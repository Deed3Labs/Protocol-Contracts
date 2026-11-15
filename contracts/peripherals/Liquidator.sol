// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./LiquidatorBase.sol";
import "./LiquidatorEnforcement.sol";

/// @title Liquidator
/// @notice The pledge module's enforcement side under MB-05: Savings on a default, pledged bonds
/// through their own terms, pledged pool shares through `PoolShareEnforcer`, and the Liquidation
/// Hold that delays all of it.
/// @dev The path for Savings is deliberately mundane. Take the CLRUSD that was standing behind the
/// credit, redeem it at the vault for the USDC that always backed it, and repay the member's savings
/// tier with that USDC. Every step is a thing the system already does.
///
/// What it does, and since Phase 2f (decisions 4, 7, 9, 10, 20-22) what it no longer does:
///  - Savings (`liquidate`) only on a computed default, only against the savings tier, and only up
///    to the Defaulted Amount still open and what the savings lock holds (MB-05 §7.2).
///  - A missed cycle takes nothing (C2, decision 4): it halves the limit and counts toward default,
///    and the registry keeps the Earn pledge locked behind the excess. `settleExcess` is gone.
///  - Pledged pool shares are never seized (C5, decision 7). `PoolShareEnforcer` redeems them
///    through the Yield Pool's queue and hands the proceeds here to apply.
///  - Pledged bonds are paid under their own terms (`payPledged`, `settle`); this contract says
///    whether MB-05 permits enforcement and applies what the bond pays.
///  - The Earn rules (the Defaulted Amount, the combined Shortfall, the MB-05 §7.1 order) run in
///    `LiquidatorEnforcement`, a delegatecall module created by this implementation's constructor.
///  - The Liquidation Hold (12.6) and any 10c pause delay every enforcement path. They move nothing.
contract Liquidator is LiquidatorBase {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice Where the Earn functions run (LiquidatorEnforcement). Created by this
    /// implementation's constructor and fixed with it: upgrading the Liquidator deploys a fresh pair.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable enforcement;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        enforcement = address(new LiquidatorEnforcement());
        _disableInitializers();
    }

    function initialize(
        address admin,
        address _stableCredit,
        address _clrusd,
        address _vault,
        address _reserveToken,
        address _collateralRegistry
    ) external initializer {
        if (
            admin == address(0) || _stableCredit == address(0) || _clrusd == address(0)
                || _vault == address(0) || _reserveToken == address(0)
                || _collateralRegistry == address(0)
        ) revert LiquidatorInvalidAddress();
        collateralRegistry = ICollateralSeizureSink(_collateralRegistry);
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        stableCredit = IStableCredit(_stableCredit);
        clrusd = IClearUSDSeizable(_clrusd);
        vault = IESADepositVault(_vault);
        reserveToken = IERC20Upgradeable(_reserveToken);
    }

    /// @notice allows or revokes an issuer whose debt the pledge module answers for.
    function setTrustedSavingsIssuer(address issuer, bool trusted) external onlyRole(OPERATOR_ROLE) {
        if (issuer == address(0)) revert LiquidatorInvalidAddress();
        trustedSavingsIssuer[issuer] = trusted;
        emit TrustedSavingsIssuerUpdated(issuer, trusted);
    }

    /// @notice the member settles their savings-backed credit out of the savings that back it.
    /// @dev The member's own instruction (MB-05 §7.9), not enforcement: their locked CLRUSD is taken
    /// past the lock, redeemed one-for-one and settled against their own SAVINGS tier, capped at
    /// what the tier owes and what they hold. Only a trusted issuer is handed the USDC.
    function settleFromSavings(address issuer, uint256 tierId, uint256 amount) external noReenter returns (uint256 repaid) {
        _requireTrusted(issuer);
        (bytes32 kind, , ) = ITierSettler(issuer).tierAt(tierId);
        if (kind != SAVINGS_KIND) revert LiquidatorNotSavingsTier(tierId, kind);

        address member = _msgSender();
        uint256 seizing = _min(amount, _min(ITierSettler(issuer).principalOf(member, tierId), clrusd.balanceOf(member)));
        if (seizing == 0) revert LiquidatorNothingToSeize(member);
        repaid = _redeemSavings(member, issuer, tierId, seizing);
        emit SettledFromSavings(member, issuer, seizing, repaid);
    }

    /// @notice applies a defaulted member's Encumbered CLRUSD to their savings tier (MB-05 §7.2).
    /// @dev Permissionless (compliance spec 10b): the default is computed on chain by a trusted
    /// issuer and recorded only by that computation. The amount is the least of: the Defaulted
    /// Amount of the line's secured positions still open (its past-due Secured Minimum, decision 22;
    /// the unpaid Rebalance Amount is unsecured debt CLRUSD never pays, MB-05 §2.5(a)), what the
    /// savings tier owes, the CLRUSD the member holds and what the registry computes as locked.
    /// Redeemed one-for-one, so there is no surplus and no deficiency. What it applies counts
    /// against the same Defaulted Amount as asset-backed enforcement on that line.
    function liquidate(address member, address issuer, uint256 tierId, bytes32 kind)
        external
        noReenter
        returns (uint256 repaid)
    {
        _requireTrusted(issuer);
        _requireNoHold(member);
        // Savings settle only the savings tier (spec 12.5; MB-05 §2.5(a)).
        (bytes32 tierKind, , ) = ITierSettler(issuer).tierAt(tierId);
        if (kind != SAVINGS_KIND || tierKind != SAVINGS_KIND) revert LiquidatorNotSavingsTier(tierId, tierKind);
        if (!_currentDefault(member, issuer)) revert LiquidatorNotInDefault(member, issuer);

        (uint256 due, , uint64 episode) = _revolvingDue(member, issuer);
        uint256 seizing = _min(_min(due, ITierSettler(issuer).principalOf(member, tierId)), clrusd.balanceOf(member));
        seizing = _min(seizing, collateralRegistry.encumberedOfKind(member, kind));
        if (seizing == 0) revert LiquidatorNothingToSeize(member);

        repaid = _redeemSavings(member, issuer, tierId, seizing);
        _noteEnforced(member, issuer, episode, repaid, 0);
        emit Liquidated(member, issuer, seizing, repaid, repaid);
    }

    /// @dev Takes `seizing` CLRUSD past the lock, records it, redeems it at the vault and settles
    /// the USDC against the savings tier.
    function _redeemSavings(address member, address issuer, uint256 tierId, uint256 seizing) private returns (uint256 redeemed) {
        clrusd.seize(member, address(this), seizing);
        // The registry stops counting a pledge that is no longer there.
        collateralRegistry.recordSeizure(member, SAVINGS_KIND, seizing);
        clrusd.approve(address(vault), seizing);
        redeemed = vault.redeem(address(reserveToken), seizing, address(this));
        reserveToken.forceApprove(issuer, redeemed);
        ITierSettler(issuer).settleFromCollateral(member, tierId, redeemed);
    }

    /// @dev A trusted issuer with tiers. A trusted term issuer (no tiers) is reached only by pledged
    /// Earn under 12.14, never by CLRUSD.
    function _requireTrusted(address issuer) private view {
        if (!trustedSavingsIssuer[issuer] || _tierCountOf(issuer) == 0) revert LiquidatorUntrustedIssuer(issuer);
    }

    /* ========== SETTINGS ========== */

    /// @notice names where the member's pause clock is read (Phase 2g, 10c). Set once.
    function setPauseClock(address clock) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (clock == address(0) || pauseClock != address(0)) revert LiquidatorPauseClockSet();
        pauseClock = clock;
        emit PauseClockSet(clock);
    }

    /// @notice sets the shortfall wait. It can only lengthen the addendum's 72 hours.
    function setShortfallWait(uint64 waitSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (waitSeconds < MIN_SHORTFALL_WAIT || waitSeconds > MAX_SHORTFALL_WAIT) revert LiquidatorBadParameter();
        _shortfallWait = waitSeconds;
        emit ShortfallWaitUpdated(waitSeconds);
    }

    /// @notice names the Yield Pool and the bond collection whose pledges MB-05 reaches. Either may
    /// be zero, which turns that kind off. What is reached stays bounded by each one's own rules.
    function setEarnSources(address pool, address bonds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        earnPool = ISeizableShares(pool);
        earnBonds = IEarnBonds(bonds);
        emit EarnSourcesUpdated(pool, bonds);
    }

    /// @notice names the `PoolShareEnforcer` whose redemption proceeds this contract applies. It
    /// can only bring USDC in: what it hands over goes to the Holder's debt or back to the Holder.
    function setPoolShareEnforcer(address enforcer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        poolShareEnforcer = enforcer;
        emit PoolShareEnforcerUpdated(enforcer);
    }

    /* ========== LIQUIDATION HOLD (12.6) ========== */

    /// @notice a member's hold, and whether it is active now.
    function holdOf(address member) external view returns (Hold memory hold, bool active) {
        hold = _holds[member];
        active = hold.confirmed && block.timestamp < hold.until;
    }

    /// @notice the governed longest a hold for this reason may run from when it was set.
    /// @dev Defaults: bankruptcy 180 days, death 90 days (decision 5), billing dispute 90 days,
    /// late default notice 30 days.
    function maxHoldOf(HoldReason reason) public view returns (uint64) {
        uint64 stored = _maxHold[reason];
        if (stored != 0) return stored;
        if (reason == HoldReason.BANKRUPTCY) return 180 days;
        if (reason == HoldReason.DEATH || reason == HoldReason.BILLING_DISPUTE) return 90 days;
        if (reason == HoldReason.LATE_NOTICE) return 30 days;
        return 0;
    }

    /// @notice governs a reason's maximum. Never above `MAX_HOLD_CEILING`.
    function setMaxHold(HoldReason reason, uint64 maxSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (reason == HoldReason.NONE || maxSeconds == 0 || maxSeconds > MAX_HOLD_CEILING) {
            revert LiquidatorBadParameter();
        }
        _maxHold[reason] = maxSeconds;
        emit MaxHoldUpdated(reason, maxSeconds);
    }

    /// @notice proposes a hold on enforcement against a member. Inactive until a second signer
    /// confirms it.
    /// @param duration seconds from now; never more than the reason's maximum.
    /// @param evidenceHash hash of the evidence. A hold that lapsed is proposed again only with
    /// different evidence, and runs its own maximum.
    function proposeHold(address member, HoldReason reason, uint64 duration, bytes32 evidenceHash)
        external
        onlyRole(HOLD_ROLE)
    {
        if (
            member == address(0) || reason == HoldReason.NONE || duration == 0 || duration > maxHoldOf(reason)
                || evidenceHash == bytes32(0)
        ) {
            revert LiquidatorBadParameter();
        }
        Hold storage hold = _holds[member];
        if (hold.confirmed) {
            if (block.timestamp < hold.until) revert LiquidatorHoldExists(member);
            if (evidenceHash == holdEvidence[member]) revert LiquidatorBadParameter();
            emit HoldLapsed(member);
        }
        uint64 until = uint64(block.timestamp) + duration;
        _holds[member] = Hold(_msgSender(), reason, false, uint64(block.timestamp), _msgSender(), until, address(0));
        holdEvidence[member] = evidenceHash;
        emit HoldProposed(member, reason, _msgSender(), until, evidenceHash);
    }

    /// @notice confirms a proposed hold. Must be a different signer from the proposer.
    function confirmHold(address member) external onlyRole(HOLD_ROLE) {
        Hold storage hold = _holds[member];
        if (hold.setAt == 0 || hold.confirmed || block.timestamp >= hold.until) revert LiquidatorNoHold(member);
        if (_msgSender() == hold.proposer) revert LiquidatorSameSigner(_msgSender());
        hold.confirmed = true;
        hold.lastSigner = _msgSender();
        emit HoldConfirmed(member, _msgSender(), hold.until);
    }

    /// @notice extends an active hold. A different signer from the last one, and never past the
    /// reason's maximum from when the hold was set.
    function renewHold(address member, uint64 until) external onlyRole(HOLD_ROLE) {
        Hold storage hold = _holds[member];
        if (!hold.confirmed || block.timestamp >= hold.until) revert LiquidatorNoHold(member);
        if (_msgSender() == hold.lastSigner) revert LiquidatorSameSigner(_msgSender());
        if (until <= hold.until || until > hold.setAt + maxHoldOf(hold.reason)) revert LiquidatorBadParameter();
        hold.until = until;
        hold.lastSigner = _msgSender();
        hold.clearProposer = address(0);
        emit HoldRenewed(member, _msgSender(), until);
    }

    /// @notice ends a hold. An active hold needs two different signers: the first call proposes,
    /// the second clears. A proposal nobody confirmed, or a hold that has lapsed, is simply dropped.
    function clearHold(address member) external onlyRole(HOLD_ROLE) {
        Hold storage hold = _holds[member];
        if (hold.setAt == 0) revert LiquidatorNoHold(member);
        if (hold.confirmed && block.timestamp >= hold.until) {
            delete _holds[member];
            emit HoldLapsed(member);
        } else if (hold.confirmed && (hold.clearProposer == address(0) || hold.clearProposer == _msgSender())) {
            hold.clearProposer = _msgSender();
            emit HoldClearProposed(member, _msgSender());
        } else {
            delete _holds[member];
            emit HoldCleared(member, _msgSender());
        }
    }

    /* ========== FORWARDED TO LiquidatorEnforcement ========== */

    /// @notice see LiquidatorEnforcement.pledgePaymentDue.
    function pledgePaymentDue(address, uint256) external view returns (bool due, address issuer, bool onDefault) {
        _forwardView();
    }

    /// @notice see LiquidatorEnforcement.applyPledgePayment.
    function applyPledgePayment(address, address, bool, uint256) external returns (uint256 applied) {
        _forward();
    }

    /// @notice see LiquidatorEnforcement.maturityToDebt.
    function maturityToDebt(address, uint256, uint256) external view returns (uint256 toDebt) {
        _forwardView();
    }

    /// @notice see LiquidatorEnforcement.applyMaturityInstruction.
    function applyMaturityInstruction(address, uint256) external {
        _forward();
    }

    /// @notice see LiquidatorEnforcement.applyDistribution.
    function applyDistribution(address, uint256) external returns (uint256 applied) {
        _forward();
    }

    /// @notice see LiquidatorEnforcement.applyPoolProceeds.
    function applyPoolProceeds(address, uint256, uint256) external returns (uint256 applied) {
        _forward();
    }

    /// @notice see LiquidatorEnforcement.noticeShortfall.
    function noticeShortfall(address) external returns (uint256 gap) {
        _forward();
    }

    /// @notice see LiquidatorEnforcement.shortfallOf.
    function shortfallOf(address) external view returns (uint256 gap, uint256 dueAt) {
        _forwardView();
    }

    /// @notice see LiquidatorEnforcement.earnDefaultedOf.
    function earnDefaultedOf(address) external view returns (uint256 due, address issuer) {
        _forwardView();
    }

    /// @notice see LiquidatorEnforcement.nextBondOf.
    function nextBondOf(address) external view returns (bool found, uint256 bondId) {
        _forwardView();
    }

    /// @dev Runs the module's implementation of this call against this contract's storage, and
    /// returns or reverts exactly as it did.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _forward() private {
        address target = enforcement;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    /// @dev `_forward` for a view: a delegatecall the compiler lets a view make, by casting it to
    /// one. The module's views write nothing, and a write would revert under a static call anyway.
    function _forwardView() private view {
        function() internal fn = _forward;
        function() internal view viewFn;
        assembly {
            viewFn := fn
        }
        viewFn();
    }
}
