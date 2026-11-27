// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./LendingPoolBase.sol";
import "../libraries/PacificCalendar.sol";

/// @dev What `LendingPool` reads from its valuation module at construction.
interface YieldPoolModule {
    function ledger() external view returns (address);
}

/// @title LendingPool (the Yield Pool)
/// @notice The Clear Earn Yield Pool: Pool Shares are limited-recourse subordinated demand notes
/// whose Share Value is principal plus accrued interest less realized loss write-downs (IV-02).
/// @dev An ERC-4626 vault, upgraded in place from the LendingPool (Phase 2f, decision 16). It
/// keeps its name, address and balances; storage is append-only (see `LendingPoolBase`).
///
/// - **Share Value** = Pool Assets ÷ outstanding Pool Shares, where Pool Assets are Vault Cash
///   (less Holdback Amounts), the Deployed Balance and accrued unpaid Pool Interest. An expected
///   loss allowance never lowers it; it sets a Loss Holdback on redemptions instead (§6A).
/// - **Deployments** go only to Clear Lending's registered lending account, by two people, and
///   each is recorded (decision 17); the Settlement Funding lane's one registered funder may also
///   deploy there alone, within its cap per period and the Settlement Headroom (decision 54).
///   Pool Interest accrues per second on the Deployed Balance at the Funding Rate; Returns (`returnFunds`, by anyone) pay interest first, then principal.
///   Direct borrowing by the PayoutPool and the card settler is off: `borrowableToday` is zero
///   and `borrow` reverts, so the PayoutPool, whose code is unchanged, simply skips this lender.
/// - **Redemptions** are on demand only while no queue request is open and Vault Cash covers the
///   full gross amount. Otherwise they wait in a strict FIFO queue whose shares stay in escrow,
///   keep earning and bearing losses, and fill at the Share Value at fill (C4, replacing X-7).
/// - **Suspension** only for the four listed Suspension Events, two signers, 72 hours at a time.
/// - **Final Maturity**: from the 20th anniversary of the Initial Closing, subscriptions and
///   Deployments stop and shares run off in queue order (decision 15).
/// - The valuation postings, the holdback ledger and Deployments run in `YieldPoolValuation`, and
///   Pool Interest, Suspension, the rate model, recoveries and the legend in `YieldPoolLedger`,
///   both by delegatecall, pinned at construction. The ledger's functions added in the IV-02
///   conformance pass are served by this contract's fallback: clients use the joined ABI
///   (`deploy/poolModules.ts`, `poolAt`).
///
/// Governance (`DEFAULT_ADMIN_ROLE`) moves to the separate 7-day Earn timelock (decision 2).
contract LendingPool is LendingPoolBase {
    using MathUpgradeable for uint256;

    /// @notice The valuation module, fixed for the life of this implementation.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable valuation;
    /// @notice The ledger module, the one `valuation` pins.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable ledger;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address valuation_) {
        _disableInitializers();
        if (IExtensionKind(valuation_).extensionKind() != keccak256("YieldPoolValuation.v3")) {
            revert LendingPoolModuleMismatch();
        }
        valuation = valuation_;
        ledger = YieldPoolModule(valuation_).ledger();
    }

    function _ledgerModule() internal view override returns (address) {
        return ledger;
    }

    /// @notice sets up a new pool. A pool upgraded from before Phase 2f calls
    /// `initializeYieldPool` instead.
    function initialize(address admin, address reserveToken, string memory name_, string memory symbol_)
        external
        initializer
    {
        if (admin == address(0) || reserveToken == address(0)) revert LendingPoolInvalidAddress();
        __ERC20_init(name_, symbol_);
        __ERC4626_init(IERC20Upgradeable(reserveToken));
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _rateModel = RateModel(0.02e18, 0.03e18, 0.8e18, 0.05e18);
        _holdbackMaxAge = 540 days;
        _lastAccrualAt = uint64(block.timestamp);
    }

    /* ========== STATE ========== */

    /// @notice The shared Earn controls: eligibility, exemption tag, pauses, wallets, transfers.
    function earnControls() external view returns (IPoolEarnControls) {
        return _earnControls;
    }

    /// @notice Clear Lending's registered lending account: the only place a Deployment goes.
    function deploymentAccount() external view returns (address) {
        return _deploymentAccount;
    }

    /// @notice Where an MB-05 enforcement redemption pays.
    function enforcementDestination() external view returns (address) {
        return _enforcementDestination;
    }

    /// @notice When Pool Interest was last booked.
    function lastAccrualAt() external view returns (uint256) {
        return _lastAccrualAt;
    }

    /// @notice The first issue of Pool Shares (the Initial Closing).
    function initialClosing() external view returns (uint256) {
        return _initialClosing;
    }

    /// @notice The Settlement Funding lane (decision 54): its funder, cap per period and period;
    /// the start of the period running now and what the lane has deployed in it; whether it is
    /// stopped; the stop count (part of a `setSettlementFunder` proposal's action hash); and the
    /// Settlement Headroom.
    function settlementLane()
        external
        view
        returns (
            address funder,
            uint256 capPerPeriod,
            uint256 periodSeconds,
            uint256 periodStart,
            uint256 usedInPeriod,
            bool stopped,
            uint256 epoch,
            uint256 headroom
        )
    {
        SettlementLane storage l = _settlementLane;
        periodSeconds = l.periodSeconds;
        periodStart = l.periodStart;
        usedInPeriod = l.used;
        if (periodSeconds != 0 && block.timestamp >= periodStart + periodSeconds) {
            periodStart += ((block.timestamp - periodStart) / periodSeconds) * periodSeconds;
            usedInPeriod = 0;
        }
        return (l.funder, l.capPerPeriod, periodSeconds, periodStart, usedInPeriod, l.stopped, l.epoch, _settlementHeadroom);
    }

    /// @notice The calendar quarter (year x 4 + quarter, plus one) of the last rate-lowering change.
    function lastLoweringQuarter() external view returns (uint256) {
        return _lastLoweringQuarter;
    }

    /// @notice The first queue request that may still be open.
    function queueHead() external view returns (uint256) {
        return _queueHead;
    }

    /// @notice Shares waiting in the queue.
    function queuedShares() external view returns (uint256) {
        return _queuedShares;
    }

    /// @notice The first holdback that may still be open.
    function holdbackHead() external view returns (uint256) {
        return _holdbackHead;
    }

    /// @notice Holdback Amounts: the sum of H over open holdbacks.
    function totalHoldback() external view returns (uint256) {
        return _totalHoldback;
    }

    /// @notice The maximum age of a holdback, in seconds.
    function holdbackMaxAge() external view returns (uint256) {
        return _holdbackMaxAge;
    }

    /// @notice The last posted Pool Loss Allowance.
    function poolLossAllowance() external view returns (uint256) {
        return _poolLossAllowance;
    }

    /// @notice When the Pool Loss Allowance was last posted.
    function allowancePostedAt() external view returns (uint256) {
        return _allowancePostedAt;
    }

    /// @notice Whether releases from a lower posting are still to be processed.
    function releasePending() external view returns (bool) {
        return _releasePending;
    }

    /// @notice Pool Loss Charges posted so far.
    function lossChargeCount() external view returns (uint256) {
        return _lossChargeCount;
    }

    /// @notice Payments owed to accounts whose token transfer refused them.
    function totalUnpaid() external view returns (uint256) {
        return _totalUnpaid;
    }

    /// @notice Deployments made.
    function deploymentCount() external view returns (uint256) {
        return _deploymentCount;
    }

    /// @notice The total of all Deployments.
    function totalDeployed() external view returns (uint256) {
        return _totalDeployed;
    }

    /// @notice Shares an owner has waiting in the queue.
    function queuedSharesOf(address key) external view returns (uint256) {
        return _queuedSharesOf[key];
    }

    /// @notice Pledged shares of a holder queued by an enforcement redemption.
    function enforcementQueuedOf(address key) external view returns (uint256) {
        return _enforcementQueuedOf[key];
    }

    /// @notice What the queue has filled of a holder's enforcement redemptions, cumulatively: the
    /// shares burned and what was paid to `enforcementDestination` for them.
    function enforcementFilledOf(address key) external view returns (uint256 shares, uint256 paid) {
        EnforcementFill storage f = _enforcementFilled[key];
        return (f.shares, f.paid);
    }

    /// @notice A Holder's Holdback Amounts: the sum of H over their open holdbacks.
    function holdbackOf(address key) external view returns (uint256) {
        return _holdbackOf[key];
    }

    /// @notice The first signer of a two-person action still waiting for its second.
    function proposerOf(bytes32 key) external view returns (address) {
        return _proposerOf[key];
    }

    /// @notice What a refused transfer left owed to an account.
    function unpaidOf(address key) external view returns (uint256) {
        return _unpaidOf[key];
    }

    /// @notice The current Funding Rate model (annual, WAD).
    function rateModel() external view returns (uint256 r0, uint256 s1, uint256 k, uint256 s2) {
        RateModel memory m = _rateModel;
        return (m.r0, m.s1, m.k, m.s2);
    }

    /// @notice A rate-model change waiting for its notice period.
    function pendingRate()
        external
        view
        returns (uint256 r0, uint256 s1, uint256 k, uint256 s2, uint256 effectiveAt, bool lowers)
    {
        PendingRate memory p = _pendingRate;
        return (p.model.r0, p.model.s1, p.model.k, p.model.s2, p.effectiveAt, p.lowers);
    }

    /// @notice The current or last Suspension: in force while `expiresAt` is in the future.
    function suspension()
        external
        view
        returns (uint256 eventId, uint8 reason, uint256 startedAt, uint256 expiresAt, address lastSigner, bytes32 evidenceHash)
    {
        Suspension memory x = _suspension;
        return (x.eventId, x.reason, x.startedAt, x.expiresAt, x.lastSigner, x.evidenceHash);
    }

    /* ========== VIEWS ========== */

    /// @notice the Share Value of one whole Pool Share, in asset units scaled by 1e18 per asset
    /// unit per share unit (1e18 = $1.00 per share). Replaces `navPerShare`. $1.00 while no Pool
    /// Share is outstanding: the next subscription restarts the pool there (decision 29).
    function shareValue() external view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? WAD : (totalAssets() + 1).mulDiv(WAD, supply + 1);
    }

    /// @notice Pool Assets now. Between bookings, Pool Interest since the last one is projected
    /// by the ledger, month ends and capitalization included.
    function totalAssets() public view override returns (uint256) {
        uint256 t = _lastAccrualAt;
        if (t == 0 || t == block.timestamp) return _poolAssets();
        (bool ok, bytes memory ret) = address(this).staticcall(abi.encodeWithSignature("projectedPoolAssets()"));
        if (!ok) revert LendingPoolInvalidAmount();
        return abi.decode(ret, (uint256));
    }

    /// @dev With no Pool Share outstanding, shares and assets convert one to one: the pool restarts
    /// at $1.00, and a leftover is set aside rather than captured (decision 29).
    function _convertToShares(uint256 assets, MathUpgradeable.Rounding r) internal view override returns (uint256) {
        return totalSupply() == 0 ? assets : super._convertToShares(assets, r);
    }

    function _convertToAssets(uint256 shares, MathUpgradeable.Rounding r) internal view override returns (uint256) {
        return totalSupply() == 0 ? shares : super._convertToAssets(shares, r);
    }

    /// @notice USDC in the vault other than Holdback Amounts (and other money owed out).
    function vaultCash() external view returns (uint256) {
        return _vaultCash();
    }

    /// @notice the Deployed Balance now (see YieldPoolLedger.deployedBalance).
    function deployedBalance() external view returns (uint256) {
        _ledgerView();
    }

    /// @notice accrued and unpaid Pool Interest, to now (see YieldPoolLedger.accruedInterest).
    function accruedInterest() external view returns (uint256) {
        _ledgerView();
    }

    /// @notice the Deployed Balance ÷ (the Deployed Balance + Vault Cash), as WAD (IV-02 §1.2).
    function utilization() external view returns (uint256) {
        _ledgerView();
    }

    /// @notice utilization in basis points (kept for the apps).
    function utilizationBps() external view returns (uint256) {
        _ledgerView();
    }

    /// @notice the Funding Rate now, annual, as WAD.
    function fundingRate() external view returns (uint256) {
        _ledgerView();
    }

    /// @notice the Funding Rate at utilization `u` (WAD) under the current model.
    function fundingRateAt(uint256) external view returns (uint256) {
        _ledgerView();
    }

    /// @notice the Holdback Percentage in basis points, rounded up (`holdbackRate` is exact).
    function holdbackBps() external view returns (uint256) {
        _ledgerView();
    }

    /// @notice Vault Cash not already spoken for by the queue.
    function availableCash() public view returns (uint256) {
        uint256 cash = _vaultCash();
        uint256 owed = _convertToAssets(_queuedShares, MathUpgradeable.Rounding.Down);
        return cash > owed ? cash - owed : 0;
    }

    /// @notice Retired with direct borrowing (decision 17): always zero.
    function borrowableToday(address) external pure returns (uint256) {
        return 0;
    }

    /// @notice the Final Maturity Date: the 20th anniversary of the Initial Closing (0 if none).
    function finalMaturity() public view returns (uint256) {
        uint256 start = _initialClosing;
        if (start == 0) return 0;
        (uint256 y, uint256 m, uint256 d) = PacificCalendar.civilFromDays(start / 1 days);
        y += 20;
        if (m == 2 && d == 29 && !(y % 4 == 0 && (y % 100 != 0 || y % 400 == 0))) d = 28;
        return PacificCalendar.daysFromCivil(y, m, d) * 1 days + (start % 1 days);
    }

    function _matured() internal view returns (bool) {
        uint256 at = finalMaturity();
        return at != 0 && block.timestamp >= at;
    }

    function queueLength() external view returns (uint256) {
        return queue.length;
    }

    function queueRequest(uint256 id)
        external
        view
        returns (address owner, address receiver, uint256 shares, uint256 requestedAt, bool enforcement)
    {
        QueueRequest storage r = queue[id];
        return (r.owner, r.receiver, r.shares, r.requestedAt, r.enforcement);
    }

    /// @notice seconds the oldest open request has waited, for the off-chain 30- and 90-day rules
    /// (IV-02 §6.4). Zero when the queue is empty.
    function oldestRequestAge() external view returns (uint256) {
        if (_queuedShares == 0) return 0;
        uint256 i = _queueHead;
        while (queue[i].shares == 0) ++i;
        return block.timestamp - queue[i].requestedAt;
    }

    function holdbackCount() external view returns (uint256) {
        return holdbacks.length;
    }

    function holdbackAt(uint256 id)
        external
        view
        returns (address holder, uint256 createdAt, uint256 maxAge, uint256 gross, uint256 held)
    {
        Holdback storage h = holdbacks[id];
        return (h.holder, h.createdAt, h.maxAge, h.gross, h.held);
    }

    /// @notice when holdback `id` may be released in full by age: its creation plus the lowest
    /// maximum age in force since then (a later raise never applies; a lowering does).
    function releasableAt(uint256 id) external view returns (uint256) {
        return _releaseAt(id);
    }

    /// @notice the pending Pool Loss Charge, if any.
    function pendingLossCharge()
        external
        view
        returns (bool pending, uint256 id, uint256 amount, uint256 absorbed, uint256 cursor, uint256 end)
    {
        LossCharge storage c = lossCharge;
        return (c.pending, c.id, c.amount, c.absorbed, c.cursor, c.end);
    }

    /// @notice a pre-2f queued request (shares burned, claim fixed in assets).
    function requestAt(uint256 requestId)
        external
        view
        returns (address owner, address receiver, uint256 assets, uint64 requestedAt, bool claimed)
    {
        WithdrawalRequest storage r = requests[requestId];
        return (r.owner, r.receiver, r.assets, r.requestedAt, r.claimed);
    }

    /* ========== ERC-4626 ========== */

    function _exitsBlocked() internal view returns (bool) {
        return _queuedShares > 0 || isSuspended() || lossCharge.pending;
    }

    function _subscriptionsBlocked() internal view returns (bool) {
        IPoolEarnControls c = _earnControls;
        return lossCharge.pending || isSuspended() || _matured() || address(c) == address(0)
            || c.subscriptionsPaused();
    }

    /// @dev The net payment for `gross`: G less G × the Holdback Percentage rounded up.
    function _net(uint256 gross) internal view returns (uint256) {
        return gross - _heldOf(gross);
    }

    function maxDeposit(address) public view override returns (uint256) {
        return _subscriptionsBlocked() ? 0 : type(uint256).max;
    }

    function maxMint(address) public view override returns (uint256) {
        return _subscriptionsBlocked() ? 0 : type(uint256).max;
    }

    /// @notice shares `owner` can redeem right now: zero while a queue request is open, a
    /// Suspension is in force or a loss charge is being applied; otherwise their free shares,
    /// up to what Vault Cash covers at the full gross amount.
    function maxRedeem(address owner) public view override returns (uint256) {
        if (_exitsBlocked()) return 0;
        uint256 free = freeSharesOf(owner);
        uint256 byCash = _convertToShares(_vaultCash(), MathUpgradeable.Rounding.Down);
        return free < byCash ? free : byCash;
    }

    /// @notice net of the Loss Holdback.
    function maxWithdraw(address owner) public view override returns (uint256) {
        return previewRedeem(maxRedeem(owner));
    }

    /// @notice what redeeming `shares` pays now: Share Value less the Loss Holdback then applying.
    /// This is the Pool Share Value of MB-05 §1.3.
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return _net(_convertToAssets(shares, MathUpgradeable.Rounding.Down));
    }

    /// @notice shares needed for a net payment of `assets`, rounded up.
    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 rate = _holdbackRate;
        if (rate >= WAD) return type(uint256).max;
        uint256 gross = assets.mulDiv(WAD, WAD - rate, MathUpgradeable.Rounding.Up);
        return _convertToShares(gross, MathUpgradeable.Rounding.Up);
    }

    /// @notice subscribes with the eligibility attestation, whose exemption tag is stored in the
    /// subscription event.
    function subscribe(uint256 assets, address receiver, bytes calldata attestation)
        external
        returns (uint256 shares)
    {
        _accrue();
        shares = previewDeposit(assets);
        _subscribe(receiver, assets, shares, attestation);
    }

    /// @notice a subscription with no attestation attached (the controls may hold one already).
    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        _accrue();
        shares = previewDeposit(assets);
        _subscribe(receiver, assets, shares, "");
    }

    function mint(uint256 shares, address receiver) public override returns (uint256 assets) {
        _accrue();
        assets = previewMint(shares);
        _subscribe(receiver, assets, shares, "");
    }

    /// @dev Mints at Share Value with nothing deducted, whatever the Holdback Percentage. The holder
    /// cap is `EarnControls`' (per household, above its floor; decision 23), checked in
    /// `checkSubscription`. With no Pool Share outstanding, it issues at exactly $1.00 and sets
    /// aside any USDC left in the vault that is owed to no one, to be recognized into Vault Cash
    /// over 30 days (decision 29). Holdback Amounts, queued shares and unclaimed payments are
    /// never part of it.
    function _subscribe(address receiver, uint256 assets, uint256 shares, bytes memory attestation) internal {
        if (assets < MIN_SUBSCRIPTION_UNITS * 10 ** uint256(decimals())) revert LendingPoolBelowMinimum(assets);
        if (shares == 0 || receiver == address(0)) revert LendingPoolInvalidAmount();
        if (lossCharge.pending) revert LendingPoolChargePending();
        if (isSuspended()) revert LendingPoolSuspended();
        if (_matured()) revert LendingPoolFinalMaturity();
        IPoolEarnControls controls = _earnControls;
        if (address(controls) == address(0)) revert LendingPoolNoControls();
        if (controls.subscriptionsPaused()) revert LendingPoolSubscriptionsPaused();
        bytes32 code = controls.checkSubscription(msg.sender, receiver, assets, attestation);
        if (_initialClosing == 0) {
            _initialClosing = uint64(block.timestamp);
            emit InitialClosingRecorded(block.timestamp, finalMaturity());
        }
        if (totalSupply() == 0) {
            uint256 gross = _cash() + totalBorrowed + interestAccrued;
            uint256 owed = _spokenFor();
            uint256 left = gross > owed ? gross - owed : 0;
            _leftover = left;
            _leftoverStart = uint64(block.timestamp);
            if (left > 0) emit LeftoverSetAside(left, block.timestamp + LEFTOVER_PERIOD);
        }
        _deposit(msg.sender, receiver, assets, shares);
        emit Subscribed(msg.sender, receiver, assets, shares, code);
        _syncClock();
    }

    /// @notice redeems on demand for a net payment of exactly `assets`.
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        _accrue();
        shares = previewWithdraw(assets);
        _redeemNow(receiver, owner, shares, assets);
    }

    /// @notice redeems on demand at Share Value, less the Loss Holdback.
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256 assets) {
        assets = _redeemNow(receiver, owner, shares, type(uint256).max);
    }

    /// @dev `net` is the exact payment for `withdraw`, or max for `redeem`. Liquidity is checked
    /// against the full gross amount. Proceeds go only to the Smart Account that held the shares
    /// (IV-02 §6.5): `receiver` must be `owner`.
    function _redeemNow(address receiver, address owner, uint256 shares, uint256 net)
        internal
        returns (uint256 paid)
    {
        if (receiver != owner) revert LendingPoolReceiverNotOwner(receiver);
        if (shares == 0) revert LendingPoolInvalidAmount();
        if (lossCharge.pending) revert LendingPoolChargePending();
        if (isSuspended()) revert LendingPoolSuspended();
        if (_queuedShares > 0) revert LendingPoolQueueOpen();
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _accrue();
        uint256 gross = _convertToAssets(shares, MathUpgradeable.Rounding.Down);
        uint256 cash = _vaultCash();
        if (gross > cash) revert LendingPoolInsufficientCash(cash, gross);
        _burn(owner, shares);
        paid = _finish(owner, receiver, gross, net);
        emit Withdraw(msg.sender, receiver, owner, paid, shares);
        _syncClock();
    }

    /// @dev Burned shares worth `gross`: records H = G × the Holdback Percentage (rounded up) as the holder's
    /// holdback (§6A) and pays G − H, or `cap` if less (a `withdraw` for an exact amount). What
    /// the cap leaves, a unit or two of rounding, stays in Vault Cash for the remaining holders.
    function _finish(address holder, address receiver, uint256 gross, uint256 cap) internal returns (uint256 paid) {
        uint256 held = _heldOf(gross);
        paid = gross - held;
        if (paid > cap) paid = cap;
        if (held > 0) {
            uint256 id = holdbacks.length;
            holdbacks.push(Holdback(holder, uint64(block.timestamp), uint32(_holdbackMaxAge), uint128(gross), uint128(held)));
            _totalHoldback += held;
            openHoldbackGross += gross;
            _holdbackOf[holder] += held;
            emit HoldbackRecorded(holder, id, gross, held);
        }
        _send(receiver, paid);
    }

    /* ========== THE QUEUE ========== */

    /// @notice "Take $X now, queue the rest": pays what Vault Cash allows and queues the rest in
    /// the same transaction. While a request is open, a Suspension is in force or a loss charge is
    /// being applied, it pays nothing now and queues everything.
    /// @return paidNow paid now, net of any holdback.
    /// @return requestId the queued request, or `NO_REQUEST`.
    function redeemOrQueue(uint256 shares, address receiver) external returns (uint256 paidNow, uint256 requestId) {
        if (receiver != msg.sender) revert LendingPoolReceiverNotOwner(receiver);
        _accrue();
        uint256 now_ = maxRedeem(msg.sender);
        if (now_ > shares) now_ = shares;
        if (now_ > 0) paidNow = _redeemNow(receiver, msg.sender, now_, type(uint256).max);
        requestId = shares > now_ ? _enqueue(msg.sender, receiver, shares - now_, false) : NO_REQUEST;
    }

    /// @notice queues all of `shares` (kept for the Liquidator and the apps). The proceeds go to
    /// the caller's own account (IV-02 §6.5).
    function requestWithdrawal(uint256 shares, address receiver) external returns (uint256) {
        if (receiver != msg.sender) revert LendingPoolReceiverNotOwner(receiver);
        return _enqueue(msg.sender, receiver, shares, false);
    }

    /// @notice fills the queue in order, whole or partial, up to Vault Cash, at the Share Value
    /// now, less the Loss Holdback now applying. Permissionless.
    /// @param maxCount most requests to look at.
    function fillQueue(uint256 maxCount) external returns (uint256 filled) {
        if (isSuspended()) revert LendingPoolSuspended();
        if (lossCharge.pending) revert LendingPoolChargePending();
        _accrue();
        uint256 i = _queueHead;
        uint256 n = queue.length;
        for (uint256 seen; i < n && seen < maxCount; ++seen) {
            QueueRequest storage r = queue[i];
            uint256 shares = r.shares;
            if (shares == 0) {
                ++i;
                continue;
            }
            uint256 cash = _vaultCash();
            uint256 take = _convertToShares(cash, MathUpgradeable.Rounding.Down);
            if (take > shares) take = shares;
            if (take == 0) break;
            uint256 gross = _convertToAssets(take, MathUpgradeable.Rounding.Down);
            uint256 left = shares - take;
            r.shares = uint128(left);
            _dequeue(r, take);
            _burn(address(this), take);
            // The holdback is the Holder's, or on the Successor path the Successor's (§6A).
            uint256 paid = _finish(r.enforcement ? r.owner : r.receiver, r.receiver, gross, type(uint256).max);
            if (r.enforcement) {
                EnforcementFill storage f = _enforcementFilled[r.owner];
                f.shares += uint128(take);
                f.paid += uint128(paid);
            }
            emit QueueFilled(i, take, gross, paid, left);
            ++filled;
            if (left > 0) break;
            ++i;
        }
        _queueHead = i;
        _syncClock();
    }

    /* ========== DEPLOYMENTS AND RETURNS ========== */

    /// @notice Retired (decision 17): only Clear Lending draws, as a recorded Deployment.
    function borrow(uint256, address) external pure {
        revert LendingPoolDirectBorrowOff();
    }

    /* ========== COLLATERAL ========== */

    /// @notice how many of a holder's shares are pledged.
    /// @dev Fails closed for pledgers, open for everyone else (audit M-3).
    function encumberedOf(address holder) public view returns (uint256) {
        return _encumberedOf(holder);
    }

    /// @notice how many of a holder's shares may leave.
    function freeSharesOf(address holder) public view returns (uint256) {
        return _freeSharesOf(holder);
    }

    /// @dev The transfer allowlist (FIXED, §6) and the pledge lock. A mint and the pool's own escrow
    /// pass; nobody is exempt (C5: the Liquidator's exemption is gone). Shares go into escrow only through the queue, and
    /// pledged ones only through an enforcement redemption. Every other move, a burn included,
    /// checks the pledge lock; a move that is not a burn or escrow must also be one the controls
    /// allow (same Holder, or the Successor path).
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        super._beforeTokenTransfer(from, to, amount);
        if (from == address(0) || from == address(this)) return;
        if (to == address(this)) {
            uint8 mode = escrowMode;
            if (mode == 0) revert LendingPoolTransferNotAllowed(from, to);
            if (mode == 2) return;
        }
        (uint256 locked, bool ok) = _readLock(from);
        if (ok) {
            if (locked != lastKnownLock[from]) lastKnownLock[from] = locked;
            locked = _lockOnBalance(from, locked);
        } else {
            locked = lastKnownLock[from] > 0 ? type(uint256).max : 0;
            emit EncumbranceSourceReverted(from, lastKnownLock[from]);
        }
        uint256 free = _unheld(balanceOf(from), locked, from);
        if (amount > free) revert LendingPoolEncumbered(from, free, amount);
        if (to == address(0) || to == address(this)) return;
        IPoolEarnControls controls = _earnControls;
        if (address(controls) == address(0) || !controls.transferAllowed(from, to)) {
            revert LendingPoolTransferNotAllowed(from, to);
        }
    }

    /* ========== VALUATION MODULE (delegatecall) ========== */

    /// @notice see YieldPoolValuation.requestRunOff.
    function requestRunOff(address) external returns (uint256) {
        _forward();
    }

    /// @notice see YieldPoolValuation.enforcementRedeem.
    function enforcementRedeem(address, uint256) external returns (uint256) {
        _forward();
    }

    /// @notice see YieldPoolValuation.cancelRequest.
    function cancelRequest(uint256, uint256) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.claimWithdrawal.
    function claimWithdrawal(uint256) external returns (uint256) {
        _forward();
    }

    /// @notice see YieldPoolValuation.claimUnpaid.
    function claimUnpaid() external {
        _forward();
    }

    /// @notice see YieldPoolValuation.returnFunds.
    function returnFunds(uint256) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.repay.
    function repay(uint256) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.syncEncumbrance.
    function syncEncumbrance(address) external returns (uint256) {
        _forward();
    }

    /// @notice see YieldPoolValuation.setEncumbranceSource.
    function setEncumbranceSource(address, bytes32) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.initializeYieldPool.
    function initializeYieldPool(address, address, uint64) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.setEarnControls.
    function setEarnControls(address) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.setDeploymentAccount.
    function setDeploymentAccount(address) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.setEnforcementDestination.
    function setEnforcementDestination(address) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.setHoldbackMaxAge.
    function setHoldbackMaxAge(uint256) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.deploy.
    function deploy(uint256, bytes32) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.setSettlementFunder.
    function setSettlementFunder(address, uint256, uint64) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.setSettlementHeadroom.
    function setSettlementHeadroom(uint256) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.stopSettlementFunder.
    function stopSettlementFunder() external {
        _forward();
    }

    /// @notice see YieldPoolValuation.deploySettlement.
    function deploySettlement(uint256, bytes32) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.postAllowance.
    function postAllowance(uint256, bytes32) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.postLossCharge.
    function postLossCharge(uint256, bytes32) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.releaseHoldbacks.
    function releaseHoldbacks(uint256) external {
        _forward();
    }

    /// @notice see YieldPoolValuation.applyHoldbacks.
    function applyHoldbacks(uint256) external {
        _forward();
    }

    /// @notice see YieldPoolLedger.suspend.
    function suspend(uint8, bytes32, bytes32) external {
        _forwardTo(ledger);
    }

    /// @notice see YieldPoolLedger.renewSuspension.
    function renewSuspension(bytes32, bytes32) external {
        _forwardTo(ledger);
    }

    /// @notice see YieldPoolLedger.liftSuspension.
    function liftSuspension() external {
        _forwardTo(ledger);
    }

    /// @notice see YieldPoolLedger.proposeRateModel.
    function proposeRateModel(uint256, uint256, uint256, uint256) external {
        _forwardTo(ledger);
    }

    /// @notice see YieldPoolLedger.applyRateModel.
    function applyRateModel() external {
        _forwardTo(ledger);
    }

    /// @notice Every other call goes to the ledger module: the functions it gained in the IV-02
    /// conformance pass (`accrue`, `postRecovery`, `recordValuationEvent`, `postPoolTierPrincipal`,
    /// the legend, and their views). Use the joined ABI.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    fallback() external {
        _forwardTo(ledger);
    }

    /// @notice Serves the ledger's views to this contract's own view functions, which call it by
    /// staticcall; no one else may call it.
    function ledgerView(bytes calldata data) external {
        if (msg.sender != address(this)) revert LendingPoolNotAuthorized(msg.sender);
        bytes memory ret = _delegate(ledger, data);
        assembly {
            return(add(ret, 32), mload(ret))
        }
    }

    /// @dev Answers a view from the ledger: a staticcall to `ledgerView` with this call's data.
    function _ledgerView() private view {
        (bool ok, bytes memory ret) = address(this).staticcall(abi.encodeCall(this.ledgerView, (msg.data)));
        assembly {
            switch ok
            case 0 { revert(add(ret, 32), mload(ret)) }
            default { return(add(ret, 32), mload(ret)) }
        }
    }

    function _forward() private {
        _forwardTo(valuation);
    }

    /// @dev Runs the module's implementation of this call against this contract's storage, and
    /// returns or reverts exactly as it did.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _forwardTo(address target) private {
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
