// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./LiquidatorBase.sol";

/// @dev The Yield Pool (LendingPool), as the enforcer uses it.
interface IEnforcementPool {
    function asset() external view returns (address);
    function collateralKind() external view returns (bytes32);
    function balanceOf(address account) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function enforcementQueuedOf(address holder) external view returns (uint256);
    function enforcementFilledOf(address holder) external view returns (uint256 shares, uint256 paid);
    function queueRequest(uint256 requestId)
        external
        view
        returns (address owner, address receiver, uint256 shares, uint256 requestedAt, bool enforcement);
    function enforcementRedeem(address holder, uint256 shares) external returns (uint256 requestId);
    function cancelRequest(uint256 requestId, uint256 shares) external;
    function claimUnpaid() external;
}

/// @dev The Liquidator, as the enforcer reads it: the Defaulted Amounts and the Shortfall it
/// computes, the hold and pause, and where it applies the proceeds.
interface IPledgeEnforcement {
    function earnDefaultedOf(address member) external view returns (uint256 due, address issuer);
    function shortfallOf(address member) external view returns (uint256 gap, uint256 dueAt);
    function holdOf(address member) external view returns (LiquidatorBase.Hold memory hold, bool active);
    function pauseClock() external view returns (address);
    function earnBonds() external view returns (address);
    function trustedSavingsIssuer(address issuer) external view returns (bool);
    function shortfallNoticedAt(address member, address issuer) external view returns (uint64);
    function applyPoolProceeds(address member, uint256 amount, uint256 shares) external returns (uint256 applied);
}

/// @dev The registry, as the enforcer reads it.
interface IPledgeRegistry {
    function collateralValueOf(address member, bytes32 kind) external view returns (uint256);
    function advanceBpsOf(address member, bytes32 kind) external view returns (uint256);
    function encumberedOfKind(address holder, bytes32 kind) external view returns (uint256);
    function pledgedItemsOf(address member, bytes32 kind) external view returns (uint256[] memory);
    function isItemPledged(address holder, bytes32 kind, uint256 itemId) external view returns (bool);
    function networkRegistry() external view returns (address);
}

