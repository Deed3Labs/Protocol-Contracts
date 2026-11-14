// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./RevolvingIssuerBase.sol";

/// @title RevolvingIssuerTerms
/// @notice RevolvingIssuer's Addendum 2 code: the member's Cycle End Day, the two-person cure-notice
/// timestamp (12.5) and Income Assurance (12.13), hybridMode and payer exclusions (12.2), the
/// governed due terms, and the views over them.
/// @dev Runs only by delegatecall from RevolvingIssuer, against its storage, like the other modules.
/// Nothing here writes a cycle end, a due amount, a pause or a default: the member's own signature
/// moves their Cycle End Day (never a due point earlier), and the attestations can only delay or
/// prevent default.
contract RevolvingIssuerTerms is RevolvingIssuerBase {
    /// @notice what RevolvingIssuer's constructor checks before pinning this module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("RevolvingIssuerTerms.v1");
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    bytes32 public constant CYCLE_END_DAY_TYPEHASH =
        keccak256("CycleEndDay(address member,uint8 day,uint256 nonce,uint256 deadline)");
    bytes32 public constant PAYER_EXCLUSION_TYPEHASH =
        keccak256("PayerExclusion(address member,bytes32 payer,bool excluded,uint256 nonce,uint256 deadline)");

    /* ---- 12.1: the member's Cycle End Day ---- */

    /// @notice the member moves their Cycle End Day (1-28), by signature, at most once per rolling
    /// 365 days. The running cycle then ends on the first new Cycle End Day on or after its existing
    /// end, so no due point ever moves earlier.
    function setCycleEndDayWithSignature(address member, uint8 day, uint256 deadline, bytes calldata signature)
        external
    {
        if (day == 0 || day > 28) revert RevolvingIssuerBadCycleDay(day);
        CycleState storage s = cycleState[member];
        if (s.dayChangedAt != 0 && block.timestamp < uint256(s.dayChangedAt) + 365 days) {
            revert RevolvingIssuerCycleDayChangedRecently(uint256(s.dayChangedAt) + 365 days);
        }
        _useSignature(
            member,
            keccak256(abi.encode(CYCLE_END_DAY_TYPEHASH, member, day, memberNonces[member], deadline)),
            deadline,
            signature
        );
        s.cycleEndDay = day;
        s.dayChangedAt = uint64(block.timestamp);
        uint64 previous = s.cycleEnd;
        if (previous != 0) {
            uint64 next = uint64(PacificCalendar.endOnOrAfter(previous, day));
            s.cycleEnd = next;
            CreditPeriod storage period = creditPeriods[member];
            if (period.expiration == previous) period.expiration = next;
        }
        emit CycleEndDaySet(member, day, s.cycleEnd);
    }

    /* ---- 12.5: the cure-notice timestamp (two people) ---- */

    /// @notice proposes recording the cure notice for the member's unpaid second consecutive
    /// Rebalance Amount. A different signer approves it; nothing is recorded until then.
    function proposeCureNotice(address member) external onlyCreditRole(ATTESTER_ROLE) {
        CycleState storage s = cycleState[member];
        if (s.cureAmount == 0 || cycleOf[member].cureNoticeAt != 0) revert RevolvingIssuerNothingDue(member);
        s.noticeProposer = _msgSender();
        emit CureNoticeProposed(member, _msgSender());
    }

    /// @notice approves the proposal: the recorded time is this block's, never earlier, and only
    /// while the amount is unpaid (paying it cancels the proposal and the timestamp).
    function approveCureNotice(address member) external onlyCreditRole(ATTESTER_ROLE) {
        CycleState storage s = cycleState[member];
        address proposer = s.noticeProposer;
        if (proposer == address(0) || s.cureAmount == 0) revert RevolvingIssuerNoProposal(member);
        if (proposer == _msgSender()) revert RevolvingIssuerSameSigner(proposer);
        s.noticeProposer = address(0);
        uint64 at = uint64(block.timestamp);
        cycleOf[member].cureNoticeAt = at;
        uint256 graceEnd = s.cureDueAt + creditTerms.cureWindow;
        uint256 noticeEnd = at + NOTICE_GRACE;
        emit CureNoticeRecorded(member, at, uint64(graceEnd > noticeEnd ? graceEnd : noticeEnd));
    }

    /* ---- 12.13: Income Assurance (two people) ---- */

    /// @notice proposes a hardship forbearance Clear Lending granted at the member's request on
    /// documented income loss: `cycles` cycle ends of Income Assurance.
    function proposeIncomePause(address member, uint8 cycles) external onlyCreditRole(ATTESTER_ROLE) {
        uint8 max = dueTerms.incomePauseMaxCycles;
        if (cycles == 0 || cycles > max) revert RevolvingIssuerPauseTooLong(cycles, max);
        CycleState storage s = cycleState[member];
        s.pauseProposer = _msgSender();
        s.pauseCycles = cycles;
        emit IncomePauseProposed(member, cycles, _msgSender());
    }

    /// @notice a second signer approves the same proposal. It can only lengthen a pause already
    /// running: only expiry or the member ends one early.
    function approveIncomePause(address member, uint8 cycles) external onlyCreditRole(ATTESTER_ROLE) {
        CycleState storage s = cycleState[member];
        address proposer = s.pauseProposer;
        if (proposer == address(0) || s.pauseCycles != cycles) revert RevolvingIssuerNoProposal(member);
        if (proposer == _msgSender()) revert RevolvingIssuerSameSigner(proposer);
        s.pauseProposer = address(0);
        s.pauseCycles = 0;
        if (cycles > s.incomePause) s.incomePause = cycles;
        emit IncomePauseSet(member, s.incomePause);
    }

    /// @notice the member ends their own Income Assurance early.
    function endIncomePause() external {
        cycleState[_msgSender()].incomePause = 0;
        emit IncomePauseSet(_msgSender(), 0);
    }

    /* ---- 12.2: the member's own switches ---- */

    /// @notice the member turns hybridMode on or off: it stops Automatic Clearing (and, off chain,
    /// limits Autopay to the Payment Due Date). It never changes a cycle.
    function setHybridMode(bool on) external {
        cycleState[_msgSender()].hybridMode = on;
        emit HybridModeSet(_msgSender(), on);
    }

    /// @notice the member excludes a payer from Automatic Clearing, or removes an exclusion (a
    /// federal benefit payer is excluded by default), by signature.
    function setPayerExclusionWithSignature(
        address member,
        bytes32 payer,
        bool excluded,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _useSignature(
            member,
            keccak256(abi.encode(PAYER_EXCLUSION_TYPEHASH, member, payer, excluded, memberNonces[member], deadline)),
            deadline,
            signature
        );
        payerChoice[member][payer] = excluded ? 1 : 2;
        emit PayerExclusionSet(member, payer, excluded);
    }

    /* ---- governance ---- */

    /// @notice adds a federal benefit payer (a hashed ACH originator id) to the default exclusions.
    /// @dev Add only: removing one would sweep deposits members never agreed to have swept.
    function addDefaultExcludedPayer(bytes32 payer) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        defaultExcludedPayer[payer] = true;
        emit DefaultExcludedPayerAdded(payer);
    }

    /// @notice sets the governed due terms.
    /// @param securedMinimumBps of secured principal (12.1). A raise binds only cycles that close 45
    /// days or more after this call; a cut binds from now.
    /// @param floor the least Secured Minimum ($1), or the secured principal if less.
    /// @param cardMemberDailyCap card settlements per member per day (4c item 1); zero is unset.
    /// @param incomePauseMaxCycles the longest Income Assurance one attestation may grant (12.13).
    function setDueTerms(uint16 securedMinimumBps, uint64 floor, uint64 cardMemberDailyCap, uint8 incomePauseMaxCycles)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        if (securedMinimumBps > BPS_) revert RevolvingIssuerBadScope(0);
        DueTerms storage t = dueTerms;
        // A raise already binding becomes the current rate before anything else changes.
        if (t.raisedFrom != 0 && block.timestamp >= t.raisedFrom) {
            t.securedMinimumBps = t.raisedBps;
            t.raisedFrom = 0;
        }
        if (securedMinimumBps > t.securedMinimumBps) {
            t.raisedBps = securedMinimumBps;
            t.raisedFrom = uint64(block.timestamp + 45 days);
        } else {
            t.securedMinimumBps = securedMinimumBps;
            t.raisedBps = 0;
            t.raisedFrom = 0;
        }
        t.securedMinimumFloor = floor;
        t.cardMemberDailyCap = cardMemberDailyCap;
        t.incomePauseMaxCycles = incomePauseMaxCycles;
        emit DueTermsUpdated(securedMinimumBps, t.raisedFrom, floor, cardMemberDailyCap, incomePauseMaxCycles);
    }

    /// @notice names the term issuer whose plans share the member's Combined Ceiling (12.3). Set
    /// once: the ceiling is permanent, and no function can switch it off.
    function setTermIssuer(address termIssuer) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        if (termIssuer == address(0) || dueTerms.termIssuer != address(0)) revert RevolvingIssuerTermIssuerSet();
        dueTerms.termIssuer = termIssuer;
        emit TermIssuerSet(termIssuer);
    }

    /* ---- views (reached through RevolvingIssuer's static forwarder) ---- */

    function cycleStateOf(address member) external view returns (CycleState memory) {
        return cycleState[member];
    }

    function dueTermsOf() external view returns (DueTerms memory) {
        return dueTerms;
    }

    /// @notice what is due now: the unpaid Rebalance Amount, the unpaid Secured Minimum, and whether
    /// new secured draws are paused.
    function duesOf(address member) external view returns (uint256 rebalance, uint256 securedMinimum, bool paused) {
        (uint256 dueU, uint256 dueT) = _dues(member);
        return (dueU, dueT - dueU, _securedDrawPaused(member));
    }

    function isPayerExcluded(address member, bytes32 payer) external view returns (bool) {
        return _payerExcluded(member, payer);
    }

    /// @notice the revolving side of the Combined Ceiling (12.3), for the term issuer: the state and
    /// ceiling product it is priced under, the unsecured revolving principal, and what that principal
    /// costs a month after the caps (principal x monthly bps x 1e18, summed).
    function combinedInputsOf(address member)
        external
        view
        returns (bytes32 state, bytes32 product, uint256 principal, uint256 monthlyCarry)
    {
        state = _pricingState(member);
        product = ceilingProduct;
        uint256[] memory rates = _effectiveRates(member);
        for (uint256 i = 0; i < tiers.length; i++) {
            if (!_isUnsecured(i)) continue;
            uint256 p = _principalOnly(member, i);
            principal += p;
            monthlyCarry += p * rates[i];
        }
    }

    /* ---- settings moved here from RevolvingIssuer in Phase 2e, for room ---- */

    /// @notice opens or closes a tier to new draws.
    /// @dev Closing does not call in what is drawn. Existing positions keep accruing and can be
    /// repaid; they simply cannot grow.
    function setTierActive(uint256 tierId, bool active) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        _requireTier(tierId);
        tiers[tierId].active = active;
    }

    /// @notice moves the co-op treasury, and with it the fallback for every tier that has not
    /// named someone else.
    /// @dev Cannot be cleared. There is no state in which carry has nowhere to go.
    function setCarryTreasury(address treasury) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        if (treasury == address(0)) revert RevolvingIssuerNoCarryRecipient();
        carryTreasury = treasury;
        emit CarryTreasuryUpdated(treasury);
    }

    /// @notice sets who is owed carry accrued in one tier.
    /// @dev Pass address(0) to return the tier to the treasury. That is how a funding source is
    /// retired: carry keeps accruing and keeps landing somewhere, and where it landed in the
    /// meantime can be settled by hand.
    function setTierCarryRecipient(uint256 tierId, address recipient) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        _requireTier(tierId);
        tierCarryRecipient[tierId] = recipient;
        emit CarryRecipientUpdated(tierId, recipient);
    }

    /// @notice sets a member's ceiling contribution in a tier.
    /// @dev The operator sets this today. In the finished shape LimitCalculator does, by valuing
    /// what the member has pledged and applying the haircut for that collateral type.
    /// @param member address of the member.
    /// @param tierId index of the tier.
    /// @param capacity new ceiling contribution.
    function setTierCapacity(address member, uint256 tierId, uint256 capacity)
        external
        onlyCreditRole(CREDIT_LIMITS_ROLE)
    {
        _requireTier(tierId);
        _touch(member);
        uint256 drawn = tierPrincipal[member][tierId];
        if (capacity < drawn) {
            revert RevolvingIssuerCapacityBelowDrawn(tierId, capacity, drawn);
        }
        uint256 previous = tierCapacity[member][tierId];
        if (capacity > previous) {
            _consumeDailyCap(capacityIncreaseCap, "CAPACITY", capacity - previous);
        }
        tierCapacity[member][tierId] = capacity;
        _checkCreditCaps(member);
        emit TierCapacityUpdated(member, tierId, capacity);
        uint256 total;
        for (uint256 i = 0; i < tiers.length; i++) total += tierCapacity[member][i];
        stableCredit.updateCreditLimit(member, total);
    }

    /// @notice allows or revokes a key that records card purchases as settled.
    function setCardSettler(address settler, bool allowed) external onlyCreditRole(CREDIT_SETTINGS_ROLE) notNull(settler) {
        isCardSettler[settler] = allowed;
        emit CardSettlerUpdated(settler, allowed);
    }

    /// @notice sets the account a settled card purchase's claim is minted to.
    function setCardSettlementAccount(address account) external onlyCreditRole(CREDIT_SETTINGS_ROLE) notNull(account) {
        cardSettlementAccount = account;
        emit CardSettlementAccountUpdated(account);
    }

    /// @notice caps on card settlement: per purchase and per day, across every member.
    function setCardCaps(uint256 txCap, uint256 dailyCap)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        cardTxCap = txCap;
        cardSpendCap.cap = dailyCap;
        emit CardCapsUpdated(txCap, dailyCap);
    }

    /// @notice names the RateSchedule unsecured tiers are priced from, and the product whose
    /// graduated schedule is the member-level ceiling.
    function setPricing(address rateSchedule_, bytes32 ceilingProduct_)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        // Each is set once (Phase 4, M-B): members hold snapshots of this schedule's accumulators
        // and of the ceiling product's bands, and another schedule's or product's would not compare.
        // The schedule upgrades in place behind the credit timelock instead.
        if (
            (address(rateSchedule) != address(0) && address(rateSchedule) != rateSchedule_)
                || (ceilingProduct != bytes32(0) && ceilingProduct != ceilingProduct_)
        ) revert RevolvingIssuerPricingSet();
        rateSchedule = RateSchedule(rateSchedule_);
        ceilingProduct = ceilingProduct_;
        emit PricingUpdated(rateSchedule_, ceilingProduct_);
    }

    /// @notice prices an unsecured tier as a RateSchedule product. Set once: positions snapshot the
    /// product's accumulator, and switching product under them would compare unrelated numbers.
    function setTierProduct(uint256 tierId, bytes32 productId)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        _requireTier(tierId);
        if (tierProduct[tierId] != bytes32(0)) revert RevolvingIssuerTierProductSet(tierId);
        tierProduct[tierId] = productId;
        emit TierProductSet(tierId, productId);
    }

    /// @notice caps how much new revolving capacity may be granted in a day, across every member.
    function setDailyCapacityCap(uint256 cap) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        capacityIncreaseCap.cap = cap;
        emit DailyCapUpdated("CAPACITY", cap);
    }

    /// @notice the member turns automatic repayment from their USDC deposits on or off.
    /// @dev Only for the caller. Turning it on is the whole mandate; the member also approves the
    /// ledger to take their USDC, and revoking either stops it.
    function setAutoRepay(bool enabled) external {
        autoRepayEnabled[_msgSender()] = enabled;
        emit AutoRepaySet(_msgSender(), enabled);
    }

    /// @notice sets the contract reporting what a member's collateral does not cover.
    function setExposureSource(address _exposureSource) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        exposureSource = IExposureSource(_exposureSource);
    }
}
