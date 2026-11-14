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
import "../libraries/PacificCalendar.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @dev The term issuer's half of the Combined Ceiling (12.3): it brings a member's plans to now.
interface ICombinedCeilingTerm {
    function materialiseMember(address member) external;
}

/// @dev The issuer's own carry entry point, which the modules call (see `_touch`).
interface IRevolvingTouch {
    function materialiseCarry(address member) external;
}

/// @dev The one CLRUSD call a Savings draw makes (Phase 4b, L-B).
interface IClrusdLockSync {
    function syncEncumbrance(address holder) external returns (uint256 locked);
}

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
    /// @param cureNoticeAt the cure-notice timestamp for the second miss in a row: the block time a
    /// second signer approved it (12.5, Phase 2e). Zero if none; a payment of the amount clears it.
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
    /// @notice member => the Automatic Clearing level (12.2): 0 = UNSECURED (the default: Boost and
    /// income-backed, then any unpaid Secured Minimum), 1 = EVERYTHING (every tier, dearest first;
    /// the old ALL), 2 = DUE_ONLY (the unpaid Rebalance Amount and any unpaid Secured Minimum).
    /// `autoRepayEnabled` is the on switch. Only the member sets either.
    mapping(address => uint8) public autoClearScopeOf;
    /// @notice member => how much more card spending may draw against their Savings (12.7). Set
    /// only by the member or their signature; revocable to zero.
    mapping(address => uint256) public savingsDrawAllowance;
    /// @notice member => nonce for the member's signed settings (auto-clear, Savings draws).
    mapping(address => uint256) public memberNonces;

    /// @dev Seven slots from the gap for the block above.

    /* ---- Phase 4: snapshot basis (M-B) ---- */

    /// @dev member => which accumulator each snapshot above was taken from: bit i set when tier i
    /// was snapshotted on the RateSchedule, clear when on its own local accumulator; bit 255 set
    /// when `ceilingSnap` holds a snapshot of the ceiling product. Pricing switched on, or a
    /// state's products launched, after a member was snapshotted changes which accumulator a tier
    /// reads; comparing numbers from two different accumulators underflowed or read past an empty
    /// snapshot and bricked the member. One slot from the gap.
    mapping(address => uint256) internal snapBasis;

    /* ---- Phase 4b: the owner's decisions on the re-review ---- */

    /// @dev member => when their current line was opened (M-C). A default recorded before it ended
    /// an earlier line, which the member has since settled and been re-onboarded from, so the
    /// Liquidator may act only on a default of this line. Zero for a line opened before this
    /// upgrade, which keeps the old rule for it. One slot from the gap.
    mapping(address => uint64) internal lineOpenedAt;
    /// @dev The CLRUSD token whose recorded lock a Savings draw refreshes (L-B). Set once, by the
    /// owner. One slot from the gap.
    address internal clrusdToken;

    /* ---- Phase 2e: calendar cycles and dues (Addendum 2: 12.1, 12.2, 12.5, 12.13) ---- */

    /// @notice A member's calendar clock and what is due on it.
    /// @dev Every field is computed by the contract from the member's own day, payments and the
    /// two-person attestations below. No role writes a cycle end, a due amount or a pause.
    struct CycleState {
        uint64 cycleEnd; // end of the running cycle: 23:59:59 Pacific on cycleEndDay
        uint64 closedAt; // the close whose dues are open; zero when none are
        uint64 dayChangedAt; // the member's last change of cycleEndDay (once per rolling 365 days)
        uint8 cycleEndDay; // 1-28
        uint8 incomePause; // 12.13: cycles of Income Assurance left
        bool hybridMode; // 12.1: stops Automatic Clearing; never changes a cycle
        uint128 rebalanceAmount; // unsecured revolving balance at the open close, due at cycleEnd
        uint128 securedMinimum; // asset-backed carry plus the minimum on secured principal, due at cycleEnd
        uint128 paidSinceClose; // every repayment on this line since the open close
        uint128 assetCarry; // asset-backed carry accrued since the last close
        uint128 securedPastDue; // what a judged cycle's RA + SM still lacks: pauses secured draws
        uint128 pastDueSM; // the Secured Minimum part of it
        uint128 cureAmount; // the second consecutive Rebalance Amount still unpaid (12.5)
        uint64 cureDueAt; // its due point
        address noticeProposer; // proposer of a pending cure-notice timestamp
        address pauseProposer; // proposer of a pending Income Assurance pause
        uint8 pauseCycles; // the cycles proposed
        bytes32 autoClearAuthHash; // 12.2: hash of the authorization text the member approved
        uint64 cardDay; // 4c item 1: the day `cardUsed` counts
        uint128 cardUsed;
    }
    mapping(address => CycleState) internal cycleState;

    /// @notice Governed figures for the dues (Addendum 2).
    struct DueTerms {
        uint16 securedMinimumBps; // of savings- and asset-backed principal (100 = 1%)
        uint16 raisedBps; // a raise, binding cycles that close at or after `raisedFrom`
        uint64 raisedFrom;
        uint64 securedMinimumFloor; // $1
        uint64 cardMemberDailyCap; // 4c item 1: card settlements per member per day; zero is unset
        uint8 incomePauseMaxCycles; // 12.13: 3
        address termIssuer; // 12.3: the term issuer whose plans share the Combined Ceiling (set once)
    }
    DueTerms internal dueTerms;

    /// @notice 12.2: payers excluded from Automatic Clearing by default (federal benefit ACH
    /// originators). Added by governance; never removed, so no member loses an exclusion they did
    /// not give up themselves.
    mapping(bytes32 => bool) public defaultExcludedPayer;
    /// @dev member => payer => 1 the member excluded it, 2 the member removed the exclusion.
    mapping(address => mapping(bytes32 => uint8)) internal payerChoice;

    /// @dev Five slots from the gap: cycleState, dueTerms (2), defaultExcludedPayer, payerChoice.
    uint256[3] private __gap;

    bytes32 internal constant BOOST_KIND = "BOOST";
    bytes32 internal constant INCOME_KIND = "INCOME";
    bytes32 internal constant SAVINGS_KIND = "SAVINGS";
    uint8 internal constant SCOPE_ALL = 1;
    uint8 internal constant LEVEL_DUE_ONLY = 2;
    /// @notice 12.5: the cure notice gives at least ten full days (MB-05 6.4). FIXED.
    uint256 internal constant NOTICE_GRACE = 864_000;
    /// @notice who records the two-person attestations: cure notices and Income Assurance.
    bytes32 internal constant ATTESTER_ROLE = keccak256("CREDIT_ATTESTER_ROLE");

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
    /// @notice the CLRUSD token a Savings draw refreshes the lock of (Phase 4b, L-B).
    event ClrusdTokenSet(address token);

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

    /* ---- Phase 2e (Addendum 2) ---- */
    event CycleEndDaySet(address indexed member, uint8 day, uint64 cycleEnd);
    event CycleClosed(address indexed member, uint64 closedAt, uint256 rebalanceAmount, uint256 securedMinimum);
    event SecuredMinimumMissed(address indexed member, uint256 pastDue);
    event CureNoticeProposed(address indexed member, address indexed proposer);
    event CureNoticeRecorded(address indexed member, uint64 noticeAt, uint64 defaultFrom);
    event CureNoticeCancelled(address indexed member);
    event IncomePauseProposed(address indexed member, uint8 cycles, address indexed proposer);
    event IncomePauseSet(address indexed member, uint8 cycles);
    event HybridModeSet(address indexed member, bool on);
    event PayerExclusionSet(address indexed member, bytes32 indexed payer, bool excluded);
    event DefaultExcludedPayerAdded(bytes32 indexed payer);
    event DueTermsUpdated(uint16 securedMinimumBps, uint64 raisedFrom, uint64 floor, uint64 cardMemberDailyCap, uint8 incomePauseMaxCycles);
    event AutoClearAuthorized(address indexed member, uint8 level, bytes32 authHash);
    event TermIssuerSet(address termIssuer);

    error RevolvingIssuerUnsecuredCap(uint256 capacity, uint256 cap);
    error RevolvingIssuerExtensionMismatch();
    error RevolvingIssuerBoostCap(uint256 capacity, uint256 cap);
    error RevolvingIssuerAutoClearOff();
    error RevolvingIssuerNothingToClear(address member);
    error RevolvingIssuerBadScope(uint8 scope);
    error RevolvingIssuerSignatureExpired(uint256 deadline);
    error RevolvingIssuerBadSignature(address member);
    /// @notice thrown when the RateSchedule or ceiling product is changed once set (Phase 4, M-B).
    error RevolvingIssuerPricingSet();
    /// @notice thrown when the CLRUSD token is set twice, or to zero (Phase 4b, L-B).
    error RevolvingIssuerClrusdSet();

    /* ---- Phase 2e (Addendum 2) ---- */
    /// @notice thrown by every role-held setter of a credit period: cycles are computed (12.1).
    error RevolvingIssuerCyclesComputed();
    error RevolvingIssuerBadCycleDay(uint256 day);
    error RevolvingIssuerCycleDayChangedRecently(uint256 availableAt);
    /// @notice thrown when a savings- or asset-backed draw meets an unpaid Secured Minimum (12.1).
    error RevolvingIssuerSecuredDrawPaused(address member);
    error RevolvingIssuerNotInDefault(address member);
    error RevolvingIssuerNothingDue(address member);
    error RevolvingIssuerSameSigner(address signer);
    error RevolvingIssuerNoProposal(address member);
    error RevolvingIssuerPauseTooLong(uint256 cycles, uint256 max);
    error RevolvingIssuerHybridMode(address member);
    error RevolvingIssuerExcludedPayer(address member, bytes32 payer);
    error RevolvingIssuerCardMemberDailyCap(address member, uint256 amount, uint256 remaining);
    /// @notice 4c item 3: an earlier default's pledged collateral has not been applied yet.
    error RevolvingIssuerDefaultCollateralUnapplied(address member);
    error RevolvingIssuerTermIssuerSet();

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
        // The Combined Ceiling (12.3): the term issuer's plans take what the revolving tiers leave
        // of the member's ceiling, so they are brought to now on the revolving principal that stood
        // over the stretch, before anything here changes it. Set once; never switched off.
        address terms = dueTerms.termIssuer;
        if (terms != address(0)) ICombinedCeilingTerm(terms).materialiseMember(member);
        uint256[] memory carries = _pendingCarry(member);
        uint256 assetCarry;
        for (uint256 i = 0; i < tiers.length; i++) {
            uint256 carry = carries[i];
            if (carry > 0) {
                tierPrincipal[member][i] += carry;
                tierCarry[member][i] += carry;
                if (_isAssetBacked(i)) assetCarry += carry;
                stableCredit.accrueCarry(member, _carryRecipient(i), carry);
                emit TierCarryMaterialised(member, i, carry);
            }
        }
        // Asset-backed carry is part of the Secured Minimum of the cycle it accrues in (12.1).
        if (assetCarry > 0) cycleState[member].assetCarry += uint128(assetCarry);
        _resnapshot(member);
    }

    /// @dev Carry accrued in each tier since the last touch, after the member-level ceiling.
    function _pendingCarry(address member) internal view returns (uint256[] memory carries) {
        uint256 n = tiers.length;
        carries = new uint256[](n);
        bytes32 state = snapState[member];
        uint256 basis = snapBasis[member];
        uint256 unsecuredPrincipal;
        uint256 unsecuredCarry;
        for (uint256 i = 0; i < n; i++) {
            uint256 principal = _principalOnly(member, i);
            if (principal == 0) continue;
            bool onSchedule = _onSchedule(state, tierProduct[i]);
            // The accumulator this tier reads changed since its snapshot (pricing switched on, or
            // the state's product launched): the two numbers do not compare, so nothing is charged
            // across the change, and the next touch snapshots on the new basis (Phase 4, M-B).
            if (onSchedule != ((basis >> i) & 1 == 1)) continue;
            uint256 acc = onSchedule ? rateSchedule.snapshot(state, tierProduct[i]).list : _localAcc(i);
            uint256 snap = tierSnap[member][i];
            if (acc > snap) carries[i] = (principal * (acc - snap)) / RAY;
            if (onSchedule) {
                unsecuredPrincipal += principal;
                unsecuredCarry += carries[i];
            }
        }
        if (unsecuredCarry == 0 || !_onSchedule(state, ceilingProduct)) return carries;
        if (basis >> 255 == 0) {
            // The ceiling applies but there is no snapshot to measure it from: charge no unsecured
            // carry for this interval rather than risk charging above the ceiling (M-B).
            for (uint256 i = 0; i < n; i++) {
                if (tierProduct[i] != bytes32(0)) carries[i] = 0;
            }
            return carries;
        }
        // The Combined Ceiling (12.3) on the revolving tiers alone: the graduated schedule on their
        // principal. They come first in it, so the term plans never take any of it from them.
        uint256 cap = rateSchedule.graduatedSince(state, ceilingProduct, unsecuredPrincipal, ceilingSnap[member]);
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
        bytes32 state = _pricingState(member);
        snapState[member] = state;
        uint256 basis;
        for (uint256 i = 0; i < tiers.length; i++) {
            bytes32 product = tierProduct[i];
            if (_onSchedule(state, product)) {
                tierSnap[member][i] = rateSchedule.snapshot(state, product).list;
                basis |= 1 << i;
            } else {
                tierSnap[member][i] = _localAcc(i);
            }
        }
        if (_onSchedule(state, ceilingProduct)) {
            ceilingSnap[member] = rateSchedule.snapshot(state, ceilingProduct);
            basis |= 1 << 255;
        }
        if (snapBasis[member] != basis) snapBasis[member] = basis;
    }

    /// @dev Whether `product` is priced from the RateSchedule for `state` right now.
    function _onSchedule(bytes32 state, bytes32 product) internal view returns (bool) {
        return address(rateSchedule) != address(0) && product != bytes32(0) && rateSchedule.hasProduct(state, product);
    }

    /// @dev The state a member's priced tiers are priced under from the next touch: the attested
    /// state, unless that state lacks a product the member's last state priced their line on. Then
    /// the member keeps the last state's products until the new state's launch (Phase 4b, O-1), so
    /// a re-attestation never moves them onto a tier's own local rate with no ceiling over it. The
    /// whole line moves together, because the member-level ceiling is one product in one state.
    function _pricingState(address member) internal view returns (bytes32 state) {
        if (address(stableCredit.networkRegistry()) == address(0)) return bytes32(0);
        state = _stateOf(member);
        bytes32 last = snapState[member];
        if (last == state || last == bytes32(0)) return state;
        if (_onSchedule(last, ceilingProduct) && !_onSchedule(state, ceilingProduct)) return last;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tierCapacity[member][i] == 0 && tierPrincipal[member][i] == 0) continue;
            bytes32 product = tierProduct[i];
            if (_onSchedule(last, product) && !_onSchedule(state, product)) return last;
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
        bool savingsDrawn;
        // An unpaid Secured Minimum pauses new savings- and asset-backed draws (12.1): those tiers
        // take nothing, and unsecured draws go on.
        bool paused = _securedDrawPaused(member);
        for (uint256 i = 0; i < tiers.length && remaining > 0; i++) {
            if (!tiers[i].active || (paused && !_isUnsecured(i))) continue;
            uint256 headroom = _headroom(member, i, tierPrincipal[member][i]);
            if (headroom == 0) continue;

            uint256 take = headroom < remaining ? headroom : remaining;
            tierPrincipal[member][i] += take;
            remaining -= take;
            if (tiers[i].kind == SAVINGS_KIND) savingsDrawn = true;
            emit TierDrawn(member, i, take);
        }
        // Anything left over means the ledger allowed a draw this issuer has no room for. The
        // ledger's ceiling is the sum of every issuer's allocation, not just these capacities, so
        // it can happen; the caller decides what to do about it.

        // A draw on Savings raises the member's CLRUSD lock. CLRUSD falls back to the last lock it
        // read when the registry cannot answer, so it must read the new one now (Phase 4b, L-B).
        // Every draw comes through here: a plain transfer and a card settlement alike. Not caught:
        // if the registry is down, the draw reverts rather than leave the record stale.
        address token = clrusdToken;
        if (savingsDrawn && token != address(0)) IClrusdLockSync(token).syncEncumbrance(member);
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

    /// @notice clears tiers most expensive first, by what each costs now after the caps.
    /// @dev Used when this issuer is the only claim on the payment (card repayments and reversals,
    /// Automatic Clearing). The same effective-rate order as the ledger's band walk (Phase 4b L-G,
    /// 4c item 7), so every repayment follows one rule. `mask` picks the tiers that may be paid:
    /// bit i for tier i. Returns what it could not place.
    function _repay(address member, uint256 amount, uint256 mask) internal returns (uint256 remaining) {
        remaining = amount;
        uint256[] memory rates = _effectiveRates(member);
        while (remaining > 0) {
            // The dearest tier left that owes something; ties go to the later (dearer-configured) tier.
            uint256 best = type(uint256).max;
            for (uint256 i = 0; i < tiers.length; i++) {
                if ((mask >> i) & 1 == 0 || tierPrincipal[member][i] == 0) continue;
                if (best == type(uint256).max || rates[i] >= rates[best]) best = i;
            }
            if (best == type(uint256).max) break;
            uint256 principal = tierPrincipal[member][best];
            uint256 pay = principal < remaining ? principal : remaining;
            _repayTier(member, best, pay);
            remaining -= pay;
        }
    }

    /// @dev Bit i set for every unsecured tier (income-backed, Boost), or for every other tier.
    function _tierMask(bool unsecured) internal view returns (uint256 mask) {
        for (uint256 i = 0; i < tiers.length; i++) {
            if (_isUnsecured(i) == unsecured) mask |= 1 << i;
        }
    }

    /// @notice reduces one tier's position by a payment.
    /// @dev Inside a position the payment clears carry first, then principal (spec item 2;
    /// pending counsel). Across positions the order is unchanged: dearest first. Every repayment
    /// passes through here, so this is where it counts toward what is due (12.1, 12.5).
    function _repayTier(address member, uint256 tierId, uint256 pay) internal {
        _repayTier(member, tierId, pay, true);
    }

    /// @dev `cures` is false only for a settlement out of pledged collateral (`settleFromCollateral`):
    /// enforcement reduces the debt, but never cures the default it enforces.
    function _repayTier(address member, uint256 tierId, uint256 pay, bool cures) internal {
        uint256 carry = tierCarry[member][tierId];
        tierCarry[member][tierId] = carry - (pay < carry ? pay : carry);
        tierPrincipal[member][tierId] -= pay;
        emit TierRepaid(member, tierId, pay);
        _notePayment(member, pay, cures);
    }

    /// @dev A payment counts toward the open cycle's dues, toward a Secured Minimum past due (the
    /// pause lifts in this same transaction once it is met), and toward an unpaid second Rebalance
    /// Amount, whose cure notice it cancels once that amount is paid (12.5).
    function _notePayment(address member, uint256 pay, bool cures) internal {
        CycleState storage s = cycleState[member];
        s.paidSinceClose += uint128(pay);
        uint256 pastDue = s.securedPastDue;
        if (pastDue != 0) s.securedPastDue = uint128(pay < pastDue ? pastDue - pay : 0);
        uint256 cure = s.cureAmount;
        if (cure != 0 && cures) {
            if (pay < cure) {
                s.cureAmount = uint128(cure - pay);
            } else {
                s.cureAmount = 0;
                s.noticeProposer = address(0);
                if (cycleOf[member].cureNoticeAt != 0) {
                    cycleOf[member].cureNoticeAt = 0;
                    emit CureNoticeCancelled(member);
                }
            }
        }
    }

    /// @dev What is due now (12.1): the unpaid Rebalance Amount, and everything due including the
    /// Secured Minimum. A payment counts toward every open figure at once (each is measured from its
    /// own close), so what clears them all is the largest, not the sum. Zero while Income Assurance
    /// runs (12.13).
    function _dues(address member) internal view returns (uint256 dueUnsecured, uint256 dueTotal) {
        CycleState storage s = cycleState[member];
        if (s.incomePause != 0) return (0, 0);
        uint256 ra = s.rebalanceAmount;
        uint256 owed = ra + s.securedMinimum;
        uint256 paid = s.paidSinceClose;
        dueUnsecured = ra > paid ? ra - paid : 0;
        if (s.cureAmount > dueUnsecured) dueUnsecured = s.cureAmount;
        dueTotal = owed > paid ? owed - paid : 0;
        if (s.securedPastDue > dueTotal) dueTotal = s.securedPastDue;
        if (dueUnsecured > dueTotal) dueTotal = dueUnsecured;
    }

    /// @dev Computed revolving default (12.5, 10b): see RevolvingIssuer.inDefault.
    function _computedDefault(address member) internal view returns (bool) {
        CycleRecord memory c = cycleOf[member];
        CycleState storage s = cycleState[member];
        if (c.missedInRow < 2 || c.cureNoticeAt == 0 || s.cureAmount == 0 || s.incomePause != 0) return false;
        uint256 graceEnd = s.cureDueAt + creditTerms.cureWindow;
        uint256 noticeEnd = c.cureNoticeAt + NOTICE_GRACE;
        return block.timestamp >= (graceEnd > noticeEnd ? graceEnd : noticeEnd);
    }

    /// @dev Whether Automatic Clearing must leave a deposit from `payer` alone (12.2): a federal
    /// benefit payer on the default list, unless the member removed it by signature, or a payer the
    /// member excluded. A sweep that names no payer cannot be checked, so it is refused too.
    function _payerExcluded(address member, bytes32 payer) internal view returns (bool) {
        uint8 choice = payerChoice[member][payer];
        return payer == bytes32(0) || choice == 1 || (choice == 0 && defaultExcludedPayer[payer]);
    }

    /// @dev Checks the member's EIP-712 signature (domain "Clear RevolvingIssuer", version 1) over
    /// `structHash` at their current nonce, then spends the nonce. EIP-1271 is accepted.
    function _useSignature(address member, bytes32 structHash, uint256 deadline, bytes calldata signature) internal {
        if (block.timestamp > deadline) revert RevolvingIssuerSignatureExpired(deadline);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Clear RevolvingIssuer"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        if (!SignatureChecker.isValidSignatureNow(member, digest, signature)) {
            revert RevolvingIssuerBadSignature(member);
        }
        memberNonces[member]++;
    }

    /// @dev Whether an unpaid Secured Minimum pauses new secured draws (12.1). Computed; never while
    /// Income Assurance runs (12.13).
    function _securedDrawPaused(address member) internal view returns (bool) {
        CycleState storage s = cycleState[member];
        return s.securedPastDue != 0 && s.incomePause == 0;
    }

    /// @dev Asset-backed: neither Savings nor unsecured.
    function _isAssetBacked(uint256 tierId) internal view returns (bool) {
        return !_isUnsecured(tierId) && tiers[tierId].kind != SAVINGS_KIND;
    }

    /// @dev Whether the member's recorded default belongs to the line they hold today (Phase 4b
    /// M-C; the card reads it too since 4c item 2).
    function _defaultedOnCurrentLine(address member) internal view returns (bool) {
        uint64 at = defaultedAt[member];
        return at != 0 && at >= lineOpenedAt[member];
    }

    /// @dev The unit repayment rates are compared in: monthly basis points times 1e18.
    uint256 internal constant RATE_SCALE_ = 1e18;

    /// @dev What each tier costs the member from now, as a monthly rate scaled by RATE_SCALE (Phase
    /// 4b, L-G): a tier on its own rate costs that rate; a priced tier costs its list rate under the
    /// member's pricing state, less its part of any excess over the member-level ceiling, trimmed
    /// dearest tier first as accrual trims it. RateSchedule does the arithmetic, so the comparison
    /// and the accrual read the same parameters.
    function _effectiveRates(address member) internal view returns (uint256[] memory rates) {
        uint256 n = tiers.length;
        bytes32[] memory products = new bytes32[](n);
        uint256[] memory principals = new uint256[](n);
        rates = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            products[i] = tierProduct[i];
            principals[i] = _principalOnly(member, i);
            rates[i] = tiers[i].index.ratePerCycle;
        }
        if (address(rateSchedule) == address(0)) {
            for (uint256 i = 0; i < n; i++) rates[i] *= RATE_SCALE_;
            return rates;
        }
        return rateSchedule.revolvingRatesOf(_pricingState(member), ceilingProduct, products, principals, rates);
    }

    function _requireTier(uint256 tierId) internal view {
        if (tierId >= tiers.length) revert RevolvingIssuerUnknownTier(tierId);
    }

    /// @dev Who is owed carry accrued in a tier: its own recipient, or the treasury (never zero).
    function _carryRecipient(uint256 tierId) internal view returns (address) {
        address recipient = tierCarryRecipient[tierId];
        return recipient == address(0) ? carryTreasury : recipient;
    }

    /// @dev A member's total principal across every tier, materialised carry included.
    function _totalPrincipal(address member) internal view returns (uint256 total) {
        for (uint256 i = 0; i < tiers.length; i++) {
            total += tierPrincipal[member][i];
        }
    }

    /// @dev The principal alone: what carry accrues on (spec item 2).
    function _principalOnly(address member, uint256 tierId) internal view returns (uint256) {
        return tierPrincipal[member][tierId] - tierCarry[member][tierId];
    }

    /// @dev The modules bring a member's carry to now through the issuer's own `materialiseCarry`,
    /// which keeps the accrual code in one contract (the modules run by delegatecall, so
    /// `address(this)` is the issuer).
    function _touch(address member) internal {
        IRevolvingTouch(address(this)).materialiseCarry(member);
    }

    /* ---- section 12 helpers ---- */

    /// @dev Income-backed and Boost: nothing pledged behind them. A tier priced from RateSchedule,
    /// or one of those kinds on its own rate.
    function _isUnsecured(uint256 tierId) internal view returns (bool) {
        bytes32 kind = tiers[tierId].kind;
        return tierProduct[tierId] != bytes32(0) || kind == BOOST_KIND || kind == INCOME_KIND;
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

    /// @dev The Boost cap this member has: the base cap, or the earned one after enough Clean
    /// Cycles and ESA deposits (12.4). Zero means not enforced. No paid membership status is read.
    function _boostCap(address member) internal view returns (uint256) {
        CycleRecord memory c = cycleOf[member];
        CreditTerms memory t = creditTerms;
        bool earned = t.boostCleanCycles != 0 && c.cleanStreak >= t.boostCleanCycles
            && _popcount(c.depositBits) >= t.boostDepositCycles;
        return earned ? boostEarnedCap : boostBaseCap;
    }

    /// @dev Reverts if capacity written for this member breaks the unsecured cap (12.3), the
    /// halved ceiling after a missed cycle (12.5), or the Boost cap (12.4).
    function _checkCreditCaps(address member) internal view {
        uint256 capacity;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (_isUnsecured(i)) capacity += tierCapacity[member][i];
        }
        uint256 cap = creditTerms.unsecuredLineCap;
        uint256 ceiling = cycleOf[member].unsecuredCeiling;
        if (ceiling != 0 && (cap == 0 || ceiling < cap)) cap = ceiling;
        if (cap != 0 && capacity > cap) revert RevolvingIssuerUnsecuredCap(capacity, cap);
        uint256 boostCap = _boostCap(member);
        if (boostCap == 0) return;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tiers[i].kind == BOOST_KIND && tierCapacity[member][i] > boostCap) {
                revert RevolvingIssuerBoostCap(tierCapacity[member][i], boostCap);
            }
        }
    }

    function _popcount(uint8 bits) internal pure returns (uint8 count) {
        for (; bits != 0; bits &= bits - 1) count++;
    }
}
