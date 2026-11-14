// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./RevolvingIssuerBase.sol";

/// @title RevolvingIssuerWorkouts
/// @notice RevolvingIssuer's Phase 2g code: workout states (12.18) and their plan's default, the pause
/// clock it reads (10c) and the statement views (12.17); and, moved here for room, the line's opening,
/// tier set-up and the member's clearing settings.
/// @dev Runs only by delegatecall from RevolvingIssuer, against its storage. The workout functions are
/// reached through RevolvingIssuer's fallback, at its address, with this contract's ABI. A workout is
/// set only by a two-person attestation and can only reduce or delay what is due; nothing here
/// writes a due amount, a miss or a revolving default.
contract RevolvingIssuerWorkouts is RevolvingIssuerBase {
    using CarryIndex for CarryIndex.Index;

    /// @notice what RevolvingIssuer's constructor checks before pinning this module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("RevolvingIssuerWorkouts.v1");
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    bytes32 public constant END_WORKOUT_TYPEHASH = keccak256("EndWorkout(address member,uint256 nonce,uint256 deadline)");

    /* ---- 10c: the pause clock ---- */

    /// @notice names where the member's pause clock is read (Phase 2g, 10c): paused seconds and
    /// whether a pause is in force, from CLRUSD and the vault. Set once. It can only lengthen a grace
    /// period or hold off a default: no role uses it to bring one on.
    function setPauseClock(address clock) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        if (clock == address(0) || pauseClock != address(0)) revert RevolvingIssuerPauseClockSet();
        pauseClock = clock;
        emit PauseClockSet(clock);
    }

    /* ---- 12.18: workout states (two people) ---- */

    /// @notice proposes a workout for the member: DEFERRAL (1, at most 2 cycles), REDUCED (2, at most
    /// 3 cycles, at `reducedAmount`) or PLAN (3, at most 12 cycle payments), recording `workoutRef`.
    /// A different signer approves the same terms; nothing changes until then.
    function proposeWorkout(address member, uint8 state, uint8 cycles, uint128 reducedAmount, bytes32 workoutRef)
        external
        onlyCreditRole(ATTESTER_ROLE)
    {
        uint256 max = state == WORKOUT_DEFERRAL ? 2 : state == WORKOUT_REDUCED ? 3 : state == WORKOUT_PLAN ? 12 : 0;
        if (
            cycles == 0 || cycles > max || workoutRef == bytes32(0)
                || (state == WORKOUT_REDUCED) != (reducedAmount != 0)
        ) revert RevolvingIssuerWorkoutTerms(state, cycles);
        Workout storage w = workoutOf[member];
        w.proposer = _msgSender();
        w.proposal = keccak256(abi.encode(state, cycles, reducedAmount, workoutRef));
        emit WorkoutProposed(member, _msgSender(), state, cycles, reducedAmount, workoutRef);
    }

    /// @notice a second signer approves the same terms, and the workout starts. At most one per
    /// member per rolling 365 days, computed here, unless a second workout was separately approved.
    function approveWorkout(address member, uint8 state, uint8 cycles, uint128 reducedAmount, bytes32 workoutRef)
        external
        onlyCreditRole(ATTESTER_ROLE)
    {
        Workout storage w = workoutOf[member];
        address proposer = w.proposer;
        if (proposer == address(0) || w.proposal != keccak256(abi.encode(state, cycles, reducedAmount, workoutRef))) {
            revert RevolvingIssuerNoProposal(member);
        }
        if (proposer == _msgSender()) revert RevolvingIssuerSameSigner(proposer);
        if (w.state != 0) revert RevolvingIssuerWorkoutRunning(member);
        if (w.startedAt != 0 && block.timestamp < w.startedAt + 365 days) {
            if (!w.secondApproved) revert RevolvingIssuerWorkoutTooSoon(member, w.startedAt + 365 days);
            w.secondApproved = false;
        }
        w.proposer = address(0);
        w.proposal = bytes32(0);
        // Carry up to now is charged on the terms that applied up to now.
        _touch(member);
        w.state = state;
        w.cyclesLeft = cycles;
        w.reducedAmount = reducedAmount;
        w.ref = workoutRef;
        w.startedAt = uint64(block.timestamp);
        w.qualifying = 0;
        CycleState storage s = cycleState[member];
        // The running cycle is the first one covered: the dues its close already fixed are reduced
        // or delayed the same way (with a close a pause holds open: 10c), and one close fewer is
        // left to cover. Every cycle counts once, so a DEFERRAL of 2 never relieves a third.
        if (s.closedAt != 0) {
            s.rebalanceAmount = uint128(_workoutRA(state, s.rebalanceAmount, reducedAmount));
            s.closedWorkout = state;
            if (state != WORKOUT_PLAN) w.cyclesLeft = cycles - 1;
        }
        if (s.heldClosedAt != 0) {
            s.heldRA = uint128(_workoutRA(state, s.heldRA, reducedAmount));
            s.heldWorkout = state;
        }
        if (state == WORKOUT_PLAN) _startPlan(member, s, w, cycles);
        emit WorkoutStarted(member, state, cycles, reducedAmount, workoutRef);
    }

    /// @dev A Rebalance Amount under a workout: none under a DEFERRAL or a PLAN (which leaves no
    /// unsecured balance), at most the attested amount under a REDUCED.
    function _workoutRA(uint8 state, uint256 ra, uint256 reducedAmount) private pure returns (uint256) {
        if (state != WORKOUT_REDUCED) return 0;
        return ra > reducedAmount ? reducedAmount : ra;
    }

    /// @notice proposes a second workout within 365 days of the last, with its own reference hash.
    function proposeSecondWorkout(address member, bytes32 secondRef) external onlyCreditRole(ATTESTER_ROLE) {
        Workout storage w = workoutOf[member];
        if (secondRef == bytes32(0) || secondRef == w.ref) revert RevolvingIssuerWorkoutTerms(0, 0);
        w.secondProposer = _msgSender();
        w.secondRef = secondRef;
        emit SecondWorkoutProposed(member, _msgSender(), secondRef);
    }

    /// @notice a second signer approves it: one more workout may start within the 365 days.
    function approveSecondWorkout(address member, bytes32 secondRef) external onlyCreditRole(ATTESTER_ROLE) {
        Workout storage w = workoutOf[member];
        address proposer = w.secondProposer;
        if (proposer == address(0) || w.secondRef != secondRef) revert RevolvingIssuerNoProposal(member);
        if (proposer == _msgSender()) revert RevolvingIssuerSameSigner(proposer);
        w.secondProposer = address(0);
        w.secondApproved = true;
        emit SecondWorkoutApproved(member, secondRef);
    }

    /// @notice the member ends their own DEFERRAL or REDUCED early. A PLAN ends when it is paid off.
    function endWorkout() external {
        _endWorkout(_msgSender());
    }

    /// @notice the same, from the member's EIP-712 signature.
    function endWorkoutWithSignature(address member, uint256 deadline, bytes calldata signature) external {
        _useSignature(
            member, keccak256(abi.encode(END_WORKOUT_TYPEHASH, member, memberNonces[member], deadline)), deadline, signature
        );
        _endWorkout(member);
    }

    function _endWorkout(address member) private {
        Workout storage w = workoutOf[member];
        uint8 state = w.state;
        if (state != WORKOUT_DEFERRAL && state != WORKOUT_REDUCED) revert RevolvingIssuerNothingDue(member);
        // A DEFERRAL accrued nothing on the unsecured positions up to now; from now they accrue.
        _touch(member);
        w.state = 0;
        w.cyclesLeft = 0;
        emit WorkoutEnded(member, state);
    }

    /// @dev PLAN: the unsecured revolving balances (income-backed and Boost, principal and carry)
    /// move into the workout plan's own 0% position, with no mint, no fee and no merchant, and are
    /// repaid in equal cycle payments, the last taking the rounding. An unpaid second Rebalance
    /// Amount and its notice go with them: from here the plan's own default rules apply.
    function _startPlan(address member, CycleState storage s, Workout storage w, uint8 cycles) private {
        uint256 planTier = type(uint256).max;
        uint256 total;
        uint256 carry;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tiers[i].kind == WORKOUT_KIND) {
                planTier = i;
                continue;
            }
            uint256 owed = tierPrincipal[member][i];
            if (!_isUnsecured(i) || owed == 0) continue;
            total += owed;
            carry += tierCarry[member][i];
            tierPrincipal[member][i] = 0;
            tierCarry[member][i] = 0;
            emit WorkoutBalanceMoved(member, i, owed);
        }
        if (planTier == type(uint256).max || total == 0) revert RevolvingIssuerNoWorkoutTier();
        tierPrincipal[member][planTier] += total;
        tierCapacity[member][planTier] = tierPrincipal[member][planTier];
        w.planTotal = uint128(total);
        w.planInstallment = uint128(total / cycles);
        w.planCycles = cycles;
        w.planDueCount = 0;
        w.planPastDueSince = 0;
        w.planNoticeAt = 0;
        w.planNoticeProposer = address(0);
        s.cureAmount = 0;
        s.noticeProposer = address(0);
        cycleOf[member].cureNoticeAt = 0;
        emit WorkoutPlanStarted(member, w.ref, total - carry, carry, cycles, total / cycles);
    }

    /// @notice pays the member's workout plan, from the caller (who approves StableCredit for the
    /// reserve token). Directed: it reduces the plan's position and nothing else.
    function payWorkoutPlan(address member, uint256 amount) external {
        // Closes any cycle end that has passed and brings the position's principal-seconds up to
        // now before it changes (12.17).
        _touch(member);
        uint256 planTier = _workoutTier();
        uint256 owed = tierPrincipal[member][planTier];
        Workout storage w = workoutOf[member];
        if (w.state != WORKOUT_PLAN || owed == 0 || amount == 0) revert RevolvingIssuerNothingDue(member);
        uint256 pay = amount < owed ? amount : owed;
        stableCredit.repayCreditBalanceFor(_msgSender(), member, uint128(pay));
        _repayTier(member, planTier, pay);
        // A PLAN ends when it is paid off (decision 32).
        if (pay == owed) {
            w.state = 0;
            emit WorkoutEnded(member, WORKOUT_PLAN);
        }
    }

    /* ---- 12.18: the workout plan's default follows 12.14's timing ---- */

    /// @notice proposes the cure-notice timestamp for the member's workout plan, while a payment on
    /// it is past due. A different signer approves it.
    function proposeWorkoutNotice(address member) external onlyCreditRole(ATTESTER_ROLE) {
        Workout storage w = _requirePlanPastDue(member);
        w.planNoticeProposer = _msgSender();
        emit WorkoutNoticeProposed(member, _msgSender());
    }

    /// @notice the second signer approves: the recorded time is this block's, and only while a
    /// payment is past due. Paying what was due by then cancels it.
    function approveWorkoutNotice(address member) external onlyCreditRole(ATTESTER_ROLE) {
        Workout storage w = _requirePlanPastDue(member);
        address proposer = w.planNoticeProposer;
        if (proposer == address(0)) revert RevolvingIssuerNoProposal(member);
        if (proposer == _msgSender()) revert RevolvingIssuerSameSigner(proposer);
        w.planNoticeProposer = address(0);
        w.planNoticeAt = uint64(block.timestamp);
        w.planNoticeDue = uint128(_planDue(w));
        w.planNoticeClock = _pauseClockOf(member);
        emit WorkoutNoticeRecorded(member, uint64(block.timestamp), w.planNoticeDue);
    }

    /// @notice whether the member's workout plan is in default now (12.18 with 12.14's timing): a
    /// payment at least 60 days past due, a cure-notice timestamp, 30 days since it (longer by any
    /// paused time since: 10c), what was due by the notice still unpaid, and no pause in force.
    /// Computed; fails closed.
    function workoutPlanDefaultable(address member) public view returns (bool) {
        Workout storage w = workoutOf[member];
        if (
            w.state != WORKOUT_PLAN || w.planNoticeAt == 0 || w.planPastDueSince == 0
                || _planPaid(member, w) >= w.planNoticeDue
        ) return false;
        uint256 cureEnd = w.planNoticeAt + 30 days + _pauseClockOf(member) - w.planNoticeClock;
        return block.timestamp >= w.planPastDueSince + 60 days && block.timestamp >= cureEnd && !_pauseInForce(member);
    }

    /// @notice records the workout plan's default once it holds, and reverts otherwise. Anyone may
    /// call it. It writes off the plan's own position and nothing else: the write-off is absorbed by
    /// that position alone, and no default of the line is recorded, so the Liquidator reaches no
    /// Savings or other collateral through it. The ledger ends the line's ceiling with it.
    function declareWorkoutDefault(address member) external {
        if (!workoutPlanDefaultable(member)) revert RevolvingIssuerPlanNotDefaultable(member);
        Workout storage w = workoutOf[member];
        _touch(member);
        uint256 owed = tierPrincipal[member][_workoutTier()];
        w.planWriteOff = true;
        stableCredit.writeOffCreditLine(member, owed);
        w.planWriteOff = false;
        w.planDefaultedAt = uint64(block.timestamp);
        w.state = 0;
        emit WorkoutPlanDefaulted(member, owed);
    }

    function _requirePlanPastDue(address member) private view returns (Workout storage w) {
        w = workoutOf[member];
        if (w.state != WORKOUT_PLAN || w.planPastDueSince == 0 || _planPaid(member, w) >= _planDue(w)) {
            revert RevolvingIssuerNothingDue(member);
        }
    }

    /* ---- views ---- */

    /// @notice a member's unsecured revolving principal, carry excluded: the tiers priced from
    /// RateSchedule, which are the revolving part of their small loan under the CFL (DECISIONS #7).
    function cflPrincipalOf(address member) external view returns (uint256 total) {
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tierProduct[i] != bytes32(0)) total += _principalOnly(member, i);
        }
    }

    /// @notice consecutive missed rebalances, for the Liquidator.
    function missedInRowOf(address member) external view returns (uint8) {
        return cycleOf[member].missedInRow;
    }

    /// @notice what an authorization recorded for a ref still allows.
    function cardAuthorizationOf(bytes32 ref) external view returns (address member, uint256 amount) {
        CardAuthorization memory authorization = cardAuthorizations[ref];
        return (authorization.member, authorization.amount);
    }


    /// @notice the member's workout record (12.18).
    function workoutStateOf(address member) external view returns (Workout memory) {
        return workoutOf[member];
    }

    /// @notice the workout plan's figures: what is due so far, what is paid, and what is owed.
    function workoutPlanOf(address member) external view returns (uint256 due, uint256 paid, uint256 owed) {
        Workout storage w = workoutOf[member];
        due = _planDue(w);
        paid = _planPaid(member, w);
        owed = w.planTotal - paid;
    }

    /// @notice one position's 12.17 figures: the running cycle's principal-seconds and carry, and the
    /// most recently closed cycle's end figures. With `cycleStateOf` (its end, when it was recorded
    /// and whether it needs a statement) and the CycleStatement events, every 12.17 value of a closed
    /// cycle is readable without recomputation.
    function positionStatOf(address member, uint256 tierId) external view returns (PositionStat memory) {
        return positionStat[member][tierId];
    }

    /* ---- moved here from the cycles module (Phase 2g, for room) ---- */

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

    /// @notice the member turns Automatic Clearing on or off, and chooses its level (12.2).
    /// @param authHash the hash of the authorization text the member approved (a copy goes to them);
    /// required to turn it on.
    function setAutoClear(bool on, uint8 level, bytes32 authHash) external {
        _setAutoClear(_msgSender(), on, level, authHash);
    }

    /// @notice the same, from the member's EIP-712 signature: how "Approve automatic clearing" on
    /// the separate screen at line opening turns it on. "Turn off" signs nothing and leaves it off.
    function setAutoClearWithSignature(
        address member,
        bool on,
        uint8 level,
        bytes32 authHash,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _useSignature(
            member,
            keccak256(abi.encode(AUTO_CLEAR_TYPEHASH, member, on, level, authHash, memberNonces[member], deadline)),
            deadline,
            signature
        );
        _setAutoClear(member, on, level, authHash);
    }

    /// @notice the member sets how much card spending may draw against their Savings (12.7).
    function setSavingsDrawAllowance(uint256 amount) external {
        savingsDrawAllowance[_msgSender()] = amount;
        emit SavingsDrawAllowanceSet(_msgSender(), amount);
    }

    /// @notice the same, from the member's EIP-712 signature.
    function setSavingsDrawAllowanceWithSignature(address member, uint256 amount, uint256 deadline, bytes calldata signature)
        external
    {
        _useSignature(
            member,
            keccak256(abi.encode(SAVINGS_DRAW_TYPEHASH, member, amount, memberNonces[member], deadline)),
            deadline,
            signature
        );
        savingsDrawAllowance[member] = amount;
        emit SavingsDrawAllowanceSet(member, amount);
    }

    bytes32 public constant AUTO_CLEAR_TYPEHASH =
        keccak256("AutoClear(address member,bool on,uint8 level,bytes32 authHash,uint256 nonce,uint256 deadline)");
    bytes32 public constant SAVINGS_DRAW_TYPEHASH =
        keccak256("SavingsDrawAllowance(address member,uint256 amount,uint256 nonce,uint256 deadline)");

    function _setAutoClear(address member, bool on, uint8 level, bytes32 authHash) private {
        if (level > LEVEL_DUE_ONLY || (on && authHash == bytes32(0))) revert RevolvingIssuerBadScope(level);
        autoRepayEnabled[member] = on;
        autoClearScopeOf[member] = level;
        if (on) {
            cycleState[member].autoClearAuthHash = authHash;
            emit AutoClearAuthorized(member, level, authHash);
        }
        emit AutoClearSet(member, on, level);
    }
}
