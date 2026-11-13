// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./CreditIssuer.sol";
import "../libraries/CarryIndex.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @dev The parts of the revolving line a mandated collection reads.
interface IRevolvingMandate {
    function autoRepayEnabled(address member) external view returns (bool);
    function isCardSettler(address account) external view returns (bool);
    function totalPrincipalOf(address member) external view returns (uint256);
}

/// @title TermIssuerBase
/// @notice Everything TermIssuer and TermIssuerExtension share: storage, events, errors and the
/// internal plan bookkeeping.
/// @dev TermIssuer outgrew the 24 KiB contract size limit with the Phase 1 audit fixes, so some of
/// its functions run in TermIssuerExtension by delegatecall. Both inherit this contract and declare
/// no storage of their own, so they read and write the same slots in the same order -- the layout
/// TermIssuer had before the split. Never add a state variable to either child.
abstract contract TermIssuerBase is CreditIssuer {
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

    Plan[] internal plans;
    /// @dev member => plan ids
    mapping(address => uint256[]) internal memberPlans;

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
    mapping(uint256 => SplitLog) internal splitLogs;

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
    mapping(bytes32 => uint256) internal mandateCollections;

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

    /// @notice cash already given back on a plan, so nothing is given back twice.
    /// @dev A plan the member paid off is closed, and refunding it is the ordinary case -- so the
    /// closed flag cannot be what stops a second refund. What a member paid is what can come back,
    /// once.
    ///
    /// After `feeRecipient`, which is already deployed: new storage goes after every variable the
    /// live implementation knows about, never among them.
    mapping(uint256 => uint256) public refundedOf;

    /// @notice carry a plan has materialised and not yet had paid, inside `principalOutstanding`.
    /// @dev Tracked rather than inferred. A refund used to find the carry by materialising and
    /// measuring the difference, so whether somebody had called the public `materialiseCarry`
    /// first decided whether a full refund closed the plan or left it open and behind (audit X-13).
    /// Payments clear it before principal. Appended after `refundedOf`.
    mapping(uint256 => uint256) public carryOutstandingOf;

    /// @notice Today's budget for raising term limits, across every member (audit H-4).
    DailyCap internal limitIncreaseCap;
    /// @notice Today's budget for new plans, across every member (audit H-4).
    DailyCap internal planTotalCap;
    /// @notice The next nonce a member's signature over plan terms must carry.
    mapping(address => uint256) public planNonces;

    /// @dev Seven slots from the gap: limitIncreaseCap (3), planTotalCap (3), planNonces.
    /// @dev member => ids of plans still open. Every loop over a member's plans walks this rather
    /// than `memberPlans`, which only grows, so a member's calls do not get dearer with every plan
    /// they have ever closed (audit L-7).
    mapping(address => uint256[]) internal openPlanIds;
    /// @dev planId => its position in `openPlanIds` plus one; zero when not tracked.
    mapping(uint256 => uint256) internal openPlanSlot;

    /// @dev Two more slots from the gap: openPlanIds, openPlanSlot.
    uint256[24] private __gap;

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
    /// @notice thrown when a plan's merchant is not a registered, active merchant (audit H-4).
    error TermIssuerMerchantNotActive(address merchant);
    /// @notice thrown when the member did not sign these plan terms (audit H-4).
    error TermIssuerBadSignature(address member);
    error TermIssuerSignatureExpired(uint256 deadline);

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
    /// @notice the terms the member signed for a plan, and the disclosure they were shown.
    event PlanTermsSigned(uint256 indexed planId, address indexed member, bytes32 disclosureHash, uint256 nonce);

    /// @notice The splits a member may choose: pay in one cycle, or spread over 2, 4, 6 or 12.
    /// @dev A fixed set rather than any number. The split is a product choice the member makes
    /// from a menu, and an arbitrary one would let a plan be stretched a cycle at a time.
    function isOfferedSplit(uint32 installments) public pure returns (bool) {
        return installments == 1 || installments == 2 || installments == 4 || installments == 6
            || installments == 12;
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

    /// @notice carry owed on no open plan and no revolving tier: what a refunded plan leaves.
    /// @dev Everything the member owes, less what each issuer's positions account for. Needs the
    /// revolving line to be known; without it the revolving balance would read as residual.
    function residualCarryOf(address member) public view returns (uint256) {
        if (mandateSource == address(0)) return 0;
        uint256 owed = stableCredit.creditBalanceOf(member);
        uint256 held = totalPrincipalOf(member) + IRevolvingMandate(mandateSource).totalPrincipalOf(member);
        return owed > held ? owed - held : 0;
    }

    /// @notice a member's outstanding principal across every open plan.
    function totalPrincipalOf(address member) public view returns (uint256 total) {
        uint256[] memory ids = openPlanIds[member];
        for (uint256 i = 0; i < ids.length; i++) {
            // Closed plans are skipped. Until refunds existed every closed plan had nothing
            // outstanding, so the sum was the same either way; a refund can close one over a carry
            // remainder, and counting that would hold a slice of a member's ceiling against a
            // purchase that was given back.
            if (plans[ids[i]].closed) continue;
            total += plans[ids[i]].principalOutstanding;
        }
    }

    /// @dev Spreads what is left of a plan over the installments it has left, keeping anything
    /// already behind as due immediately.
    function _refixSchedule(uint256 planId) internal {
        Plan storage plan = plans[planId];
        uint256 due = installmentsDue(planId);
        uint32 left = due >= plan.installments ? 1 : uint32(plan.installments - due);
        uint256 behind = arrearsOf(planId);
        if (behind > plan.principalOutstanding) behind = plan.principalOutstanding;
        plan.scheduleStart = uint64(block.timestamp);
        plan.scheduleFloor = plan.repaid + behind;
        plan.scheduleBase = plan.principalOutstanding - behind;
        plan.installments = left;
        _fixSchedule(plan);
        emit PlanSplitChanged(planId, left, plan.scheduleBase, behind);
    }

    /// @dev The fee's home, falling back to the carry treasury while nobody has named one.
    function _feeRecipient() internal view returns (address) {
        return feeRecipient == address(0) ? carryTreasury : feeRecipient;
    }

    /// @dev What a payment does to a plan, however it arrived: carry-aware reduction, the repaid
    /// figure the schedule is measured against, and closing it at zero.
    function _applyPlanPayment(uint256 planId, uint256 pay) internal {
        Plan storage plan = plans[planId];
        uint256 index = plan.index.currentIndex(block.timestamp);
        uint256 reduction = CarryIndex.normalizeUp(pay, index);
        plan.normalized = reduction >= plan.normalized ? 0 : plan.normalized - reduction;
        plan.principalOutstanding -= pay;
        plan.repaid += pay;
        uint256 principalPortion = pay - _clearCarry(planId, pay);

        emit PlanPaid(planId, pay, principalPortion);
        if (plan.principalOutstanding == 0) {
            plan.closed = true;
            _untrackOpen(planId);
            emit PlanClosed(planId);
        }
    }

    /// @notice fixes the payment schedule for whatever the plan is spreading.
    /// @dev Called when a schedule opens and again when one is re-split, because a re-split is a
    /// new schedule over a new remainder -- and quoting the old payment against it would be the
    /// drift this exists to remove, arriving by another route.
    function _fixSchedule(Plan storage plan) internal {
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

    /// @dev Carry deepens the member's negative balance and mints the matching claim to the
    /// treasury. Raising the plan's outstanding principal to match means the same carry is never
    /// accrued twice, and that the schedule's arrears are measured against a figure the ledger
    /// agrees with.
    function _materialiseCarry(uint256 planId) internal {
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
        carryOutstandingOf[planId] += carry;
        stableCredit.accrueCarry(plan.member, carryTreasury, carry);
        emit PlanCarryMaterialised(planId, carry);
    }

    /// @dev Applies a payment to a plan's outstanding carry first, and says how much it took.
    /// Carry before principal within a plan is the order the compliance spec proposes (pending
    /// counsel); here it only decides what the refund path treats as carry.
    function _clearCarry(uint256 planId, uint256 pay) internal returns (uint256 cleared) {
        uint256 carry = carryOutstandingOf[planId];
        cleared = pay < carry ? pay : carry;
        if (cleared > 0) carryOutstandingOf[planId] = carry - cleared;
    }

    function _trackOpen(address member, uint256 planId) internal {
        openPlanIds[member].push(planId);
        openPlanSlot[planId] = openPlanIds[member].length;
    }

    function _untrackOpen(uint256 planId) internal {
        uint256 slot = openPlanSlot[planId];
        if (slot == 0) return;
        uint256[] storage ids = openPlanIds[plans[planId].member];
        uint256 last = ids[ids.length - 1];
        ids[slot - 1] = last;
        openPlanSlot[last] = slot;
        ids.pop();
        delete openPlanSlot[planId];
    }

    function _requirePlan(uint256 planId) internal view {
        if (planId >= plans.length) revert TermIssuerUnknownPlan(planId);
    }
}
