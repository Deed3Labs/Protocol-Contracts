// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./RevolvingIssuerBase.sol";

/// @notice RevolvingIssuer's section 12 code: judging cycles on the calendar, the Clear Credit
/// Agreement's terms, Automatic Clearing from Spendable, and the member's Savings draw allowance.
/// @dev Runs only by delegatecall from RevolvingIssuer, against its storage, like
/// RevolvingIssuerExtension. Split out to keep both under the EIP-170 size limit.
contract RevolvingIssuerCycles is RevolvingIssuerBase {
    /// @notice what RevolvingIssuer's constructor checks before pinning this as its cycles module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("RevolvingIssuerCycles.v4");
    }

    /* ---- section 12: cycles, terms and the member's own switches ---- */

    /// @dev Judges every cycle end that has passed (12.1, 12.5; Addendum 2). Returns 0 when the line
    /// is current on the calendar, 1 to keep it frozen (a second consecutive miss is unpaid), 2 for a
    /// computed default. Reached only by delegatecall from RevolvingIssuer.
    ///
    /// At each end: the dues of the cycle that closed at the end before are judged (paid since
    /// close against the Rebalance Amount; a missed Secured Minimum only pauses secured draws), Income
    /// Assurance falls by one, and the cycle closes: the Rebalance Amount and Secured Minimum due at
    /// the next end are fixed. The next end is computed from the member's Cycle End Day.
    ///
    /// 10c (decision 5): paused time since a close pushes its due point back by as much, and no due
    /// point is judged while a pause is in force, so a payment a pause prevented is never a miss. A
    /// close whose pushed due point is still ahead at the next end is held and judged once it passes;
    /// the next close is recorded at its own end all the same (12.17). One close is held at a time: a
    /// pause that outlasts a second cycle makes the line wait on the calendar until the first is judged.
    function judgeCycle(address member) external returns (uint8) {
        CycleState storage s = cycleState[member];
        CreditPeriod storage period = creditPeriods[member];
        if (s.cycleEnd == 0) {
            // A line opened before Phase 2e: on the calendar from here, never ending before its period.
            uint8 day = PacificCalendar.defaultDay(block.timestamp);
            s.cycleEndDay = day;
            uint256 from = period.expiration > block.timestamp ? period.expiration : block.timestamp;
            s.cycleEnd = uint64(PacificCalendar.endOnOrAfter(from, day));
        }
        _judgeHeld(member, s);
        while (s.cycleEnd <= block.timestamp) {
            uint64 end = s.cycleEnd;
            if (s.cureAmount == 0) {
                if (s.closedAt != 0) {
                    if (s.heldClosedAt != 0) {
                        period.expiration = block.timestamp + 1;
                        return 0;
                    }
                    if (_dueAt(member, end, s.closeClock) <= block.timestamp) _judgeDues(member, s, end, s.closeClock);
                    else _hold(s, end);
                }
                _countDownIncomePause(s, end);
                if (s.cureAmount == 0) _close(member, s, end);
            } else {
                _countDownIncomePause(s, end);
                // The line is frozen, but the cycle still gets its statement (12.17).
                IRevolvingCloseCarry(address(this)).closeCarry(member, end);
                _recordStatement(member, s, end, s.cureAmount, 0, _p2g().workoutOf[member]);
            }
            s.cycleEnd = uint64(PacificCalendar.endOnOrAfter(end + 1, s.cycleEndDay));
        }
        emit CreditPeriodExpired(member);
        if (s.cureAmount != 0) {
            // A second consecutive miss stands unpaid: the line stays frozen at its due point until
            // it is paid. Default only once computed, which needs the two-person notice.
            period.expiration = s.cureDueAt;
            if (!_computedDefault(member)) return 1;
            // Carry to now goes on the ledger first, so the write-off reaches all of it.
            IRevolvingCloseCarry(address(this)).closeCarry(member, uint64(block.timestamp));
            return 2;
        }
        // The period ends at the next cycle end, or at a held close's due point if that is sooner.
        uint256 expiration = s.cycleEnd;
        if (s.heldClosedAt != 0) {
            uint256 due = _dueAt(member, s.heldDueAt, s.heldClock);
            if (due < expiration) expiration = due > block.timestamp ? due : block.timestamp + 1;
        }
        period.issuedAt = s.closedAt != 0 ? s.closedAt : block.timestamp;
        period.expiration = expiration;
        period.graceLength = 0;
        emit CreditPeriodCreated(member, expiration, 0);
        return 0;
    }

    /// @dev A due point `end`, pushed back by the paused time since the close it belongs to, whose
    /// pause clock read `clock` (10c). Never while a pause is in force.
    function _dueAt(address member, uint256 end, uint256 clock) private view returns (uint256) {
        if (_pauseInForce(member)) return type(uint256).max;
        return end + _pauseClockOf(member) - clock;
    }

    /// @dev Holds the open close for judging at its pushed due point `end` + paused time (10c).
    function _hold(CycleState storage s, uint64 end) private {
        s.heldClosedAt = s.closedAt;
        s.heldDueAt = end;
        s.heldRA = s.rebalanceAmount;
        s.heldSM = s.securedMinimum;
        s.heldPaid = s.paidSinceClose;
        s.heldClock = s.closeClock;
        s.heldWorkout = s.closedWorkout;
        s.closedAt = 0;
    }

    /// @dev Judges a held close once its pushed due point has passed, in the open close's place,
    /// which is put back after.
    function _judgeHeld(address member, CycleState storage s) private {
        if (s.heldClosedAt == 0 || _dueAt(member, s.heldDueAt, s.heldClock) > block.timestamp) return;
        (uint64 closedAt, uint128 ra, uint128 sm, uint128 paid, uint8 workout) =
            (s.closedAt, s.rebalanceAmount, s.securedMinimum, s.paidSinceClose, s.closedWorkout);
        s.closedAt = s.heldClosedAt;
        s.rebalanceAmount = s.heldRA;
        s.securedMinimum = s.heldSM;
        s.paidSinceClose = s.heldPaid;
        s.closedWorkout = s.heldWorkout;
        s.heldClosedAt = 0;
        _judgeDues(member, s, s.heldDueAt, s.heldClock);
        s.closedAt = closedAt;
        s.rebalanceAmount = ra;
        s.securedMinimum = sm;
        s.paidSinceClose = paid;
        s.closedWorkout = workout;
    }

    /// @dev Income Assurance falls by one at each cycle end; the end it runs out at is kept, so a
    /// further attestation for the same hardship can tell whether it would be consecutive (12.13).
    function _countDownIncomePause(CycleState storage s, uint64 end) private {
        if (s.incomePause != 0 && --s.incomePause == 0) s.hardshipLastEnd = end;
    }

    /// @dev Judges the dues of the cycle that closed at `s.closedAt`, at its due point `end`. `clock`
    /// is the pause clock at that close.
    function _judgeDues(address member, CycleState storage s, uint64 end, uint256 clock) private {
        CycleRecord storage c = cycleOf[member];
        uint256 ra = s.rebalanceAmount;
        uint256 owed = ra + s.securedMinimum;
        uint256 paid = s.paidSinceClose;

        bool deposited;
        if (depositSource != address(0)) {
            (bool ok, bytes memory data) =
                depositSource.staticcall(abi.encodeWithSignature("lastDepositAt(address)", member));
            deposited = ok && data.length >= 32 && abi.decode(data, (uint256)) >= s.closedAt;
        }
        c.depositBits = uint8(((uint256(c.depositBits) << 1) | (deposited ? 1 : 0)) & 0x3f);

        bool clean = paid >= ra;
        uint8 workout = s.closedWorkout;
        if (s.incomePause != 0) {
            // Income Assurance (12.13): nothing was due, no miss is recorded and nothing counts
            // toward default. A miss before it is not consecutive with one after it.
            clean = true;
            c.missedInRow = 0;
            c.cureNoticeAt = 0;
        } else if (clean && workout != 0) {
            // A workout cycle paid as it asks (12.18): not a miss, but the run of misses stands until
            // a re-age (below).
        } else if (clean) {
            if (c.cleanStreak < type(uint8).max) c.cleanStreak++;
            c.missedInRow = 0;
            c.cureNoticeAt = 0;
            c.unsecuredCeiling = 0;
        } else if (_useGrace(s, end)) {
            // Cycle Assurance (12.13): an eligible member's unpaid Rebalance Amount uses a grace, if
            // one is left in the window. The limit is not halved, nothing settles and the cycle does
            // not count toward default; the run of misses stands as it was.
            c.cleanStreak = 0;
            emit GraceCycleUsed(member, end);
        } else if (c.missedInRow == 0) {
            // First miss: halve the unsecured limit, even below what is drawn. The excess is settled
            // from pledged bonds or pool shares by the Liquidator, never from Savings.
            c.missedInRow = 1;
            c.cleanStreak = 0;
            uint256 limit;
            for (uint256 i = 0; i < tiers.length; i++) {
                if (!_isUnsecured(i)) continue;
                uint256 halved = tierCapacity[member][i] / 2;
                tierCapacity[member][i] = halved;
                limit += halved;
                emit TierCapacityUpdated(member, i, halved);
            }
            c.unsecuredCeiling = uint128(limit == 0 ? 1 : limit);
            uint256 total;
            for (uint256 i = 0; i < tiers.length; i++) total += tierCapacity[member][i];
            // The ledger refuses a ceiling below what is owed. The tiers already stop new draws (no
            // headroom above the halved capacity), so the ledger keeps at least the balance.
            uint256 balance = stableCredit.creditBalanceOf(member);
            stableCredit.updateCreditLimit(member, total > balance ? total : balance);
            emit UnsecuredLimitHalved(member, limit, ra > limit ? ra - limit : 0);
        } else {
            // A second miss in a row (or later): this amount, unpaid, is what default turns on, and
            // only after a two-person cure-notice timestamp for it (12.5). The line stays frozen.
            if (c.missedInRow < type(uint8).max) c.missedInRow++;
            c.cleanStreak = 0;
            c.cureNoticeAt = 0;
            s.noticeProposer = address(0);
            s.cureAmount = uint128(ra - paid);
            s.cureDueAt = end;
            // 10c: the grace period runs longer by the paused time since this close: what pushed the
            // due point back, and whatever falls inside the grace period itself.
            s.cureClock = clock;
        }
        // A missed Secured Minimum is never a miss (12.1): it only pauses secured draws until the
        // payments since this close reach the Rebalance Amount plus the Secured Minimum.
        if (s.incomePause == 0 && paid < owed && owed > ra) {
            uint256 lack = owed - paid;
            if (lack > s.securedPastDue) s.securedPastDue = uint128(lack);
            uint256 smLack = owed - ra < lack ? owed - ra : lack;
            s.pastDueSM = uint128(smLack);
            emit SecuredMinimumMissed(member, lack);
        }
        if (workout != 0) _judgeWorkout(member, s, c, workout, end, clean);
        s.closedAt = 0;
        s.rebalanceAmount = 0;
        s.securedMinimum = 0;
        s.closedWorkout = 0;
        emit CycleJudged(member, clean, c.missedInRow, c.cleanStreak, deposited);
    }

    /// @dev 12.18 at a due point: the workout plan's installment comes due (none while Income
    /// Assurance runs: the lower amount due applies) and its past-due date is kept; a PLAN paid off
    /// ends. Then the re-age: three consecutive REDUCED or PLAN cycles paid as required reset the
    /// run of misses, at most once per rolling 365 days and twice per rolling 5 years. DEFERRAL
    /// cycles neither count nor break the run.
    function _judgeWorkout(address member, CycleState storage s, CycleRecord storage c, uint8 workout, uint64 end, bool paid)
        private
    {
        Workout storage w = _p2g().workoutOf[member];
        if (workout == WORKOUT_PLAN && w.state == WORKOUT_PLAN) {
            if (s.closedAt >= w.startedAt && s.incomePause == 0 && w.planDueCount < w.planCycles) w.planDueCount++;
            uint256 planPaid = _planPaid(member, w);
            paid = planPaid >= _planDue(w);
            if (paid) w.planPastDueSince = 0;
            else if (w.planPastDueSince == 0) w.planPastDueSince = end;
            if (planPaid >= w.planTotal) {
                w.state = 0;
                emit WorkoutEnded(member, WORKOUT_PLAN);
            }
        }
        if (workout == WORKOUT_DEFERRAL || s.incomePause != 0) return;
        if (!paid) {
            w.qualifying = 0;
            return;
        }
        if (++w.qualifying < 3) return;
        w.qualifying = 0;
        if ((w.reagedAt == 0 || end >= w.reagedAt + 365 days) && (w.reagedBefore == 0 || end >= w.reagedBefore + 5 * 365 days)) {
            c.missedInRow = 0;
            w.reagedBefore = w.reagedAt;
            w.reagedAt = end;
            emit WorkoutReaged(member, end);
        }
    }

    /// @dev Uses a grace (12.13) when the member is eligible and has one left in the rolling window:
    /// at most `graceCyclesPerWindow` (1, up to 4) per `graceWindow` (365 days), counted by due point.
    /// Computed; no role uses or grants a grace.
    function _useGrace(CycleState storage s, uint64 end) private returns (bool) {
        if (!s.graceEligible) return false;
        DueTerms memory t = dueTerms;
        uint256 max = t.graceCyclesPerWindow == 0 ? 1 : t.graceCyclesPerWindow;
        uint256 window = t.graceWindow == 0 ? 365 days : t.graceWindow;
        uint256 uses = s.graceUses;
        uint256 used;
        for (uint256 i = 0; i < 4; i++) {
            uint256 at = (uses >> (64 * i)) & type(uint64).max;
            if (at != 0 && at + window > end) used++;
        }
        if (used >= max) return false;
        s.graceUses = (uses << 64) | end;
        return true;
    }

    /// @dev Closes a cycle at `end`: what is due at the next end (12.1).
    function _close(address member, CycleState storage s, uint64 end) private {
        // 12.17 (decision 18): carry is brought up to the cycle end itself, so the close's figures
        // are as at that end even when it is recorded later.
        IRevolvingCloseCarry(address(this)).closeCarry(member, end);
        Workout storage w = _p2g().workoutOf[member];
        uint8 workout = w.state;
        uint256 ra;
        uint256 sm;
        if (s.incomePause == 0) {
            uint256 unsecuredPrincipal;
            uint256 securedPrincipal;
            for (uint256 i = 0; i < tiers.length; i++) {
                if (_isUnsecured(i)) {
                    ra += tierPrincipal[member][i];
                    unsecuredPrincipal += _principalOnly(member, i);
                } else if (tiers[i].kind != WORKOUT_KIND) {
                    securedPrincipal += _principalOnly(member, i);
                }
            }
            sm = s.assetCarry;
            if (unsecuredPrincipal == 0 && securedPrincipal != 0) {
                DueTerms memory t = dueTerms;
                uint256 bps = t.raisedFrom != 0 && end >= t.raisedFrom ? t.raisedBps : t.securedMinimumBps;
                uint256 part = (securedPrincipal * bps) / BPS_;
                if (part < t.securedMinimumFloor) part = t.securedMinimumFloor;
                sm += part < securedPrincipal ? part : securedPrincipal;
            }
        }
        // 12.18: a DEFERRAL owes no Rebalance Amount and a REDUCED one at most the attested amount;
        // a PLAN has no unsecured balance left. DEFERRAL and REDUCED count down the closes they
        // cover, and end at the close after the last: that one, and what it fixes, is ordinary.
        if (workout != 0 && workout != WORKOUT_PLAN) {
            if (w.cyclesLeft == 0) {
                w.state = 0;
                emit WorkoutEnded(member, workout);
                workout = 0;
            } else {
                w.cyclesLeft--;
                if (workout == WORKOUT_DEFERRAL) ra = 0;
                else if (ra > w.reducedAmount) ra = w.reducedAmount;
            }
        }
        s.closedWorkout = workout;
        s.assetCarry = 0;
        s.rebalanceAmount = uint128(ra);
        s.securedMinimum = uint128(sm);
        s.paidSinceClose = 0;
        s.closedAt = end;
        s.closeClock = _pauseClockOf(member);
        _recordStatement(member, s, end, ra, sm, w);
        emit CycleClosed(member, end, ra, sm);
    }

    /// @dev 12.17 (decisions 17-22): the cycle's statement figures as at its end, in one event, and
    /// the most recent close kept for views. Start figures are the last close's end figures. A
    /// statement is required when any position, secured ones included, ends with a balance.
    function _recordStatement(address member, CycleState storage s, uint64 end, uint256 ra, uint256 sm, Workout storage w)
        private
    {
        uint256 n = tiers.length;
        uint256[] memory startPrincipal = new uint256[](n);
        uint256[] memory startCarry = new uint256[](n);
        uint256[] memory endPrincipal = new uint256[](n);
        uint256[] memory endCarry = new uint256[](n);
        uint256[] memory cycleCarry = new uint256[](n);
        uint256[] memory principalSeconds = new uint256[](n);
        bool required;
        for (uint256 i = 0; i < n; i++) {
            PositionStat storage p = _p2g().positionStat[member][i];
            startPrincipal[i] = p.endPrincipal;
            startCarry[i] = p.endCarry;
            uint256 carry = tierCarry[member][i];
            uint256 principal = tierPrincipal[member][i] - carry;
            if (principal + carry != 0) required = true;
            endPrincipal[i] = principal;
            endCarry[i] = carry;
            cycleCarry[i] = p.cycleCarry;
            principalSeconds[i] = p.principalSeconds;
            p.endPrincipal = uint128(principal);
            p.endCarry = uint128(carry);
            p.lastCycleCarry = p.cycleCarry;
            p.lastPrincipalSeconds = p.principalSeconds;
            p.cycleCarry = 0;
            p.principalSeconds = 0;
        }
        s.lastCycleEnd = end;
        s.lastRecordedAt = uint64(block.timestamp);
        s.lastStatementRequired = required;
        emit CycleStatement(
            member, end, uint64(block.timestamp), startPrincipal, startCarry, endPrincipal, endCarry, cycleCarry,
            principalSeconds, ra, sm, required, s.closedWorkout, w.ref
        );
    }

    /* ---- section 12 settings: back here from the workouts module (decision 55, for room) ---- */

    /// @notice sets the governed terms of the Clear Credit Agreement (section 12).
    /// @dev `autoClearOffGlobal` is no longer read: only the member's hybridMode switches Automatic
    /// Clearing off (12.2, Addendum 2). The field stays for the layout and the ABI.
    function setCreditTerms(CreditTerms calldata terms, uint128 boostBase, uint128 boostEarned)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        creditTerms = terms;
        boostBaseCap = boostBase;
        boostEarnedCap = boostEarned;
        emit CreditTermsUpdated(terms, boostBase, boostEarned);
    }

    /// @notice names where a member's last ESA deposit is read, for the Boost deposit test.
    function setDepositSource(address source) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        depositSource = source;
        emit DepositSourceUpdated(source);
    }

    /* ---- moved here from the workouts module (Phase 2g, for room) ---- */

    /// @notice opens a member's line with a starting ceiling in each tier.
    /// @dev Cycles are calendar months (12.1, Addendum 2): each ends at 23:59:59 Pacific on the
    /// member's Cycle End Day, and the first on the first such day at least 14 days from now. The
    /// day is the member's choice at opening; zero takes the default (the day before today, or the
    /// 28th). Automatic Clearing is set separately, from the member's own choice and signature.
    /// @param member address of the member.
    /// @param capacities ceiling contribution per tier, in tier order.
    /// @param cycleEndDay the member's Cycle End Day (1-28), or zero for the default.
    function openLine(
        address member,
        uint256[] calldata capacities,
        uint8 cycleEndDay
    ) external onlyCreditRole(CREDIT_LINES_ROLE) notNull(member) {
        // Only a member with no live line: reopening one would restart its clock and its dues,
        // which no role may do (12.1). A default deletes the period, so re-onboarding still works.
        if (inInitializedPeriod(member)) revert RevolvingIssuerCyclesComputed();
        if (cycleEndDay > 28) revert RevolvingIssuerBadCycleDay(cycleEndDay);
        // 4c item 3: re-onboarding waits until collateral pledged against an earlier default has
        // been applied, so a new line can never cut that recovery short.
        if (_defaultedOnCurrentLine(member) && address(exposureSource) != address(0)) {
            for (uint256 i = 0; i < tiers.length; i++) {
                if (_isUnsecured(i) || tierPrincipal[member][i] == 0) continue;
                (bool ok, bytes memory data) = address(exposureSource).staticcall(
                    abi.encodeWithSignature("collateralValueOf(address,bytes32)", member, tiers[i].kind)
                );
                if (ok && data.length >= 32 && abi.decode(data, (uint256)) != 0) {
                    revert RevolvingIssuerDefaultCollateralUnapplied(member);
                }
            }
        }
        // State gate (spec item 9): no line for a member with no attested state, or in a state
        // where the revolving product is not enabled.
        if (address(rateSchedule) != address(0)) {
            bytes32 state = _stateOf(member);
            if (state == bytes32(0) || !rateSchedule.isEnabled(state, ceilingProduct)) {
                revert RevolvingIssuerStateNotEnabled(member, state);
            }
        }
        // A new line starts its own record: misses, a halved ceiling or a streak of an earlier line
        // do not carry over.
        delete cycleOf[member];
        uint256 total;
        uint256 increase;
        for (uint256 i = 0; i < capacities.length && i < tiers.length; i++) {
            uint256 previous = tierCapacity[member][i];
            if (capacities[i] > previous) increase += capacities[i] - previous;
            tierCapacity[member][i] = capacities[i];
            total += capacities[i];
            emit TierCapacityUpdated(member, i, capacities[i]);
        }
        _checkCreditCaps(member);
        // Opening a line is new credit like any other limit raised (audit H-4).
        _consumeDailyCap(capacityIncreaseCap, "CAPACITY", increase);
        stableCredit.createCreditLine(member, total, 0);
        uint8 day = cycleEndDay != 0 ? cycleEndDay : PacificCalendar.defaultDay(block.timestamp);
        uint64 firstEnd = uint64(PacificCalendar.endOnOrAfter(block.timestamp + 14 days, day));
        CycleState storage s = cycleState[member];
        // A fresh clock and no dues; the Automatic Clearing choice and hybridMode are the member's
        // and stay as they set them.
        s.cycleEnd = firstEnd;
        s.cycleEndDay = day;
        s.closedAt = 0;
        s.rebalanceAmount = 0;
        s.securedMinimum = 0;
        s.paidSinceClose = 0;
        s.securedPastDue = 0;
        s.pastDueSM = 0;
        s.cureAmount = 0;
        s.noticeProposer = address(0);
        _updateCreditPeriod(member, firstEnd, 0);
        emit CycleEndDaySet(member, day, firstEnd);
        // A new line starts a new default episode (Phase 4b, M-C): a default recorded before now
        // stays on record, but no longer lets anyone liquidate this line.
        lineOpenedAt[member] = uint64(block.timestamp);
    }
}
