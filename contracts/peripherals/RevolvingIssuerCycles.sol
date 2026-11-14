// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./RevolvingIssuerBase.sol";

/// @notice RevolvingIssuer's section 12 code: judging cycles on the calendar, the Clear Credit
/// Agreement's terms, Automatic Clearing from Spendable, and the member's Savings draw allowance.
/// @dev Runs only by delegatecall from RevolvingIssuer, against its storage, like
/// RevolvingIssuerExtension. Split out to keep both under the EIP-170 size limit.
contract RevolvingIssuerCycles is RevolvingIssuerBase {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice what RevolvingIssuer's constructor checks before pinning this as its cycles module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("RevolvingIssuerCycles.v3");
    }

    /// @notice Automatic Clearing (12.2): records a deposit that landed in the member's Spendable at
    /// the bank as a repayment, at the level the member chose.
    /// @dev The settler delivers the cash; nothing is taken from the member's wallet, so Ready to
    /// allocate USDC and CLRUSD are never swept. Refused while the member is in hybridMode (the only
    /// thing that switches clearing off besides the member), for a deposit from an excluded payer
    /// (federal benefits unless the member removed them), and once per ref.
    ///
    /// UNSECURED (the default) clears Boost and income-backed, then any unpaid Secured Minimum, and
    /// stops. DUE_ONLY clears exactly the unpaid Rebalance Amount and any unpaid Secured Minimum.
    /// EVERYTHING clears every tier. Within each, dearest first by what each tier costs now (4c
    /// item 7). What is not applied stays in Spendable.
    /// @param ref idempotency key.
    /// @param member address being repaid for.
    /// @param amount the deposit available to clear, in ledger units.
    /// @param payer the deposit's originator (hashed ACH company id), checked against exclusions.
    function repayForMember(bytes32 ref, address member, uint256 amount, bytes32 payer) external notNull(member) {
        if (!isCardSettler[_msgSender()]) revert RevolvingIssuerNotCardSettler(_msgSender());
        if (!autoRepayEnabled[member]) revert RevolvingIssuerAutoRepayNotEnabled(member);
        if (cycleState[member].hybridMode) revert RevolvingIssuerHybridMode(member);
        if (_payerExcluded(member, payer)) revert RevolvingIssuerExcludedPayer(member, payer);
        if (amount == 0) revert RevolvingIssuerCardAmountZero();
        if (autoRepayments[ref] != 0) revert RevolvingIssuerAutoRepayAlreadyUsed(ref);

        _touch(member);
        uint8 level = autoClearScopeOf[member];
        uint256 unsecuredMask = _tierMask(true);
        uint256 first;
        uint256 second;
        if (level == SCOPE_ALL) {
            first = _min(amount, _totalPrincipal(member));
        } else {
            (uint256 owedUnsecured, uint256 owedSecured) = _owedBySide(member);
            (uint256 dueU, uint256 dueT) = _dues(member);
            first = _min(amount, owedUnsecured);
            if (level == LEVEL_DUE_ONLY) first = _min(first, dueU);
            // What the first part leaves of the Secured Minimum: every due figure falls with it.
            uint256 leftU = dueU > first ? dueU - first : 0;
            uint256 leftT = dueT > first ? dueT - first : 0;
            second = _min(_min(amount - first, leftT - leftU), owedSecured);
        }
        uint256 applied = first + second;
        if (applied == 0) revert RevolvingIssuerNothingToClear(member);
        autoRepayments[ref] = applied;

        IERC20Upgradeable reserve = stableCredit.reserveToken();
        reserve.safeTransferFrom(_msgSender(), address(this), applied);
        reserve.forceApprove(address(stableCredit), applied);
        stableCredit.repayCreditBalanceFor(address(this), member, uint128(applied));

        if (level == SCOPE_ALL) {
            _repay(member, first, type(uint256).max);
        } else {
            _repay(member, first, unsecuredMask);
            _repay(member, second, ~unsecuredMask);
        }
        emit AutoRepaid(ref, member, applied);
        emit AutoCleared(ref, member, applied, amount - applied);
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
        while (s.cycleEnd <= block.timestamp) {
            uint64 end = s.cycleEnd;
            if (s.cureAmount == 0) {
                if (s.closedAt != 0) {
                    // 10c (decision 5): paused time since this close pushes its due point back by as
                    // much, and no due point is judged while a pause is in force, so a payment a pause
                    // prevented is never a miss. The line waits on the calendar until then.
                    uint256 due = end + _pauseClockOf(member) - s.closeClock;
                    if (due > block.timestamp || _pauseInForce(member)) {
                        period.expiration = due > block.timestamp ? due : block.timestamp + 1;
                        return 0;
                    }
                    _judgeDues(member, s, end);
                }
                _countDownIncomePause(s, end);
                if (s.cureAmount == 0) _close(member, s, end);
            } else {
                _countDownIncomePause(s, end);
                // The line is frozen, but the cycle still gets its statement (12.17).
                IRevolvingCloseCarry(address(this)).closeCarry(member, end);
                _recordStatement(member, s, end, s.cureAmount, 0, workoutOf[member]);
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
            _touch(member);
            return 2;
        }
        period.issuedAt = s.closedAt != 0 ? s.closedAt : block.timestamp;
        period.expiration = s.cycleEnd;
        period.graceLength = 0;
        emit CreditPeriodCreated(member, s.cycleEnd, 0);
        return 0;
    }

    /// @dev Income Assurance falls by one at each cycle end; the end it runs out at is kept, so a
    /// further attestation for the same hardship can tell whether it would be consecutive (12.13).
    function _countDownIncomePause(CycleState storage s, uint64 end) private {
        if (s.incomePause != 0 && --s.incomePause == 0) s.hardshipLastEnd = end;
    }

    /// @dev Judges the dues of the cycle that closed at `s.closedAt`, at its due point `end`.
    function _judgeDues(address member, CycleState storage s, uint64 end) private {
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
            // 10c: the grace period from here runs longer by any paused time from now.
            s.cureClock = _pauseClockOf(member);
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
        Workout storage w = workoutOf[member];
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
        Workout storage w = workoutOf[member];
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
        // a PLAN has no unsecured balance left. Each counts down the closes it covers.
        if (workout != 0) {
            if (workout == WORKOUT_DEFERRAL) ra = 0;
            else if (workout == WORKOUT_REDUCED && ra > w.reducedAmount) ra = w.reducedAmount;
            if (workout != WORKOUT_PLAN && --w.cyclesLeft == 0) {
                w.state = 0;
                emit WorkoutEnded(member, workout);
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
            PositionStat storage p = positionStat[member][i];
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

    /// @dev What the member owes on the unsecured tiers and on the rest.
    function _owedBySide(address member) private view returns (uint256 unsecured, uint256 secured) {
        for (uint256 i = 0; i < tiers.length; i++) {
            if (_isUnsecured(i)) unsecured += tierPrincipal[member][i];
            else secured += tierPrincipal[member][i];
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

}
