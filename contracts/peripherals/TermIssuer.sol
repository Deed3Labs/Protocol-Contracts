// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./CreditIssuer.sol";
import "../libraries/CarryIndex.sol";
import "../core/interfaces/stable-credit/ICreditPositionSource.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/// @dev The parts of the revolving line a mandated collection reads.
interface IRevolvingMandate {
    function autoRepayEnabled(address member) external view returns (bool);
    function isCardSettler(address account) external view returns (bool);
    function totalPrincipalOf(address member) external view returns (uint256);
}

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
contract TermIssuer is CreditIssuer, ICreditPositionSource {
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
        /// @dev When the current schedule started. A member may re-split what is left, and the
        /// schedule they are on then is not the one they opened with.
        uint64 scheduleStart;
        /// @dev Principal the current schedule spreads.
        uint256 scheduleBase;
        /// @dev Principal already due before the current schedule begins: what had been repaid,
        /// plus anything they were behind by when they changed the split. Re-splitting spreads
        /// the remainder; it does not forgive what was already owed.
        uint256 scheduleFloor;
        /// @dev The payment the schedule asks for each period, fixed when the schedule opens.
        uint256 installmentAmount;
        /// @dev What the whole schedule collects: `scheduleBase` plus the carry it will accrue if
        /// it is paid on time. Held so the last period settles the schedule exactly rather than
        /// inheriting the rounding of every period before it.
        uint256 scheduleTotal;
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

    /// @dev How often a plan has been re-split, and when last. Kept beside the plan rather than in
    /// it: appending to a struct inside a dynamic array would move every element after it.
    struct SplitLog {
        uint8 changes;
        uint64 lastChangedAt;
    }
    mapping(uint256 => SplitLog) private splitLogs;

    /// @notice What a term default wrote off for a member, and what they have paid back since.
    mapping(address => uint256) public writtenOffOf;
    mapping(address => uint256) public recoveredOf;
    /// @notice A member whose term credit ended in default. No new plans, and no term limit, until
    /// they are reinstated.
    mapping(address => bool) public termSuspended;

    /// @notice The revolving line: its automatic-repayment mandate, and its card settlers, are the
    /// ones a mandated collection here honours. One switch for the member, one key for the co-op.
    address public mandateSource;
    /// @dev ref => amount collected under the mandate. Once per ref.
    mapping(bytes32 => uint256) private mandateCollections;

    /// @notice cash already given back on a plan, so nothing is given back twice.
    /// @dev A plan the member paid off is closed, and refunding it is the ordinary case -- so the
    /// closed flag cannot be what stops a second refund. What a member paid is what can come back,
    /// once.
    mapping(uint256 => uint256) public refundedOf;

    /// @notice where the co-op's share of a purchase is minted, when that is not the carry treasury.
    /// @dev The fee and the carry were one address, and they are not one thing. `openPlan` mints
    /// the co-op's share of every purchase to `carryTreasury`, so moving carry somewhere else --
    /// to the payout pool, to be split among whoever bore the float -- took the fee with it, and
    /// the split would have handed funders a share of the co-op's income.
    ///
    /// Unset means the carry treasury, which is where the fee has always gone: adding this changes
    /// nothing until somebody sets it, and the migration is to name the co-op here FIRST and only
    /// then point `carryTreasury` elsewhere. A refund burns the fee from here too, so a plan opened
    /// before the split and refunded after it still unwinds against the address that holds it.
    address public feeRecipient;

    uint256[34] private __gap;

    /// @notice A plan defaults once its oldest missed installment is this many installments overdue.
    uint256 public constant DEFAULT_AFTER_INSTALLMENTS = 2;
    /// @notice A plan may be re-split this many times in its life, and no more than once an
    /// installment period.
    uint8 public constant MAX_SPLIT_CHANGES = 3;

    /* ========== ERRORS ========== */

    error TermIssuerNoCarryRecipient();
    error TermIssuerUnknownPlan(uint256 planId);
    error TermIssuerPlanClosed(uint256 planId);
    error TermIssuerInvalidSchedule();
    error TermIssuerExceedsTermLimit(address member, uint256 requested, uint256 limit);
    /// @notice principal given back on a plan. Not a repayment -- see closePlanForRefund.
    event PlanRefunded(uint256 indexed planId, uint256 amount);
    /// @notice cash given back to a member for a plan they had already paid into.
    event PlanRefundPaid(uint256 indexed planId, uint256 returned, uint256 carryWithheld);
    error TermIssuerNothingToPay(uint256 planId);
    error TermIssuerSplitNotOffered(uint32 installments);
    error TermIssuerNotPlanHolder(address caller);
    /// @notice behind on a plan: no new plans, and no re-split, until caught up.
    error TermIssuerBehindSchedule(address member);
    error TermIssuerSuspended(address member);
    error TermIssuerSplitLimitReached(uint256 planId);
    error TermIssuerSplitTooSoon(uint256 planId, uint256 availableAt);
    error TermIssuerNotDefaultable(address member);
    error TermIssuerNotReinstatable(address member);
    error TermIssuerNotCollector(address caller);
    error TermIssuerMandateOff(address member);
    error TermIssuerCollectionUsed(bytes32 ref);

    /* ========== EVENTS ========== */

    event TermLimitUpdated(address indexed member, uint256 limit);
    event CarryTreasuryUpdated(address treasury);
    event FeeRecipientUpdated(address recipient);
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
    event PlanSplitChanged(
        uint256 indexed planId, uint32 installments, uint256 spread, uint256 carriedArrears
    );
    event TermDefaulted(address indexed member, uint256 writtenOff);
    event WrittenOffRepaid(address indexed member, address indexed payer, uint256 amount);
    event TermReinstated(address indexed member);
    event MandateSourceUpdated(address source);
    event CollectedForMember(bytes32 indexed ref, address indexed member, uint256 amount);
    event ResidualCarryPaid(address indexed member, address indexed payer, uint256 amount);

    /// @notice The splits a member may choose: pay in one cycle, or spread over 2, 4, 6 or 12.
    /// @dev A fixed set rather than any number. The split is a product choice the member makes
    /// from a menu, and an arbitrary one would let a plan be stretched a cycle at a time.
    function isOfferedSplit(uint32 installments) public pure returns (bool) {
        return installments == 1 || installments == 2 || installments == 4 || installments == 6
            || installments == 12;
    }

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
        if (block.timestamp <= plan.scheduleStart) return 0;
        uint256 elapsed = block.timestamp - plan.scheduleStart;
        uint256 due = elapsed / plan.installmentLength;
        return due > plan.installments ? plan.installments : due;
    }

    /// @notice what the schedule says should have been repaid by now, carry included.
    /// @dev Fixed at origination rather than derived from carry so far. The earlier version added
    /// `_pendingCarry` on every read, which was right about what was owed and wrong about what
    /// the member had been told: the quoted payment climbed across the term as carry accrued.
    /// Projecting the whole schedule up front prices the same carry into a figure that holds
    /// still, and prices it from the start rather than lagging the last touch -- so this never
    /// under-reports how far behind a plan is, which is what an automatic pull is sized from.
    function scheduledPrincipalDue(uint256 planId) public view returns (uint256) {
        Plan storage plan = plans[planId];
        uint256 due = installmentsDue(planId);
        // The last period settles the schedule rather than paying another equal share, so the
        // rounding-up in each installment does not accumulate into a final overcharge.
        if (due >= plan.installments) return plan.scheduleFloor + plan.scheduleTotal;
        return plan.scheduleFloor + plan.installmentAmount * due;
    }

    /// @notice carry a plan has accrued but not yet had written onto the ledger.
    function pendingCarryOn(uint256 planId) external view returns (uint256) {
        _requirePlan(planId);
        return _pendingCarry(plans[planId]);
    }

    function _pendingCarry(Plan storage plan) private view returns (uint256) {
        if (plan.closed || plan.normalized == 0) return 0;
        uint256 owed =
            CarryIndex.denormalize(plan.normalized, plan.index.currentIndex(block.timestamp));
        return owed > plan.principalOutstanding ? owed - plan.principalOutstanding : 0;
    }

    /// @notice how far behind the schedule a plan is, in principal.
    function arrearsOf(uint256 planId) public view returns (uint256) {
        Plan storage plan = plans[planId];
        if (plan.closed) return 0;
        uint256 shouldHaveRepaid = scheduledPrincipalDue(planId);
        // Read rather than derived. `principal` is the figure at origination, and materialised
        // carry raises what is outstanding above it, so `principal - outstanding` is not what was
        // repaid -- it underflows the moment a plan has carried for long enough.
        uint256 hasRepaid = plan.repaid;
        return shouldHaveRepaid > hasRepaid ? shouldHaveRepaid - hasRepaid : 0;
    }

    /// @notice a member's total arrears across every plan they hold.
    function totalArrearsOf(address member) public view returns (uint256 total) {
        uint256[] storage ids = memberPlans[member];
        for (uint256 i = 0; i < ids.length; i++) {
            total += arrearsOf(ids[i]);
        }
    }

    /// @notice when a plan fell behind: the due date of its oldest installment not yet covered.
    /// Zero for a plan that is on time.
    /// @dev Anything a re-split carried in (the floor above what was repaid) was due the moment the
    /// schedule began. Past that, installment k is covered once `repaid` reaches
    /// `floor + installmentAmount * k`, so the first uncovered one is the next whole installment.
    function delinquentSince(uint256 planId) public view returns (uint256) {
        if (arrearsOf(planId) == 0) return 0;
        Plan storage plan = plans[planId];
        if (plan.repaid < plan.scheduleFloor || plan.installmentAmount == 0) return plan.scheduleStart;
        uint256 k = (plan.repaid - plan.scheduleFloor) / plan.installmentAmount + 1;
        if (k > plan.installments) k = plan.installments;
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
        uint256[] storage ids = memberPlans[member];
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

    /// @notice carry owed on no open plan and no revolving tier: what a refunded plan leaves.
    /// @dev Everything the member owes, less what each issuer's positions account for. Needs the
    /// revolving line to be known; without it the revolving balance would read as residual.
    function residualCarryOf(address member) public view returns (uint256) {
        if (mandateSource == address(0)) return 0;
        uint256 owed = stableCredit.creditBalanceOf(member);
        uint256 held = totalPrincipalOf(member) + IRevolvingMandate(mandateSource).totalPrincipalOf(member);
        return owed > held ? owed - held : 0;
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
            // Closed plans are skipped. Until refunds existed every closed plan had nothing
            // outstanding, so the sum was the same either way; a refund can close one over a carry
            // remainder, and counting that would hold a slice of a member's ceiling against a
            // purchase that was given back.
            if (plans[ids[i]].closed) continue;
            total += plans[ids[i]].principalOutstanding;
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
        // A default is not undone by writing a new number over it; reinstatement is its own step.
        if (termSuspended[member] && limit > 0) revert TermIssuerSuspended(member);
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

    /// @notice gives a purchase back: unwinds the principal and closes the plan when none is left.
    /// @dev The refund path, and deliberately not `payPlan`. A payment brings reserve tokens in to
    /// settle an obligation; a refund undoes the entry that created it. Sending refunds through
    /// `payPlan` would make whoever called it buy the member's debt back with real money that
    /// nobody received, and would leave the co-op's discount minted against nothing.
    ///
    /// Carry is deliberately materialised first rather than skipped. A member who held a plan for
    /// two cycles accrued carry over those cycles, and giving the purchase back does not unmake
    /// the time -- materialising it turns it into an obligation of its own, which survives the
    /// reversal below because only principal is unwound. Refunding the carry too would mean the
    /// co-op paid a member to hold a balance.
    ///
    /// The merchant and payout are arguments rather than plan state: the plan never recorded them,
    /// and appending fields to a struct inside a dynamic array would move every element of it,
    /// which is not something an upgrade may do. StableCredit asserts the legs net, exactly as it
    /// does on the way in, so a caller cannot invent a split that does not add up.
    /// @param planId the plan being unwound.
    /// @param amount principal to give back, capped at what is still outstanding.
    /// @param merchant address whose claim is taken back.
    /// @param payout the merchant's share of `amount`.
    /// @return refunded principal actually unwound.
    function closePlanForRefund(uint256 planId, uint256 amount, address merchant, uint256 payout)
        external
        onlyOperator
        returns (uint256 refunded)
    {
        _requirePlan(planId);
        Plan storage plan = plans[planId];

        /*
         * A plan a member has PAID OFF is closed, and giving that purchase back is the commonest
         * refund there is -- they bought it, paid for it, and returned it. So a closed plan is not
         * turned away; what it cannot do is give anything back twice, which `refundedOf` is for.
         * A closed plan has nothing left to reverse, so all that is left is cash.
         */
        uint256 principalOnly = plan.principalOutstanding;
        uint256 carry;
        if (!plan.closed) {
            // Read before materialising: afterwards `principalOutstanding` is principal AND carry,
            // and the difference between the two readings is exactly the carry. That difference is
            // what must survive this call.
            _materialiseCarry(planId);
            carry = plan.principalOutstanding - principalOnly;
        }

        /*
         * Reverse what is still owed; repay what has already been paid.
         *
         * Money a member has paid is fungible against the purchase, so the split is arithmetic
         * rather than proportional: a refund is met first out of what they still owe, and only what
         * is left over is cash going back to them. A $40 refund against $54 outstanding moves no
         * money at all -- the member simply owes $14 on what is now a $60 purchase -- while a full
         * refund of a plan they had half paid returns that half.
         *
         * Capped at what the purchase was, never at what is owed with carry on top: a refund that
         * reached into the carry would mean the co-op paid a member for the time they held the
         * balance.
         */
        uint256 refundable = plan.principal < amount ? plan.principal : amount;
        if (refundable == 0) revert TermIssuerNothingToPay(planId);
        refunded = refundable < principalOnly ? refundable : principalOnly;
        uint256 cash = refundable - refunded;
        // Never more than they put in, and never the same money twice.
        uint256 returnable = plan.repaid > refundedOf[planId] ? plan.repaid - refundedOf[planId] : 0;
        if (cash > returnable) cash = returnable;
        if (refunded == 0 && cash == 0) revert TermIssuerPlanClosed(planId);
        if (payout > refundable) revert TermIssuerInvalidSchedule();

        // The merchant's share of the whole refund, split between the two legs in the same
        // proportion, with the remainder falling to the co-op rather than clawing a cent from a
        // merchant they were never paid.
        uint256 payoutReversed = refundable == 0 ? 0 : (payout * refunded) / refundable;

        if (refunded > 0) {
            stableCredit.reversePurchase(
                plan.member, refunded, merchant, payoutReversed, _feeRecipient(), refunded - payoutReversed
            );
        }

        if (cash > 0) {
            /*
             * Carry withheld from the cash rather than forgiven. They held the money for the time
             * they held it and owe for that, which is why a refund does not unmake the carry -- but
             * taking it out of what goes back leaves nothing stranded on the ledger afterwards for
             * anybody to chase. Capped at the cash: no cash, no netting, and the member clears what
             * is left the ordinary way.
             */
            uint256 withheld = carry < cash ? carry : cash;
            refundedOf[planId] += cash;
            uint256 merchantCash = (payout * cash) / refundable;
            stableCredit.repayRefund(
                plan.member, cash, merchant, merchantCash, _feeRecipient(), cash - merchantCash, withheld
            );
            emit PlanRefundPaid(planId, cash, withheld);
        }

        uint256 index = plan.index.currentIndex(block.timestamp);
        uint256 reduction = CarryIndex.normalizeUp(refunded, index);
        plan.normalized = reduction >= plan.normalized ? 0 : plan.normalized - reduction;
        plan.principalOutstanding -= refunded;

        // Not added to `repaid`. Nobody paid this -- it was given back, and a plan that reports it
        // as repayment would tell a member they had settled something they never did.
        emit PlanRefunded(planId, refunded);

        /*
         * Closed once the purchase is gone, even with carry left on it.
         *
         * The carry is already the member's obligation -- `_materialiseCarry` put it on the ledger
         * and minted the treasury's claim to match -- so the plan is not what holds it, and a plan
         * kept open to carry it would be a second copy of the same debt.
         *
         * Without this, refunding a purchase the moment it is made leaves a plan owing millionths
         * of a cent, sitting on a member's shelf for a purchase that was given back.
         *
         * The remainder is cleared rather than left as a record: `totalPrincipalOf` reads it to
         * measure a member against their term ceiling, so a figure left on a closed plan would
         * quietly hold a slice of their headroom for ever. What was outstanding is on the ledger,
         * where the carry itself lives.
         */
        if (plan.principalOutstanding <= carry) {
            plan.principalOutstanding = 0;
            plan.normalized = 0;
            plan.closed = true;
            emit PlanClosed(planId);
        }
    }

    /// @notice where the co-op's share of a purchase is minted.
    /// @dev Name this before moving `carryTreasury`, never after: between the two the fee would be
    /// minted wherever carry had gone.
    function setFeeRecipient(address recipient) external onlyOperator {
        if (recipient == address(0)) revert TermIssuerNoCarryRecipient();
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    /// @dev The fee's home, falling back to the carry treasury while nobody has named one.
    function _feeRecipient() private view returns (address) {
        return feeRecipient == address(0) ? carryTreasury : feeRecipient;
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
        if (installmentLength == 0 || purchase == 0) revert TermIssuerInvalidSchedule();
        if (!isOfferedSplit(installments)) revert TermIssuerSplitNotOffered(installments);
        if (payout > purchase) revert TermIssuerInvalidSchedule();
        // Behind on one plan freezes new ones: term credit, not the card, and only until caught up.
        if (termSuspended[member]) revert TermIssuerSuspended(member);
        if (totalArrearsOf(member) > 0) revert TermIssuerBehindSchedule(member);

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
        plan.scheduleStart = uint64(block.timestamp);
        plan.scheduleBase = purchase;
        plan.scheduleFloor = 0;
        plan.index.init(ratePerCycle, cycleLength, uint64(block.timestamp));
        plan.normalized = CarryIndex.normalizeUp(purchase, CarryIndex.RAY);
        _fixSchedule(plan);
        memberPlans[member].push(planId);

        stableCredit.originatePurchase(
            member, purchase, merchant, payout, _feeRecipient(), purchase - payout
        );
        emit PlanOpened(planId, member, purchase, ratePerCycle, installments);
    }

    /// @notice re-splits what is left of a plan over a newly chosen number of cycles.
    /// @dev The member's choice: pay the rest in one cycle, or spread it over 2, 4, 6 or 12. Only
    /// the remainder moves. Someone who opened at two cycles and paid the first half can spread
    /// the second half over twelve, and what they already paid is not re-spread with it.
    ///
    /// Anything they were behind by is carried into the new schedule as due immediately, rather
    /// than being folded into the spread. Re-splitting is meant to change how the remainder is
    /// paid, not to forgive what was already owed -- and without that, changing the split would
    /// clear arrears, which is also what suppresses the auto-pull and the delinquency that
    /// follows from it.
    ///
    /// Carry is untouched and goes on accruing on whatever is outstanding, which is the point of
    /// spreading it further costing more.
    /// @param planId plan to re-split.
    /// @param installments new number of cycles: 1, 2, 4, 6 or 12.
    function setSplit(uint256 planId, uint32 installments) external {
        _requirePlan(planId);
        Plan storage plan = plans[planId];
        if (plan.closed) revert TermIssuerPlanClosed(planId);
        if (msg.sender != plan.member && !stableCredit.access().isOperator(msg.sender)) {
            revert TermIssuerNotPlanHolder(msg.sender);
        }
        if (!isOfferedSplit(installments)) revert TermIssuerSplitNotOffered(installments);

        /*
         * The member's own re-splits are bounded: not while behind (catch up first -- a re-split
         * is how a plan is reshaped, not how a missed installment is put off), at most
         * MAX_SPLIT_CHANGES in a plan's life, and at most one an installment period. An operator
         * re-splitting for hardship is not held to these.
         */
        if (msg.sender == plan.member) {
            if (arrearsOf(planId) > 0) revert TermIssuerBehindSchedule(plan.member);
            SplitLog storage log = splitLogs[planId];
            if (log.changes >= MAX_SPLIT_CHANGES) revert TermIssuerSplitLimitReached(planId);
            if (log.lastChangedAt != 0 && block.timestamp < log.lastChangedAt + plan.installmentLength) {
                revert TermIssuerSplitTooSoon(planId, log.lastChangedAt + plan.installmentLength);
            }
            log.changes += 1;
            log.lastChangedAt = uint64(block.timestamp);
        }

        // Bring the plan current first, so the remainder being re-split is what is really owed.
        _materialiseCarry(planId);

        uint256 repaid = plan.repaid;
        uint256 behind = arrearsOf(planId);
        uint256 spread = plan.principalOutstanding - behind;

        plan.scheduleStart = uint64(block.timestamp);
        plan.scheduleFloor = repaid + behind;
        plan.scheduleBase = spread;
        plan.installments = installments;
        _fixSchedule(plan);

        emit PlanSplitChanged(planId, installments, spread, behind);
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

    /// @notice pays carry a refunded plan left owed on nothing, for a member, from the caller.
    /// @dev Directed, so no issuer absorbs it: it clears the residual and only the residual. The
    /// co-op calls it from its float when a bank deposit paid the carry; anyone may, since it only
    /// ever reduces what a member owes.
    function payResidualCarry(address member, uint256 amount) external notNull(member) {
        uint256 residual = residualCarryOf(member);
        uint256 pay = amount < residual ? amount : residual;
        if (pay == 0) revert TermIssuerNothingToPay(type(uint256).max);
        stableCredit.repayCreditBalanceFor(msg.sender, member, uint128(pay));
        emit ResidualCarryPaid(member, msg.sender, pay);
    }

    /// @notice collects what is due on a member's plans from their own USDC, under the mandate they
    /// set on the revolving line.
    /// @dev The term half of "there is no pay button". Bounded like the revolving half: only a
    /// card settler, only for a member who switched automatic repayment on, only once per ref, and
    /// only toward what is DUE -- each plan's arrears, oldest first, then residual carry. Never an
    /// installment early: that would be lending the member their own money.
    /// @param ref idempotency key.
    /// @param member address being collected for; also the payer.
    /// @param amount the most to collect.
    /// @return collected what was actually taken.
    function collectForMember(bytes32 ref, address member, uint256 amount)
        external
        notNull(member)
        returns (uint256 collected)
    {
        if (mandateSource == address(0) || !IRevolvingMandate(mandateSource).isCardSettler(msg.sender)) {
            revert TermIssuerNotCollector(msg.sender);
        }
        if (!IRevolvingMandate(mandateSource).autoRepayEnabled(member)) revert TermIssuerMandateOff(member);
        if (mandateCollections[ref] != 0) revert TermIssuerCollectionUsed(ref);

        uint256 remaining = amount;
        uint256[] storage ids = memberPlans[member];
        for (uint256 i = 0; i < ids.length && remaining > 0; i++) {
            uint256 planId = ids[i];
            if (plans[planId].closed) continue;
            uint256 behind = arrearsOf(planId);
            if (behind == 0) continue;
            _materialiseCarry(planId);
            uint256 owed = plans[planId].principalOutstanding;
            uint256 pay = behind < remaining ? behind : remaining;
            if (pay > owed) pay = owed;
            if (pay == 0) continue;
            stableCredit.repayCreditBalanceFor(member, member, uint128(pay));
            _applyPlanPayment(planId, pay);
            remaining -= pay;
            collected += pay;
        }
        uint256 residual = residualCarryOf(member);
        if (remaining > 0 && residual > 0) {
            uint256 pay = residual < remaining ? residual : remaining;
            stableCredit.repayCreditBalanceFor(member, member, uint128(pay));
            emit ResidualCarryPaid(member, member, pay);
            collected += pay;
        }
        if (collected == 0) revert TermIssuerNothingToPay(type(uint256).max);
        mandateCollections[ref] = collected;
        emit CollectedForMember(ref, member, collected);
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

        uint256[] storage ids = memberPlans[member];
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

    /// @notice pays back what a term default wrote off, into the assurance reserve that covered it.
    /// @dev Anyone may pay for a member. Paying it all back is one way to term credit again.
    function repayWrittenOff(address member, uint256 amount) external notNull(member) returns (uint256 pay) {
        uint256 outstanding = writtenOffOf[member] - recoveredOf[member];
        pay = amount < outstanding ? amount : outstanding;
        if (pay == 0) revert TermIssuerNothingToPay(type(uint256).max);
        IAssurancePool pool = stableCredit.assurancePool();
        IERC20Upgradeable token = pool.reserveToken();
        SafeERC20Upgradeable.safeTransferFrom(token, msg.sender, address(this), pay);
        SafeERC20Upgradeable.safeApprove(token, address(pool), 0);
        SafeERC20Upgradeable.safeApprove(token, address(pool), pay);
        pool.deposit(pay);
        recoveredOf[member] += pay;
        emit WrittenOffRepaid(member, msg.sender, pay);
    }

    /// @notice lifts a term suspension.
    /// @dev Two ways back. Paying back everything written off lets anyone reinstate the member.
    /// Otherwise it is the co-op's call -- after a run of clean card cycles, which this issuer
    /// cannot see. Either way a new term limit is still an underwriting decision (setTermLimit).
    function reinstate(address member) external notNull(member) {
        if (!termSuspended[member]) revert TermIssuerNotReinstatable(member);
        bool repaid = recoveredOf[member] >= writtenOffOf[member];
        if (!repaid && !stableCredit.access().isOperator(msg.sender)) revert TermIssuerNotReinstatable(member);
        termSuspended[member] = false;
        emit TermReinstated(member);
    }

    /// @notice names the revolving line whose mandate and settlers a mandated collection honours.
    function setMandateSource(address source) external onlyOperator {
        mandateSource = source;
        emit MandateSourceUpdated(source);
    }

    /// @dev What a payment does to a plan, however it arrived: carry-aware reduction, the repaid
    /// figure the schedule is measured against, and closing it at zero.
    function _applyPlanPayment(uint256 planId, uint256 pay) private {
        Plan storage plan = plans[planId];
        uint256 index = plan.index.currentIndex(block.timestamp);
        uint256 reduction = CarryIndex.normalizeUp(pay, index);
        plan.normalized = reduction >= plan.normalized ? 0 : plan.normalized - reduction;
        plan.principalOutstanding -= pay;
        plan.repaid += pay;

        emit PlanPaid(planId, pay, pay);
        if (plan.principalOutstanding == 0) {
            plan.closed = true;
            emit PlanClosed(planId);
        }
    }

    /* ========== INTERNAL ========== */

    /// @notice fixes the payment schedule for whatever the plan is spreading.
    /// @dev Called when a schedule opens and again when one is re-split, because a re-split is a
    /// new schedule over a new remainder -- and quoting the old payment against it would be the
    /// drift this exists to remove, arriving by another route.
    function _fixSchedule(Plan storage plan) private {
        uint256 growth = plan.index.growthBetween(
            plan.scheduleStart, uint256(plan.scheduleStart) + plan.installmentLength
        );
        uint256 total = CarryIndex.scheduleCost(plan.scheduleBase, growth, plan.installments);
        plan.scheduleTotal = total;
        // Rounded up, so a member who pays what is asked is never a wei short of the schedule.
        // The last period settles against the total instead of paying another equal share, so
        // the rounding does not accumulate across the term.
        plan.installmentAmount = total == 0 ? 0 : (total - 1) / plan.installments + 1;
    }


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

    /// @notice clears the member's plans on default, and suspends their term credit.
    /// @dev Narrowed to this issuer, as the base contract asks of an issuer that shares a member:
    /// no revoking membership. A missed plan ends term credit; it does not take away the card, the
    /// savings, or the co-op.
    function _onDefault(address member) internal override {
        uint256[] storage ids = memberPlans[member];
        for (uint256 i = 0; i < ids.length; i++) {
            Plan storage plan = plans[ids[i]];
            if (plan.closed) continue;
            plan.normalized = 0;
            plan.principalOutstanding = 0;
            plan.closed = true;
            emit PlanClosed(ids[i]);
        }
        termLimitOf[member] = 0;
        termSuspended[member] = true;
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
        // Carry that has become principal is spread over the installments left, so the schedule
        // still adds up to everything owed rather than to the figure at origination.
        plan.scheduleBase += carry;
        stableCredit.accrueCarry(plan.member, carryTreasury, carry);
        emit PlanCarryMaterialised(planId, carry);
    }

    function _requirePlan(uint256 planId) private view {
        if (planId >= plans.length) revert TermIssuerUnknownPlan(planId);
    }
}
