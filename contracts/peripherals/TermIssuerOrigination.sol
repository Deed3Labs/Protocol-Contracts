// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./TermIssuerBase.sol";

/// @title TermIssuerOrigination
/// @notice Where a term plan is opened: signature check, on-chain pricing and the origination mint.
/// @dev The second of TermIssuer's delegatecall extensions, for the same reason as the first: the
/// compliance pricing (spec items 5-9) would not fit under the 24 KiB limit in one contract.
/// Never called directly in production; TermIssuer creates one in its constructor, pins it as an
/// immutable and forwards `openPlan` to it, so this code runs against the TermIssuer proxy's
/// storage with the original caller.
contract TermIssuerOrigination is TermIssuerBase {
    /// @notice what TermIssuer's constructor checks before pinning this module.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("TermIssuerOrigination.v1");
    }

    using CarryIndex for CarryIndex.Index;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice opens a term plan against a partner purchase, on terms the member signed.
    /// @dev The purchase is a three-party mint that nets to zero: the member is debited, the
    /// merchant is credited the payout, and the co-op is credited the discount. StableCredit
    /// asserts the netting.
    ///
    /// The operator submits; the member decides (audit H-4). Without the member's signature an
    /// operator key could open a plan for anyone, naming itself the merchant and the payout the
    /// whole purchase. EIP-1271 signatures are accepted, so a smart wallet can sign. The merchant
    /// must be registered and active, and every plan counts against today's cap.
    /// @param terms the plan terms, as the member signed them.
    /// @param signature the member's EIP-712 signature over `terms` at their current nonce.
    /// @return planId the new plan's id.
    function openPlan(PlanTerms calldata terms, bytes calldata signature)
        external
        onlyCreditRole(CREDIT_LINES_ROLE)
        notNull(terms.member)
        returns (uint256 planId)
    {
        address member = terms.member;
        uint256 purchase = terms.purchase;
        if (block.timestamp > terms.deadline) revert TermIssuerSignatureExpired(terms.deadline);
        if (!SignatureChecker.isValidSignatureNow(member, _planTermsDigest(terms), signature)) {
            revert TermIssuerBadSignature(member);
        }
        uint256 nonce = planNonces[member]++;
        if (!stableCredit.isActiveMerchant(terms.merchant)) {
            revert TermIssuerMerchantNotActive(terms.merchant);
        }
        if (terms.installmentLength == 0 || purchase == 0) revert TermIssuerInvalidSchedule();
        if (terms.payout > purchase) revert TermIssuerInvalidSchedule();

        /*
         * Priced on chain (spec items 5-9): the state gate, the free rules, min(list, cap) less the
         * merchant's subsidy, and the merchant's discount for this split. The member signed the
         * rate and payout they were shown, and both must be what the chain computes -- a
         * disclosure that differs from what is charged is not a disclosure.
         */
        PlanPricing memory pricing;
        uint256 rateBps = terms.ratePerCycle;
        bool largeLoan;
        if (address(rateSchedule) != address(0)) {
            Quote memory q = _quote(
                member, terms.merchant, terms.productId, purchase, terms.installments, terms.installmentLength,
                IOpenPrincipal(address(this)).openPrincipalOf(member, terms.productId, type(uint256).max)
            );
            if (q.rateBps != terms.ratePerCycle || q.payout != terms.payout) {
                revert TermIssuerTermsMismatch(terms.ratePerCycle, q.rateBps, terms.payout, q.payout);
            }
            rateBps = q.rateBps;
            largeLoan = q.largeTerm;
            pricing = PlanPricing({
                state: q.state,
                product: terms.productId,
                merchant: terms.merchant,
                subsidyBps: q.subsidyBps,
                free: q.free,
                priced: true,
                accruedAt: 0,
                payout: 0,
                refundTermsRecorded: false
            });
        } else {
            pricing.merchant = terms.merchant;
            pricing.free = rateBps == 0;
        }
        // What a refund will take back, and from whom (Phase 4, H-A).
        pricing.payout = uint128(terms.payout);
        pricing.refundTermsRecorded = true;
        // The 13-cycle option exists for large loans only (DECISIONS #4).
        if (!isOfferedSplit(terms.installments) && !(largeLoan && terms.installments == CLEAR_CASH_SPLIT)) {
            revert TermIssuerSplitNotOffered(terms.installments);
        }
        // Behind on one plan freezes new ones: term credit, not the card, and only until caught up.
        if (termSuspended[member]) revert TermIssuerSuspended(member);
        if (totalArrearsOf(member) > 0) revert TermIssuerBehindSchedule(member);

        uint256 wouldOwe = totalPrincipalOf(member) + purchase;
        if (wouldOwe > termLimitOf[member]) {
            revert TermIssuerExceedsTermLimit(member, wouldOwe, termLimitOf[member]);
        }
        _consumeDailyCap(planTotalCap, "PLANS", purchase);

        planId = plans.length;
        plans.push();
        Plan storage plan = plans[planId];
        plan.member = member;
        plan.principal = purchase;
        plan.principalOutstanding = purchase;
        plan.openedAt = uint64(block.timestamp);
        plan.installments = terms.installments;
        plan.installmentLength = terms.installmentLength;
        plan.scheduleStart = uint64(block.timestamp);
        plan.scheduleBase = purchase;
        plan.scheduleFloor = 0;
        // The index now only records the plan's scheduled rate (repayment order and the schedule);
        // carry itself accrues per second through `_materialiseCarry`.
        plan.index.init(rateBps, terms.installmentLength, uint64(block.timestamp));
        pricing.accruedAt = uint64(block.timestamp);
        planPricing[planId] = pricing;
        if (pricing.priced) planSnap[planId] = rateSchedule.snapshot(pricing.state, pricing.product);
        _fixSchedule(plan);
        memberPlans[member].push(planId);
        _trackOpen(member, planId);

        stableCredit.originatePurchase(
            member, purchase, terms.merchant, terms.payout, _feeRecipient(), purchase - terms.payout
        );
        emit PlanOpened(
            planId,
            member,
            terms.merchant,
            purchase,
            terms.installments,
            rateBps,
            keccak256(
                abi.encode(planId, terms.installments, terms.installmentLength, plan.scheduleStart, purchase, rateBps)
            ),
            plan.scheduleTotal - purchase,
            terms.disclosureHash
        );
        emit PlanTermsSigned(planId, member, terms.disclosureHash, nonce);
    }
}
