// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./TermIssuerBase.sol";
import "./TermIssuerExtension.sol";
import "./TermIssuerOrigination.sol";
import "../libraries/CarryIndex.sol";
import "../core/interfaces/stable-credit/ICreditPositionSource.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title TermIssuer
/// @notice Term plans: partner credit, Clear Cash, and the ELPA that buys a home.
/// @dev A different rule set from the revolving line, which is why it is a different issuer
/// rather than a fifth tier. All balance drawn in a revolving tier shares a rate and a clock, so
/// a tier carries one index. A term plan has its own rate, its own opening date and its own split
/// schedule, and two plans at different rates cannot share an index -- so a plan carries one.
///
/// It is also exempt from cycle equilibrium. A revolving member is in compliance when they have
/// rebalanced to zero or above; a member on a term plan is in compliance when they are current on
/// the schedule they agreed to. Holding a term balance is the product, not a delinquency.
///
/// A plan is originated as a three-party mint that nets to zero. Nothing is lent at origination
/// and no capital is required: the member is debited, the merchant is credited what they are
/// owed, and the co-op is credited the difference.
contract TermIssuer is TermIssuerBase, ICreditPositionSource {
    using CarryIndex for CarryIndex.Index;

    /* ========== INITIALIZER ========== */

    /// @dev The bare implementation can never be initialized; only the proxy can (audit L-1).
    /// @dev Both modules are deployed on their own and passed in: creating them here put their creation
    /// code inside this one, at 62,992 bytes, over EIP-3860's 48 KiB limit. Each is checked for its
    /// kind and fixed for the life of this implementation.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address extension_, address origination_) {
        _disableInitializers();
        if (
            IExtensionKind(extension_).extensionKind() != keccak256("TermIssuerExtension.v2")
                || IExtensionKind(origination_).extensionKind() != keccak256("TermIssuerOrigination.v1")
        ) revert TermIssuerExtensionMismatch();
        extension = extension_;
        origination = origination_;
    }

    function initialize(address _stableCredit, address _carryTreasury) external initializer {
        if (_carryTreasury == address(0)) revert TermIssuerNoCarryRecipient();
        __CreditIssuer_init(_stableCredit);
        carryTreasury = _carryTreasury;
        emit CarryTreasuryUpdated(_carryTreasury);
    }

    /* ========== VIEWS ========== */

    function planCount() external view returns (uint256) {
        return plans.length;
    }

    /// @notice the plan ids a member holds.
    function plansOf(address member) external view returns (uint256[] memory) {
        return memberPlans[member];
    }

    /// @notice a plan's terms and current state.
    function planAt(uint256 planId)
        external
        view
        returns (
            address member,
            uint256 principal,
            uint256 principalOutstanding,
            uint256 repaid,
            uint64 openedAt,
            uint32 installments,
            uint64 installmentLength,
            uint256 ratePerCycle,
            bool closed
        )
    {
        _requirePlan(planId);
        Plan storage plan = plans[planId];
        return (
            plan.member,
            plan.principal,
            plan.principalOutstanding,
            plan.repaid,
            plan.openedAt,
            plan.installments,
            plan.installmentLength,
            plan.index.ratePerCycle,
            plan.closed
        );
    }

    /// @notice the schedule a plan is on: the figure quoted, and what the term costs in total.
    /// @dev The number the app shows a member. Held rather than derived precisely so that it is
    /// the same number every time they look at it.
    /// @param planId plan to read.
    /// @return installmentAmount what each period asks for.
    /// @return scheduleTotal what the whole schedule collects, carry included.
    /// @return installments periods in the current schedule.
    /// @return scheduleStart when the current schedule began.
    function scheduleOf(uint256 planId)
        external
        view
        returns (
            uint256 installmentAmount,
            uint256 scheduleTotal,
            uint32 installments,
            uint64 scheduleStart
        )
    {
        _requirePlan(planId);
        Plan storage plan = plans[planId];
        return (
            plan.installmentAmount, plan.scheduleTotal, plan.installments, plan.scheduleStart
        );
    }

    /// @notice what a plan owes now, carry included.
    function owedOn(uint256 planId) public view returns (uint256) {
        _requirePlan(planId);
        Plan storage plan = plans[planId];
        if (plan.closed) return 0;
        return plan.principalOutstanding + _pendingPlanCarry(planId);
    }

    /// @notice the carry accrued on a plan since it was last brought current.
    function carryOn(uint256 planId) external view returns (uint256) {
        _requirePlan(planId);
        return _pendingPlanCarry(planId);
    }

    /// @notice carry a plan has accrued but not yet had written onto the ledger.
    function pendingCarryOn(uint256 planId) external view returns (uint256) {
        _requirePlan(planId);
        return _pendingPlanCarry(planId);
    }

    /// @notice a member's term principal, carry excluded, as one part of their small loan under
    /// the CFL (DECISIONS #7). Free plans count: they are principal the member owes all the same.
    function cflPrincipalOf(address member) external view returns (uint256 total) {
        uint256[] memory ids = openPlanIds[member];
        for (uint256 i = 0; i < ids.length; i++) {
            if (plans[ids[i]].closed) continue;
            total += plans[ids[i]].principalOutstanding - carryOutstandingOf[ids[i]];
        }
    }

    /// @notice how a plan is priced: its state and product, merchant subsidy, and whether it is
    /// free.
    function pricingOf(uint256 planId) external view returns (PlanPricing memory) {
        _requirePlan(planId);
        return planPricing[planId];
    }



    /// @notice when a plan fell behind: the due date of its oldest installment not yet covered.
    /// Zero for a plan that is on time.
    /// @dev Anything a re-split carried in (the floor above what was repaid) was due the moment the
    /// schedule began. Past that, installment k is covered once `repaid` reaches what the schedule
    /// asks for after k installments; the first uncovered one is when the plan fell behind.
    function delinquentSince(uint256 planId) public view returns (uint256) {
        if (arrearsOf(planId) == 0) return 0;
        Plan storage plan = plans[planId];
        if (plan.repaid < plan.scheduleFloor) return plan.scheduleStart;
        uint256 n = plan.installments;
        uint256 k = 1;
        while (k < n && plan.repaid >= _dueAt(plan, k)) k++;
        return plan.scheduleStart + k * plan.installmentLength;
    }

    /// @notice when a plan that is behind becomes defaultable. Zero for a plan that is on time.
    function defaultableAt(uint256 planId) public view returns (uint256) {
        uint256 since = delinquentSince(planId);
        if (since == 0) return 0;
        return since + DEFAULT_AFTER_INSTALLMENTS * plans[planId].installmentLength;
    }

    /// @notice the soonest any of a member's plans becomes defaultable. Zero when none is behind.
    function memberDefaultableAt(address member) public view returns (uint256 soonest) {
        uint256[] memory ids = openPlanIds[member];
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 at = defaultableAt(ids[i]);
            if (at != 0 && (soonest == 0 || at < soonest)) soonest = at;
        }
    }

    /// @notice how many re-splits a plan has left, and the earliest the next is allowed.
    function splitAllowance(uint256 planId) external view returns (uint8 remaining, uint256 availableAt) {
        _requirePlan(planId);
        SplitLog storage log = splitLogs[planId];
        remaining = log.changes >= MAX_SPLIT_CHANGES ? 0 : MAX_SPLIT_CHANGES - log.changes;
        availableAt = log.lastChangedAt == 0 ? 0 : log.lastChangedAt + plans[planId].installmentLength;
    }


    /// @notice a member's total owed across every open plan, carry included.
    function totalOwedOf(address member) public view returns (uint256 total) {
        uint256[] memory ids = openPlanIds[member];
        for (uint256 i = 0; i < ids.length; i++) {
            if (!plans[ids[i]].closed) total += owedOn(ids[i]);
        }
    }


    /// @notice The kind term debt is reported under.
    /// @dev A single bucket, and an unsecured one. A term plan amortizes on a schedule against a
    /// signed ledger balance with nothing pledged behind it, so the pool would cover all of it --
    /// and ExposureMath treats a kind it does not recognise as unsecured, which is the same
    /// answer arrived at from the other direction.
    bytes32 public constant TERM_KIND = "TERM";

    /// @inheritdoc ICreditPositionSource
    function debtByKind(address member)
        external
        view
        override
        returns (bytes32[] memory kinds, uint256[] memory amounts)
    {
        uint256 principal = totalPrincipalOf(member);
        if (principal == 0) return (new bytes32[](0), new uint256[](0));
        kinds = new bytes32[](1);
        amounts = new uint256[](1);
        kinds[0] = TERM_KIND;
        amounts[0] = principal;
    }

    /// @inheritdoc ICreditIssuer
    /// @dev The whole term limit is locked. It is drawn by `openPlan`, which always records a
    /// schedule; a plain transfer drawing it instead left debt no schedule described and no
    /// default could reach (audit C-1).
    function lockedAllocationOf(address member)
        external
        view
        override
        returns (uint256 allocation, uint256 drawn)
    {
        return (termLimitOf[member], totalPrincipalOf(member));
    }

    /// @notice refuses a draw on this line that pays anyone but an active merchant or a named
    /// system address, then applies the period rules.
    function _validateCreditTransaction(address sender, address recipient, uint256 amount)
        internal
        override
        returns (bool)
    {
        if (!_drawRecipientAllowed(sender, recipient, amount)) return false;
        return super._validateCreditTransaction(sender, recipient, amount);
    }

    /// @notice a term line is governed by its plans' schedules, not by a period.
    /// @dev The term limit is locked to `openPlan`, so no transfer ever draws it, and a plan's
    /// default comes from its schedule (`declareDefault`).
    function _requiresPeriod(address) internal pure override returns (bool) {
        return false;
    }

    /// @notice whether a member is current on every plan they hold.
    /// @dev Overrides cycle equilibrium. The base rule is that a member has rebalanced to zero or
    /// above; here a member carrying a term balance on schedule is doing exactly what the product
    /// asks of them, and only falling behind the schedule is a delinquency.
    function inCompliance(address member) public view override returns (bool) {
        return totalArrearsOf(member) == 0;
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /// @notice sets a member's ceiling for term plans.
    /// @dev Underwritten off-chain against attested income and entered here as an attestation,
    /// not as raw data. Separate from the revolving tiers, which are backed by pledged collateral.
    function setTermLimit(address member, uint256 limit)
        external
        onlyCreditRole(CREDIT_LIMITS_ROLE)
        notNull(member)
    {
        // A default is not undone by writing a new number over it; reinstatement is its own step.
        if (termSuspended[member] && limit > 0) revert TermIssuerSuspended(member);
        uint256 previous = termLimitOf[member];
        if (limit > previous) _consumeDailyCap(limitIncreaseCap, "TERM_LIMIT", limit - previous);
        termLimitOf[member] = limit;
        emit TermLimitUpdated(member, limit);
        // The first allocation is what enrols the member with this issuer; after that the
        // allocation is adjusted in place. A member may hold a revolving line as well, and this
        // sets only this issuer's contribution to their ceiling.
        if (stableCredit.networkRegistry().isEnrolled(member, address(this))) {
            stableCredit.updateCreditLimit(member, limit);
        } else {
            stableCredit.createCreditLine(member, limit, 0);
        }
    }



    /// @notice where the co-op's share of a purchase is minted.
    /// @dev Name this before moving `carryTreasury`, never after: between the two the fee would be
    /// minted wherever carry had gone.
    function setFeeRecipient(address recipient) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        if (recipient == address(0)) revert TermIssuerNoCarryRecipient();
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }


    /// @notice moves the co-op treasury.
    function setCarryTreasury(address treasury) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        if (treasury == address(0)) revert TermIssuerNoCarryRecipient();
        carryTreasury = treasury;
        emit CarryTreasuryUpdated(treasury);
    }

    /// @notice opens a term plan against a partner purchase, on terms the member signed.
    /// @dev Runs in TermIssuerOrigination (see `origination`).
    function openPlan(PlanTerms calldata, bytes calldata) external returns (uint256) {
        _forwardTo(origination);
    }

    /// @notice the digest a member signs for these terms, at their current nonce.
    function planTermsDigest(PlanTerms calldata terms) external view returns (bytes32) {
        return _planTermsDigest(terms);
    }

    /// @notice names the RateSchedule plans are priced from.
    function setRateSchedule(address rateSchedule_) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        rateSchedule = RateSchedule(rateSchedule_);
    }

    /// @notice caps on new term credit per day, across every member.
    /// @param limitCap most that term limits may be raised by in a day.
    /// @param planCap most that new plans may total in a day.
    function setDailyCaps(uint256 limitCap, uint256 planCap)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
    {
        limitIncreaseCap.cap = limitCap;
        planTotalCap.cap = planCap;
        emit DailyCapUpdated("TERM_LIMIT", limitCap);
        emit DailyCapUpdated("PLANS", planCap);
    }


    /// @notice brings a plan's accrued carry onto the ledger.
    function materialiseCarry(uint256 planId) public {
        _requirePlan(planId);
        _materialiseCarry(planId);
    }

    /// @notice pays down a plan.
    /// @dev Directed at a plan rather than at a balance. A term plan amortizes on a schedule, so
    /// a payment has to say which schedule it is servicing -- an undirected credit transfer
    /// reduces the revolving line instead, which is the demand obligation.
    /// @param planId plan to pay.
    /// @param amount amount to pay, capped at what is owed.
    function payPlan(uint256 planId, uint256 amount) external {
        _requirePlan(planId);
        Plan storage plan = plans[planId];
        if (plan.closed) revert TermIssuerPlanClosed(planId);

        _materialiseCarry(planId);

        uint256 owed = plan.principalOutstanding;
        if (owed == 0) revert TermIssuerNothingToPay(planId);
        uint256 pay = amount < owed ? amount : owed;

        // The payer settles the member's obligation on the ledger; the plan records it here, so
        // the ledger does not also announce it to the revolving line as an undirected payment.
        // The payer approves StableCredit for the reserve token, not this contract.
        stableCredit.repayCreditBalanceFor(msg.sender, plan.member, uint128(pay));
        _applyPlanPayment(planId, pay);
    }



    /// @notice what a mandated collection ref took, zero if unused.
    function mandateCollectionOf(bytes32 ref) external view returns (uint256) {
        return mandateCollections[ref];
    }

    /// @notice ends a member's term credit when a plan is too far behind.
    /// @dev Anyone may call it; the schedule decides, not the caller. A plan defaults once its
    /// oldest missed installment is DEFAULT_AFTER_INSTALLMENTS installments overdue. What is
    /// written off is this issuer's plans and nothing else: the member keeps their card, their
    /// savings and their membership. Nothing is seized -- term plans are underwritten on income,
    /// not on pledged savings -- and the loss is the network's lost debt, which the assurance
    /// reserve covers.
    function declareDefault(address member) external notNull(member) returns (uint256 writtenOff) {
        uint256 at = memberDefaultableAt(member);
        if (at == 0 || block.timestamp < at) revert TermIssuerNotDefaultable(member);

        uint256[] memory ids = openPlanIds[member];
        for (uint256 i = 0; i < ids.length; i++) {
            _materialiseCarry(ids[i]);
        }
        writtenOff = totalPrincipalOf(member);
        defaultedAt[member] = uint64(block.timestamp);
        stableCredit.writeOffCreditLine(member, writtenOff);
        writtenOffOf[member] += writtenOff;
        _onDefault(member);
        emit TermDefaulted(member, writtenOff);
    }



    /// @notice names the revolving line whose mandate and settlers a mandated collection honours.
    function setMandateSource(address source) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        mandateSource = source;
        emit MandateSourceUpdated(source);
    }


    /* ========== INTERNAL ========== */



    /// @notice takes what these plans can of an undirected repayment.
    /// @dev A payment directed at a plan never reaches here -- `payPlan` records it itself and
    /// the ledger stays quiet, so nothing is counted twice. This is the other case: credit
    /// arriving at a member with no plan named. The ledger burns their balance either way, so
    /// the plans have to take their share or they go on claiming principal the ledger says is
    /// settled.
    ///
    /// Oldest plan first, which is also most-overdue first on any schedule that has been running
    /// longer.
    function _absorbRepayment(address member, uint256 available, uint256 minRate)
        internal
        override
        returns (uint256 absorbed)
    {
        if (available == 0) return 0;
        uint256[] memory ids = openPlanIds[member];
        uint256 remaining = available;

        for (uint256 i = 0; i < ids.length && remaining > 0; i++) {
            uint256 planId = ids[i];
            Plan storage plan = plans[planId];
            if (plan.closed || plan.principalOutstanding == 0) continue;
            if (plan.index.ratePerCycle < minRate) continue;

            _materialiseCarry(planId);
            uint256 owed = plan.principalOutstanding;
            uint256 pay = owed < remaining ? owed : remaining;

            plan.principalOutstanding = owed - pay;
            plan.repaid += pay;
            uint256 principalPortion = pay - _clearCarry(planId, pay);

            remaining -= pay;
            absorbed += pay;
            emit PlanPaid(planId, pay, principalPortion);
            if (plan.principalOutstanding == 0) {
                plan.closed = true;
                _untrackOpen(planId);
                emit PlanClosed(planId);
            }
        }
    }

    /// @inheritdoc ICreditIssuer
    function nextRepaymentRate(address member)
        external
        view
        override
        returns (uint256 rate, bool hasPosition)
    {
        uint256[] memory ids = openPlanIds[member];
        for (uint256 i = 0; i < ids.length; i++) {
            Plan storage plan = plans[ids[i]];
            if (plan.closed || plan.principalOutstanding == 0) continue;
            // Plans are not ordered by rate, so every open one has to be considered.
            if (!hasPosition || plan.index.ratePerCycle > rate) {
                rate = plan.index.ratePerCycle;
                hasPosition = true;
            }
        }
    }

    /// @notice this issuer's share of a member's debt.
    /// @dev Only what sits in its plans. A member who also holds a revolving balance has debt this
    /// issuer does not own and must not write off.
    function _writeOffAmount(address member) internal view override returns (uint256) {
        return totalPrincipalOf(member);
    }

    /// @notice clears the member's plans on default, and suspends their term credit.
    /// @dev Narrowed to this issuer, as the base contract asks of an issuer that shares a member:
    /// no revoking membership. A missed plan ends term credit; it does not take away the card, the
    /// savings, or the co-op.
    function _onDefault(address member) internal override {
        uint256[] memory ids = openPlanIds[member];
        for (uint256 i = 0; i < ids.length; i++) {
            Plan storage plan = plans[ids[i]];
            if (plan.closed) continue;
            plan.principalOutstanding = 0;
            carryOutstandingOf[ids[i]] = 0;
            plan.closed = true;
            _untrackOpen(ids[i]);
            emit PlanClosed(ids[i]);
        }
        termLimitOf[member] = 0;
        termSuspended[member] = true;
    }



    /// @notice the ids of a member's plans that are still open.
    function openPlansOf(address member) external view returns (uint256[] memory) {
        return openPlanIds[member];
    }

    /// @notice rebuilds a member's open-plan index from their plan history.
    /// @dev For a proxy upgraded from before the index existed: its open plans were never added.
    /// Permissionless, because it only records which of the member's plans are open, which is a
    /// fact anyone can read. Bounded by the member's own history.
    function indexOpenPlans(address member) external {
        uint256[] storage all = memberPlans[member];
        for (uint256 i = 0; i < all.length; i++) {
            uint256 planId = all[i];
            if (!plans[planId].closed && openPlanSlot[planId] == 0) _trackOpen(member, planId);
        }
    }

    /* ========== FORWARDED TO THE EXTENSION ========== */

    /// @notice Where the forwarded functions below actually run.
    /// @dev Created by this implementation's constructor and fixed with it: upgrading TermIssuer
    /// deploys a fresh pair, and nobody can point a live issuer at other code. Not storage, so the
    /// layout is untouched.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable extension;

    /// @notice Where `openPlan` runs. Created and pinned like `extension`.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable origination;

    /// @notice see TermIssuerExtension.closePlanForRefund.
    function closePlanForRefund(uint256, uint256, address, uint256) external returns (uint256) {
        _forward();
    }

    /// @notice see TermIssuerExtension.setSplit.
    function setSplit(uint256, uint32) external {
        _forward();
    }

    /// @notice see TermIssuerExtension.resplitWithSignature.
    function resplitWithSignature(uint256, uint32, uint256, uint256, bytes calldata) external {
        _forward();
    }

    /// @notice see TermIssuerExtension.collectForMember.
    function collectForMember(bytes32, address, uint256) external returns (uint256) {
        _forward();
    }

    /// @notice see TermIssuerExtension.repayWrittenOff.
    function repayWrittenOff(address, uint256) external returns (uint256) {
        _forward();
    }

    /// @notice see TermIssuerExtension.reinstate.
    function reinstate(address) external {
        _forward();
    }

    /// @notice see TermIssuerExtension.payResidualCarry.
    function payResidualCarry(address, uint256) external {
        _forward();
    }

    /// @dev Runs the extension's implementation of this call against this contract's storage, and
    /// returns or reverts exactly as it did.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _forward() private {
        _forwardTo(extension);
    }

    /// @dev `_forward`, to a named target.
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
