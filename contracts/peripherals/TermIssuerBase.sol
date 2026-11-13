// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./CreditIssuer.sol";
import "../libraries/CarryIndex.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "./RateSchedule.sol";
import "../core/interfaces/stable-credit/IMerchantStatus.sol";

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

    /* ---- Phase 2: compliance pricing (spec items 2, 5-7) ---- */

    /// @notice Where plans are priced: list rate, legal cap and free rules by state and product.
    /// @dev Unset, plans keep the rate their terms carry and none of the compliance rules apply;
    /// the deploy script sets it, and every test of the rules runs with it set.
    RateSchedule public rateSchedule;

    /// @notice How a plan is priced, fixed at opening and changed only by a re-split.
    struct PlanPricing {
        bytes32 state;
        bytes32 product;
        address merchant;
        /// @dev Monthly bps the merchant takes off the rate.
        uint32 subsidyBps;
        /// @dev A free plan never accrues anything, not even when past due (spec item 5).
        bool free;
        /// @dev Priced from RateSchedule (rather than at the rate in its terms).
        bool priced;
        /// @dev When carry was last brought onto the ledger.
        uint64 accruedAt;
    }
    mapping(uint256 => PlanPricing) internal planPricing;
    /// @dev planId => RateSchedule accumulators at the last touch.
    mapping(uint256 => RateSchedule.Snapshot) internal planSnap;

    /// @dev Three more slots from the gap: rateSchedule, planPricing, planSnap.
    uint256[21] private __gap;

    uint256 internal constant RAY_ = 1e27;
    uint256 internal constant BPS_ = 10_000;
    /// @notice Clear Cash at $2,500 and up may run 13 thirty-day cycles (DECISIONS #4): 390 days,
    /// the shortest offered term that clears the large-loan regime's 365-day minimum.
    uint32 public constant CLEAR_CASH_SPLIT = 13;

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
    /// @notice thrown when a product is not enabled in the member's state, or they have none.
    error TermIssuerProductNotEnabled(address member, bytes32 stateCode, bytes32 productId);
    /// @notice thrown when the rate or payout signed for is not what the chain computes.
    error TermIssuerTermsMismatch(uint256 signedRate, uint256 rate, uint256 signedPayout, uint256 payout);
    /// @notice thrown when a large loan is scheduled over less than its minimum term.
    error TermIssuerTermTooShort(uint256 term, uint256 minimum);
    /// @notice thrown when a re-split would cost the member more and they have not signed for it.
    error TermIssuerResplitNeedsSignature(uint256 planId);

    /* ========== EVENTS ========== */

    event TermLimitUpdated(address indexed member, uint256 limit);
    event CarryTreasuryUpdated(address treasury);
    event FeeRecipientUpdated(address recipient);
    /// @notice everything needed to reproduce a plan's loan disclosure later (spec item 5).
    event PlanOpened(
        uint256 indexed planId,
        address indexed member,
        address indexed merchant,
        uint256 principal,
        uint32 split,
        uint256 rateBps,
        bytes32 scheduleHash,
        uint256 totalCarry,
        bytes32 disclosureHash
    );
    /// @notice a plan's rate changed with a re-split, from now on.
    event PlanRepriced(uint256 indexed planId, uint256 rateBps, bool free);
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
    ///
    /// The schedule is equal principal installments plus carry on the principal still unpaid
    /// (spec item 5), so what is due by installment k is k shares of principal plus the carry those
    /// k periods run on a declining balance.
    function scheduledPrincipalDue(uint256 planId) public view returns (uint256) {
        return _dueAt(plans[planId], installmentsDue(planId));
    }

    /// @dev What the schedule asks to have been repaid once `k` installments have come due.
    function _dueAt(Plan storage plan, uint256 k) internal view returns (uint256) {
        uint256 n = plan.installments;
        // The last period settles the schedule exactly, so rounding never accumulates.
        if (k >= n) return plan.scheduleFloor + plan.scheduleTotal;
        if (k == 0) return plan.scheduleFloor;
        uint256 base = plan.scheduleBase;
        uint256 periodRate = _periodRate(plan);
        // carry over k periods = base x rate x (n + (n-1) + ... + (n-k+1)) / n
        uint256 carry = (base * periodRate * (k * n - (k * (k - 1)) / 2)) / (n * RAY_);
        return plan.scheduleFloor + (base * k) / n + carry;
    }

    /// @dev The plan's scheduled rate over one installment period, RAY-scaled: monthly bps
    /// x 12 / 365 days per second (DECISIONS #1).
    function _periodRate(Plan storage plan) internal view returns (uint256) {
        return (plan.index.ratePerCycle * RAY_ * 12 * plan.installmentLength) / (BPS_ * 365 days);
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
    ///
    /// Equal shares of principal, each period also paying the carry on what is still unpaid at the
    /// plan's rate (spec item 5): $940 in four at 2% a month is 235 of principal a period plus
    /// carry on 940, 705, 470 and 235. `installmentAmount` is the first, largest payment.
    function _fixSchedule(Plan storage plan) internal {
        uint256 n = plan.installments;
        uint256 base = plan.scheduleBase;
        uint256 periodRate = _periodRate(plan);
        uint256 carry = (base * periodRate * (n + 1)) / (2 * RAY_);
        plan.scheduleTotal = base + carry;
        plan.installmentAmount = base == 0 ? 0 : (base - 1) / n + 1 + (base * periodRate) / RAY_;
    }

    /// @dev Carry deepens the member's negative balance and mints the matching claim to the
    /// treasury. Raising the plan's outstanding principal to match means the same carry is never
    /// accrued twice, and that the schedule's arrears are measured against a figure the ledger
    /// agrees with.
    ///
    /// Compliance spec items 2 and 5. Carry is simple interest on the plan's unpaid principal alone,
    /// never on carry already owed: the lesser of the list rate and the legal cap on that principal,
    /// less the merchant's subsidy. A free plan accrues nothing, ever. Snapshots are reset to now,
    /// which is what lets principal be treated as constant between touches.
    function _materialiseCarry(uint256 planId) internal {
        Plan storage plan = plans[planId];
        if (plan.closed) return;
        uint256 carry = _pendingPlanCarry(planId);
        if (carry > 0) {
            plan.principalOutstanding += carry;
            carryOutstandingOf[planId] += carry;
            stableCredit.accrueCarry(plan.member, carryTreasury, carry);
            emit PlanCarryMaterialised(planId, carry);
        }
        PlanPricing storage pricing = planPricing[planId];
        pricing.accruedAt = uint64(block.timestamp);
        if (pricing.priced && !pricing.free) {
            planSnap[planId] = rateSchedule.snapshot(pricing.state, pricing.product);
        }
    }

    /// @dev Carry a plan has accrued since its last touch.
    function _pendingPlanCarry(uint256 planId) internal view returns (uint256) {
        Plan storage plan = plans[planId];
        PlanPricing storage pricing = planPricing[planId];
        if (plan.closed || pricing.free) return 0;
        uint256 principal = plan.principalOutstanding - carryOutstandingOf[planId];
        if (principal == 0) return 0;
        uint256 elapsed = block.timestamp - pricing.accruedAt;
        uint256 charge;
        if (pricing.priced) {
            (uint256 list, uint256 cap,) =
                rateSchedule.chargesSince(pricing.state, pricing.product, principal, planSnap[planId]);
            charge = list < cap ? list : cap;
        } else {
            charge = (principal * plan.index.ratePerCycle * 12 * elapsed) / (BPS_ * 365 days);
        }
        uint256 subsidy = (principal * pricing.subsidyBps * 12 * elapsed) / (BPS_ * 365 days);
        return charge > subsidy ? charge - subsidy : 0;
    }

    /// @notice What a plan of these terms costs, from RateSchedule and the merchant's terms.
    struct Quote {
        uint256 rateBps;
        uint256 payout;
        uint32 subsidyBps;
        bool free;
        bool largeLoan;
        bytes32 state;
    }

    /// @dev Prices a plan for `member` at `merchant` (spec items 5-9): the state gate, the free
    /// rules, min(list, legal cap on this principal) less the merchant's subsidy, the payout after
    /// the merchant's discount for this split, and the large-loan minimum term.
    function _quote(
        address member,
        address merchant,
        bytes32 product,
        uint256 principal,
        uint32 installments,
        uint64 installmentLength
    ) internal view returns (Quote memory q) {
        q.state = stableCredit.networkRegistry().stateCodeOf(member);
        if (q.state == bytes32(0) || !rateSchedule.isEnabled(q.state, product)) {
            revert TermIssuerProductNotEnabled(member, q.state, product);
        }
        RateSchedule.ProductParams memory p = rateSchedule.paramsOf(q.state, product);
        (uint256 discountBps, uint256 subsidyBps, uint32 merchantFreeMax) =
            IMerchantSplitTerms(address(stableCredit.merchantRegistry())).splitTermsOf(merchant, installments);
        q.payout = principal - (principal * discountBps) / BPS_;
        q.subsidyBps = uint32(subsidyBps);
        q.largeLoan = p.largeLoanThreshold != 0 && principal >= p.largeLoanThreshold;
        if (q.largeLoan) {
            uint256 term = uint256(installments) * installmentLength;
            if (term < p.minTermSeconds) revert TermIssuerTermTooShort(term, p.minTermSeconds);
        }
        q.free = (p.freeInFull && installments == 1)
            || (p.freeBelowAmount != 0 && principal < p.freeBelowAmount)
            || (p.freeSplitMax != 0 && installments <= p.freeSplitMax)
            || (merchantFreeMax != 0 && installments <= merchantFreeMax);
        uint256 effective = rateSchedule.effectiveMonthlyBps(q.state, product, principal);
        if (!q.free && subsidyBps >= effective) q.free = true;
        q.rateBps = q.free ? 0 : effective - subsidyBps;
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

    /// @notice the EIP-712 domain plan signatures are made in.
    /// @dev Computed rather than stored: EIP712Upgradeable would add storage ahead of this
    /// contract's own, which an upgrade may not do.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Clear TermIssuer")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice The terms a member signs for a plan.
    /// @dev Everything that decides what they owe and to whom, plus the hash of the disclosure
    /// they were shown, so the signature is over what they agreed to rather than over whatever an
    /// operator key later submits (audit H-4).
    struct PlanTerms {
        address member;
        address merchant;
        /// @dev The RateSchedule product: partner credit, Clear Cash, ... (spec items 5, 7).
        bytes32 productId;
        uint256 purchase;
        uint256 payout;
        uint256 ratePerCycle;
        uint64 cycleLength;
        uint32 installments;
        uint64 installmentLength;
        bytes32 disclosureHash;
        uint256 deadline;
    }

    bytes32 public constant PLAN_TERMS_TYPEHASH = keccak256(
        "PlanTerms(address member,address merchant,bytes32 productId,uint256 purchase,uint256 payout,uint256 ratePerCycle,uint64 cycleLength,uint32 installments,uint64 installmentLength,bytes32 disclosureHash,uint256 nonce,uint256 deadline)"
    );

    /// @notice the digest a member signs for these terms, at their current nonce.
    function _planTermsDigest(PlanTerms calldata terms) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                PLAN_TERMS_TYPEHASH,
                terms.member,
                terms.merchant,
                terms.productId,
                terms.purchase,
                terms.payout,
                terms.ratePerCycle,
                terms.cycleLength,
                terms.installments,
                terms.installmentLength,
                terms.disclosureHash,
                planNonces[terms.member],
                terms.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @notice a member's total arrears across every plan they hold.
    function totalArrearsOf(address member) public view returns (uint256 total) {
        uint256[] memory ids = openPlanIds[member];
        for (uint256 i = 0; i < ids.length; i++) {
            total += arrearsOf(ids[i]);
        }
    }
}
