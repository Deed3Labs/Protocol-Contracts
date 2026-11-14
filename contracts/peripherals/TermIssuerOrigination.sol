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
    /// merchant is credited the payout, and Clear Lending's `feeRecipient` is credited the fee
    /// (12.16, Addendum 2: the third leg no longer goes to the co-op). The fee is the merchant's
    /// discount for the split, capped at $50 up to $2,500 and $75 above; it is never charged to
    /// the member, and the merchant is paid the amount less the fee. StableCredit asserts the
    /// netting.
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
                refundTermsRecorded: false,
                feeTo: address(0)
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
        // The member's other plans come to now first: a new plan changes how the Combined Ceiling
        // (12.3) is shared from this moment, never before it.
        IOpenPrincipal(address(this)).materialiseMember(member);
        // 12.16: the third leg goes to Clear Lending's fee recipient, never to the co-op.
        uint256 fee = purchase - terms.payout;
        address feeTo = feeRecipient;
        if (fee != 0 && feeTo == address(0)) revert TermIssuerNoFeeRecipient();
        pricing.feeTo = feeTo;

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

        stableCredit.originatePurchase(member, purchase, terms.merchant, terms.payout, feeTo, fee);
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

    /* ---- 12.16: the fee recipient and the fee cap (Phase 2e) ---- */

    /// @notice proposes a new fee recipient: Clear Lending's own multisig, or an account Clear
    /// Financial holds as its agent. A different signer approves it.
    function proposeFeeRecipient(address recipient, bytes32 reasonCode) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        _checkFeeRecipient(recipient);
        feeRecipientProposal = FeeRecipientProposal({recipient: recipient, proposer: _msgSender(), reasonCode: reasonCode});
        emit FeeRecipientProposed(recipient, reasonCode, _msgSender());
    }

    /// @notice approves the pending proposal (the same recipient and reason). Applies to charges
    /// from now on; a refund of an earlier charge still reverses from where its fee went.
    function approveFeeRecipient(address recipient, bytes32 reasonCode) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        FeeRecipientProposal memory p = feeRecipientProposal;
        if (p.proposer == address(0) || p.recipient != recipient || p.reasonCode != reasonCode) {
            revert TermIssuerNoProposal();
        }
        if (p.proposer == _msgSender()) revert TermIssuerSameSigner(p.proposer);
        _checkFeeRecipient(recipient);
        delete feeRecipientProposal;
        emit FeeRecipientChanged(feeRecipient, recipient, reasonCode, p.proposer, _msgSender());
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    /// @dev Never zero and never a Clear Collective address this issuer knows: the co-op treasury
    /// carry is minted to.
    function _checkFeeRecipient(address recipient) private view {
        if (recipient == address(0) || recipient == carryTreasury) revert TermIssuerFeeRecipientNotAllowed(recipient);
    }

    /// @notice sets the fee cap: $50 up to $2,500, $75 above (governed).
    function setFeeTerms(uint64 maxFeeSmall, uint64 maxFeeLarge, uint64 largeFrom) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        feeTerms = FeeTerms({maxFeeSmall: maxFeeSmall, maxFeeLarge: maxFeeLarge, largeFrom: largeFrom});
        emit FeeTermsUpdated(maxFeeSmall, maxFeeLarge, largeFrom);
    }

    /// @notice names the revolving line and the graduated-schedule product of the Combined Ceiling
    /// (12.3). Set once: the ceiling is permanent.
    function setCombinedCeiling(address revolving, bytes32 product) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        if (combinedProduct != bytes32(0) || product == bytes32(0)) revert TermIssuerCombinedSet();
        combinedRevolving = revolving;
        combinedProduct = product;
        emit CombinedCeilingSet(revolving, product);
    }

    /* ---- settings moved here from TermIssuer in Phase 2e, for room ---- */

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

    /// @notice moves the co-op treasury.
    function setCarryTreasury(address treasury) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        if (treasury == address(0)) revert TermIssuerNoCarryRecipient();
        carryTreasury = treasury;
        emit CarryTreasuryUpdated(treasury);
    }

    /// @notice names the RateSchedule plans are priced from. Set once (Phase 4, M-B): a priced
    /// plan holds the schedule's accumulator snapshots, and another schedule's numbers would not
    /// compare with them. The schedule upgrades in place behind the credit timelock instead.
    function setRateSchedule(address rateSchedule_) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        if (address(rateSchedule) != address(0) && address(rateSchedule) != rateSchedule_) {
            revert TermIssuerRateScheduleSet();
        }
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

    /// @notice names the revolving line whose mandate and settlers a mandated collection honours.
    function setMandateSource(address source) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        mandateSource = source;
        emit MandateSourceUpdated(source);
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
}
