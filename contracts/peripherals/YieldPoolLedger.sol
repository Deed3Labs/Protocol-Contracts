// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./LendingPoolBase.sol";
import "../libraries/PacificCalendar.sol";

/// @title YieldPoolLedger
/// @notice The Yield Pool's second delegatecall module: Pool Interest with its monthly billing and
/// capitalization (IV-02 §4.6, decision 24), the restart leftover (decision 29), the low-Utilization
/// clock (§2.6), recoveries (§5.4, decision 25), the Valuation Event flag (Exhibit A, A4; decision
/// 26), the Pool Tier principal ceiling on Deployments (§4.3), the legend (§8.4, decision 27),
/// Suspension (Article 7) and the Funding Rate model (Schedule 2).
/// @dev Pinned in `YieldPoolValuation`'s constructor and, through it, in `LendingPool`'s. Never
/// called directly in production: it runs against the pool proxy's storage with the original
/// caller. It declares no storage (see `LendingPoolBase`). It moves no USDC.
contract YieldPoolLedger is LendingPoolBase {
    using MathUpgradeable for uint256;

    /// @notice How long a legend change waits after it is scheduled (decision 27).
    uint256 public constant LEGEND_DELAY = 7 days;

    /// @dev The interest state projected to now.
    struct Accrual {
        uint256 deployed;
        uint256 interest;
        uint256 billed;
        uint256 capitalized;
        uint64 dueAt;
        uint64 periodEnd;
    }

    /// @notice what YieldPoolValuation's constructor checks before pinning this module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("YieldPoolLedger.v1");
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function _ledgerModule() internal pure override returns (address) {
        return address(0);
    }

    function _accrue() internal override {
        accrue();
    }

    /* ========== POOL INTEREST (IV-02 §4.6; decision 24) ========== */

    /// @notice books Pool Interest to now. Interest accrues each second on the Deployed Balance at
    /// the Funding Rate, on a 365-day year. At each month end (23:59:59 Pacific on its last day)
    /// the interest accrued and unpaid is billed; what is still unpaid at the end of the 5th
    /// weekday after month end is capitalized into the Deployed Balance, where it earns interest.
    /// Returns pay interest first, the billed part first. Lazy: it runs at the start of every
    /// change, and anyone may call it.
    /// @dev Business Days are taken as weekdays: ignoring bank holidays makes the due date no
    /// later than the true one, so capitalization is never later than IV-02 allows.
    function accrue() public {
        uint256 t = _lastAccrualAt;
        if (t == 0 || t == block.timestamp) return;
        Accrual memory a = _project();
        uint256 added = a.interest + a.capitalized - interestAccrued;
        if (a.dueAt != _billedDueAt) emit InterestBilled(a.billed, a.dueAt);
        if (a.capitalized > 0) {
            _totalCapitalized += a.capitalized;
            emit InterestCapitalized(a.capitalized, a.deployed);
        }
        totalBorrowed = a.deployed;
        interestAccrued = a.interest;
        _billedInterest = a.billed;
        _billedDueAt = a.dueAt;
        _periodEnd = a.periodEnd;
        _lastAccrualAt = uint64(block.timestamp);
        if (added > 0) emit InterestAccrued(added, _rateNow(a.deployed), a.interest);
        _syncClock();
    }

    /// @dev Walks the month ends and due dates since the last booking, in time order. Vault Cash
    /// is taken as it is now for the whole walk (it changes only by a transaction or a restart
    /// leftover's recognition).
    function _project() internal view returns (Accrual memory a) {
        a = Accrual(totalBorrowed, interestAccrued, _billedInterest, 0, _billedDueAt, _periodEnd);
        uint256 t = _lastAccrualAt;
        if (t == 0) return a;
        if (a.periodEnd == 0) a.periodEnd = uint64(_monthEnd(t));
        uint256 cash = _vaultCash();
        while (true) {
            bool due = a.billed > 0 && a.dueAt < a.periodEnd;
            uint256 next = due ? a.dueAt : a.periodEnd;
            if (next >= block.timestamp) {
                a.interest += _interestOver(a.deployed, cash, block.timestamp - t);
                return a;
            }
            a.interest += _interestOver(a.deployed, cash, next - t);
            t = next;
            if (due) {
                a.deployed += a.billed;
                a.interest -= a.billed;
                a.capitalized += a.billed;
                a.billed = 0;
            } else {
                a.billed = a.interest;
                a.dueAt = uint64(_dueAfter(next));
                a.periodEnd = uint64(_monthEnd(next + 1));
            }
        }
    }

    function _interestOver(uint256 deployed, uint256 cash, uint256 dt) internal view returns (uint256) {
        if (deployed == 0 || dt == 0) return 0;
        return (deployed * _rateAt(_utilizationOf(deployed, cash)) * dt) / (365 days * WAD);
    }

    function _rateNow(uint256 deployed) internal view returns (uint256) {
        return _rateAt(_utilizationOf(deployed, _vaultCash()));
    }

    /// @dev 23:59:59 Pacific on the last day of the Pacific month that contains `ts`.
    function _monthEnd(uint256 ts) internal pure returns (uint256) {
        (uint256 y, uint256 m,) = PacificCalendar.localDate(ts);
        (y, m) = m == 12 ? (y + 1, 1) : (y, m + 1);
        return _endOfDayNumber(PacificCalendar.daysFromCivil(y, m, 1) - 1);
    }

    /// @dev 23:59:59 Pacific on the 5th weekday after the day of `monthEnd` (itself 23:59:59
    /// Pacific). Weekdays stand for Business Days (see `accrue`).
    function _dueAfter(uint256 monthEnd) internal pure returns (uint256) {
        uint256 dn = (monthEnd - 8 hours) / 1 days;
        for (uint256 n; n < 5;) {
            ++dn;
            uint256 w = (dn + 4) % 7; // 1970-01-01 was a Thursday; 0 is Sunday, 6 Saturday
            if (w != 0 && w != 6) ++n;
        }
        return _endOfDayNumber(dn);
    }

    function _endOfDayNumber(uint256 dn) internal pure returns (uint256) {
        (uint256 y,,) = PacificCalendar.civilFromDays(dn);
        return dn * 1 days + 1 days - 1 + (PacificCalendar.isDaylightDay(dn, y) ? 7 hours : 8 hours);
    }

    /// @dev R = R₀ + S₁·(U/K) up to the kink, then R₀ + S₁ + S₂·((U−K)/(1−K)) (IV-02 Sch. 2).
    function _rateAt(uint256 u) internal view returns (uint256) {
        return _rate(_rateModel, u);
    }

    function _rate(RateModel memory m, uint256 u) internal pure returns (uint256) {
        if (u > WAD) u = WAD;
        if (u <= m.k) return m.k == 0 ? m.r0 : m.r0 + (uint256(m.s1) * u) / m.k;
        return m.r0 + m.s1 + (uint256(m.s2) * (u - m.k)) / (WAD - m.k);
    }

    /* ========== VIEWS (projected to now) ========== */

    /// @notice Pool Assets now, with Pool Interest projected since the last booking. `LendingPool`
    /// reads it for `totalAssets` between bookings.
    function projectedPoolAssets() external view returns (uint256) {
        Accrual memory a = _project();
        uint256 gross = _cash() + a.deployed + a.interest;
        uint256 owed = _spokenFor() + _unrecognized();
        return gross > owed ? gross - owed : 0;
    }

    /// @notice the Deployed Balance now: Deployments plus capitalized Pool Interest, less Returns
    /// and Pool Loss Charges, plus recoveries (IV-02 §1.2).
    function deployedBalance() external view returns (uint256) {
        return _project().deployed;
    }

    /// @notice accrued and unpaid Pool Interest, to now.
    function accruedInterest() external view returns (uint256) {
        return _project().interest;
    }

    /// @notice the Pool Interest of the last month ended still unpaid, when it falls due (and is
    /// capitalized if still unpaid), and when the current month ends.
    function billedInterest() external view returns (uint256 amount, uint256 dueAt, uint256 periodEnd) {
        Accrual memory a = _project();
        return (a.billed, a.dueAt, a.periodEnd);
    }

    /// @notice Pool Interest capitalized into the Deployed Balance so far (booked).
    function totalCapitalized() external view returns (uint256) {
        return _totalCapitalized;
    }

    /// @notice Utilization now: the Deployed Balance ÷ (the Deployed Balance + Vault Cash), WAD.
    function utilization() public view returns (uint256) {
        return _utilizationOf(_project().deployed, _vaultCash());
    }

    /// @notice Utilization in basis points (kept for the apps).
    function utilizationBps() external view returns (uint256) {
        return utilization() / 1e14;
    }

    /// @notice the Funding Rate now, annual, as WAD.
    function fundingRate() external view returns (uint256) {
        return _rateAt(utilization());
    }

    /// @notice the Funding Rate at utilization `u` (WAD) under the current model.
    function fundingRateAt(uint256 u) external view returns (uint256) {
        return _rateAt(u);
    }

    /// @notice since when Utilization has stayed below 50%, or 0 while it is at least 50%
    /// (IV-02 §2.6; `IPoolUtilizationClock`, read by `EarnControls`). Updated on every change to
    /// the Deployed Balance or Vault Cash; a direct USDC transfer counts from the next one.
    function lowUtilizationSince() external view returns (uint64) {
        return _lowUtilSince;
    }

    /// @notice the restart leftover (decision 29): the amount set aside, when, and what is not
    /// yet recognized into Vault Cash.
    function leftover() external view returns (uint256 amount, uint256 setAsideAt, uint256 unrecognized) {
        return (_leftover, _leftoverStart, _unrecognized());
    }

    /// @notice Pool Loss Charges not yet restored by a recovery (IV-02 §5.4).
    function unrestoredCharges() external view returns (uint256) {
        return _unrestoredCharges;
    }

    /// @notice the posted Pool Tier principal ceiling (IV-02 §4.3) and when it was posted.
    function poolTierPrincipal() external view returns (uint256 value, uint256 postedAt) {
        return (_poolTierPrincipal, _poolTierPostedAt);
    }

    /// @notice whether a Valuation Event awaits its updated Pool Loss Allowance, and since when.
    function valuationEvent() external view returns (bool pending, uint256 recordedAt) {
        return (_valuationEventPending, _valuationEventAt);
    }

    /// @notice the Holdback Percentage as a WAD fraction.
    function holdbackRate() external view returns (uint256) {
        return _holdbackRate;
    }

    /// @notice the Holdback Percentage in basis points, rounded up (kept for the apps).
    function holdbackBps() external view returns (uint256) {
        return _holdbackRate.mulDiv(BPS, WAD, MathUpgradeable.Rounding.Up);
    }

    /* ========== RECOVERIES (IV-02 §5.4; decision 25) ========== */

    /// @notice posts a recovery: an accounting entry, not cash, that adds back to the Deployed
    /// Balance Pool Loss Charges not yet restored, and so raises the Share Value. Capped at the
    /// unrestored charges. Cash follows later as ordinary Returns.
    /// @dev The posting rules of a loss charge: two `VALUATION_ROLE` signers, an evidence hash, and
    /// not while a charge is being applied or a lower posting's releases are unprocessed.
    function postRecovery(uint256 value, bytes32 evidenceHash) external {
        if (evidenceHash == bytes32(0) || value == 0) revert LendingPoolInvalidAmount();
        if (_releasePending) revert LendingPoolReleasePending();
        if (lossCharge.pending) revert LendingPoolChargePending();
        (bool done, address first) = _pair(keccak256(abi.encode("recovery", value, evidenceHash)), VALUATION_ROLE);
        if (!done) return;
        uint256 unrestored = _unrestoredCharges;
        if (value > unrestored) revert LendingPoolInvalidAmount();
        accrue();
        _unrestoredCharges = unrestored - value;
        totalBorrowed += value;
        emit RecoveryPosted(value, unrestored - value, evidenceHash, first, msg.sender);
        _syncClock();
    }

    /* ========== VALUATION EVENT (Exhibit A, A4; decision 26) ========== */

    /// @notice records that a Valuation Event has occurred, two `VALUATION_ROLE` signers with an
    /// evidence hash. It has no effect but to allow one VALUATION_PENDING Suspension (§7.1(d))
    /// until the next Pool Loss Allowance posting, which clears it.
    function recordValuationEvent(bytes32 evidenceHash) external {
        if (evidenceHash == bytes32(0)) revert LendingPoolInvalidAmount();
        if (_valuationEventPending) revert LendingPoolInvalidAmount();
        (bool done, address first) = _pair(keccak256(abi.encode("valuationEvent", evidenceHash)), VALUATION_ROLE);
        if (!done) return;
        _valuationEventPending = true;
        _valuationSuspended = false;
        _valuationEventAt = uint64(block.timestamp);
        emit ValuationEventRecorded(evidenceHash, first, msg.sender);
    }

    /* ========== POOL TIER PRINCIPAL (IV-02 §4.3) ========== */

    /// @notice posts the outstanding principal of the Pool Tiers plus Margin Advances, two
    /// `VALUATION_ROLE` signers with an evidence hash. No Deployment may take the Deployed Balance
    /// above it, and none is made before it is first posted. Returning any excess on the next
    /// Business Day is Clear Lending's obligation off chain.
    function postPoolTierPrincipal(uint256 value, bytes32 evidenceHash) external {
        if (evidenceHash == bytes32(0)) revert LendingPoolInvalidAmount();
        (bool done, address first) = _pair(keccak256(abi.encode("poolTier", value, evidenceHash)), VALUATION_ROLE);
        if (!done) return;
        _poolTierPrincipal = value;
        _poolTierPostedAt = uint64(block.timestamp);
        emit PoolTierPrincipalPosted(value, evidenceHash, first, msg.sender);
    }

    /* ========== LEGEND (IV-02 §8.4; decision 27) ========== */

    /// @notice the legend the Register and the vault's metadata carry (IV-02 §8.4).
    function legend() external view returns (string memory) {
        return _legend;
    }

    /// @notice the keccak256 of the legend's text.
    function legendHash() external view returns (bytes32) {
        return keccak256(bytes(_legend));
    }

    /// @notice a scheduled legend change and when it may take effect (0 if none).
    function pendingLegend() external view returns (string memory text, uint256 effectiveAt) {
        return (_pendingLegend, _legendEffectiveAt);
    }

    /// @notice writes the legend. The first write takes effect at once, at initialization or the
    /// upgrade's setup; any later change waits 7 days on chain (`applyLegend`), on top of the Earn
    /// timelock and the Clear Lending Safe's two signers that hold `DEFAULT_ADMIN_ROLE`.
    function setLegend(string calldata text) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bytes(text).length == 0) revert LendingPoolInvalidAmount();
        bytes32 h = keccak256(bytes(text));
        if (bytes(_legend).length == 0) {
            _legend = text;
            emit LegendSet(h, text);
            return;
        }
        uint256 at = block.timestamp + LEGEND_DELAY;
        _pendingLegend = text;
        _legendEffectiveAt = uint64(at);
        emit LegendScheduled(h, text, at);
    }

    /// @notice puts a scheduled legend change in force once its 7 days have run. Permissionless.
    function applyLegend() external {
        uint256 at = _legendEffectiveAt;
        if (at == 0) revert LendingPoolInvalidAmount();
        if (block.timestamp < at) revert LendingPoolNotYet(at);
        string memory text = _pendingLegend;
        _legend = text;
        delete _pendingLegend;
        _legendEffectiveAt = 0;
        emit LegendSet(keccak256(bytes(text)), text);
    }

    /* ========== SUSPENSION (Article 7) ========== */

    function _isSuspensionSigner(address a) internal view returns (bool) {
        return hasRole(SUSPENSION_ROLE, a) || _isOfficer(a);
    }

    function _isOfficer(address a) internal view returns (bool) {
        return hasRole(CCO_ROLE, a) || hasRole(TREASURER_ROLE, a);
    }

    /// @notice suspends subscriptions, redemptions and queue processing, only for a listed
    /// Suspension Event (FIXED reason codes, §7.1). Set by one authorized individual and approved
    /// by a different one, at least one of them the CCO or treasurer (§7.3). Expires 72 hours after
    /// approval unless renewed.
    /// - The 10-Business-Day (240 hours) and 30-day limits count the total for the same facts,
    ///   across earlier suspensions on the same evidence.
    /// - A new suspension on the same facts within 30 days of the last one needs a Lending Board
    ///   resolution hash.
    /// - VALUATION_PENDING (§7.1(d)) only while a Valuation Event is pending, once per event, for
    ///   48 hours (two Business Days at most), not renewable; the allowance posting ends it.
    /// @param resolutionHash a Lending Board resolution with the Independent Manager's vote.
    function suspend(uint8 reason, bytes32 evidenceHash, bytes32 resolutionHash) external {
        if (reason < LOSS_EVENT || reason > VALUATION_PENDING) revert LendingPoolBadReason(reason);
        if (evidenceHash == bytes32(0)) revert LendingPoolInvalidAmount();
        if (isSuspended()) revert LendingPoolSuspended();
        if (reason == VALUATION_PENDING && (!_valuationEventPending || _valuationSuspended)) {
            revert LendingPoolNoValuationEvent();
        }
        uint256 lastEnd = evidenceEndedAt[evidenceHash];
        if (lastEnd != 0 && block.timestamp < lastEnd + 30 days && resolutionHash == bytes32(0)) {
            revert LendingPoolResolutionRequired();
        }
        if (!_isSuspensionSigner(msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        bytes32 action = keccak256(abi.encode("suspend", reason, evidenceHash, resolutionHash));
        address first = _proposerOf[action];
        if (first == msg.sender) revert LendingPoolSameSigner(msg.sender);
        if (first == address(0) || !_isSuspensionSigner(first)) {
            _proposerOf[action] = msg.sender;
            emit ActionProposed(action, msg.sender);
            return;
        }
        if (!_isOfficer(first) && !_isOfficer(msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        delete _proposerOf[action];
        emit ActionApproved(action, first, msg.sender);
        accrue();
        // Count the time already spent suspended on these facts.
        uint256 start = block.timestamp;
        uint256 lastStart = evidenceStartedAt[evidenceHash];
        if (lastEnd != 0 && lastStart != 0) start -= lastEnd - lastStart;
        uint256 expires = block.timestamp + (reason == VALUATION_PENDING ? 48 hours : 72 hours);
        if (reason != LEGAL_ORDER) {
            if (expires > start + 30 days) expires = start + 30 days;
            if (expires <= block.timestamp) revert LendingPoolSuspensionCeiling();
        }
        if (expires > start + 240 hours && resolutionHash == bytes32(0)) revert LendingPoolResolutionRequired();
        if (reason == VALUATION_PENDING) _valuationSuspended = true;
        uint64 eventId = _suspension.eventId + 1;
        _suspension = Suspension(eventId, reason, uint64(start), uint64(expires), first, evidenceHash);
        evidenceStartedAt[evidenceHash] = start;
        evidenceEndedAt[evidenceHash] = expires;
        emit Suspended(eventId, reason, evidenceHash, expires, first, msg.sender);
    }

    /// @notice renews the Suspension for 72 hours from now, by an authorized individual other
    /// than the one who set or last renewed it. Beyond 240 hours of the total on these facts it
    /// needs a Lending Board resolution hash; it never runs past 30 days of that total, except a
    /// LEGAL_ORDER renewed with an order hash, as long as the order requires. VALUATION_PENDING
    /// cannot be renewed.
    function renewSuspension(bytes32 resolutionHash, bytes32 orderHash) external {
        Suspension storage s = _suspension;
        if (s.expiresAt <= block.timestamp) revert LendingPoolNotSuspended();
        if (s.reason == VALUATION_PENDING) revert LendingPoolNotRenewable();
        if (!_isSuspensionSigner(msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        if (msg.sender == s.lastSigner) revert LendingPoolSameSigner(msg.sender);
        uint256 expires = block.timestamp + 72 hours;
        if (expires > s.startedAt + 240 hours && resolutionHash == bytes32(0)) revert LendingPoolResolutionRequired();
        if (!(s.reason == LEGAL_ORDER && orderHash != bytes32(0))) {
            uint256 ceiling = s.startedAt + 30 days;
            if (expires > ceiling) expires = ceiling;
            if (expires <= s.expiresAt) revert LendingPoolSuspensionCeiling();
        }
        s.expiresAt = uint64(expires);
        s.lastSigner = msg.sender;
        evidenceEndedAt[s.evidenceHash] = expires;
        emit SuspensionRenewed(s.eventId, expires, msg.sender, resolutionHash, orderHash);
    }

    /// @notice ends the Suspension once its event has ended. Any authorized individual.
    function liftSuspension() external {
        Suspension storage s = _suspension;
        if (s.expiresAt <= block.timestamp) revert LendingPoolNotSuspended();
        if (!_isSuspensionSigner(msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        accrue();
        s.expiresAt = uint64(block.timestamp);
        evidenceEndedAt[s.evidenceHash] = block.timestamp;
        emit SuspensionLifted(s.eventId, msg.sender);
    }

    /* ========== FUNDING RATE MODEL (IV-02 Sch. 2) ========== */

    /// @notice proposes new rate parameters (annual, WAD). Bounds are FIXED: R₀ 0–5%, S₁ 0–6%,
    /// K 60–90%, S₂ 0–10%, R₀+S₁+S₂ ≤ 10%. A change that does not lower R at any utilization takes
    /// effect after 48 hours; one that lowers it at any utilization needs 30 days' notice, and at
    /// most one may take effect per calendar quarter (UTC).
    function proposeRateModel(uint256 r0, uint256 s1, uint256 k, uint256 s2) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (r0 > MAX_R0 || s1 > MAX_S1 || k < MIN_K || k > MAX_K || s2 > MAX_S2 || r0 + s1 + s2 > MAX_RATE_SUM) {
            revert LendingPoolInvalidRateModel();
        }
        RateModel memory next = RateModel(uint64(r0), uint64(s1), uint64(k), uint64(s2));
        RateModel memory cur = _rateModel;
        bool lowers = _lowerAt(next, cur, 0) || _lowerAt(next, cur, cur.k) || _lowerAt(next, cur, next.k)
            || _lowerAt(next, cur, WAD);
        uint256 effectiveAt = block.timestamp + (lowers ? 30 days : 48 hours);
        if (lowers) {
            uint32 quarter = _quarterOf(effectiveAt);
            if (quarter == _lastLoweringQuarter) revert LendingPoolRateQuarter(quarter);
            _lastLoweringQuarter = quarter;
        }
        _pendingRate = PendingRate(next, uint64(effectiveAt), lowers);
        emit RateModelProposed(r0, s1, k, s2, effectiveAt, lowers);
    }

    /// @notice puts the proposed model in force once its notice has run. Permissionless.
    function applyRateModel() external {
        PendingRate memory p = _pendingRate;
        if (p.effectiveAt == 0) revert LendingPoolInvalidRateModel();
        if (block.timestamp < p.effectiveAt) revert LendingPoolRateNotice(p.effectiveAt);
        accrue();
        _rateModel = p.model;
        delete _pendingRate;
        emit RateModelApplied(p.model.r0, p.model.s1, p.model.k, p.model.s2);
    }

    /// @dev Whether `next` gives a lower rate than `cur` at utilization `u`. Both are piecewise
    /// linear with corners only at 0, their kinks and 1, so checking those points is exhaustive.
    function _lowerAt(RateModel memory next, RateModel memory cur, uint256 u) internal pure returns (bool) {
        return _rate(next, u) < _rate(cur, u);
    }

    /// @dev year × 4 + quarter index, plus one so zero means "none yet".
    function _quarterOf(uint256 ts) internal pure returns (uint32) {
        (uint256 y, uint256 m,) = PacificCalendar.civilFromDays(ts / 1 days);
        return uint32(y * 4 + (m - 1) / 3 + 1);
    }
}
