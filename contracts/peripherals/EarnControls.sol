// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "./EarnControlsBase.sol";
import "./IExtensionKind.sol";

/// @title EarnControls
/// @notice The one governed contract the Earn products share (Phase 2f, decision 1): the Funding
/// Limit, the offering maxima and pool capacity, eligibility by attestation with its net-worth
/// figure, the 10% holder cap per household with its bootstrap floor, the subscription and purchase
/// pauses, the Ladder, the Successor path and the transfer policy (IV-02 §§2.4-2.6, 8.1; Earn
/// §§1, 2, 6). The Yield Pool reads it through `IPoolEarnControls`; the bond collections, the
/// BondVault and the Collateral Agent through `IEarnControls`.
/// @dev Nothing here holds, moves or freezes a position or any USDC. Every function answers a
/// question or refuses a new purchase or subscription; none reaches a Member's Smart Account.
///
/// The governed settings, the Ladder, the Successor path, households and the holder-ineligible
/// flag run in the delegatecall module `EarnControlsAdmin` (for size), reached through the
/// fallback. The full external surface is `IEarnControls` plus both contracts' ABIs.
contract EarnControls is EarnControlsBase, IPoolEarnControls {
    using MathUpgradeable for uint256;

    /// @notice EIP-712 type of an eligibility attestation (IV-02 §§2.1, 2.5(b), 10.1): the
    /// exemption tag and the net worth established under IV-03 §2.5, in reserve-token units.
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "EligibilityAttestation(address account,bytes32 exemptionCode,uint256 netWorth,uint64 issuedAt,uint64 validUntil)"
    );

    uint256 internal constant WAD = 1e18;
    /// @notice FIXED: the smallest BurnerBond Purchase Price, in dollars (§1).
    uint256 public constant MIN_PURCHASE_DOLLARS = 250;
    /// @notice IV-02 §2.5(b): Earn Products at purchase price up to 10% of net worth.
    uint256 public constant NET_WORTH_LIMIT_BPS = 1_000;
    /// @notice IV-02 §2.6: 30 consecutive days below 50% Utilization.
    uint64 public constant LOW_UTILIZATION_WINDOW = 30 days;

    /// @notice The admin and registry module, fixed for the life of this implementation.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable adminModule;

    /// @notice The initial governed settings, in reserve-token units.
    struct Settings {
        address admin;
        uint8 decimals;
        address membership;
        uint256 fundingLimit;
        bytes32 fundingResolution;
        uint16 fiscalYear;
        uint256 offeringCap;
        uint256 poolOfferingCap;
        uint256 poolCapacity;
        uint256 holderCapFloor;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address admin_) {
        _disableInitializers();
        if (IExtensionKind(admin_).extensionKind() != keccak256("EarnControlsAdmin.v1")) {
            revert EarnControlsModuleMismatch();
        }
        adminModule = admin_;
    }

    /// @param s the initial settings; `s.admin` is the Earn timelock (decision 2)
    function initialize(Settings calldata s) external initializer {
        if (s.admin == address(0)) revert EarnControlsInvalidAddress();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __EIP712_init("EarnControls", "1");
        _grantRole(DEFAULT_ADMIN_ROLE, s.admin);
        unit = 10 ** uint256(s.decimals);
        membership = IEarnMembership(s.membership);
        fundingLimit = s.fundingLimit;
        fundingLimitResolution = s.fundingResolution;
        fundingLimitFiscalYear = s.fiscalYear;
        offeringCap = s.offeringCap;
        poolOfferingCap = s.poolOfferingCap;
        poolCapacity = s.poolCapacity;
        holderCapBps = 1_000;
        _holderCapFloor = s.holderCapFloor;
        emit SettingsSet("fundingLimit", s.fundingLimit, s.fundingResolution);
        emit SettingsSet("offeringCap", s.offeringCap, bytes32(0));
        emit SettingsSet("poolOfferingCap", s.poolOfferingCap, bytes32(0));
        emit SettingsSet("poolCapacity", s.poolCapacity, bytes32(0));
        emit SettingsSet("holderCapBps", 1_000, bytes32(0));
        emit HolderCapFloorScheduled(0, s.holderCapFloor, uint64(block.timestamp));
    }

    /* ========== THE POOL'S QUESTIONS (IPoolEarnControls) ========== */

    /// @inheritdoc IPoolEarnControls
    /// @dev Only the Yield Pool may ask, since an attestation passed here is recorded and the
    /// subscription is booked against the pool's offering maximum and the member's net worth. The
    /// pool calls this before it takes the USDC, so every limit is counted on the figures after
    /// the subscription (IV-02 §2.5: "accepted only if, after it").
    function checkSubscription(address payer, address receiver, uint256 assets, bytes calldata attestation)
        external
        returns (bytes32 exemptionCode)
    {
        address pool = yieldPool;
        if (msg.sender != pool || pool == address(0)) revert EarnControlsNotAuthorized(msg.sender);
        if (subscriptionsPaused()) revert EarnControlsPaused();
        _checkParties(payer, receiver);
        exemptionCode = _eligible(payer, attestation);
        IEarnPoolView p = IEarnPoolView(pool);
        uint256 shares = p.previewDeposit(assets);
        uint256 before = p.totalAssets();
        _within("capacity", before, assets, poolCapacity);
        _within("funding", fundingUsed(), assets, fundingLimit);
        uint256 taken = poolOfferingTaken;
        _within("offering", taken, assets, poolOfferingCap);
        poolOfferingTaken = taken + assets;
        emit OfferingTaken(receiver, true, assets, taken + assets);
        _bookCost(payer, assets, shares, true);
        if (before + assets > holderCapFloor()) {
            uint256 held = shares;
            address[] memory wallets = walletsOf(receiver);
            for (uint256 i; i < wallets.length; ++i) {
                held += p.balanceOf(wallets[i]) + p.queuedSharesOf(wallets[i]);
            }
            uint256 limit = ((p.totalSupply() + shares) * holderCapBps) / BPS;
            if (held > limit) revert EarnControlsHolderCap(receiver, held, limit);
        }
    }

    /// @inheritdoc IPoolEarnControls
    /// @dev IV-02 §2.6: a Reserve Shortfall (the two-person flag, or the BondVault's own), the
    /// Equity Cushion not met, or, while L-01 §2.9(c) applies, Utilization below 50% for 30
    /// consecutive days. A pool that cannot answer the last question counts as paused.
    function subscriptionsPaused() public view returns (bool) {
        if (_commonPause()) return true;
        if (pauseFlags & LOW_UTILIZATION_RULE == 0) return false;
        address pool = yieldPool;
        if (pool == address(0)) return true;
        try IPoolUtilizationClock(pool).lowUtilizationSince() returns (uint64 since) {
            return since != 0 && block.timestamp >= uint256(since) + LOW_UTILIZATION_WINDOW;
        } catch {
            return true;
        }
    }

    /// @inheritdoc IPoolEarnControls
    /// @dev The holder-cap group (IV-02 §2.5(c)): every wallet of every member of the account's
    /// household as recorded, or of its member alone when none is recorded.
    function walletsOf(address account) public view returns (address[] memory all) {
        bytes32 h = householdOf[memberKeyOf(account)];
        if (h == bytes32(0)) return memberWalletsOf(account);
        address[] memory reps = _households[h];
        address[][] memory each = new address[][](reps.length);
        uint256 n;
        for (uint256 i; i < reps.length; ++i) {
            each[i] = memberWalletsOf(reps[i]);
            n += each[i].length;
        }
        all = new address[](n);
        n = 0;
        for (uint256 i; i < reps.length; ++i) {
            for (uint256 j; j < each[i].length; ++j) all[n++] = each[i][j];
        }
    }

    /// @inheritdoc IPoolEarnControls
    /// @dev IV-02 §8.1: between two Smart Accounts of the same Holder, or by operation of law
    /// (the Successor path, open 30 days). A pledge moves nothing.
    function transferAllowed(address from, address to) external view returns (bool) {
        if (sameHolder(from, to)) return true;
        SuccessorApproval storage a = _successorTransfers[from][to];
        return a.approvedAt != 0 && block.timestamp <= uint256(a.approvedAt) + SUCCESSOR_WINDOW;
    }

    /* ========== THE BONDS' QUESTIONS (IEarnControls) ========== */

    /// @notice see IEarnControls.checkPurchase.
    function checkPurchase(
        address payer,
        address holder,
        uint256 purchasePrice,
        uint256 maturityAmount,
        uint32 termDays,
        bytes calldata attestation
    ) external onlyRole(BOND_ROLE) returns (bytes32 exemptionCode) {
        if (purchasesPaused()) revert EarnControlsPaused();
        _checkParties(payer, holder);
        if (purchasePrice < MIN_PURCHASE_DOLLARS * unit) revert EarnControlsBelowMinimum(purchasePrice);
        if (!_rungs[termDays].offered) revert EarnControlsTermNotOffered(termDays);
        exemptionCode = _eligible(payer, attestation);
        _within("funding", fundingUsed(), maturityAmount, fundingLimit);
        uint256 taken = offeringTaken;
        _within("offering", taken, purchasePrice, offeringCap);
        offeringTaken = taken + purchasePrice;
        emit OfferingTaken(holder, false, purchasePrice, taken + purchasePrice);
        _bookCost(payer, purchasePrice, 0, false);
    }

    /// @notice see IEarnControls.recordBondExit.
    function recordBondExit(address holder, uint256 purchasePrice) external onlyRole(BOND_ROLE) {
        uint256 key = memberKeyOf(holder);
        Cost storage c = _costs[key];
        c.bondCost = c.bondCost > purchasePrice ? c.bondCost - purchasePrice : 0;
        emit EarnCostRecorded(key, c.poolCost, c.bondCost);
    }

    /// @notice see IEarnControls.purchasesPaused.
    function purchasesPaused() public view returns (bool) {
        return _commonPause() || _enforcement();
    }

    /// @notice see IEarnControls.rollAllowed: only an Enforcement Notice stops a roll.
    function rollAllowed() external view returns (bool) {
        return !_enforcement();
    }

    /* ========== LIMITS AND ELIGIBILITY ========== */

    /// @notice what counts against the Funding Limit (decision 12): outstanding BurnerBonds at their
    /// Maturity Amount, plus outstanding Pool Shares at Share Value (rounded up).
    function fundingUsed() public view returns (uint256 used) {
        address[] memory books = _bondBooks;
        for (uint256 i; i < books.length; ++i) used += IEarnBondBook(books[i]).totalFaceOutstanding();
        address pool = yieldPool;
        if (pool != address(0)) {
            IEarnPoolView p = IEarnPoolView(pool);
            used += p.totalSupply().mulDiv(p.shareValue(), WAD, MathUpgradeable.Rounding.Up);
        }
    }

    function bondBooks() external view returns (address[] memory) {
        return _bondBooks;
    }

    /// @notice Pool Assets at or below which the 10% holder cap does not apply (decision 23).
    function holderCapFloor() public view returns (uint256) {
        uint64 at = _holderCapFloorAt;
        return at != 0 && block.timestamp >= at ? _pendingHolderCapFloor : _holderCapFloor;
    }

    /// @notice a scheduled floor and when it applies (zeros when none is pending).
    function pendingHolderCapFloor() external view returns (uint256 floor, uint64 effectiveAt) {
        uint64 at = _holderCapFloorAt;
        if (at == 0 || block.timestamp >= at) return (0, 0);
        return (_pendingHolderCapFloor, at);
    }

    function eligibilityOf(address account) external view returns (Eligibility memory) {
        return _eligibility[account];
    }

    /// @notice a member's Earn Products at purchase price, as last booked.
    function earnCostOf(address account) external view returns (Cost memory) {
        return _costs[memberKeyOf(account)];
    }

    /// @notice records an eligibility attestation ahead of a purchase or subscription. Anyone may
    /// submit one: it counts only if an attester signed it for that account.
    function attestEligibility(address account, bytes calldata attestation) external returns (bytes32) {
        if (attestation.length == 0) revert EarnControlsBadAttestation();
        return _eligible(account, attestation);
    }

    /// @notice the EIP-712 digest an attester signs for `account`.
    function attestationDigest(address account, bytes32 exemptionCode, uint256 netWorth, uint64 issuedAt, uint64 validUntil)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(ATTESTATION_TYPEHASH, account, exemptionCode, netWorth, issuedAt, validUntil))
        );
    }

    /// @notice sets or clears a pause flag (IV-02 §2.6), two `PAUSE_ROLE` holders. The flags stop
    /// new purchases and subscriptions only: never a roll, a redemption or a withdrawal.
    function setPauseFlag(uint8 flag, bool on, bytes32 reasonHash) external {
        if (flag != RESERVE_SHORTFALL && flag != EQUITY_CUSHION && flag != LOW_UTILIZATION_RULE) {
            revert EarnControlsInvalidValue();
        }
        (bool done, address first) =
            _pair(keccak256(abi.encode(this.setPauseFlag.selector, flag, on, reasonHash)), PAUSE_ROLE);
        if (!done) return;
        pauseFlags = on ? pauseFlags | flag : pauseFlags & ~flag;
        emit PauseFlagSet(flag, on, reasonHash, first, msg.sender);
    }

    /* ========== THE MODULE ========== */

    /// @dev Everything else runs in `EarnControlsAdmin` against this storage.
    fallback() external {
        address target = adminModule;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    /* ========== INTERNALS ========== */

    function _within(bytes32 what, uint256 used, uint256 adding, uint256 limit) internal pure {
        if (used + adding > limit) revert EarnControlsLimit(what, used, adding, limit);
    }

    function _checkParties(address payer, address receiver) internal view {
        if (refused[payer]) revert EarnControlsRefused(payer);
        if (refused[receiver]) revert EarnControlsRefused(receiver);
        if (receiver == address(0) || !sameHolder(payer, receiver)) revert EarnControlsNotSameHolder(payer, receiver);
    }

    /// @dev Books `amount` of new Earn Product at purchase price for the payer's member, after
    /// bringing the Pool Share cost down to the shares still held (average cost), and refuses it
    /// above 10% of the payer's attested net worth (IV-02 §2.5(b)).
    function _bookCost(address payer, uint256 amount, uint256 shares, bool pool) internal {
        uint256 key = memberKeyOf(payer);
        Cost storage c = _costs[key];
        uint256 held;
        address p = yieldPool;
        if (p != address(0)) {
            address[] memory wallets = memberWalletsOf(payer);
            for (uint256 i; i < wallets.length; ++i) {
                held += IEarnPoolView(p).balanceOf(wallets[i]) + IEarnPoolView(p).queuedSharesOf(wallets[i]);
            }
        }
        uint256 poolCost = c.poolCost;
        if (held < c.poolShares) poolCost = poolCost.mulDiv(held, c.poolShares);
        uint256 limit = _eligibility[payer].netWorth.mulDiv(NET_WORTH_LIMIT_BPS, BPS);
        _within("netWorth", poolCost + c.bondCost, amount, limit);
        if (pool) poolCost += amount;
        else c.bondCost += amount;
        c.poolCost = uint128(poolCost);
        c.poolShares = uint128(held + shares);
        emit EarnCostRecorded(key, poolCost, c.bondCost);
    }

    /// @dev Records `attestation` when one is given (a newer one replaces the record), then
    /// requires an attestation in force whose attester still holds the role.
    function _eligible(address account, bytes calldata attestation) internal returns (bytes32) {
        Eligibility storage e = _eligibility[account];
        if (attestation.length != 0) {
            (address attester, bytes32 code, uint256 netWorth, uint64 issuedAt, uint64 validUntil, bytes memory sig) =
                abi.decode(attestation, (address, bytes32, uint256, uint64, uint64, bytes));
            if (
                code == bytes32(0) || netWorth == 0 || !hasRole(ATTESTER_ROLE, attester) || issuedAt > block.timestamp
                    || validUntil < block.timestamp || issuedAt < e.issuedAt
                    || !SignatureCheckerUpgradeable.isValidSignatureNow(
                        attester, attestationDigest(account, code, netWorth, issuedAt, validUntil), sig
                    )
            ) revert EarnControlsBadAttestation();
            _eligibility[account] = Eligibility(code, attester, issuedAt, validUntil, netWorth);
            emit EligibilityAttested(account, attester, code, netWorth, issuedAt, validUntil);
        }
        if (e.exemptionCode == bytes32(0) || block.timestamp > e.validUntil || !hasRole(ATTESTER_ROLE, e.attester)) {
            revert EarnControlsIneligible(account);
        }
        return e.exemptionCode;
    }

    /// @dev The pauses bonds and the pool share: the Reserve Shortfall (flag or BondVault) and the
    /// Equity Cushion.
    function _commonPause() internal view returns (bool) {
        if (pauseFlags & (RESERVE_SHORTFALL | EQUITY_CUSHION) != 0) return true;
        address s = reserveStatus;
        return s != address(0) && IEarnReserveStatus(s).inReserveShortfall();
    }

    function _enforcement() internal view returns (bool) {
        address a = collateralAgent;
        return a != address(0) && IEarnEnforcementStatus(a).enforcementInForce();
    }
}
