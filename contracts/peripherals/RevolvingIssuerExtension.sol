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
        return keccak256("RevolvingIssuerExtension.v5");
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
    function settleCardSpend(bytes32 ref, address member, uint256 amount) external {
        _settleCard(ref, member, amount, 0);
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
    ///
    /// A card credit fee (decision 55) is kept on a partial refund. The reversal that brings the
    /// purchase to zero also credits back whatever is left of it, once, the way
    /// `returnCardCreditFee` does.
    /// @param ref the card issuer's transaction reference, hashed.
    /// @param amount the amount given back, in ledger units, without the fee.
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
        // A full refund credits back what is left of the fee. First, so the fee's claim is taken back
        // from the card settlement account before the purchase's reversal draws that account down.
        CardCreditFee storage charged = _cardFee().feeOf[ref];
        if (amount == settlement.amount && charged.fee > charged.returned) {
            _returnCardFee(ref, settlement.member, charged, charged.fee - charged.returned);
        }
        stableCredit.reversePurchase(
            settlement.member, amount, cardSettlementAccount, amount, cardSettlementAccount, 0
        );
        emit CardSpendReversed(ref, settlement.member, amount);
    }

    /// @notice credits back part or all of a settled purchase's card credit fee (decision 55): what
    /// a cycle statement credits when carry and the fee together would pass the CFL maximum (MB-04
    /// §5.4(f)).
    /// @dev Card settler only. The fee's own three-party entry reversed for `amount`: the tiers
    /// release it dearest first and the ledger takes that much of the fee's claim back from the card
    /// settlement account. At most what is left of the fee; a full refund later credits only the
    /// rest. Not bounded by `maxCardCreditFee`, so switching the fee off never holds up a credit.
    /// @param ref the card issuer's transaction reference, hashed.
    /// @param amount how much of the fee to credit back, in ledger units.
    function returnCardCreditFee(bytes32 ref, uint256 amount) external {
        if (!isCardSettler[_msgSender()]) revert RevolvingIssuerNotCardSettler(_msgSender());
        if (amount == 0) revert RevolvingIssuerCardAmountZero();
        address member = cardSettlements[ref].member;
        if (member == address(0)) revert RevolvingIssuerCardNotSettled(ref);
        CardCreditFee storage charged = _cardFee().feeOf[ref];
        uint256 left = charged.fee - charged.returned;
        if (amount > left) revert RevolvingIssuerCardFeeReturnExceedsLeft(ref, amount, left);
        _touch(member);
        _returnCardFee(ref, member, charged, amount);
    }

    /// @dev Credits `amount` of a purchase's fee back: tiers dearest first, then the ledger's
    /// three-party reversal with the fee as its only leg. The caller has brought carry on.
    function _returnCardFee(bytes32 ref, address member, CardCreditFee storage charged, uint256 amount) private {
        charged.returned += uint128(amount);
        _repay(member, amount, type(uint256).max);
        stableCredit.reversePurchase(member, amount, cardSettlementAccount, 0, cardSettlementAccount, amount);
        emit CardCreditFeeReturned(ref, member, amount);
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

        // Collateral applied to the debt is not a cure of the default it enforces (12.5).
        _repayTier(member, tierId, pay, false);
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
        if (kind == WORKOUT_KIND) {
            // The workout plan's position (12.18): one, at a fixed 0%, outside the draw order.
            for (uint256 i = 0; i < tiers.length; i++) {
                if (tiers[i].kind == WORKOUT_KIND) ratePerCycle = 1;
            }
            if (ratePerCycle != 0) revert RevolvingIssuerWorkoutTerms(0, 0);
        } else {
            (bool found, uint256 previous) = _neighbourRate(tiers.length, false);
            if (found && ratePerCycle < previous) revert RevolvingIssuerRatesMustAscend(previous, ratePerCycle);
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
        // The workout plan's position stays at 0% (12.18), and is left out of the order.
        if (tiers[tierId].kind == WORKOUT_KIND) revert RevolvingIssuerWorkoutTerms(0, 0);
        (bool found, uint256 previous) = _neighbourRate(tierId, false);
        if (found && ratePerCycle < previous) revert RevolvingIssuerRatesMustAscend(previous, ratePerCycle);
        uint256 next;
        (found, next) = _neighbourRate(tierId, true);
        if (found && ratePerCycle > next) revert RevolvingIssuerRatesMustAscend(ratePerCycle, next);
        // Bring the tier's own accumulator to now at the old rate first (spec item 3: a new rate
        // only ever applies going forward).
        localAcc[tierId] = _localAcc(tierId);
        localAccAt[tierId] = uint64(block.timestamp);
        tiers[tierId].index.setRate(ratePerCycle, block.timestamp);
        emit TierRateUpdated(tierId, ratePerCycle);
    }

    /// @dev The rate of the nearest tier below `tierId` (or above it, when `up`) other than the
    /// workout plan's, and whether there is one.
    function _neighbourRate(uint256 tierId, bool up) private view returns (bool, uint256) {
        uint256 i = tierId;
        while (up ? i + 1 < tiers.length : i > 0) {
            i = up ? i + 1 : i - 1;
            if (tiers[i].kind != WORKOUT_KIND) return (true, tiers[i].index.ratePerCycle);
        }
        return (false, 0);
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

    /// @notice Automatic Clearing (12.2): records a deposit that landed in the member's Spendable at
    /// the bank as a repayment, at the level the member chose.
    /// @dev The settler delivers the cash; nothing is taken from the member's wallet, so Ready to
    /// allocate USDC and CLRUSD are never swept. Refused while the member is in hybridMode (the only
    /// thing that switches clearing off besides the member), for a deposit from an excluded payer
    /// (federal benefits unless the member removed them), and once per ref.
    ///
    /// UNSECURED (the default) clears Boost and income-backed, then any unpaid Secured Minimum, and
    /// stops. DUE_ONLY clears exactly the unpaid Rebalance Amount and any unpaid Secured Minimum.
    /// EVERYTHING clears every tier. Within each, dearest first by what each tier costs now (4c
    /// item 7). What is not applied stays in Spendable.
    /// @param ref idempotency key.
    /// @param member address being repaid for.
    /// @param amount the deposit available to clear, in ledger units.
    /// @param payer the deposit's originator (hashed ACH company id), checked against exclusions.
    function repayForMember(bytes32 ref, address member, uint256 amount, bytes32 payer) external notNull(member) {
        if (!isCardSettler[_msgSender()]) revert RevolvingIssuerNotCardSettler(_msgSender());
        if (!autoRepayEnabled[member]) revert RevolvingIssuerAutoRepayNotEnabled(member);
        if (cycleState[member].hybridMode) revert RevolvingIssuerHybridMode(member);
        if (_payerExcluded(member, payer)) revert RevolvingIssuerExcludedPayer(member, payer);
        if (amount == 0) revert RevolvingIssuerCardAmountZero();
        if (autoRepayments[ref] != 0) revert RevolvingIssuerAutoRepayAlreadyUsed(ref);

        _touch(member);
        uint8 level = autoClearScopeOf[member];
        uint256 unsecuredMask = _tierMask(true);
        uint256 first;
        uint256 second;
        if (level == SCOPE_ALL) {
            first = _min(amount, _totalPrincipal(member));
        } else {
            (uint256 owedUnsecured, uint256 owedSecured) = _owedBySide(member);
            (uint256 dueU, uint256 dueT) = _dues(member);
            first = _min(amount, owedUnsecured);
            if (level == LEVEL_DUE_ONLY) first = _min(first, dueU);
            // What the first part leaves of the Secured Minimum: every due figure falls with it.
            uint256 leftU = dueU > first ? dueU - first : 0;
            uint256 leftT = dueT > first ? dueT - first : 0;
            second = _min(_min(amount - first, leftT - leftU), owedSecured);
        }
        uint256 applied = first + second;
        if (applied == 0) revert RevolvingIssuerNothingToClear(member);
        autoRepayments[ref] = applied;

        IERC20Upgradeable reserve = stableCredit.reserveToken();
        reserve.safeTransferFrom(_msgSender(), address(this), applied);
        reserve.forceApprove(address(stableCredit), applied);
        stableCredit.repayCreditBalanceFor(address(this), member, uint128(applied));

        if (level == SCOPE_ALL) {
            _repay(member, first, type(uint256).max);
        } else {
            _repay(member, first, unsecuredMask);
            _repay(member, second, ~unsecuredMask);
        }
        emit AutoRepaid(ref, member, applied);
        emit AutoCleared(ref, member, applied, amount - applied);
    }

    /// @dev What the member owes on the unsecured tiers and on the rest.
    function _owedBySide(address member) private view returns (uint256 unsecured, uint256 secured) {
        for (uint256 i = 0; i < tiers.length; i++) {
            if (_isUnsecured(i)) unsecured += tierPrincipal[member][i];
            else secured += tierPrincipal[member][i];
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
