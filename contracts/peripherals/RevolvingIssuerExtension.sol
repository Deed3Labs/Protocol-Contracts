// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./RevolvingIssuerBase.sol";

/// @title RevolvingIssuerExtension
/// @notice The part of RevolvingIssuer that runs by delegatecall.
/// @dev Never called directly in production. RevolvingIssuer creates one in its constructor, pins it as
/// an immutable, and forwards these selectors to it, so this code runs against the RevolvingIssuer proxy's
/// storage with the original caller. Called directly it acts on its own empty storage, which it
/// never initializes.
contract RevolvingIssuerExtension is RevolvingIssuerBase {
    /// @notice what RevolvingIssuer's constructor checks before pinning this as its extension.
    function extensionKind() external pure returns (bytes32) {
        return keccak256("RevolvingIssuerExtension.v3");
    }

    using CarryIndex for CarryIndex.Index;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice records a card purchase outside the network as settled: the draw becomes debt.
    /// @dev Called once the card network has cleared the purchase, not at authorization. The
    /// amount is final then -- a tip added, a fuel pump's round number replaced, a void never
    /// reaching here at all -- so this is one write for one fact rather than a write and its
    /// corrections.
    ///
    /// The tiers are drawn here, cheapest first, the same as a spend on the ledger would draw them.
    /// That is what starts carry: carry accrues on a tier's position, so a purchase recorded on the
    /// ledger alone would be owed and never cost anything. Then the ledger records it the way it
    /// records a partner purchase, with the claim going to the float that paid the merchant.
    ///
    /// All or nothing. A purchase the line cannot hold reverts rather than drawing part of it,
    /// because the settlement is the member's whole purchase and a partial draw would record a
    /// different fact from the one that happened.
    /// @param ref the card issuer's transaction reference, hashed.
    /// @param member address whose line the purchase is drawn on.
    /// @param amount the settled amount, in ledger units.
    function settleCardSpend(bytes32 ref, address member, uint256 amount)
        external
        notNull(member)
    {
        if (!isCardSettler[_msgSender()]) revert RevolvingIssuerNotCardSettler(_msgSender());
        if (cardSettlementAccount == address(0)) revert RevolvingIssuerNoCardSettlementAccount();
        if (amount == 0) revert RevolvingIssuerCardAmountZero();
        // Once settled, always settled -- even after a full refund, which leaves the amount at zero
        // but must not let the same purchase be drawn again.
        if (cardSettlements[ref].member != address(0)) revert RevolvingIssuerCardAlreadySettled(ref);

        /*
         * Only what was approved, for whom it was approved (audit M-2). The authorization was
         * recorded when the card network asked, while the member was in good standing; a purchase
         * that clears after a freeze is still honoured, because it was approved before it. One in
         * default is not: a default ends the line. A per-purchase and a per-day cap bound what the
         * settler key can do even with authorizations it recorded itself (DFAL 10a: flagged for
         * counsel in the Phase 1 report).
         */
        CardAuthorization memory authorization = cardAuthorizations[ref];
        if (authorization.member != member) revert RevolvingIssuerCardNotAuthorized(ref, member);
        if (amount > authorization.amount) {
            revert RevolvingIssuerCardExceedsAuthorization(ref, amount, authorization.amount);
        }
        if (cardTxCap != 0 && amount > cardTxCap) revert RevolvingIssuerCardTxCap(amount, cardTxCap);
        // The card follows the current line (4c item 2): a default of an earlier line, settled
        // before the member was re-onboarded, does not stop this one.
        if (_computedDefault(member) || _defaultedOnCurrentLine(member)) {
            revert RevolvingIssuerMemberNotInGoodStanding(member);
        }
        _consumeDailyCap(cardSpendCap, "CARD", amount);
        _consumeMemberCardCap(member, amount);
        delete cardAuthorizations[ref];

        // Carry accrued since the last touch is part of what is owed; bring it on before measuring.
        _touch(member);

        // Card spending draws against Savings only as far as the member has authorized (12.7): the
        // Savings tier is narrowed to that for this draw, and the rest falls to the next tiers.
        uint256 savingsTier = type(uint256).max;
        uint256 savingsCap;
        uint256 savingsBefore;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tiers[i].kind == SAVINGS_KIND) {
                savingsTier = i;
                savingsCap = tierCapacity[member][i];
                savingsBefore = tierPrincipal[member][i];
                // Saturating: an unlimited allowance (type(uint256).max) narrows nothing, and
                // adding it to what is drawn must not overflow (Phase 4, L-A).
                uint256 allowance = savingsDrawAllowance[member];
                if (allowance < savingsCap && savingsBefore + allowance < savingsCap) {
                    tierCapacity[member][i] = savingsBefore + allowance;
                }
                break;
            }
        }

        // All or nothing: whatever the tiers cannot place reverts the whole settlement.
        uint256 unplaced = _draw(member, amount);
        if (unplaced > 0) revert RevolvingIssuerCardHeadroom(member, amount, amount - unplaced);
        if (savingsTier != type(uint256).max) {
            tierCapacity[member][savingsTier] = savingsCap;
            uint256 used = tierPrincipal[member][savingsTier] - savingsBefore;
            if (used > 0) {
                uint256 left = savingsDrawAllowance[member];
                if (left != type(uint256).max) savingsDrawAllowance[member] = left - used;
                emit SavingsDrawn(member, used, savingsDrawAllowance[member]);
            }
        }
        cardSettlements[ref] = CardSettlement({member: member, amount: amount});
        stableCredit.originatePurchase(
            member, amount, cardSettlementAccount, amount, cardSettlementAccount, 0
        );
        emit CardSpendSettled(ref, member, amount);
    }

    /// @notice records what the card issuer approved, at the moment it approved it.
    /// @dev Settlement may later draw up to this and no more (audit M-2). Refused for a member who
    /// is frozen, in default or has defaulted, or for more than their line could hold right now.
    /// @param ref the card issuer's transaction reference, hashed.
    /// @param member address whose line the purchase will draw on.
    /// @param amount the approved amount, in ledger units.
    function authorizeCardSpend(bytes32 ref, address member, uint256 amount)
        external
        notNull(member)
    {
        if (!isCardSettler[_msgSender()]) revert RevolvingIssuerNotCardSettler(_msgSender());
        if (amount == 0) revert RevolvingIssuerCardAmountZero();
        if (cardAuthorizations[ref].member != address(0) || cardSettlements[ref].member != address(0)) {
            revert RevolvingIssuerCardAlreadyAuthorized(ref);
        }
        if (isFrozen(member) || _computedDefault(member) || _defaultedOnCurrentLine(member)) {
            revert RevolvingIssuerMemberNotInGoodStanding(member);
        }
        if (cardTxCap != 0 && amount > cardTxCap) revert RevolvingIssuerCardTxCap(amount, cardTxCap);
        // What the line could hold right now, carry brought on first. Savings count only as far as
        // the member has authorized card draws against them (12.7), and not at all while an unpaid
        // Secured Minimum pauses secured draws (12.1).
        _touch(member);
        bool paused = _securedDrawPaused(member);
        uint256 headroom;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (!tiers[i].active || (paused && !_isUnsecured(i))) continue;
            uint256 room = _headroom(member, i, tierPrincipal[member][i]);
            if (tiers[i].kind == SAVINGS_KIND && room > savingsDrawAllowance[member]) room = savingsDrawAllowance[member];
            headroom += room;
        }
        if (headroom < amount) revert RevolvingIssuerCardHeadroom(member, amount, headroom);
        cardAuthorizations[ref] = CardAuthorization({member: member, amount: amount});
        emit CardAuthorized(ref, member, amount);
    }

    /// @notice gives back a settled card purchase, in whole or in part: a refund after clearing.
    /// @dev The inverse of `settleCardSpend`, and capital-free for the same reason a partner
    /// reversal is. The tiers are cleared dearest first, which is what any repayment does, and
    /// the ledger takes the claim back from the float.
    /// @param ref the card issuer's transaction reference, hashed.
    /// @param amount the amount given back, in ledger units.
    function reverseCardSpend(bytes32 ref, uint256 amount) external {
        if (!isCardSettler[_msgSender()]) revert RevolvingIssuerNotCardSettler(_msgSender());
        if (amount == 0) revert RevolvingIssuerCardAmountZero();
        CardSettlement memory settlement = cardSettlements[ref];
        if (settlement.member == address(0)) revert RevolvingIssuerCardNotSettled(ref);
        if (amount > settlement.amount) {
            revert RevolvingIssuerCardReversalExceedsSettlement(ref, amount, settlement.amount);
        }

        _touch(settlement.member);
        _repay(settlement.member, amount, type(uint256).max);
        cardSettlements[ref].amount = settlement.amount - amount;
        stableCredit.reversePurchase(
            settlement.member, amount, cardSettlementAccount, amount, cardSettlementAccount, 0
        );
        emit CardSpendReversed(ref, settlement.member, amount);
    }

    /// @notice clears card debt a member has repaid in fiat.
    /// @dev A card purchase was paid to the merchant in fiat, out of the co-op's float, and the
    /// matching claim was minted to that float at settlement. When the member repays in fiat the
    /// dollars go straight back into the float -- which is exactly the claim being satisfied. So
    /// nothing needs to move on chain to settle it: the float's claim is burned against the
    /// member's obligation, the same capital-free unwind a reversal is. The tiers are cleared
    /// dearest first, as any repayment clears them, and the carry that stops is the most it can be.
    ///
    /// On-ramping the fiat to pay this in reserve tokens would move money onto the chain only for
    /// it to be moved back off again to refill the float.
    ///
    /// Refuses rather than doing part: more than the member has drawn here would be clearing
    /// debt that lives somewhere else, and more than the float holds would hand the co-op an
    /// obligation instead of burning a claim.
    /// @param ref idempotency key for this repayment.
    /// @param member address whose card debt is cleared.
    /// @param amount the amount repaid, in ledger units.
    function repayCardSpend(bytes32 ref, address member, uint256 amount)
        external
        notNull(member)
    {
        if (!isCardSettler[_msgSender()]) revert RevolvingIssuerNotCardSettler(_msgSender());
        if (amount == 0) revert RevolvingIssuerCardAmountZero();
        if (cardRepayments[ref] != 0) revert RevolvingIssuerCardAlreadyRepaid(ref);

        _touch(member);
        uint256 principal = _totalPrincipal(member);
        if (amount > principal) revert RevolvingIssuerCardRepaymentExceedsDrawn(member, amount, principal);
        uint256 held = IERC20Upgradeable(address(stableCredit)).balanceOf(cardSettlementAccount);
        if (held < amount) revert RevolvingIssuerCardFloatCannotCover(amount, held);

        _repay(member, amount, type(uint256).max);
        cardRepayments[ref] = amount;
        stableCredit.reversePurchase(
            member, amount, cardSettlementAccount, amount, cardSettlementAccount, 0
        );
        emit CardSpendRepaid(ref, member, amount);
    }

    /// @notice settles a tier out of the collateral that was pledged against it.
    /// @dev Directed at one tier on purpose. An ordinary payment works down the rate bands,
    /// because a member paying something back should stop the most carry they can. Liquidated
    /// collateral is not that: it was pledged against a particular tier, and letting it settle a
    /// dearer one somewhere else would leave the tier it actually backed still drawn against a
    /// pledge that no longer exists.
    ///
    /// The caller delivers the reserve token first. Settling on the ledger is silent, so the
    /// waterfall is not told and cannot claim the payment a second time.
    /// @param member address whose tier is settled.
    /// @param tierId tier the collateral backed.
    /// @param amount amount of reserve token delivered.
    function settleFromCollateral(address member, uint256 tierId, uint256 amount)
        external
        onlyOperator
    {
        _requireTier(tierId);
        _touch(member);

        uint256 principal = tierPrincipal[member][tierId];
        uint256 pay = principal < amount ? principal : amount;
        if (pay == 0) return;

        IERC20Upgradeable reserve = stableCredit.reserveToken();
        reserve.safeTransferFrom(_msgSender(), address(this), pay);
        reserve.forceApprove(address(stableCredit), pay);
        stableCredit.repayCreditBalanceFor(address(this), member, uint128(pay));

        _repayTier(member, tierId, pay);
    }

    /// @notice adds a tier at the end of the draw order.
    /// @dev Rates must ascend. Yield-bearing collateral has to cost more than it yields, and a
    /// tier that is cheaper than the one before it would be drawn last while costing least --
    /// the waterfall would have to be enforced separately instead of falling out of the order.
    /// @param kind tier kind, from ExposureMath.
    /// @param ratePerCycle carry rate per cycle in basis points.
    /// @param cycleLength_ seconds in a cycle. Must match the network's, and sets it when first.
    function addTier(bytes32 kind, uint256 ratePerCycle, uint64 cycleLength_)
        external
        onlyCreditRole(CREDIT_SETTINGS_ROLE)
        returns (uint256 tierId)
    {
        if (tiers.length > 0) {
            uint256 previous = tiers[tiers.length - 1].index.ratePerCycle;
            if (ratePerCycle < previous) {
                revert RevolvingIssuerRatesMustAscend(previous, ratePerCycle);
            }
        }
        // Every tier shares one clock. Two tiers accruing on different periods would make
        // "cheapest first" meaningless, because the rates would stop being comparable and draw
        // order is priced off exactly that comparison.
        if (tiers.length > 0 && cycleLength_ != tiers[0].index.cycleLength) {
            revert RevolvingIssuerCycleMismatch(tiers[0].index.cycleLength, cycleLength_);
        }

        tierId = tiers.length;
        tiers.push();
        TierConfig storage tier = tiers[tierId];
        tier.kind = kind;
        tier.active = true;
        tier.index.init(ratePerCycle, cycleLength_, uint64(block.timestamp));
        localAccAt[tierId] = uint64(block.timestamp);
        emit TierAdded(tierId, kind, ratePerCycle);
    }

    /// @notice changes a tier's rate from now on.
    /// @dev Checkpoints the index, so the new rate never reaches carry already accrued at the old
    /// one. The ascending order still has to hold afterwards, in both directions.
    function setTierRate(uint256 tierId, uint256 ratePerCycle) external onlyCreditRole(CREDIT_SETTINGS_ROLE) {
        _requireTier(tierId);
        if (tierId > 0) {
            uint256 previous = tiers[tierId - 1].index.ratePerCycle;
            if (ratePerCycle < previous) {
                revert RevolvingIssuerRatesMustAscend(previous, ratePerCycle);
            }
        }
        if (tierId + 1 < tiers.length) {
            uint256 next = tiers[tierId + 1].index.ratePerCycle;
            if (ratePerCycle > next) revert RevolvingIssuerRatesMustAscend(ratePerCycle, next);
        }
        // Bring the tier's own accumulator to now at the old rate first (spec item 3: a new rate
        // only ever applies going forward).
        localAcc[tierId] = _localAcc(tierId);
        localAccAt[tierId] = uint64(block.timestamp);
        tiers[tierId].index.setRate(ratePerCycle, block.timestamp);
        emit TierRateUpdated(tierId, ratePerCycle);
    }

    /// @notice opens a member's line with a starting ceiling in each tier.
    /// @dev Cycles are calendar months (12.1, Addendum 2): each ends at 23:59:59 Pacific on the
    /// member's Cycle End Day, and the first on the first such day at least 14 days from now. The
    /// day is the member's choice at opening; zero takes the default (the day before today, or the
    /// 28th). Automatic Clearing is set separately, from the member's own choice and signature.
    /// @param member address of the member.
    /// @param capacities ceiling contribution per tier, in tier order.
    /// @param cycleEndDay the member's Cycle End Day (1-28), or zero for the default.
    function openLine(
        address member,
        uint256[] calldata capacities,
        uint8 cycleEndDay
    ) external onlyCreditRole(CREDIT_LINES_ROLE) notNull(member) {
        // Only a member with no live line: reopening one would restart its clock and its dues,
        // which no role may do (12.1). A default deletes the period, so re-onboarding still works.
        if (inInitializedPeriod(member)) revert RevolvingIssuerCyclesComputed();
        if (cycleEndDay > 28) revert RevolvingIssuerBadCycleDay(cycleEndDay);
        // 4c item 3: re-onboarding waits until collateral pledged against an earlier default has
        // been applied, so a new line can never cut that recovery short.
        if (_defaultedOnCurrentLine(member) && address(exposureSource) != address(0)) {
            for (uint256 i = 0; i < tiers.length; i++) {
                if (_isUnsecured(i) || tierPrincipal[member][i] == 0) continue;
                (bool ok, bytes memory data) = address(exposureSource).staticcall(
                    abi.encodeWithSignature("collateralValueOf(address,bytes32)", member, tiers[i].kind)
                );
                if (ok && data.length >= 32 && abi.decode(data, (uint256)) != 0) {
                    revert RevolvingIssuerDefaultCollateralUnapplied(member);
                }
            }
        }
        // State gate (spec item 9): no line for a member with no attested state, or in a state
        // where the revolving product is not enabled.
        if (address(rateSchedule) != address(0)) {
            bytes32 state = _stateOf(member);
            if (state == bytes32(0) || !rateSchedule.isEnabled(state, ceilingProduct)) {
                revert RevolvingIssuerStateNotEnabled(member, state);
            }
        }
        uint256 total;
        uint256 increase;
        for (uint256 i = 0; i < capacities.length && i < tiers.length; i++) {
            uint256 previous = tierCapacity[member][i];
            if (capacities[i] > previous) increase += capacities[i] - previous;
            tierCapacity[member][i] = capacities[i];
            total += capacities[i];
            emit TierCapacityUpdated(member, i, capacities[i]);
        }
        _checkCreditCaps(member);
        // Opening a line is new credit like any other limit raised (audit H-4).
        _consumeDailyCap(capacityIncreaseCap, "CAPACITY", increase);
        stableCredit.createCreditLine(member, total, 0);
        uint8 day = cycleEndDay != 0 ? cycleEndDay : PacificCalendar.defaultDay(block.timestamp);
        uint64 firstEnd = uint64(PacificCalendar.endOnOrAfter(block.timestamp + 14 days, day));
        CycleState storage s = cycleState[member];
        // A fresh clock and no dues; the Automatic Clearing choice and hybridMode are the member's
        // and stay as they set them.
        s.cycleEnd = firstEnd;
        s.cycleEndDay = day;
        s.closedAt = 0;
        s.rebalanceAmount = 0;
        s.securedMinimum = 0;
        s.paidSinceClose = 0;
        s.securedPastDue = 0;
        s.pastDueSM = 0;
        s.cureAmount = 0;
        s.noticeProposer = address(0);
        cycleOf[member].cureNoticeAt = 0;
        _updateCreditPeriod(member, firstEnd, 0);
        emit CycleEndDaySet(member, day, firstEnd);
        // A new line starts a new default episode (Phase 4b, M-C): a default recorded before now
        // stays on record, but no longer lets anyone liquidate this line.
        lineOpenedAt[member] = uint64(block.timestamp);
    }

    /// @dev 4c item 1: today's card settlements for one member, against the governed per-member cap,
    /// so the settler key's reach over any one member is bounded. Zero means not set.
    function _consumeMemberCardCap(address member, uint256 amount) private {
        uint256 cap = dueTerms.cardMemberDailyCap;
        if (cap == 0) return;
        CycleState storage s = cycleState[member];
        uint64 today = uint64(block.timestamp / 1 days);
        uint256 used = s.cardDay == today ? s.cardUsed : 0;
        if (used + amount > cap) revert RevolvingIssuerCardMemberDailyCap(member, amount, cap > used ? cap - used : 0);
        s.cardDay = today;
        s.cardUsed = uint128(used + amount);
    }

    /// @notice names the CLRUSD token whose lock a Savings draw refreshes (Phase 4b, L-B).
    /// @dev The owner's (the credit timelock after the handover), and set once: every Savings draw
    /// calls it and reverts if it reverts, so pointing it elsewhere later would be a way to stop
    /// Savings draws, or to call arbitrary code on them. Changing it takes an upgrade, which is the
    /// owner's power already, so this adds none.
    function setClrusdToken(address token) external onlyOwner {
        if (token == address(0) || clrusdToken != address(0)) revert RevolvingIssuerClrusdSet();
        clrusdToken = token;
        emit ClrusdTokenSet(token);
    }
}
