// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import "./BurnerBondBase.sol";
import "./IExtensionKind.sol";

/// @title BurnerBondPledges
/// @notice How a BurnerBond leaves (Earn §4): `settle` at maturity (a payout, the pledged split of
/// MB-05 §5.6, or a confirmed roll under IV-01 §5.2), `payPledged` (IV-01 §4.9), `buyback`
/// (Earn §4(a)) and `redeemUnderWindDown` (Earn §4(c), R5).
/// @dev A delegatecall module. BurnerBond pins it in its constructor and reaches it through its
/// fallback; it runs against the collection's storage (BurnerBondBase) and is never called directly.
/// Anything it does not declare goes on to BurnerBondIssue, which it pins in its own constructor.
///
/// While the Collateral Agent's Enforcement Notice is in force every one of these reverts in the
/// BondVault (IV-10 §7.2; decisions 5 and 19): a bond is then paid only through the Agent's rounds,
/// and no roll executes, even a confirmed one.
/// @dev The Funding Limit as EarnControls measures it (decision 12).
interface IEarnFunding {
    function fundingUsed() external view returns (uint256);
    function fundingLimit() external view returns (uint256);
}

contract BurnerBondPledges is BurnerBondBase {
    using SafeERC20 for IERC20;

    /// @notice Where purchases, notices, confirmations and the wind-down flag run (BurnerBondIssue).
    address public immutable issue;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address issue_) {
        _disableInitializers();
        if (IExtensionKind(issue_).extensionKind() != keccak256("BurnerBondIssue.v1")) revert BurnerBondModuleMismatch();
        issue = issue_;
    }

    /// @notice what BurnerBond's constructor checks before pinning this as its module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("BurnerBondPledges.v2");
    }

    /// @notice settles a matured bond. Anyone may call it, at or after its Maturity Date.
    /// @dev A bond whose Holder confirmed its Roll Notice rolls, unless the Holder is flagged
    /// ineligible or `redeemAll` has started: the new Maturity Amount is the old one ÷ the new price
    /// per dollar at the notice yield (or any higher Ladder yield), rounded down to the cent, the
    /// remainder is paid to the Holder, no other USDC leaves the vault, and a pledged bond's
    /// replacement is re-pledged in the same transaction. Otherwise it pays out: an unpledged bond its
    /// Maturity Amount to the Holder (or its payment Successor), a pledged one through its Maturity
    /// Instruction split (`toDebt` to the Holder's own Asset-Backed Drawn, the rest to the Holder).
    /// What the vault cannot pay is recorded as a settlement shortfall.
    /// @return toDebt applied to the Holder's Asset-Backed Drawn (0 for a roll)
    /// @return toHolder owed to the Holder (for a roll: the new bond's id)
    function settle(uint256 bondId) external nonReentrant returns (uint256 toDebt, uint256 toHolder) {
        (BondInfo storage b, address holder) = _exists(bondId);
        if (block.timestamp < b.maturityDate) revert BurnerBondNotSettleable(bondId);

        if (_notices[bondId].confirmed && redeemAllFrom == 0 && !controls.holderIneligible(holder)) {
            uint256 newId = _roll(bondId, b, holder);
            if (newId != 0) return (0, newId);
        }

        uint256 maturityAmount = b.faceValue;
        if (!_isPledged(holder, bondId)) {
            _retire(bondId, holder, maturityAmount, true);
            bondVault.settle(bondId, holder);
            emit BondRedeemed(bondId, holder, maturityAmount);
            return (0, maturityAmount);
        }
        (toDebt, toHolder) = _payPledgedSplit(bondId, holder, maturityAmount);
        emit PledgedMaturitySplit(bondId, toDebt, toHolder);
    }

    /// @notice pays a pledged bond under its pledge payment term (IV-01 §4.9; MB-05 §7.3(a)). Anyone
    /// may call it; it succeeds only when the pledge module reports that MB-05 permits enforcement
    /// against this bond, pays its whole Accreted Value in this block (FIXED: never less) to the
    /// Holder's own MB-05 secured debt with any surplus to the Holder, releases the pledge and burns
    /// the bond. Not while an Enforcement Notice is in force (C3, decision 5).
    function payPledged(uint256 bondId) external nonReentrant returns (uint256 amount) {
        BondInfo storage b = _bonds[bondId];
        address holder = holderOf[bondId];
        IBondPledgeEnforcer enforcer = IBondPledgeEnforcer(liquidator);
        if (
            b.faceValue == 0 || b.isRedeemed || holder == address(0) || address(enforcer) == address(0)
                || !_isPledged(holder, bondId)
        ) revert BurnerBondNotPledgePayable(bondId);
        (bool due, address issuer, bool onDefault) = enforcer.pledgePaymentDue(holder, bondId);
        if (!due) revert BurnerBondNotPledgePayable(bondId);

        amount = _presentValue(bondId);
        _retire(bondId, holder, amount, true);
        bondVault.settleEarly(bondId, address(enforcer), amount);
        uint256 applied = enforcer.applyPledgePayment(holder, issuer, onDefault, amount);
        encumbranceSource.releaseRetiredItem(holder, collateralKind, bondId);
        emit PledgePaid(bondId, holder, amount, applied, amount - applied);
    }

    /// @notice buys a bond back (Earn §4(a)): the caller pays `price` from outside the BondVault to
    /// the Holder (or its payment Successor), on the Holder's signature over that price, and the bond
    /// burns while the vault stops owing it. `price` may not exceed the Accreted Value now. Refused on
    /// a pledged bond, during a Reserve Shortfall, and while an Enforcement Notice is in force.
    function buyback(uint256 bondId, uint256 price, uint256 deadline, bytes calldata sig) external nonReentrant {
        (, address holder) = _exists(bondId);
        if (_isPledged(holder, bondId)) revert BurnerBondPledged(bondId);
        if (block.timestamp > deadline || price > _presentValue(bondId) || bondVault.inReserveShortfall()) {
            revert BurnerBondBuybackRefused(bondId);
        }
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(BUYBACK_TYPEHASH, bondId, price, deadline)));
        if (!SignatureCheckerUpgradeable.isValidSignatureNow(holder, digest, sig)) revert BurnerBondBadSignature();
        _retire(bondId, holder, price, true);
        bondVault.retireUnpaid(bondId);
        underlyingToken.safeTransferFrom(msg.sender, _payee(holder), price);
        emit BondBoughtBack(bondId, holder, msg.sender, price);
    }

    /// @notice pays one bond its Accreted Value once `redeemAll` has started (Earn §4(c), R5).
    /// Anyone may call it. A pledged bond settles through the pledged split (decision 14): the part
    /// that keeps the Holder's Asset-Backed Drawn within their limit without it goes to that debt,
    /// the rest to the Holder.
    function redeemUnderWindDown(uint256 bondId) external nonReentrant returns (uint256 amount) {
        if (redeemAllFrom == 0) revert BurnerBondNotWindingDown();
        (, address holder) = _exists(bondId);
        amount = _presentValue(bondId);
        uint256 toDebt;
        if (!_isPledged(holder, bondId)) {
            _retire(bondId, holder, amount, true);
            bondVault.settleAt(bondId, address(0), 0, holder, amount);
        } else {
            (toDebt,) = _payPledgedSplit(bondId, holder, amount);
        }
        emit RedeemedUnderWindDown(bondId, holder, amount, toDebt);
    }

    /// @dev The Maturity Instruction split (MB-05 §5.6) of `amount`: computed by the pledge module
    /// from on-chain values in this block, never above `amount`; the debt part first.
    function _payPledgedSplit(uint256 bondId, address holder, uint256 amount)
        internal
        returns (uint256 toDebt, uint256 toHolder)
    {
        IBondPledgeEnforcer enforcer = IBondPledgeEnforcer(liquidator);
        toDebt = enforcer.maturityToDebt(holder, bondId, amount);
        if (toDebt > amount) toDebt = amount;
        toHolder = amount - toDebt;
        _retire(bondId, holder, amount, true);
        uint256 debtPaid = amount == _bonds[bondId].faceValue
            ? bondVault.settlePledged(bondId, address(enforcer), toDebt, holder)
            : bondVault.settleAt(bondId, address(enforcer), toDebt, holder, amount);
        if (debtPaid > 0) enforcer.applyMaturityInstruction(holder, debtPaid);
        encumbranceSource.releaseRetiredItem(holder, collateralKind, bondId);
    }

    /// @dev A confirmed roll (IV-01 §5.2): into the same term or, if it is not offered now, the
    /// nearest shorter Ladder term; at the Roll Notice yield (decision 11) or any higher Ladder yield
    /// for that term now. No roll (0) when no such term is offered or the larger Maturity Amount would
    /// exceed the Funding Limit (IV-01 §5.4); the bond is then paid instead. The new bond starts with
    /// no Roll Notice and unconfirmed, keeps the old one's cost basis and exemption tag, and is issued
    /// at the old Maturity Date.
    function _roll(uint256 bondId, BondInfo storage b, address holder) internal returns (uint256 newId) {
        RollNotice storage n = _notices[bondId];
        uint32 term = controls.rollTermFor(b.termDays);
        if (term == 0) return 0;
        uint32 yieldBps = controls.rollYieldFor(term, n.yieldBps);
        (uint256 newFace, uint256 price, uint256 remainder) =
            Accretion.rollTerms(b.faceValue, yieldBps, term, cent);
        IEarnFunding f = IEarnFunding(address(controls));
        if (f.fundingUsed() + newFace > f.fundingLimit() + b.faceValue) return 0;
        uint64 start = b.maturityDate;
        uint64 maturity = start + uint64(term) * 1 days;
        newId = _issue(
            holder,
            BondInfo(newFace, price, b.costBasis, 0, start, maturity, term, yieldBps, false, b.exemptionCode)
        );
        bool pledged = _isPledged(holder, bondId);
        _retire(bondId, holder, 0, false);
        bondVault.roll(bondId, newId, newFace, maturity, yieldBps, term, holder, remainder);
        if (pledged) encumbranceSource.rollItem(holder, collateralKind, bondId, newId);
        emit BondRolled(bondId, newId, holder, newFace, term, yieldBps, remainder);
    }

    /// @dev Everything else: BurnerBondIssue, against the same storage.
    fallback() external {
        address target = issue;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
