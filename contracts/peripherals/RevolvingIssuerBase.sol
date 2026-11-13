// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./IExtensionKind.sol";
import "./CreditIssuer.sol";
import "../libraries/CarryIndex.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../libraries/ExposureMath.sol";
import "../core/interfaces/stable-credit/ICreditPositionSource.sol";
import "../core/interfaces/stable-credit/IExposureSource.sol";
import "./RateSchedule.sol";

/// @title RevolvingIssuerBase
/// @notice Everything RevolvingIssuer and RevolvingIssuerExtension share: storage, events, errors and internals.
/// @dev RevolvingIssuer outgrew the 24 KiB contract size limit, so some of its functions run in
/// RevolvingIssuerExtension by delegatecall. Both inherit this contract and declare no storage of their
/// own, so they read and write the same slots in the same order. Never add a state variable to
/// either child.
abstract contract RevolvingIssuerBase is CreditIssuer {
    using CarryIndex for CarryIndex.Index;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== STATE VARIABLES ========== */

    struct TierConfig {
        bytes32 kind;
        CarryIndex.Index index;
        bool active;
    }

    /// @dev Ordered cheapest first. Position in this array is the draw order.
    TierConfig[] internal tiers;

    /// @dev member => tier => ceiling contribution
    mapping(address => mapping(uint256 => uint256)) internal tierCapacity;
    /// @dev member => tier => index-relative amount owed
    mapping(address => mapping(uint256 => uint256)) internal tierNormalized;
    /// @dev member => tier => principal drawn, carry excluded
    mapping(address => mapping(uint256 => uint256)) internal tierPrincipal;

    /// @notice The co-op's treasury, and the terminal fallback for carry.
    /// @dev Set at initialization and never allowed to be empty. Carry is accrued on every
    /// interaction, so a recipient that cannot be resolved does not merely lose the carry -- it
    /// reverts the transfer that triggered the accrual, and members stop being able to spend.
    /// A backstop that is always set means the worst case is carry landing somewhere it can be
    /// redistributed from by hand, rather than the line seizing up.
    address public carryTreasury;
    /// @dev tier => recipient, falling back to the treasury when unset.
    /// @dev A tier funded from somewhere else names it here: the LendingPool funds the unsecured
    /// tiers, and the carry on those is owed to the depositors whose money was lent rather than
    /// to the co-op. Clearing it back to zero returns the tier to the treasury, which is how a
    /// pool is retired without stranding the carry that accrues in the meantime.
    mapping(uint256 => address) internal tierCarryRecipient;

    /// @notice Reports how much of a member's debt no collateral stands behind.
    /// @dev Optional. Unset, a default writes off the whole position, which is right only when
    /// nothing was pledged.
    IExposureSource public exposureSource;

    /// @notice where a card purchase's claim is minted when it settles: the co-op's card float.
    /// @dev A swipe at a merchant outside the network is paid by the card issuer in fiat, from the
    /// co-op's float, at clearing. The member's obligation is created then, and the matching claim
    /// belongs to the float that paid -- one fixed address, set by an operator, so a settler key
    /// cannot mint claims to anyone it likes.
    address public cardSettlementAccount;
    /// @notice keys allowed to record a card purchase as settled.
    mapping(address => bool) public isCardSettler;

    /// @dev What a settled card purchase put on a member's line, by the issuer's transaction ref.
    struct CardSettlement {
        address member;
        uint256 amount;
    }
    /// @dev ref => settlement. The ref makes settling idempotent: a retried or redelivered
    /// settlement cannot draw twice for one purchase.
    mapping(bytes32 => CardSettlement) internal cardSettlements;

    /// @dev ref => amount cleared by a fiat repayment. Keyed like settlements, so a repayment
    /// recorded twice -- a retry, or two processes deciding at once -- clears once.
    mapping(bytes32 => uint256) internal cardRepayments;

    /// @notice members who have asked for their USDC deposits to repay their card debt.
    /// @dev Set by the member, never by anyone else. It is the mandate: the card settler can pull a
    /// member's USDC to repay only while this is on, and the member turns it off the same way.
    mapping(address => bool) public autoRepayEnabled;
    /// @dev ref => amount repaid under the mandate. Once per ref, like every other card write.
    mapping(bytes32 => uint256) internal autoRepayments;

    /// @notice Today's budget for new revolving capacity, across every member (audit H-4).
    DailyCap internal capacityIncreaseCap;

    /// @dev What the card issuer approved, recorded when it approved it (audit M-2).
    struct CardAuthorization {
        address member;
        uint256 amount;
    }
    /// @dev ref => authorization. Settlement may not exceed it.
    mapping(bytes32 => CardAuthorization) internal cardAuthorizations;
    /// @notice The most one card purchase may settle for. Zero means no cap has been set.
    uint256 public cardTxCap;
    /// @notice Today's budget for card settlements, across every member.
    DailyCap internal cardSpendCap;

    /// @dev Eight slots from the gap: capacityIncreaseCap (3), cardAuthorizations, cardTxCap,
    /// cardSpendCap (3).

    /* ---- Phase 2: compliance pricing (spec items 2-4) ---- */

    /// @notice Where unsecured tiers are priced, by the member's state.
    RateSchedule public rateSchedule;
    /// @notice tier => RateSchedule product it is priced as. Zero means the tier's own rate
    /// (savings- and asset-backed tiers). Set once per tier.
    mapping(uint256 => bytes32) public tierProduct;
    /// @notice The product whose graduated schedule bounds a member's unsecured carry as one loan.
    bytes32 public ceilingProduct;
    /// @dev member => tier => the part of `tierPrincipal` that is unpaid carry. Carry accrues only
    /// on the rest (spec item 2).
    mapping(address => mapping(uint256 => uint256)) internal tierCarry;
    /// @dev member => tier => accumulator value at the last touch.
    mapping(address => mapping(uint256 => uint256)) internal tierSnap;
    /// @dev member => ceiling product accumulators at the last touch.
    mapping(address => RateSchedule.Snapshot) internal ceilingSnap;
    /// @dev member => the state the snapshots above were taken under.
    mapping(address => bytes32) internal snapState;
    /// @dev tier => cumulative accumulator of the tier's own rate, and when it was last brought
    /// forward. Checkpointed on every rate change, so a new rate never reaches back.
    mapping(uint256 => uint256) internal localAcc;
    mapping(uint256 => uint64) internal localAccAt;

    /// @dev Nine slots from the gap for the block above.

    /* ---- Phase 2b: credit agreements (section 12) ---- */

    /// @notice A member's record of judged cycles (12.4, 12.5).
    /// @param missedInRow consecutive cycles that ended without the required rebalance.
    /// @param cleanStreak consecutive Clean Cycles (rebalanced by the due date, or none due).
    /// @param depositBits the last six cycles, one bit each, newest lowest: an ESA deposit in it.
    /// @param cureNoticeAt when the chain dated the cure notice (second miss in a row); zero if none.
    /// @param unsecuredCeiling the halved unsecured limit after a miss; zero when not halved.
    struct CycleRecord {
        uint8 missedInRow;
        uint8 cleanStreak;
        uint8 depositBits;
        uint64 cureNoticeAt;
        uint128 unsecuredCeiling;
    }
    mapping(address => CycleRecord) public cycleOf;

    /// @notice Governed terms of the Clear Credit Agreement (section 12). Zero means not enforced.
    struct CreditTerms {
        uint128 unsecuredLineCap; // income-backed + Boost capacity, together (12.3: $2,499)
        uint64 cureWindow; // after the cure notice, before default (12.5: 15 days)
        uint8 boostCleanCycles; // consecutive Clean Cycles to earn the higher Boost cap (12.4: 6)
        uint8 boostDepositCycles; // of the last six cycles, how many need an ESA deposit (12.4: 5)
        bool autoClearOffGlobal; // 12.2: auto-clear switched off network-wide (default on)
    }
    CreditTerms public creditTerms;
    /// @notice Boost cap before and after it is earned (12.4: $500 and $750).
    uint128 public boostBaseCap;
    uint128 public boostEarnedCap;
    /// @notice Where a member's last ESA deposit is read (ESADepositVault.lastDepositAt).
    address public depositSource;
    /// @notice member => what automatic clearing covers: 0 = income-backed and Boost only
    /// (UNSECURED_ONLY, the default), 1 = every tier (ALL). `autoRepayEnabled` is the on switch.
    mapping(address => uint8) public autoClearScopeOf;
    /// @notice member => how much more card spending may draw against their Savings (12.7). Set
    /// only by the member or their signature; revocable to zero.
    mapping(address => uint256) public savingsDrawAllowance;
    /// @notice member => nonce for the member's signed settings (auto-clear, Savings draws).
    mapping(address => uint256) public memberNonces;

    /// @dev Seven slots from the gap for the block above.
    uint256[11] private __gap;

    bytes32 internal constant BOOST_KIND = "BOOST";
    bytes32 internal constant SAVINGS_KIND = "SAVINGS";
    uint8 internal constant SCOPE_ALL = 1;

    uint256 internal constant RAY = 1e27;
    uint256 internal constant BPS_ = 10_000;

    /* ========== ERRORS ========== */

    error RevolvingIssuerRatesMustAscend(uint256 previous, uint256 proposed);
    /// @notice thrown when a tier or a credit line would run on a different clock from the rest.
    error RevolvingIssuerCycleMismatch(uint64 expected, uint64 given);
    error RevolvingIssuerUnknownTier(uint256 tierId);
    error RevolvingIssuerCapacityBelowDrawn(uint256 tierId, uint256 capacity, uint256 drawn);
    error RevolvingIssuerNoCarryRecipient();
    error RevolvingIssuerNotCardSettler(address caller);
    error RevolvingIssuerNoCardSettlementAccount();
    error RevolvingIssuerCardAmountZero();
    error RevolvingIssuerCardAlreadySettled(bytes32 ref);
    error RevolvingIssuerCardNotSettled(bytes32 ref);
    error RevolvingIssuerCardHeadroom(address member, uint256 amount, uint256 headroom);
    error RevolvingIssuerCardReversalExceedsSettlement(bytes32 ref, uint256 amount, uint256 settled);
    error RevolvingIssuerCardAlreadyRepaid(bytes32 ref);
    error RevolvingIssuerCardRepaymentExceedsDrawn(address member, uint256 amount, uint256 principal);
    error RevolvingIssuerCardFloatCannotCover(uint256 amount, uint256 held);
    error RevolvingIssuerAutoRepayNotEnabled(address member);
    error RevolvingIssuerAutoRepayAlreadyUsed(bytes32 ref);
    /// @notice thrown when a transfer would mint more than the tiers can place.
    /// @dev Debt no tier holds accrues nothing and no default can reach it (audit C-1).
    error RevolvingIssuerDrawUnplaced(address member, uint256 unplaced);
    error RevolvingIssuerCardNotAuthorized(bytes32 ref, address member);
    error RevolvingIssuerCardExceedsAuthorization(bytes32 ref, uint256 amount, uint256 authorized);
    error RevolvingIssuerCardTxCap(uint256 amount, uint256 cap);
    error RevolvingIssuerCardAlreadyAuthorized(bytes32 ref);
    error RevolvingIssuerMemberNotInGoodStanding(address member);
    error RevolvingIssuerTierProductSet(uint256 tierId);
    error RevolvingIssuerStateNotEnabled(address member, bytes32 stateCode);

    /* ========== EVENTS ========== */

    event TierAdded(uint256 indexed tierId, bytes32 kind, uint256 ratePerCycle);
    event TierRateUpdated(uint256 indexed tierId, uint256 ratePerCycle);
    event TierCapacityUpdated(address indexed member, uint256 indexed tierId, uint256 capacity);
    event TierDrawn(address indexed member, uint256 indexed tierId, uint256 amount);
    event TierRepaid(address indexed member, uint256 indexed tierId, uint256 amount);
    event CarryRecipientUpdated(uint256 indexed tierId, address recipient);
    event CarryTreasuryUpdated(address treasury);
    event TierCarryMaterialised(address indexed member, uint256 indexed tierId, uint256 amount);
    event CardSettlerUpdated(address indexed settler, bool allowed);
    event CardSettlementAccountUpdated(address account);
    event CardSpendSettled(bytes32 indexed ref, address indexed member, uint256 amount);
    event CardSpendReversed(bytes32 indexed ref, address indexed member, uint256 amount);
    event CardSpendRepaid(bytes32 indexed ref, address indexed member, uint256 amount);
    event AutoRepaySet(address indexed member, bool enabled);
    event AutoRepaid(bytes32 indexed ref, address indexed member, uint256 amount);
    event CardAuthorized(bytes32 indexed ref, address indexed member, uint256 amount);
    event CardCapsUpdated(uint256 txCap, uint256 dailyCap);
    event PricingUpdated(address rateSchedule, bytes32 ceilingProduct);
    event TierProductSet(uint256 indexed tierId, bytes32 productId);
    /// @notice carry above the member-level ceiling that was not charged (spec item 4).
    event CarryTrimmed(address indexed member, uint256 indexed tierId, uint256 amount);

    /* ---- section 12 ---- */
    event CycleJudged(address indexed member, bool clean, uint8 missedInRow, uint8 cleanStreak, bool deposited);
    event UnsecuredLimitHalved(address indexed member, uint256 newLimit, uint256 excess);
    event CureNotice(address indexed member, uint64 noticeAt, uint64 defaultFrom);
    event CreditTermsUpdated(CreditTerms terms, uint128 boostBaseCap, uint128 boostEarnedCap);
    event DepositSourceUpdated(address source);
    event AutoClearSet(address indexed member, bool on, uint8 scope);
    event AutoCleared(bytes32 indexed ref, address indexed member, uint256 applied, uint256 remainder);
    event SavingsDrawAllowanceSet(address indexed member, uint256 amount);
    event SavingsDrawn(address indexed member, uint256 amount, uint256 allowanceLeft);

    error RevolvingIssuerUnsecuredCap(uint256 capacity, uint256 cap);
    error RevolvingIssuerExtensionMismatch();
    error RevolvingIssuerBoostCap(uint256 capacity, uint256 cap);
    error RevolvingIssuerAutoClearOff();
    error RevolvingIssuerNothingToClear(address member);
    error RevolvingIssuerBadScope(uint8 scope);
    error RevolvingIssuerSignatureExpired(uint256 deadline);
    error RevolvingIssuerBadSignature(address member);

    /// @notice moves carry accrued in each tier onto the ledger.
    /// @dev Carry deepens the member's negative balance and mints the matching claim to whoever
    /// funded the draw. Once it is on the ledger it stops being a figure this contract derives
    /// and becomes debt like any other: repayable, and counted by everything that reads a
    /// balance. The tier's principal is raised to match, so the same carry is never accrued twice.
    ///
    /// Compliance spec items 2-4. Carry since the last touch is simple interest on each tier's
    /// principal alone -- never on carry already owed -- at the tier's own rate, or for an
    /// unsecured tier at the list rate RateSchedule sets for the member's state. Then the
    /// member-level ceiling: all unsecured principal is one loan, and the carry on it together may
    /// not exceed the graduated schedule on that total; anything over is trimmed from the dearest
    /// unsecured tier first. Every snapshot is then reset to now, which is what lets principal be
    /// treated as constant between touches.
    function _materialiseCarry(address member) internal {
        uint256[] memory carries = _pendingCarry(member);
        for (uint256 i = 0; i < tiers.length; i++) {
            uint256 carry = carries[i];
            if (carry > 0) {
                tierPrincipal[member][i] += carry;
                tierCarry[member][i] += carry;
                stableCredit.accrueCarry(member, carryRecipientOf(i), carry);
                emit TierCarryMaterialised(member, i, carry);
            }
        }
        _resnapshot(member);
    }

    /// @dev Carry accrued in each tier since the last touch, after the member-level ceiling.
    function _pendingCarry(address member) internal view returns (uint256[] memory carries) {
        uint256 n = tiers.length;
        carries = new uint256[](n);
        bytes32 state = snapState[member];
        bool priced = address(rateSchedule) != address(0);
        uint256 unsecuredPrincipal;
        uint256 unsecuredCarry;
        for (uint256 i = 0; i < n; i++) {
            uint256 principal = principalOnlyOf(member, i);
            if (principal == 0) continue;
            bytes32 product = tierProduct[i];
            if (priced && product != bytes32(0) && rateSchedule.hasProduct(state, product)) {
                uint256 acc = rateSchedule.snapshot(state, product).list;
                carries[i] = (principal * (acc - tierSnap[member][i])) / RAY;
                unsecuredPrincipal += principal;
                unsecuredCarry += carries[i];
            } else {
                carries[i] = (principal * (_localAcc(i) - tierSnap[member][i])) / RAY;
            }
        }
        if (
            unsecuredCarry == 0 || ceilingProduct == bytes32(0)
                || !rateSchedule.hasProduct(state, ceilingProduct)
        ) return carries;
        uint256 cap = rateSchedule.capFor(member, state, ceilingProduct, unsecuredPrincipal, ceilingSnap[member]);
        if (unsecuredCarry <= cap) return carries;
        // Over the member's ceiling: trim the excess from the dearest unsecured tier first.
        uint256 excess = unsecuredCarry - cap;
        for (uint256 i = n; i > 0 && excess > 0; i--) {
            uint256 tierId = i - 1;
            if (tierProduct[tierId] == bytes32(0)) continue;
            uint256 cut = carries[tierId] < excess ? carries[tierId] : excess;
            carries[tierId] -= cut;
            excess -= cut;
        }
    }

    /// @dev Resets every snapshot to now, under the member's current state.
    function _resnapshot(address member) internal {
        bytes32 state = address(stableCredit.networkRegistry()) == address(0)
            ? bytes32(0)
            : _stateOf(member);
        snapState[member] = state;
        bool priced = address(rateSchedule) != address(0);
        for (uint256 i = 0; i < tiers.length; i++) {
            bytes32 product = tierProduct[i];
            tierSnap[member][i] = priced && product != bytes32(0) && rateSchedule.hasProduct(state, product)
                ? rateSchedule.snapshot(state, product).list
                : _localAcc(i);
        }
        if (priced && ceilingProduct != bytes32(0) && rateSchedule.hasProduct(state, ceilingProduct)) {
            ceilingSnap[member] = rateSchedule.snapshot(state, ceilingProduct);
        }
    }

    /// @dev A member's attested state, or zero if the registry has none for them.
    function _stateOf(address member) internal view returns (bytes32 state) {
        (bool ok, bytes memory data) = address(stableCredit.networkRegistry()).staticcall(
            abi.encodeWithSignature("stateCodeOf(address)", member)
        );
        if (ok && data.length >= 32) state = abi.decode(data, (bytes32));
    }

    /// @dev The tier's own rate accumulated since the tier began: monthly bps x 12 / 365 days
    /// per second (DECISIONS #1), checkpointed on rate changes.
    function _localAcc(uint256 tierId) internal view returns (uint256) {
        // Multiply before dividing: the per-second rate is never truncated on its own.
        return localAcc[tierId]
            + (tiers[tierId].index.ratePerCycle * RAY * 12 * (block.timestamp - localAccAt[tierId]))
                / (BPS_ * 365 days);
    }

    /// @notice fills tiers in order, cheapest first.
    /// @return remaining what the tiers had no room for.
    function _draw(address member, uint256 amount) internal returns (uint256 remaining) {
        remaining = amount;
        for (uint256 i = 0; i < tiers.length && remaining > 0; i++) {
            if (!tiers[i].active) continue;
            uint256 headroom = _headroom(member, i, tierPrincipal[member][i]);
            if (headroom == 0) continue;

            uint256 take = headroom < remaining ? headroom : remaining;
            tierPrincipal[member][i] += take;
            remaining -= take;
            emit TierDrawn(member, i, take);
        }
        // Anything left over means the ledger allowed a draw this issuer has no room for. The
        // ledger's ceiling is the sum of every issuer's allocation, not just these capacities, so
        // it can happen; the caller decides what to do about it.
    }

    /// @dev Headroom given what is drawn. Draws pass the ledger figure directly: they run right
    /// after carry is materialised, when nothing is pending.
    function _headroom(address member, uint256 tierId, uint256 drawn) internal view returns (uint256) {
        uint256 capacity = tierCapacity[member][tierId];
        uint256 room = capacity > drawn ? capacity - drawn : 0;
        if (room == 0 || address(exposureSource) == address(0)) return room;
        uint256 backed = _backedHeadroom(member, tiers[tierId].kind);
        return backed < room ? backed : room;
    }

    /// @dev What the collateral registry says may still be drawn against a kind. A registry that
    /// cannot answer backs nothing: under-lending shrinks a line, over-lending lends against
    /// savings that may be gone.
    function _backedHeadroom(address member, bytes32 kind) internal view returns (uint256) {
        (bool ok, bytes memory data) = address(exposureSource).staticcall(
            abi.encodeWithSignature("backedHeadroomOf(address,bytes32)", member, kind)
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    /// @dev What a member could draw across every tier open to new draws.
    function _activeHeadroom(address member) internal view returns (uint256 headroom) {
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tiers[i].active) headroom += headroomOf(member, i);
        }
    }

    /// @notice clears tiers in reverse order, most expensive first.
    /// @dev Used when this issuer is the only claim on the payment. The ledger's band walk calls
    /// `_repayTier` directly, so a dearer position at another issuer is cleared first.
    function _repay(address member, uint256 amount) internal {
        uint256 remaining = amount;
        for (uint256 i = tiers.length; i > 0 && remaining > 0; i--) {
            uint256 tierId = i - 1;
            uint256 principal = tierPrincipal[member][tierId];
            if (principal == 0) continue;
            uint256 pay = principal < remaining ? principal : remaining;
            _repayTier(member, tierId, pay);
            remaining -= pay;
        }
    }

    /// @notice reduces one tier's position by a payment.
    /// @dev Inside a position the payment clears carry first, then principal (spec item 2;
    /// pending counsel). Across positions the order is unchanged: dearest first.
    function _repayTier(address member, uint256 tierId, uint256 pay) internal {
        uint256 carry = tierCarry[member][tierId];
        tierCarry[member][tierId] = carry - (pay < carry ? pay : carry);
        tierPrincipal[member][tierId] -= pay;
        emit TierRepaid(member, tierId, pay);
    }

    function _requireTier(uint256 tierId) internal view {
        if (tierId >= tiers.length) revert RevolvingIssuerUnknownTier(tierId);
    }

    /// @notice who is owed carry accrued in a tier.
    /// @dev Resolves to the tier's own recipient, or the treasury when it has none. Never zero,
    /// because the treasury cannot be.
    function carryRecipientOf(uint256 tierId) public view returns (address) {
        address recipient = tierCarryRecipient[tierId];
        return recipient == address(0) ? carryTreasury : recipient;
    }

    /// @notice how much more a member may draw in a tier.
    /// @dev Carry consumes headroom as it accrues, because the ceiling bounds what is owed rather
    /// than what was spent.
    /// Capped, for a collateral-backed tier, at what the collateral backs right now. A savings
    /// tier's capacity was set from a pledge, and the savings behind it can leave while nothing is
    /// drawn; drawing against capacity alone let a member keep their savings and spend them too
    /// (audit C-2). Asked at every draw and every card settlement, because both read this.
    function headroomOf(address member, uint256 tierId) public view returns (uint256) {
        return _headroom(member, tierId, drawnOf(member, tierId));
    }

    /// @notice what a member owes in a tier, carry included, as of now.
    /// @dev What is on the ledger plus what has accrued since the last touch.
    function drawnOf(address member, uint256 tierId) public view returns (uint256) {
        _requireTier(tierId);
        return tierPrincipal[member][tierId] + _pendingCarry(member)[tierId];
    }

    /// @notice a member's total principal across every tier, carry excluded.
    /// @dev This is the figure that reconciles with the ledger. StableCredit's credit balance
    /// moves only when credit moves, so it carries principal; the carry above it is derived here
    /// and is not yet materialised onto the ledger. `totalDrawnOf` minus this is what the member
    /// owes beyond what they spent.
    function totalPrincipalOf(address member) public view returns (uint256 total) {
        for (uint256 i = 0; i < tiers.length; i++) {
            total += tierPrincipal[member][i];
        }
    }

    /// @notice the principal alone: what carry accrues on (spec item 2).
    function principalOnlyOf(address member, uint256 tierId) public view returns (uint256) {
        return tierPrincipal[member][tierId] - tierCarry[member][tierId];
    }

    /* ---- section 12 helpers ---- */

    /// @dev Income-backed and Boost: the tiers priced from RateSchedule, nothing pledged behind them.
    function _isUnsecured(uint256 tierId) internal view returns (bool) {
        return tierProduct[tierId] != bytes32(0);
    }

    /// @dev The member's unsecured capacity and drawn amount together. Drawn includes carry accrued
    /// since the last touch, so an amount sized from it still covers the debt once that carry is
    /// brought onto the ledger.
    function _unsecuredTotals(address member) internal view returns (uint256 capacity, uint256 drawn) {
        uint256[] memory pending = _pendingCarry(member);
        for (uint256 i = 0; i < tiers.length; i++) {
            if (!_isUnsecured(i)) continue;
            capacity += tierCapacity[member][i];
            drawn += tierPrincipal[member][i] + pending[i];
        }
    }

    /// @notice the Boost cap this member has: the base cap, or the earned one after enough Clean
    /// Cycles and ESA deposits (12.4). Zero means not enforced. No paid membership status is read.
    function boostCapOf(address member) public view returns (uint256) {
        CycleRecord memory c = cycleOf[member];
        CreditTerms memory t = creditTerms;
        bool earned = t.boostCleanCycles != 0 && c.cleanStreak >= t.boostCleanCycles
            && _popcount(c.depositBits) >= t.boostDepositCycles;
        return earned ? boostEarnedCap : boostBaseCap;
    }

    /// @dev Reverts if capacity written for this member breaks the unsecured cap (12.3), the
    /// halved ceiling after a missed cycle (12.5), or the Boost cap (12.4).
    function _checkCreditCaps(address member) internal view {
        (uint256 capacity,) = _unsecuredTotals(member);
        uint256 cap = creditTerms.unsecuredLineCap;
        uint256 ceiling = cycleOf[member].unsecuredCeiling;
        if (ceiling != 0 && (cap == 0 || ceiling < cap)) cap = ceiling;
        if (cap != 0 && capacity > cap) revert RevolvingIssuerUnsecuredCap(capacity, cap);
        uint256 boostCap = boostCapOf(member);
        if (boostCap == 0) return;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tiers[i].kind == BOOST_KIND && tierCapacity[member][i] > boostCap) {
                revert RevolvingIssuerBoostCap(tierCapacity[member][i], boostCap);
            }
        }
    }

    /// @notice what a member owes on income-backed and Boost above their halved limit, after a
    /// missed cycle (12.5). Settled from pledged bonds or pool shares, never Savings. Zero otherwise.
    function unsecuredExcessOf(address member) public view returns (uint256) {
        if (cycleOf[member].missedInRow == 0) return 0;
        (uint256 capacity, uint256 drawn) = _unsecuredTotals(member);
        return drawn > capacity ? drawn - capacity : 0;
    }

    /// @notice consecutive missed rebalances, for the Liquidator.
    function missedInRowOf(address member) external view returns (uint8) {
        return cycleOf[member].missedInRow;
    }

    function _popcount(uint8 bits) internal pure returns (uint8 count) {
        for (; bits != 0; bits &= bits - 1) count++;
    }
}