/// @title PoolShareEnforcer
/// @notice The pledge module's pool-share side under MB-05 (Phase 2f, decisions 7 and 10, C5).
/// Pledged Pool Shares are never seized: when MB-05 permits enforcement, this contract asks the
/// Yield Pool to redeem only the shares still needed, through its ordinary queue, at Share Value
/// when filled (MB-05 §7.3(b)). The proceeds come here, and the Liquidator applies them to the
/// Holder's Defaulted Amounts, oldest plan first, or to end the Shortfall; the surplus goes to the
/// Holder.
/// @dev Holds the pool's `ENFORCER_ROLE` and is the pool's recorded `enforcementDestination`. It
/// has no owner, role, setter or upgrade: every address is fixed at deployment, and every function
/// is permissionless and moves only what the rules compute.
///
/// What it asks for:
///  - **On a default** (MB-05 §7.1(b), (d)): the Defaulted Amounts Earn may pay (decision 22, from
///    the Liquidator), less what the member's pledged bonds will pay at Present Value, since bonds
///    come first (decision 10), less what is already queued.
///  - **On a Shortfall** past its wait (§7.1(c), decision 21): pool shares come first, in the
///    smallest amount that ends it. Redeeming r of Pool Share Value lowers the drawn by r and the
///    limit by r times the advance rate, so r is the Shortfall / (1 - rate), capped at the pledge.
///  - Never more shares than the pool's pledge lock allows, and nothing while a Liquidation Hold or
///    a 10c pause is in force.
///
/// What it gives back: if the need falls (the member pays, cures, or releases), anyone may cancel
/// the queued shares no longer needed, which go back to the Holder (`cancelExcess`).
contract PoolShareEnforcer {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    IEnforcementPool public immutable pool;
    IPledgeEnforcement public immutable liquidator;
    IPledgeRegistry public immutable registry;
    IERC20 public immutable reserve;

    /// @notice holder => the pool's cumulative enforcement fill already handed to the Liquidator.
    mapping(address => uint256) public settledShares;
    mapping(address => uint256) public settledPaid;

    error PoolShareEnforcerInvalidAddress();
    error PoolShareEnforcerBlocked(address holder);
    error PoolShareEnforcerNothingNeeded(address holder);
    error PoolShareEnforcerNothingToSettle(address holder);
    error PoolShareEnforcerNotExcess(uint256 requestId);

    event EnforcementRequested(address indexed holder, uint256 indexed requestId, uint256 shares, uint256 value, bool onDefault);
    event EnforcementSettled(address indexed holder, uint256 shares, uint256 proceeds, uint256 applied);
    event EnforcementCancelled(address indexed holder, uint256 indexed requestId, uint256 shares);

    constructor(address pool_, address liquidator_, address registry_) {
        if (pool_ == address(0) || liquidator_ == address(0) || registry_ == address(0)) {
            revert PoolShareEnforcerInvalidAddress();
        }
        pool = IEnforcementPool(pool_);
        liquidator = IPledgeEnforcement(liquidator_);
        registry = IPledgeRegistry(registry_);
        reserve = IERC20(IEnforcementPool(pool_).asset());
    }

    /* ========== VIEWS ========== */

    /// @notice the Pool Share Value MB-05 lets enforcement redeem in all for this holder now, the
    /// shares already queued included, and whether it is for a default (else a Shortfall).
    /// @dev Ignores the hold and the pause, which delay enforcement but do not change the need.
    function valueNeeded(address holder) public view returns (uint256 value, bool onDefault) {
        (uint256 due, ) = liquidator.earnDefaultedOf(holder);
        if (due > 0) {
            uint256 bonds = _bondsValue(holder);
            return (due > bonds ? due - bonds : 0, true);
        }
        (uint256 gap, uint256 dueAt) = liquidator.shortfallOf(holder);
        if (gap == 0 || dueAt == 0 || block.timestamp < dueAt) return (0, false);
        bytes32 kind = pool.collateralKind();
        uint256 pledged = registry.collateralValueOf(holder, kind);
        uint256 rate = registry.advanceBpsOf(holder, kind);
        value = rate >= BPS ? pledged : Math.mulDiv(gap, BPS, BPS - rate, Math.Rounding.Up);
        if (value > pledged) value = pledged;
    }

    /// @notice the Pool Share Value a recorded default holds pledged: the Defaulted Amounts Earn
    /// may pay, less what the holder's pledged bonds will pay first (decision 10). The registry keeps
    /// that much of the holder's pledged shares locked, so a secured plan's default reaches them.
    function defaultLockValue(address holder) external view returns (uint256) {
        (uint256 due, ) = liquidator.earnDefaultedOf(holder);
        if (due == 0) return 0;
        uint256 bonds = _bondsValue(holder);
        return due > bonds ? due - bonds : 0;
    }

    /// @notice the pledged shares `enforce` would queue for this holder now; zero while a hold or
    /// pause is in force.
    function sharesNeeded(address holder) public view returns (uint256 shares, uint256 value, bool onDefault) {
        if (_blocked(holder)) return (0, 0, false);
        (value, onDefault) = valueNeeded(holder);
        uint256 queued = pool.enforcementQueuedOf(holder);
        uint256 queuedValue = queued == 0 ? 0 : pool.previewRedeem(queued);
        if (value <= queuedValue) return (0, 0, onDefault);
        value -= queuedValue;
        shares = pool.previewWithdraw(value);
        // The pool redeems only pledged shares: the lock less what is already queued.
        uint256 lock = registry.encumberedOfKind(holder, pool.collateralKind());
        uint256 cap = lock > queued ? lock - queued : 0;
        if (shares > cap) shares = cap;
        uint256 held = pool.balanceOf(holder);
        if (shares > held) shares = held;
    }

    /// @notice whether a Default Notice or Shortfall notice is recorded for the member now: the
    /// registry accepts a member's own enforcement order only while none is (decision 20).
    /// @dev A Shortfall notice; a revolving cure-notice timestamp (MB-04 §9.2(d)) on a trusted
    /// issuer; or a secured plan's cure notice (MB-06 §13.8) not yet paid. Asked with plain static
    /// calls, so an issuer without the view answers no.
    function noticeRecorded(address member) external view returns (bool) {
        if (liquidator.shortfallNoticedAt(member, address(0)) != 0) return true;
        address[] memory issuers = IMemberIssuersView(registry.networkRegistry()).issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            address iss = issuers[i];
            if (!liquidator.trustedSavingsIssuer(iss)) continue;
            (bool ok, bytes memory data) = iss.staticcall(abi.encodeWithSignature("cycleOf(address)", member));
            // CycleRecord: missedInRow, cleanStreak, depositBits, cureNoticeAt, unsecuredCeiling.
            if (ok && data.length >= 160 && abi.decode(data, (uint256[5]))[3] != 0) return true;
            (ok, data) = iss.staticcall(abi.encodeWithSignature("openPlansOf(address)", member));
            if (!ok || data.length < 64) continue;
            uint256[] memory ids = abi.decode(data, (uint256[]));
            for (uint256 j = 0; j < ids.length; j++) {
                (, , uint64 noticeAt, , uint128 noticeDue) = ISecuredTermPlans(iss).securedPlans(ids[j]);
                if (noticeAt == 0) continue;
                (, , , uint256 repaid, , , , , bool closed) = ISecuredTermPlans(iss).planAt(ids[j]);
                if (!closed && repaid < noticeDue) return true;
            }
        }
        return false;
    }

    /* ========== ENFORCEMENT ========== */

    /// @notice queues the holder's pledged shares MB-05 now lets enforcement redeem, and no more,
    /// as an enforcement redemption in the Yield Pool's queue. Permissionless.
    function enforce(address holder) external returns (uint256 requestId) {
        if (_blocked(holder)) revert PoolShareEnforcerBlocked(holder);
        (uint256 shares, uint256 value, bool onDefault) = sharesNeeded(holder);
        if (shares == 0) revert PoolShareEnforcerNothingNeeded(holder);
        requestId = pool.enforcementRedeem(holder, shares);
        emit EnforcementRequested(holder, requestId, shares, value, onDefault);
    }

    /// @notice hands what the queue has paid for the holder's enforcement redemptions since the last
    /// settlement to the Liquidator, which applies it and pays the surplus to the Holder.
    /// Permissionless. Waits (reverts) while a Liquidation Hold or a 10c pause is in force.
    function settle(address holder) external returns (uint256 applied) {
        (uint256 filled, uint256 paid) = pool.enforcementFilledOf(holder);
        uint256 shares = filled - settledShares[holder];
        uint256 proceeds = paid - settledPaid[holder];
        if (shares == 0 && proceeds == 0) revert PoolShareEnforcerNothingToSettle(holder);
        settledShares[holder] = filled;
        settledPaid[holder] = paid;
        // A payment the token refused waits in the pool for its payee; collect it first.
        if (reserve.balanceOf(address(this)) < proceeds) pool.claimUnpaid();
        if (proceeds > 0) reserve.safeTransfer(address(liquidator), proceeds);
        applied = liquidator.applyPoolProceeds(holder, proceeds, shares);
        emit EnforcementSettled(holder, shares, proceeds, applied);
    }

    /// @notice cancels the part of a holder's queued enforcement request that is no longer needed,
    /// so those shares go back to the Holder (MB-05 §7.3(c)). Permissionless.
    function cancelExcess(address holder, uint256 requestId) external returns (uint256 cancelled) {
        (address owner, , uint256 left, , bool enforcement) = pool.queueRequest(requestId);
        if (owner != holder || !enforcement || left == 0) revert PoolShareEnforcerNotExcess(requestId);
        (uint256 value, ) = valueNeeded(holder);
        uint256 needed = value == 0 ? 0 : pool.previewWithdraw(value);
        uint256 queued = pool.enforcementQueuedOf(holder);
        if (queued <= needed) revert PoolShareEnforcerNotExcess(requestId);
        cancelled = queued - needed < left ? queued - needed : left;
        pool.cancelRequest(requestId, cancelled);
        emit EnforcementCancelled(holder, requestId, cancelled);
    }

    /* ========== INTERNAL ========== */

    /// @dev A confirmed Liquidation Hold active now, or a 10c pause in force.
    function _blocked(address holder) private view returns (bool) {
        (, bool active) = liquidator.holdOf(holder);
        if (active) return true;
        address clock = liquidator.pauseClock();
        return clock != address(0) && IPauseClock(clock).inForce(holder);
    }

    /// @dev What the holder's pledged bonds would pay now at Present Value: on a default they are
    /// applied before any pool share (decision 10).
    function _bondsValue(address holder) private view returns (uint256 value) {
        address bonds = liquidator.earnBonds();
        if (bonds == address(0)) return 0;
        bytes32 kind = IEarnBonds(bonds).collateralKind();
        uint256[] memory items = registry.pledgedItemsOf(holder, kind);
        for (uint256 i = 0; i < items.length; i++) {
            if (IEarnBonds(bonds).balanceOf(holder, items[i]) == 0) continue;
            value += IEarnBonds(bonds).presentValueOf(items[i]);
        }
    }
}

interface IMemberIssuersView {
    function issuersOf(address member) external view returns (address[] memory);
}
