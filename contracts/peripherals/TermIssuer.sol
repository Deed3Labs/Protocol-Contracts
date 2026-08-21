// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./CreditIssuer.sol";
import "../libraries/CarryIndex.sol";

/// @title TermIssuer
/// @notice Term plans: partner credit, Clear Cash, ground lease, ELPA.
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
contract TermIssuer is CreditIssuer {
    using CarryIndex for CarryIndex.Index;

    /* ========== STATE VARIABLES ========== */

    struct Plan {
        address member;
        /// @dev Principal at origination. The schedule amortizes this, not the carry above it.
        uint256 principal;
        /// @dev Index-relative amount outstanding.
        uint256 normalized;
        /// @dev Principal still owed.
        uint256 principalOutstanding;
        /// @dev Total repaid against the plan, carry included.
        uint256 repaid;
        uint64 openedAt;
        uint64 installmentLength;
        uint32 installments;
        bool closed;
        CarryIndex.Index index;
    }

    Plan[] private plans;
    /// @dev member => plan ids
    mapping(address => uint256[]) private memberPlans;

    /// @notice The co-op treasury, and the fallback for carry with no other home.
    address public carryTreasury;

    /// @notice A member's ceiling for term plans, set from attested income.
    /// @dev Its own limit, separate from the revolving tiers. Term plans are underwritten against
    /// what a member earns rather than against what they have pledged.
    mapping(address => uint256) public termLimitOf;

    uint256[42] private __gap;

    /* ========== ERRORS ========== */

    error TermIssuerNoCarryRecipient();
    error TermIssuerUnknownPlan(uint256 planId);
    error TermIssuerPlanClosed(uint256 planId);
    error TermIssuerInvalidSchedule();
    error TermIssuerExceedsTermLimit(address member, uint256 requested, uint256 limit);
    error TermIssuerNothingToPay(uint256 planId);

    /* ========== EVENTS ========== */

    event TermLimitUpdated(address indexed member, uint256 limit);
    event CarryTreasuryUpdated(address treasury);
    event PlanOpened(
        uint256 indexed planId,
        address indexed member,
        uint256 principal,
        uint256 ratePerCycle,
        uint32 installments
    );
    event PlanPaid(uint256 indexed planId, uint256 amount, uint256 principalPortion);
    event PlanClosed(uint256 indexed planId);
    event PlanCarryMaterialised(uint256 indexed planId, uint256 amount);

    /* ========== INITIALIZER ========== */

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

    /// @notice what a plan owes now, carry included.
    function owedOn(uint256 planId) public view returns (uint256) {
        _requirePlan(planId);
        Plan storage plan = plans[planId];
        return CarryIndex.denormalize(plan.normalized, plan.index.currentIndex(block.timestamp));
    }

    /// @notice the carry accrued on a plan since it was last brought current.
    function carryOn(uint256 planId) external view returns (uint256) {
        Plan storage plan = plans[planId];
        uint256 owed = owedOn(planId);
        return owed > plan.principalOutstanding ? owed - plan.principalOutstanding : 0;
    }

    /// @notice how many installments have come due by now.
    /// @dev The schedule is what the member agreed to, so it runs on wall-clock time rather than
    /// on what has been paid. Falling behind does not slow it down.
    function installmentsDue(uint256 planId) public view returns (uint256) {
        _requirePlan(planId);
        Plan storage plan = plans[planId];
        if (block.timestamp <= plan.openedAt) return 0;
        uint256 elapsed = block.timestamp - plan.openedAt;
        uint256 due = elapsed / plan.installmentLength;
        return due > plan.installments ? plan.installments : due;
    }

    /// @notice the principal the schedule says should have been repaid by now.
    /// @dev Amortized in equal parts, with the remainder falling in the last installment so the
    /// schedule sums to the principal exactly.
    function scheduledPrincipalDue(uint256 planId) public view returns (uint256) {
        Plan storage plan = plans[planId];
        uint256 due = installmentsDue(planId);
        if (due >= plan.installments) return plan.principal;
        return (plan.principal * due) / plan.installments;
    }

    /// @notice how far behind the schedule a plan is, in principal.
    function arrearsOf(uint256 planId) public view returns (uint256) {
        Plan storage plan = plans[planId];
        if (plan.closed) return 0;
        uint256 shouldHaveRepaid = scheduledPrincipalDue(planId);
        uint256 hasRepaid = plan.principal - plan.principalOutstanding;
        return shouldHaveRepaid > hasRepaid ? shouldHaveRepaid - hasRepaid : 0;
    }

    /// @notice a member's total arrears across every plan they hold.
    function totalArrearsOf(address member) public view returns (uint256 total) {
        uint256[] storage ids = memberPlans[member];
        for (uint256 i = 0; i < ids.length; i++) {
            total += arrearsOf(ids[i]);
        }
    }

    /// @notice a member's total owed across every open plan, carry included.
    function totalOwedOf(address member) public view returns (uint256 total) {
        uint256[] storage ids = memberPlans[member];
        for (uint256 i = 0; i < ids.length; i++) {
            if (!plans[ids[i]].closed) total += owedOn(ids[i]);
        }
    }

    /// @notice a member's outstanding principal across every open plan.
    function totalPrincipalOf(address member) public view returns (uint256 total) {
        uint256[] storage ids = memberPlans[member];
        for (uint256 i = 0; i < ids.length; i++) {
            total += plans[ids[i]].principalOutstanding;
        }
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
    function setTermLimit(address member, uint256 limit) external onlyOperator notNull(member) {
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

    /// @notice moves the co-op treasury.
    function setCarryTreasury(address treasury) external onlyOperator {
        if (treasury == address(0)) revert TermIssuerNoCarryRecipient();
        carryTreasury = treasury;
        emit CarryTreasuryUpdated(treasury);
    }

    /// @notice opens a term plan against a partner purchase.
    /// @dev The purchase is a three-party mint that nets to zero: the member is debited, the
    /// merchant is credited the payout, and the co-op is credited the discount. StableCredit
    /// asserts the netting.
    /// @param member address taking on the plan.
    /// @param merchant address receiving the payout.
    /// @param purchase amount the member is debited.
    /// @param payout amount the merchant is credited.
    /// @param ratePerCycle carry rate per cycle, in basis points.
    /// @param cycleLength seconds in a cycle.
    /// @param installments number of scheduled installments.
    /// @param installmentLength seconds between installments.
    /// @return planId the new plan's id.
    function openPlan(
        address member,
        address merchant,
        uint256 purchase,
        uint256 payout,
        uint256 ratePerCycle,
        uint64 cycleLength,
        uint32 installments,
        uint64 installmentLength
    ) external onlyOperator notNull(member) returns (uint256 planId) {
        if (installments == 0 || installmentLength == 0 || purchase == 0) {
            revert TermIssuerInvalidSchedule();
        }
        if (payout > purchase) revert TermIssuerInvalidSchedule();

        uint256 wouldOwe = totalPrincipalOf(member) + purchase;
        if (wouldOwe > termLimitOf[member]) {
            revert TermIssuerExceedsTermLimit(member, wouldOwe, termLimitOf[member]);
        }

        planId = plans.length;
        plans.push();
        Plan storage plan = plans[planId];
        plan.member = member;
        plan.principal = purchase;
        plan.principalOutstanding = purchase;
        plan.openedAt = uint64(block.timestamp);
        plan.installments = installments;
        plan.installmentLength = installmentLength;
        plan.index.init(ratePerCycle, cycleLength, uint64(block.timestamp));
        plan.normalized = CarryIndex.normalizeUp(purchase, CarryIndex.RAY);
        memberPlans[member].push(planId);

        stableCredit.originatePurchase(
            member, purchase, merchant, payout, carryTreasury, purchase - payout
        );
        emit PlanOpened(planId, member, purchase, ratePerCycle, installments);
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

        uint256 index = plan.index.currentIndex(block.timestamp);
        uint256 reduction = CarryIndex.normalizeUp(pay, index);
        plan.normalized = reduction >= plan.normalized ? 0 : plan.normalized - reduction;
        plan.principalOutstanding = owed - pay;
        plan.repaid += pay;

        emit PlanPaid(planId, pay, pay);
        if (plan.principalOutstanding == 0) {
            plan.closed = true;
            emit PlanClosed(planId);
        }
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
        uint256[] storage ids = memberPlans[member];
        uint256 remaining = available;

        for (uint256 i = 0; i < ids.length && remaining > 0; i++) {
            uint256 planId = ids[i];
            Plan storage plan = plans[planId];
            if (plan.closed || plan.principalOutstanding == 0) continue;
            if (plan.index.ratePerCycle < minRate) continue;

            _materialiseCarry(planId);
            uint256 owed = plan.principalOutstanding;
            uint256 pay = owed < remaining ? owed : remaining;

            uint256 index = plan.index.currentIndex(block.timestamp);
            uint256 reduction = CarryIndex.normalizeUp(pay, index);
            plan.normalized = reduction >= plan.normalized ? 0 : plan.normalized - reduction;
            plan.principalOutstanding = owed - pay;
            plan.repaid += pay;

            remaining -= pay;
            absorbed += pay;
            emit PlanPaid(planId, pay, pay);
            if (plan.principalOutstanding == 0) {
                plan.closed = true;
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
        uint256[] storage ids = memberPlans[member];
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

    /// @notice clears the member's plans on default.
    function _onDefault(address member) internal override {
        uint256[] storage ids = memberPlans[member];
        for (uint256 i = 0; i < ids.length; i++) {
            Plan storage plan = plans[ids[i]];
            plan.normalized = 0;
            plan.principalOutstanding = 0;
            plan.closed = true;
        }
        termLimitOf[member] = 0;
        super._onDefault(member);
    }

    /// @dev Carry deepens the member's negative balance and mints the matching claim to the
    /// treasury. Raising the plan's outstanding principal to match means the same carry is never
    /// accrued twice, and that the schedule's arrears are measured against a figure the ledger
    /// agrees with.
    function _materialiseCarry(uint256 planId) private {
        Plan storage plan = plans[planId];
        if (plan.closed || plan.normalized == 0) return;

        uint256 owed = CarryIndex.denormalize(
            plan.normalized, plan.index.currentIndex(block.timestamp)
        );
        if (owed <= plan.principalOutstanding) return;

        uint256 carry = owed - plan.principalOutstanding;
        plan.principalOutstanding = owed;
        stableCredit.accrueCarry(plan.member, carryTreasury, carry);
        emit PlanCarryMaterialised(planId, carry);
    }

    function _requirePlan(uint256 planId) private view {
        if (planId >= plans.length) revert TermIssuerUnknownPlan(planId);
    }
}
