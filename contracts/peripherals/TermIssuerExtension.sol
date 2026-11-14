// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./TermIssuerBase.sol";

/// @title TermIssuerExtension
/// @notice The part of TermIssuer that runs by delegatecall: refunds, re-splits, mandated
/// collection and recovery after a default.
/// @dev Never called directly in production. TermIssuer creates one in its constructor, pins it
/// as an immutable, and forwards these selectors to it, so this code runs against the TermIssuer
/// proxy's storage with the original caller. Called directly it acts on its own empty storage,
/// which it never initializes.
contract TermIssuerExtension is TermIssuerBase {
    /// @notice what TermIssuer's constructor checks before pinning this module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("TermIssuerExtension.v2");
    }

    using CarryIndex for CarryIndex.Index;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
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
    /// The merchant and the payout are the ones the plan recorded when it opened (Phase 4, H-A),
    /// never the caller's. A refund takes back only what that merchant was paid for this sale, so
    /// it cannot create an obligation on anyone else, or move the merchant's share onto the co-op.
    /// `merchant` must name the plan's merchant, as a check on the caller; `payout` is kept in the
    /// signature so existing callers keep working, and is ignored -- the merchant's share of the
    /// refund is the recorded payout in proportion to the purchase.
    /// @param planId the plan being unwound.
    /// @param amount principal to give back, capped at what is still outstanding.
    /// @param merchant the plan's merchant; anything else reverts.
    /// @param payout ignored (see above).
    /// @return refunded principal actually unwound.
    function closePlanForRefund(uint256 planId, uint256 amount, address merchant, uint256 payout)
        external
        onlyCreditRole(CREDIT_LINES_ROLE)
        returns (uint256 refunded)
    {
        _requirePlan(planId);
        Plan storage plan = plans[planId];
        {
            PlanPricing storage terms = planPricing[planId];
            if (!terms.refundTermsRecorded) revert TermIssuerRefundTermsUnknown(planId);
            if (merchant != terms.merchant) revert TermIssuerRefundTermsMismatch(merchant, terms.merchant);
            payout = terms.payout;
        }

        /*
         * A plan a member has PAID OFF is closed, and giving that purchase back is the commonest
         * refund there is -- they bought it, paid for it, and returned it. So a closed plan is not
         * turned away; what it cannot do is give anything back twice, which `refundedOf` is for.
         * A closed plan has nothing left to reverse, so all that is left is cash.
         */
        uint256 carry;
        if (!plan.closed) {
            // Every unit of carry the plan has ever materialised and not had paid is tracked, so
            // the split between principal and carry is the same whoever materialised it and when
            // (audit X-13). That carry is what must survive this call.
            _materialiseCarry(planId);
            carry = carryOutstandingOf[planId];
        }
        uint256 principalOnly = plan.principalOutstanding - carry;

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
        // The merchant's share of what is being given back, in the proportion it was paid.
        payout = (payout * refundable) / plan.principal;

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
            // The member's cash net of the carry withheld, which is what actually reached them
            // (audit X-14).
            emit PlanRefundPaid(planId, cash - withheld, withheld);
        }

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
            carryOutstandingOf[planId] = 0;
            plan.closed = true;
            _untrackOpen(planId);
            emit PlanClosed(planId);
        } else if (refunded > 0) {
            // Still open with less to pay. The old schedule was sized for the whole purchase, so
            // it is re-fixed over what is left (audit X-13). Arrears are carried in as due now,
            // exactly as a re-split carries them: a refund reduces the purchase, it does not
            // forgive a missed installment.
            _refixSchedule(planId);
        }
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
        _resplit(planId, installments, false, 0);
    }

    bytes32 public constant RESPLIT_TYPEHASH = keccak256(
        "Resplit(uint256 planId,uint32 installments,uint256 rateBps,uint256 nonce,uint256 deadline)"
    );

    /// @notice re-splits a plan on new finance-charge terms the member has signed for.
    /// @dev Spec item 6. A re-split that makes the plan cost more -- a free plan becoming charged, a
    /// higher rate, or the same rate over more installments -- creates new finance-charge terms, so
    /// it needs the member's EIP-712 signature over the new split and rate at their current nonce.
    function resplitWithSignature(
        uint256 planId,
        uint32 installments,
        uint256 rateBps,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _requirePlan(planId);
        address member = plans[planId].member;
        if (block.timestamp > deadline) revert TermIssuerSignatureExpired(deadline);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                keccak256(abi.encode(RESPLIT_TYPEHASH, planId, installments, rateBps, planNonces[member], deadline))
            )
        );
        if (!SignatureChecker.isValidSignatureNow(member, digest, signature)) {
            revert TermIssuerBadSignature(member);
        }
        planNonces[member]++;
        _resplit(planId, installments, true, rateBps);
    }

    /// @dev Accrues to now, sets the new rate going forward only, and re-fixes the schedule over
    /// what is left (spec item 6). Nothing before the switch is ever charged at the new rate,
    /// because carry up to now is materialised at the old one first.
    function _resplit(uint256 planId, uint32 installments, bool signed, uint256 signedRate) internal {
        _requirePlan(planId);
        Plan storage plan = plans[planId];
        if (plan.closed) revert TermIssuerPlanClosed(planId);
        if (
            msg.sender != plan.member
                && !stableCredit.access().hasCreditRole(CREDIT_LINES_ROLE, msg.sender)
                && !signed
        ) {
            revert TermIssuerNotPlanHolder(msg.sender);
        }

        /*
         * The member's own re-splits are bounded: not while behind (catch up first -- a re-split
         * is how a plan is reshaped, not how a missed installment is put off), at most
         * MAX_SPLIT_CHANGES in a plan's life, and at most one an installment period. A re-split the
         * member signed is theirs too, whoever submits it. An operator re-splitting for hardship,
         * unsigned (so never at a higher cost), is not held to these.
         */
        if (msg.sender == plan.member || signed) {
            if (arrearsOf(planId) > 0) revert TermIssuerBehindSchedule(plan.member);
            SplitLog storage log = splitLogs[planId];
            if (log.changes >= MAX_SPLIT_CHANGES) revert TermIssuerSplitLimitReached(planId);
            if (log.lastChangedAt != 0 && block.timestamp < log.lastChangedAt + plan.installmentLength) {
                revert TermIssuerSplitTooSoon(planId, log.lastChangedAt + plan.installmentLength);
            }
            log.changes += 1;
            log.lastChangedAt = uint64(block.timestamp);
        }

        /*
         * Anyone else's re-split -- the operator's, unsigned -- may only help the member (Phase 4,
         * H-B): never fewer installments than are left, never a higher installment, and it carries
         * no arrears in that were not already there. Shortening a plan the member did not sign
         * for would bring payments forward and could put them into default.
         */
        bool unsigned = msg.sender != plan.member && !signed;
        uint256 oldInstallment = plan.installmentAmount;
        if (unsigned) {
            uint256 dueNow = installmentsDue(planId);
            if (plan.installments > dueNow && installments < plan.installments - dueNow) {
                revert TermIssuerResplitShortens(planId);
            }
        }

        // Bring the plan current first, at the old rate, so the remainder being re-split is what is
        // really owed and nothing before now is charged at the new one.
        _materialiseCarry(planId);

        PlanPricing storage pricing = planPricing[planId];
        bool largeLoan;
        if (pricing.priced) {
            Quote memory q = _quote(
                plan.member,
                pricing.merchant,
                pricing.product,
                plan.principalOutstanding - carryOutstandingOf[planId],
                installments,
                plan.installmentLength,
                IOpenPrincipal(address(this)).openPrincipalOf(plan.member, pricing.product, planId)
            );
            largeLoan = q.largeTerm;
            uint256 oldRate = plan.index.ratePerCycle;
            uint256 due = installmentsDue(planId);
            uint256 remaining = plan.installments > due ? plan.installments - due : 0;
            bool costRises = q.rateBps > oldRate || (q.rateBps > 0 && installments > remaining);
            if (costRises && !signed) revert TermIssuerResplitNeedsSignature(planId);
            if (signed && signedRate != q.rateBps) {
                revert TermIssuerTermsMismatch(signedRate, q.rateBps, 0, 0);
            }
            pricing.free = q.free;
            pricing.subsidyBps = q.subsidyBps;
            plan.index.ratePerCycle = q.rateBps;
            emit PlanRepriced(planId, q.rateBps, q.free);
        }
        if (!isOfferedSplit(installments) && !(largeLoan && installments == CLEAR_CASH_SPLIT)) {
            revert TermIssuerSplitNotOffered(installments);
        }

        uint256 repaid = plan.repaid;
        uint256 behind = arrearsOf(planId);
        uint256 spread = plan.principalOutstanding - behind;

        plan.scheduleStart = uint64(block.timestamp);
        plan.scheduleFloor = repaid + behind;
        plan.scheduleBase = spread;
        plan.installments = installments;
        _fixSchedule(plan);
        if (unsigned && plan.installmentAmount > oldInstallment) revert TermIssuerResplitShortens(planId);

        emit PlanSplitChanged(planId, installments, spread, behind);
    }

    /// @notice pays back what a term default wrote off, to Lending Co., whose charge-off it was.
    /// @dev Anyone may pay for a member. Paying it all back is one way to term credit again.
    /// Section 13: the write-off is Lending Co.'s loss, so the recovery is its money, paid to its
    /// operating address. If the co-op's Credit Backstop covered the loss, Lending Co. pays it back
    /// itself with `deposit(RECOVERY)`; no credit path calls the Assurance contracts.
    function repayWrittenOff(address member, uint256 amount) external notNull(member) returns (uint256 pay) {
        uint256 outstanding = writtenOffOf[member] - recoveredOf[member];
        pay = amount < outstanding ? amount : outstanding;
        if (pay == 0) revert TermIssuerNothingToPay(type(uint256).max);
        address lender = stableCredit.lenderOperating();
        if (lender == address(0)) revert TermIssuerNothingToPay(type(uint256).max);
        SafeERC20Upgradeable.safeTransferFrom(stableCredit.reserveToken(), msg.sender, lender, pay);
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
        if (!repaid && !stableCredit.access().hasCreditRole(CREDIT_LIMITS_ROLE, msg.sender)) {
            revert TermIssuerNotReinstatable(member);
        }
        termSuspended[member] = false;
        emit TermReinstated(member);
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
}
