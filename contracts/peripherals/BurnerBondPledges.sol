// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./BurnerBondBase.sol";

/// @title BurnerBondPledges
/// @notice The pledged-bond terms of a BurnerBond: the pledge payment term (`payPledged`, IV-01
/// §4.9) and maturity settlement with the pledged split (`settle`, MB-05 §5.6).
/// @dev A delegatecall module. BurnerBond's implementation pins it in its constructor and forwards
/// these two calls to it; it runs against the collection's storage (BurnerBondBase) and is never
/// called directly. Called directly it has no bonds, no vault and no pledge module, so every call
/// reverts.
///
/// **Founder answer G (Phase 2e).** `payPledged` replaces the Liquidator's seize-and-redeem path:
/// the bond is not taken from the Holder and redeemed by someone else, it is paid under its own
/// terms and the payment goes where those terms say. The bond decides the amount (its Accreted
/// Value in this block), the bond burns, and the pledge module's only parts are to say whether MB-05
/// permits enforcement against this bond and to apply the money to the Holder's own debt.
contract BurnerBondPledges is BurnerBondBase {
    /// @notice what BurnerBond's constructor checks before pinning this as its module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("BurnerBondPledges.v1");
    }

    /// @notice see BurnerBond.payPledged.
    function payPledged(uint256 bondId) external nonReentrant returns (uint256 amount) {
        IBurnerBond.BondInfo storage bond = bonds[bondId];
        address holder = holderOf[bondId];
        IBondPledgeEnforcer enforcer = IBondPledgeEnforcer(liquidator);
        // Never an unpledged or released bond (IV-01 §4.9(d)), and never without a pledge module.
        if (
            bond.creator == address(0) || bond.isRedeemed || holder == address(0)
                || address(enforcer) == address(0) || !_isPledged(holder, bondId)
        ) revert BurnerBondNotPledgePayable(bondId);

        // MB-05 §6.1 as recorded on chain, and only for the bond the module requests (§7.3(c)).
        (bool due, address issuer, bool onDefault) = enforcer.pledgePaymentDue(holder, bondId);
        if (!due) revert BurnerBondNotPledgePayable(bondId);

        // FIXED: the whole Accreted Value in this block. The vault pays exactly this or reverts.
        amount = _presentValue(bondId);
        _retire(bondId, holder, amount);
        bondVault.settleEarly(bondId, address(enforcer), amount);
        // The module applies it to this Holder's secured debt in its order and pays the surplus to
        // the Holder; it is given no other address.
        uint256 applied = enforcer.applyPledgePayment(holder, issuer, onDefault, amount);
        encumbranceSource.releaseRetiredItem(holder, collateralKind, bondId);
        emit PledgePaid(bondId, holder, amount, applied, amount - applied);
    }

    /// @notice see BurnerBond.settle.
    function settle(uint256 bondId) external nonReentrant returns (uint256 toDebt, uint256 toHolder) {
        IBurnerBond.BondInfo storage bond = bonds[bondId];
        address holder = holderOf[bondId];
        // Matured, unredeemed, and paying out: a bond that rolls is rolled, not settled.
        if (
            bond.creator == address(0) || bond.isRedeemed || holder == address(0)
                || block.timestamp < bond.maturityDate || !autoRollOptedOut[bondId]
        ) revert BurnerBondNotSettleable(bondId);

        uint256 maturityAmount = bond.faceValue;
        if (!_isPledged(holder, bondId)) {
            _retire(bondId, holder, maturityAmount);
            toHolder = bondVault.settle(bondId, holder);
            emit IBurnerBond.BondRedeemed(bondId, holder, toHolder);
            return (0, toHolder);
        }

        // The Maturity Instruction (MB-05 §5.6). toDebt is computed from on-chain values in this
        // block -- what keeps Asset-Backed Drawn within the limit the Holder has without this bond
        // -- and never exceeds the Maturity Amount. No caller or role supplies any part of it.
        IBondPledgeEnforcer enforcer = IBondPledgeEnforcer(liquidator);
        toDebt = enforcer.maturityToDebt(holder, bondId, maturityAmount);
        if (toDebt > maturityAmount) toDebt = maturityAmount;
        toHolder = maturityAmount - toDebt;

        _retire(bondId, holder, maturityAmount);
        // toDebt first, then toHolder, from what the vault and the treasury hold; whatever of either
        // they cannot pay is recorded for `completeSettlement`, debt part first (owner decision).
        // toHolder goes to the Holder and nowhere else, never locked or held.
        uint256 debtPaid = bondVault.settlePledged(bondId, address(enforcer), toDebt, holder);
        if (debtPaid > 0) enforcer.applyMaturityInstruction(holder, debtPaid);
        encumbranceSource.releaseRetiredItem(holder, collateralKind, bondId);
        emit PledgedMaturitySplit(bondId, toDebt, toHolder);
    }
}
