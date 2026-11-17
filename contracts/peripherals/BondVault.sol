// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "../libraries/Accretion.sol";
import "./interfaces/ICollateralAgent.sol";
import "./interfaces/IEarnControls.sol";

/// @dev The pledge module that applies a pledged bond's `toDebt` to its Holder's debt (the Liquidator).
interface IMaturityInstructionApplier {
    function applyMaturityInstruction(address member, uint256 toDebt) external;
}

/// @dev The CollateralRegistry's answer to "is this bond spoken for".
interface IBondEncumbranceSource {
    function isItemEncumbered(address holder, bytes32 kind, uint256 itemId) external view returns (bool);
}

/// @dev What the vault asks of the collection that recorded a bond.
interface IBondCollectionBook {
    function holderOf(uint256 bondId) external view returns (address);
    function burnPaid(uint256 bondId) external;
}

/// @dev The Ladder's terms (EarnControls' module).
interface IEarnLadder {
    function ladderTerms() external view returns (uint32[] memory);
    function rollTermFor(uint32 termDays) external view returns (uint32);
}

/// @dev The Collateral Agent's registered destination for deployable excess (Exhibit A, Part 5(a)).
interface IAgentExcessDestination {
    function excessDestination() external view returns (address);
}

/// @title BondVault
/// @notice Where bond proceeds live, and what keeps them senior: the BurnerBond Collateral, under the
/// Collateral Agent's first lien (IV-10), with the Redemption Reserve of Earn §2.
/// @dev Bondholders lent money and are creditors. The vault holds only USDC and has no path to or
/// from the AssurancePool, the Loss Reserve or the ESA (Earn "Do NOT change").
///
/// **Redemption Reserve (Earn §2, R2, Phase 2f).** `requiredReserve()` is the greater of (a) the
/// glide schedule, each bond's Maturity Amount at the ratio of its time-to-maturity band, never below
/// the floor (`minReserveBps`, FIXED at 30% or more and raise-only), and (b) 100% of every bond due
/// within 90 days (FIXED) except confirmed rolls that can roll; plus recorded settlement shortfalls
/// and the Collateral Agent's unclaimed distributions. The near-term figure comes from two Fenwick
/// trees over daily maturity buckets: every bond's face, and the face of confirmed bonds whose Holder
/// is eligible. A withdrawn confirmation, or a Holder flagged ineligible (`IEarnControlsHook`), moves
/// the reserve in the same transaction. Below it the vault is in Reserve Shortfall: new purchases and
/// excess withdrawals stop (not rolls) until `topUp` cures it; `shortfallSince` records the start.
///
/// **Outflows.** Only: paying a Holder (settlement, the pledged split and `payPledged` to the
/// Holder's own debt (C3, decision 5), a roll's remainder, `redeemAll`); the Collateral Agent's
/// distributions, Collateral Deposit Account transfers and capped costs; and deployable excess to
/// Clear Lending's single registered multisig through the Agent (`agentWithdrawExcess`, proposed and
/// executed by different treasury signers; C1, decision 3). `withdrawDeployable` and
/// `lendToPayoutPool` are gone; `repayFromPayoutPool` stays until any open loan is repaid.
///
/// **Enforcement (IV-10 §7.2, decisions 5 and 19).** While the Agent's Enforcement Notice is in force,
/// every outflow but the Agent's own reverts, and so do purchases and rolls, confirmed ones included.
///
/// **Changes (IV-10 §4.5, Exhibit A Part 2 item 6).** Once the Agent is named, every upgrade, role,
/// parameter and destination change also needs its co-signature: the call consumes a change the
/// treasury proposed and confirmed and the Agent approved, 7 days old (`consumeChange`).
contract BondVault is
    AccessControlUpgradeable,
    UUPSUpgradeable,
    IAgentVault,
    IAgentBondBook,
    IEarnReserveStatus,
    IEarnControlsHook
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using MathUpgradeable for uint256;

    /// @dev Kept so existing grants still read; it gates nothing since Phase 2f.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice A bond collection. Records purchases, rolls and settlements.
    bytes32 public constant BOND_ROLE = keccak256("BOND_ROLE");
    /// @dev Kept so existing grants still read; excess leaves only through the Collateral Agent.
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    uint256 internal constant BPS = 10_000;
    /// @notice FIXED: bonds due within 90 days are reserved at 100% unless they will roll (Earn §2).
    uint64 public constant RESERVE_WINDOW = 90 days;
    /// @notice FIXED: the floor of the glide schedule may never be below 30% (Earn §2).
    uint256 public constant MIN_RESERVE_FLOOR_BPS = 3_000;
    uint256 public constant MAX_GLIDE_BANDS = 8;

    /// @dev Maturity buckets (audit X-10): one per UTC day from `BUCKET_EPOCH`, summed with a Fenwick
    /// tree so "face due within a window" costs log2(BUCKETS) reads instead of one per bond.
    uint256 internal constant BUCKET_EPOCH = 1_577_836_800; // 2020-01-01T00:00:00Z
    /// @dev 2^15 days: maturities up to early 2109.
    uint256 internal constant BUCKETS = 32_768;

    /// @notice What the vault owes on one bond.
    struct Obligation {
        uint256 principal;
        uint256 faceValue;
        uint64 maturity;
        bool settled;
    }

    /// @notice A bond's Register entry beyond its obligation (Phase 2f).
    struct BondTerms {
        /// @dev the collection that recorded it, which knows its Holder
        address collection;
        uint32 yieldBps;
        uint64 issuedAt;
        /// @dev the Holder whose confirmed roll this is (zero: not confirmed)
        address confirmedBy;
        uint64 endedAt;
        /// @dev counted in the rolling tree: confirmed, its Holder not flagged ineligible, and a term
        /// of its length or shorter offered (IV-01 §§5.2(a), 5.4)
        bool rolling;
        /// @dev its Series: `issueDay << 32 | maturityDay` (IV-01: same Issue Date and Maturity Date)
        uint64 seriesId;
        uint32 termDays;
    }

    IERC20Upgradeable public reserveToken;

    /// @dev bond id => obligation
    mapping(uint256 => Obligation) public obligations;
    uint256[] private outstanding;
    /// @dev bond id => index in `outstanding`, plus one
    mapping(uint256 => uint256) private outstandingIndex;

    /// @notice Principal taken in across every bond, settled or not.
    uint256 public totalPrincipal;
    /// @notice Maturity Amounts still owed.
    uint256 public totalFaceOutstanding;
    /// @notice Maturity Amounts already paid.
    uint256 public totalFaceSettled;

    /// @dev Retired in Phase 2f: the 90-day window is FIXED (`RESERVE_WINDOW`).
    /// @custom:oz-renamed-from reserveWindow
    uint64 private retiredReserveWindow;
    /// @notice The glide schedule's floor, as a share of Maturity Amounts outstanding. FIXED at 30%
    /// or more, and it can only be raised (`raiseReserveFloor`).
    uint256 public minReserveBps;

    /* ========== ADDED AFTER DEPLOYMENT: five slots from the gap ========== */

    /// @notice The co-op's treasury, the Safe. Pays a bond the vault cannot, up to its allowance.
    address public treasury;
    /// @dev Retired (section 13): the vault holds no AssurancePool address and never calls one.
    /// @custom:oz-renamed-from assurancePool
    address private retiredAssurancePool;
    /// @notice The payout pool. It no longer borrows (C1, decision 3); it only repays.
    address public payoutPool;
    /// @notice Reserve tokens still out with the payout pool from before Phase 2f.
    uint256 public lentToPayoutPool;
    /// @custom:oz-renamed-from owedToReserve
    uint256 private retiredOwedToReserve;

    /* ========== ADDED AFTER DEPLOYMENT: two more slots from the gap ========== */

    /// @notice What reports a bond pledged and backing drawn credit -- the CollateralRegistry.
    IBondEncumbranceSource public encumbranceSource;
    /// @notice The collateral kind bonds are pledged as.
    bytes32 public collateralKind;

    /* ========== ADDED BY THE AUDIT FIXES: two slots from the gap ========== */

    /// @dev Fenwick tree over maturity day (1-indexed): face value outstanding per bucket.
    mapping(uint256 => uint256) private dueTree;
    /// @dev bond id => its bucket (0: not bucketed).
    mapping(uint256 => uint256) private bucketOf;

    /* ========== ADDED IN PHASE 2E: two slots from the gap ========== */

    /// @notice What a settled bond still owes because the vault and the treasury together could not
    /// pay all of it at settlement. Fixed at settlement; nobody re-points or resizes it.
    struct PendingSettlement {
        address holder;
        address debtTo;
        uint256 debtOwed;
        uint256 holderOwed;
    }

    mapping(uint256 => PendingSettlement) public pendingSettlement;
    /// @notice Everything recorded in `pendingSettlement`. Due now, so it sits on top of the reserve.
    uint256 public totalSettlementOwed;

    /* ========== ADDED IN PHASE 2F: eleven slots from the gap ========== */

    /// @notice The Collateral Agent (IV-10 Exhibit A).
    ICollateralAgent public agent;
    /// @notice The shared Earn controls: the Holder-ineligible flag and payment Successors.
    IEarnControls public controls;
    /// @notice When the current Reserve Shortfall began (0: none recorded).
    uint64 public shortfallSince;
    /// @dev The glide bands, ascending: `days << 16 | bps`, each the ratio for bonds due within
    /// `days` (and beyond the band before).
    uint256[] internal _glide;
    /// @dev Fenwick tree over maturity day: face of confirmed bonds that can roll.
    mapping(uint256 => uint256) private rollTree;
    mapping(uint256 => BondTerms) internal _terms;
    mapping(address => uint256[]) internal _confirmedOf;
    mapping(uint256 => uint256) internal _confirmedIndex;
    /// @dev every bond recorded since Phase 2f, in order: the Register the Required-Holder tallies read.
    uint256[] internal _register;
    /// @notice Maturity Amounts outstanding per Series (`issueDay << 32 | maturityDay`, days since
    /// 1970; IV-01: a Series is all Bonds with the same Issue Date and Maturity Date).
    mapping(uint64 => uint256) public seriesFaceOutstanding;
    mapping(uint32 => uint256[]) internal _confirmedOfTerm;
    mapping(uint256 => uint256) internal _confirmedTermIndex;

    uint256[20] private __gap;

    error BondVaultInvalidAddress();
    error BondVaultUnknownBond(uint256 bondId);
    error BondVaultBondExists(uint256 bondId);
    error BondVaultAlreadySettled(uint256 bondId);
    error BondVaultReserveFloorOutOfBounds(uint256 bps);
    error BondVaultWouldBreachReserve(uint256 deployable, uint256 requested);
    error BondVaultInsufficientFunds(uint256 held, uint256 required);
    error BondVaultBondPledged(uint256 bondId);
    error BondVaultMaturityOutOfRange(uint64 maturity);
    error BondVaultNotTrackedBorrower(address caller);
    error BondVaultLoanOutstanding(uint256 outstanding);
    error BondVaultBadSplit(uint256 toDebt, uint256 amount);
    error BondVaultNothingOwed(uint256 bondId);
    /// @dev An Enforcement Notice is in force (IV-10 §7.2).
    error BondVaultEnforcementInForce();
    error BondVaultNotAgent(address caller);
    error BondVaultNotControls(address caller);
    error BondVaultBadGlide();

    event PurchaseRecorded(uint256 indexed bondId, uint256 principal, uint256 faceValue, uint64 maturity);
    event Settled(uint256 indexed bondId, address indexed to, uint256 faceValue);
    event Rolled(
        uint256 indexed oldBondId,
        uint256 indexed newBondId,
        uint256 rolledPrincipal,
        uint256 newFaceValue,
        uint64 newMaturity
    );
    event SettledEarly(uint256 indexed bondId, address indexed to, uint256 presentValue, uint256 faceValue);
    event BackstopsUpdated(address indexed treasury, address indexed payoutPool);
    event EncumbranceSourceUpdated(address indexed source, bytes32 kind);
    event DrewFromTreasury(uint256 amount);
    event RepaidFromPayoutPool(uint256 amount, uint256 outstanding);
    event InterestReceived(uint256 principal, uint256 interest);
    event SettledPledged(uint256 indexed bondId, address indexed holder, uint256 paidToDebt, uint256 paidToHolder);
    event SettlementShortfall(uint256 indexed bondId, address indexed holder, uint256 debtOwed, uint256 holderOwed);
    event SettlementCompleted(
        uint256 indexed bondId,
        address indexed holder,
        uint256 paidToDebt,
        uint256 paidToHolder,
        uint256 debtOwed,
        uint256 holderOwed
    );
    // Phase 2f
    event BondTermsRecorded(uint256 indexed bondId, address indexed collection, uint32 yieldBps, uint64 seriesId);
    event RollRemainderPaid(uint256 indexed oldBondId, address indexed holder, address indexed payee, uint256 amount);
    event BondRetired(uint256 indexed bondId, uint256 faceValue);
    event BondPaidThroughDistributions(uint256 indexed bondId, uint256 faceValue);
    event RollConfirmationSet(uint256 indexed bondId, address indexed holder, bool confirmed, bool rolling);
    event ReserveShortfall(uint256 required, uint256 held);
    event ReserveShortfallCured(uint256 required, uint256 held, uint64 since);
    event ToppedUp(address indexed from, uint256 amount);
    event ReserveFloorRaised(uint256 previousBps, uint256 bps);
    event GlideScheduleSet(uint32[] bandDays, uint16[] bandBps);
    event EarnSourcesSet(address indexed agent, address indexed controls);
    event AgentTransfer(address indexed to, uint256 amount);
    event ExcessWithdrawn(address indexed to, uint256 amount);

    modifier notEnforced() {
        _notEnforced();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev The third argument was the governed reserve window; the window is FIXED at 90 days now
    /// and the argument is ignored.
    function initialize(address admin, address _reserveToken, uint64) external initializer {
        if (admin == address(0) || _reserveToken == address(0)) revert BondVaultInvalidAddress();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        reserveToken = IERC20Upgradeable(_reserveToken);
        minReserveBps = MIN_RESERVE_FLOOR_BPS;
    }

    /// @dev An upgrade is a change: the Earn timelock, and once the Agent is named its co-signature.
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        _change();
    }

    /* ========== VIEWS ========== */

    function held() public view returns (uint256) {
        return reserveToken.balanceOf(address(this));
    }

    /// @inheritdoc IAgentVault
    function collateralAssets() external view returns (uint256) {
        return held();
    }

    /// @inheritdoc IAgentBondBook
    function outstandingCount() external view returns (uint256) {
        return outstanding.length;
    }

    /// @inheritdoc IAgentBondBook
    function outstandingAt(uint256 index) external view returns (uint256) {
        return outstanding[index];
    }

    function outstandingBonds() external view returns (uint256[] memory) {
        return outstanding;
    }

    /// @notice a bond's Register terms (Phase 2f).
    function bondTerms(uint256 bondId) external view returns (BondTerms memory) {
        return _terms[bondId];
    }

    /// @notice the bonds `holder` has confirmed to roll.
    function confirmedBondsOf(address holder) external view returns (uint256[] memory) {
        return _confirmedOf[holder];
    }

    /// @notice the glide bands: (days, bps) ascending.
    function glideSchedule() external view returns (uint32[] memory bandDays, uint16[] memory bandBps) {
        uint256 n = _glide.length;
        bandDays = new uint32[](n);
        bandBps = new uint16[](n);
        for (uint256 i; i < n; ++i) {
            bandDays[i] = uint32(_glide[i] >> 16);
            bandBps[i] = uint16(_glide[i]);
        }
    }

    /// @notice the number of bonds in the Register (every bond recorded since Phase 2f).
    function registerLength() external view returns (uint256) {
        return _register.length;
    }

    /// @notice the `i`th bond recorded.
    function registerAt(uint256 i) external view returns (uint256) {
        return _register[i];
    }

    /// @notice what the Required-Holder tally needs about a bond: its Maturity Amount, Maturity Date
    /// and Issue Yield (for its Accreted Value at a record time), when it was recorded and when it
    /// left the Register (0: outstanding), and its Holder now.
    function registerEntry(uint256 bondId)
        external
        view
        returns (uint256 faceValue, uint64 maturity, uint32 yieldBps, uint64 issuedAt, uint64 endedAt, address holder)
    {
        Obligation storage o = obligations[bondId];
        BondTerms storage t = _terms[bondId];
        holder = t.endedAt == 0 && t.collection != address(0) ? IBondCollectionBook(t.collection).holderOf(bondId) : address(0);
        return (o.faceValue, o.maturity, t.yieldBps, t.issuedAt, t.endedAt, holder);
    }

    /// @inheritdoc IAgentBondBook
    /// @dev Its Accreted Value at `timestamp` at its Issue Yield (Accretion, rounded down), or its
    /// Maturity Amount once matured by then.
    function amountDueAt(uint256 bondId, uint256 timestamp) external view returns (uint256) {
        Obligation storage o = obligations[bondId];
        if (o.settled) return 0;
        return Accretion.accretedValue(o.faceValue, _terms[bondId].yieldBps, o.maturity, timestamp);
    }

    /// @inheritdoc IAgentBondBook
    function holderOf(uint256 bondId) external view returns (address) {
        address c = _terms[bondId].collection;
        return c == address(0) ? address(0) : IBondCollectionBook(c).holderOf(bondId);
    }

    /// @notice Maturity Amounts falling due inside a window, overdue ones included.
    function faceDueWithin(uint64 window) public view returns (uint256) {
        return _prefix(dueTree, window);
    }

    /// @notice Maturity Amounts falling due inside a window whose roll is confirmed and can roll.
    function rollingDueWithin(uint64 window) public view returns (uint256) {
        return _prefix(rollTree, window);
    }

    /// @notice the glide schedule's reserve: each bond at its band's ratio (never below the floor).
    function glideReserve() public view returns (uint256) {
        uint256 floor = minReserveBps;
        uint256 acc;
        uint256 prevDue;
        uint256 n = _glide.length;
        for (uint256 i; i < n; ++i) {
            uint256 band = _glide[i];
            uint256 due = faceDueWithin(uint64((band >> 16) * 1 days));
            uint256 bps = uint16(band);
            acc += (due - prevDue) * (bps > floor ? bps : floor);
            prevDue = due;
        }
        acc += (totalFaceOutstanding - prevDue) * floor;
        return acc.ceilDiv(BPS);
    }

    /// @notice 100% of every bond due within 90 days that will not roll.
    function nearTermReserve() public view returns (uint256) {
        return faceDueWithin(RESERVE_WINDOW) - rollingDueWithin(RESERVE_WINDOW);
    }

    /// @notice the Redemption Reserve (Earn §2), plus what is owed now: recorded settlement
    /// shortfalls and the Agent's distributions not yet claimed.
    function requiredReserve() public view returns (uint256) {
        uint256 glide = glideReserve();
        uint256 near = nearTermReserve();
        return (near > glide ? near : glide) + totalSettlementOwed + _unclaimed();
    }

    /// @inheritdoc IEarnReserveStatus
    function inReserveShortfall() public view returns (bool) {
        return held() < requiredReserve();
    }

    /// @inheritdoc IAgentVault
    function deployableExcess() public view returns (uint256) {
        uint256 balance = held();
        uint256 reserve = requiredReserve();
        return balance > reserve ? balance - reserve : 0;
    }

    /// @notice what the treasury can put up for a bond right now: its allowance, capped at its balance.
    function treasuryAvailable() public view returns (uint256) {
        if (treasury == address(0)) return 0;
        uint256 allowed = reserveToken.allowance(treasury, address(this));
        uint256 balance = reserveToken.balanceOf(treasury);
        return allowed < balance ? allowed : balance;
    }

    /// @notice face value due inside 90 days that neither the vault nor the treasury can pay.
    function uncoveredNearTerm() external view returns (uint256) {
        uint256 due = faceDueWithin(RESERVE_WINDOW);
        uint256 have = held() + treasuryAvailable();
        return due > have ? due - have : 0;
    }

    /// @notice whether the vault can pay everything due inside 90 days.
    function coversNearTermMaturities() external view returns (bool) {
        return held() >= faceDueWithin(RESERVE_WINDOW);
    }

    /* ========== BOND LIFECYCLE (BOND_ROLE: a collection) ========== */

    /// @notice records a purchase and the obligation it creates. Not while an Enforcement Notice is
    /// in force (IV-10 §7.2).
    function recordPurchase(
        uint256 bondId,
        uint256 principal,
        uint256 faceValue,
        uint64 maturity,
        uint32 yieldBps,
        uint32 termDays
    ) external onlyRole(BOND_ROLE) notEnforced {
        _record(bondId, principal, faceValue, maturity, yieldBps, termDays);
        totalPrincipal += principal;
        emit PurchaseRecorded(bondId, principal, faceValue, maturity);
        _syncShortfall();
    }

    /// @notice pays a matured, unpledged bond its Maturity Amount: to the Holder, or its registered
    /// payment Successor. What the vault and the treasury cannot pay is recorded as a settlement
    /// shortfall (Earn §4) rather than reverting.
    function settle(uint256 bondId, address holder) external onlyRole(BOND_ROLE) returns (uint256) {
        return _settle(bondId, address(0), 0, holder, obligations[bondId].faceValue);
    }

    /// @notice pays a matured pledged bond under its Maturity Instruction (MB-05 §5.6): `toDebt`
    /// first, to the pledge module for the Holder's own debt (C3), then the rest to the Holder.
    /// @return debtPaid what of `toDebt` was paid to `debtTo` now, for it to apply
    function settlePledged(uint256 bondId, address debtTo, uint256 toDebt, address holder)
        external
        onlyRole(BOND_ROLE)
        returns (uint256 debtPaid)
    {
        if (debtTo == address(0)) revert BondVaultInvalidAddress();
        return _settle(bondId, debtTo, toDebt, holder, obligations[bondId].faceValue);
    }

    /// @notice pays a bond `amount` (its Accreted Value) under `redeemAll` (R5, decision 14): split
    /// like `settlePledged` when pledged (`debtTo` set), else all to the Holder.
    function settleAt(uint256 bondId, address debtTo, uint256 toDebt, address holder, uint256 amount)
        external
        onlyRole(BOND_ROLE)
        returns (uint256 debtPaid)
    {
        if (amount > obligations[bondId].faceValue) revert BondVaultBadSplit(amount, obligations[bondId].faceValue);
        return _settle(bondId, debtTo, toDebt, holder, amount);
    }

    /// @notice pays what a settlement still owes, as far as the vault and the treasury can: the rest
    /// of `toDebt` first, then the rest of `toHolder` to the Holder (or its payment Successor).
    /// Anyone may call it; not while an Enforcement Notice is in force.
    function completeSettlement(uint256 bondId) external notEnforced {
        PendingSettlement storage pending = pendingSettlement[bondId];
        uint256 debtOwed = pending.debtOwed;
        uint256 holderOwed = pending.holderOwed;
        if (debtOwed + holderOwed < 1) revert BondVaultNothingOwed(bondId);
        uint256 have = _coverUpTo(debtOwed + holderOwed);
        if (have < 1) revert BondVaultInsufficientFunds(0, debtOwed + holderOwed);
        uint256 toDebt = have < debtOwed ? have : debtOwed;
        uint256 toHolder = have - toDebt;

        pending.debtOwed = debtOwed - toDebt;
        pending.holderOwed = holderOwed - toHolder;
        totalSettlementOwed -= have;
        address holder = pending.holder;
        emit SettlementCompleted(bondId, holder, toDebt, toHolder, debtOwed - toDebt, holderOwed - toHolder);
        if (toDebt > 0) {
            address debtTo = pending.debtTo;
            reserveToken.safeTransfer(debtTo, toDebt);
            IMaturityInstructionApplier(debtTo).applyMaturityInstruction(holder, toDebt);
        }
        if (toHolder > 0) reserveToken.safeTransfer(_payee(holder), toHolder);
        _syncShortfall();
    }

    /// @notice pays a pledged bond before maturity at its Accreted Value (`payPledged`, IV-01 §4.9),
    /// to the pledge module for the Holder's own debt (C3). The whole value or a revert.
    function settleEarly(uint256 bondId, address to, uint256 presentValue) external onlyRole(BOND_ROLE) notEnforced {
        Obligation storage obligation = obligations[bondId];
        if (obligation.faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (obligation.settled) revert BondVaultAlreadySettled(bondId);
        _cover(presentValue);
        uint256 faceValue = obligation.faceValue;
        _end(bondId, true);
        reserveToken.safeTransfer(to, presentValue);
        emit SettledEarly(bondId, to, presentValue, faceValue);
        _syncShortfall();
    }

    /// @notice rolls a matured obligation into a new one (IV-01 §5.2). Only the remainder (the old
    /// Maturity Amount less the new bond's Purchase Price) leaves, to the Holder; the rest stays.
    /// Not while an Enforcement Notice is in force (decision 19), even for a confirmed roll.
    function roll(
        uint256 oldBondId,
        uint256 newBondId,
        uint256 newFaceValue,
        uint64 newMaturity,
        uint32 yieldBps,
        uint32 termDays,
        address holder,
        uint256 remainder
    ) external onlyRole(BOND_ROLE) notEnforced {
        Obligation storage matured = obligations[oldBondId];
        if (matured.faceValue == 0) revert BondVaultUnknownBond(oldBondId);
        if (matured.settled) revert BondVaultAlreadySettled(oldBondId);
        uint256 rolled = matured.faceValue;
        if (remainder > rolled) revert BondVaultBadSplit(remainder, rolled);
        _end(oldBondId, false);
        _record(newBondId, rolled - remainder, newFaceValue, newMaturity, yieldBps, termDays);
        emit Rolled(oldBondId, newBondId, rolled - remainder, newFaceValue, newMaturity);
        if (remainder > 0) {
            _cover(remainder);
            address payee = _payee(holder);
            reserveToken.safeTransfer(payee, remainder);
            emit RollRemainderPaid(oldBondId, holder, payee, remainder);
        }
        _syncShortfall();
    }

    /// @notice drops a bond bought back from outside the vault (`buyback`, Earn §4(a)): the vault
    /// stops owing it and pays nothing.
    function retireUnpaid(uint256 bondId) external onlyRole(BOND_ROLE) notEnforced {
        Obligation storage o = obligations[bondId];
        if (o.faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (o.settled) revert BondVaultAlreadySettled(bondId);
        uint256 face = o.faceValue;
        _end(bondId, false);
        emit BondRetired(bondId, face);
        _syncShortfall();
    }

    /// @notice records or withdraws a Holder's roll confirmation (Earn §4A): a confirmed bond whose
    /// Holder is eligible leaves the 90-day 100% reserve, and a withdrawn one returns to it in the
    /// same transaction, which may start a Reserve Shortfall.
    function setRollConfirmation(uint256 bondId, address holder, bool confirmed) external onlyRole(BOND_ROLE) {
        BondTerms storage t = _terms[bondId];
        if (obligations[bondId].settled || obligations[bondId].faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (confirmed) {
            if (t.confirmedBy == address(0)) {
                t.confirmedBy = holder;
                _confirmedOf[holder].push(bondId);
                _confirmedIndex[bondId] = _confirmedOf[holder].length;
                _confirmedOfTerm[t.termDays].push(bondId);
                _confirmedTermIndex[bondId] = _confirmedOfTerm[t.termDays].length;
            }
            _setRolling(bondId, _canRoll(holder, t.termDays));
        } else {
            _unconfirm(bondId);
        }
        emit RollConfirmationSet(bondId, holder, confirmed, t.rolling);
        _syncShortfall();
    }

    /* ========== THE EARN CONTROLS' HOOK ========== */

    /// @inheritdoc IEarnControlsHook
    /// @dev A flagged Holder's confirmed bonds will not roll, so they return to the 100% reserve now.
    function holderEligibilityChanged(address holder, bool ineligible) external {
        if (msg.sender != address(controls)) revert BondVaultNotControls(msg.sender);
        uint256[] storage list = _confirmedOf[holder];
        for (uint256 i; i < list.length; ++i) {
            uint256 id = list[i];
            _setRolling(id, !ineligible && _termRollable(_terms[id].termDays));
        }
        _syncShortfall();
    }

    /// @inheritdoc IEarnControlsHook
    /// @dev A confirmed bond rolls into its own term or the nearest shorter offered one (IV-01
    /// §5.2(a)), so a change to term `termDays` can only change whether bonds of that term or longer
    /// can roll (§5.4: "no term of the same length or shorter is offered"). Each is re-read now.
    function termOfferChanged(uint32 termDays, bool) external {
        if (msg.sender != address(controls)) revert BondVaultNotControls(msg.sender);
        uint32[] memory terms = IEarnLadder(address(controls)).ladderTerms();
        for (uint256 i; i < terms.length; ++i) {
            uint32 term = terms[i];
            if (term < termDays) continue;
            bool rollable = _termRollable(term);
            uint256[] storage list = _confirmedOfTerm[term];
            for (uint256 j; j < list.length; ++j) {
                uint256 id = list[j];
                _setRolling(id, rollable && !controls.holderIneligible(_terms[id].confirmedBy));
            }
        }
        _syncShortfall();
    }

    /* ========== RESERVE SHORTFALL (Earn §2) ========== */

    /// @notice records the start or the cure of a Reserve Shortfall. Anyone may call it: time alone
    /// (bonds entering the 90-day window) can start one.
    function pokeReserve() external {
        _syncShortfall();
    }

    /// @notice pays USDC into the vault to cure a Reserve Shortfall. Anyone may.
    function topUp(uint256 amount) external {
        reserveToken.safeTransferFrom(msg.sender, address(this), amount);
        emit ToppedUp(msg.sender, amount);
        _syncShortfall();
    }

    /* ========== THE COLLATERAL AGENT (IV-10 Exhibit A) ========== */

    /// @inheritdoc IAgentVault
    function agentTransfer(address to, uint256 amount) external {
        _onlyAgent();
        reserveToken.safeTransfer(to, amount);
        emit AgentTransfer(to, amount);
    }

    /// @inheritdoc IAgentVault
    /// @dev The Agent checks two different treasury signers; the vault re-checks the destination,
    /// the Enforcement Notice and that assets after it stay at or above the Redemption Reserve.
    function agentWithdrawExcess(address to, uint256 amount) external notEnforced {
        _onlyAgent();
        if (to == address(0) || to != IAgentExcessDestination(address(agent)).excessDestination()) {
            revert BondVaultInvalidAddress();
        }
        uint256 deployable = deployableExcess();
        if (amount > deployable) revert BondVaultWouldBreachReserve(deployable, amount);
        reserveToken.safeTransfer(to, amount);
        emit ExcessWithdrawn(to, amount);
    }

    /// @inheritdoc IAgentBondBook
    /// @dev A bond paid in full through distributions (IV-10 §7.6): the vault stops owing it and the
    /// collection burns it and releases any pledge.
    function burnPaid(uint256 bondId) external {
        _onlyAgent();
        Obligation storage o = obligations[bondId];
        if (o.faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (o.settled) revert BondVaultAlreadySettled(bondId);
        uint256 face = o.faceValue;
        _end(bondId, true);
        emit BondPaidThroughDistributions(bondId, face);
        IBondCollectionBook(_terms[bondId].collection).burnPaid(bondId);
    }

    /* ========== BACKSTOPS ========== */

    function _cover(uint256 amount) private {
        uint256 balance = _coverUpTo(amount);
        if (balance < amount) revert BondVaultInsufficientFunds(balance, amount);
    }

    /// @dev Draws on the treasury, up to its allowance, for whatever of `amount` the vault does not
    /// hold, and returns what the vault holds afterwards, capped at `amount`.
    function _coverUpTo(uint256 amount) private returns (uint256) {
        uint256 balance = held();
        if (balance >= amount) return amount;
        uint256 short = amount - balance;
        uint256 fromTreasury = treasuryAvailable();
        if (fromTreasury > short) fromTreasury = short;
        if (fromTreasury > 0) {
            reserveToken.safeTransferFrom(treasury, address(this), fromTreasury);
            emit DrewFromTreasury(fromTreasury);
        }
        balance = held();
        return balance < amount ? balance : amount;
    }

    /// @notice lends nothing (C1, decision 3): excess leaves only to the registered multisig through
    /// the Collateral Agent. Kept as a stub that returns 0 and moves no USDC so that PayoutPool's
    /// unchanged draw path skips the vault rather than reverting until its vault leg is switched off
    /// by configuration (`PayoutPool.setBondVault(0)`).
    function lendToPayoutPool(uint256) external pure returns (uint256) {
        return 0;
    }

    /// @notice takes back what the payout pool borrowed before Phase 2f, and any carry on it. Only the
    /// payout pool (audit M-8). `lendToPayoutPool` is gone (C1, decision 3): this stays until any open
    /// loan is repaid.
    function repayFromPayoutPool(uint256 amount) external {
        if (payoutPool == address(0) || _msgSender() != payoutPool) revert BondVaultNotTrackedBorrower(_msgSender());
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 principal = lentToPayoutPool < amount ? lentToPayoutPool : amount;
        lentToPayoutPool -= principal;
        if (amount > principal) emit InterestReceived(principal, amount - principal);
        emit RepaidFromPayoutPool(amount, lentToPayoutPool);
    }

    /* ========== CHANGES (the Earn timelock, with the Agent's co-signature) ========== */

    /// @notice names the treasury and the payout pool. Zero is "none" for each.
    function setBackstops(address _treasury, address _payoutPool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _change();
        if (_payoutPool != payoutPool && lentToPayoutPool != 0) revert BondVaultLoanOutstanding(lentToPayoutPool);
        treasury = _treasury;
        payoutPool = _payoutPool;
        emit BackstopsUpdated(_treasury, _payoutPool);
    }

    /// @notice names what reports a bond pledged against drawn credit, and the kind to ask about.
    function setEncumbranceSource(address source, bytes32 kind) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _change();
        encumbranceSource = IBondEncumbranceSource(source);
        collateralKind = kind;
        emit EncumbranceSourceUpdated(source, kind);
    }

    /// @notice names the Collateral Agent and the Earn controls. Before the Agent is named this is the
    /// admin's alone; afterwards it is a co-signed change like any other.
    function setEarnSources(address agent_, address controls_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _change();
        agent = ICollateralAgent(agent_);
        controls = IEarnControls(controls_);
        emit EarnSourcesSet(agent_, controls_);
    }

    /// @notice raises the floor of the glide schedule. It can never be lowered (Earn §2, FIXED).
    function raiseReserveFloor(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _change();
        uint256 previous = minReserveBps;
        if (bps <= previous || bps > BPS) revert BondVaultReserveFloorOutOfBounds(bps);
        minReserveBps = bps;
        emit ReserveFloorRaised(previous, bps);
        _syncShortfall();
    }

    /// @notice sets the glide schedule's bands. Raise-only: at every time to maturity the new ratio
    /// is at least the old one, so no change can lower the reserve on any bond.
    function setGlideSchedule(uint32[] calldata bandDays, uint16[] calldata bandBps)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _change();
        uint256 n = bandDays.length;
        if (n != bandBps.length || n > MAX_GLIDE_BANDS) revert BondVaultBadGlide();
        uint256[] memory next = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            if (bandBps[i] > BPS || bandDays[i] == 0 || (i > 0 && bandDays[i] <= bandDays[i - 1])) revert BondVaultBadGlide();
            next[i] = (uint256(bandDays[i]) << 16) | bandBps[i];
        }
        uint256[] memory old = _glide;
        // Every breakpoint of either schedule; past the last one both are at the floor.
        for (uint256 i; i < old.length + n; ++i) {
            uint256 d = i < n ? next[i] >> 16 : old[i - n] >> 16;
            if (_ratioAt(next, d) < _ratioAt(old, d)) revert BondVaultBadGlide();
        }
        _glide = next;
        emit GlideScheduleSet(bandDays, bandBps);
        _syncShortfall();
    }

    /// @notice a role grant is a change: co-signed once the Agent is named.
    function grantRole(bytes32 role, address account) public override {
        _change();
        super.grantRole(role, account);
    }

    /// @notice a role revocation is a change: co-signed once the Agent is named.
    function revokeRole(bytes32 role, address account) public override {
        _change();
        super.revokeRole(role, account);
    }

    /* ========== INTERNALS ========== */

    function _record(
        uint256 bondId,
        uint256 principal,
        uint256 faceValue,
        uint64 maturity,
        uint32 yieldBps,
        uint32 termDays
    ) private {
        if (obligations[bondId].faceValue != 0) revert BondVaultBondExists(bondId);
        obligations[bondId] = Obligation({principal: principal, faceValue: faceValue, maturity: maturity, settled: false});
        outstanding.push(bondId);
        outstandingIndex[bondId] = outstanding.length;
        _addDue(dueTree, maturity, faceValue);
        bucketOf[bondId] = _bucketFor(maturity);
        totalFaceOutstanding += faceValue;
        uint64 maturityDay = maturity / 1 days;
        uint64 series = ((maturityDay - termDays) << 32) | maturityDay;
        seriesFaceOutstanding[series] += faceValue;
        _terms[bondId] =
            BondTerms(msg.sender, yieldBps, uint64(block.timestamp), address(0), 0, false, series, termDays);
        _register.push(bondId);
        emit BondTermsRecorded(bondId, msg.sender, yieldBps, series);
    }

    /// @dev Takes a bond off the books: out of the outstanding list, both trees and its series.
    function _end(uint256 bondId, bool paid) private {
        Obligation storage o = obligations[bondId];
        uint256 face = o.faceValue;
        _unconfirm(bondId);
        o.settled = true;
        totalFaceOutstanding -= face;
        if (paid) totalFaceSettled += face;
        _removeOutstanding(bondId);
        uint256 i = bucketOf[bondId];
        if (i != 0) {
            delete bucketOf[bondId];
            _removeAt(dueTree, i, face);
        }
        BondTerms storage t = _terms[bondId];
        t.endedAt = uint64(block.timestamp);
        if (seriesFaceOutstanding[t.seriesId] >= face) seriesFaceOutstanding[t.seriesId] -= face;
    }

    /// @dev Pays `amount` on a bond, `toDebt` of it first to `debtTo` (the pledge module) and the rest
    /// to the Holder; what the vault and the treasury cannot pay is recorded, debt part first.
    function _settle(uint256 bondId, address debtTo, uint256 toDebt, address holder, uint256 amount)
        private
        notEnforced
        returns (uint256 debtPaid)
    {
        Obligation storage obligation = obligations[bondId];
        if (obligation.faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (obligation.settled) revert BondVaultAlreadySettled(bondId);
        if (toDebt > amount) revert BondVaultBadSplit(toDebt, amount);
        if (debtTo == address(0)) {
            if (toDebt != 0) revert BondVaultBadSplit(toDebt, amount);
            if (
                address(encumbranceSource) != address(0)
                    && encumbranceSource.isItemEncumbered(holder, collateralKind, bondId)
            ) revert BondVaultBondPledged(bondId);
        }

        uint256 have = _coverUpTo(amount);
        debtPaid = have < toDebt ? have : toDebt;
        uint256 toHolder = amount - toDebt;
        uint256 paid = have - debtPaid < toHolder ? have - debtPaid : toHolder;

        _end(bondId, true);

        uint256 debtOwed = toDebt - debtPaid;
        uint256 holderOwed = toHolder - paid;
        if (debtOwed + holderOwed > 0) {
            pendingSettlement[bondId] = PendingSettlement(holder, debtTo, debtOwed, holderOwed);
            totalSettlementOwed += debtOwed + holderOwed;
            emit SettlementShortfall(bondId, holder, debtOwed, holderOwed);
        }
        if (debtPaid > 0) reserveToken.safeTransfer(debtTo, debtPaid);
        address payee = _payee(holder);
        if (paid > 0) reserveToken.safeTransfer(payee, paid);
        if (debtTo == address(0)) emit Settled(bondId, payee, paid);
        else emit SettledPledged(bondId, holder, debtPaid, paid);
        _syncShortfall();
    }

    function _setRolling(uint256 bondId, bool rolling) private {
        BondTerms storage t = _terms[bondId];
        if (t.rolling == rolling) return;
        t.rolling = rolling;
        uint256 i = bucketOf[bondId];
        uint256 face = obligations[bondId].faceValue;
        if (i == 0) return;
        if (rolling) {
            for (; i <= BUCKETS; i += i & (~i + 1)) rollTree[i] += face;
        } else {
            _removeAt(rollTree, i, face);
        }
    }

    function _unconfirm(uint256 bondId) private {
        BondTerms storage t = _terms[bondId];
        address holder = t.confirmedBy;
        if (holder == address(0)) return;
        _setRolling(bondId, false);
        _dropFrom(_confirmedOf[holder], _confirmedIndex, bondId);
        _dropFrom(_confirmedOfTerm[t.termDays], _confirmedTermIndex, bondId);
        t.confirmedBy = address(0);
    }

    function _dropFrom(uint256[] storage list, mapping(uint256 => uint256) storage indexOf, uint256 bondId) private {
        uint256 index = indexOf[bondId] - 1;
        uint256 last = list[list.length - 1];
        list[index] = last;
        indexOf[last] = index + 1;
        list.pop();
        delete indexOf[bondId];
    }

    /// @dev Whether a confirmed bond of `termDays` held by `holder` can roll as things stand: the
    /// Holder not flagged ineligible and a term of that length or shorter offered (IV-01 §5.4).
    function _canRoll(address holder, uint32 termDays) private view returns (bool) {
        IEarnControls c = controls;
        if (address(c) == address(0)) return true;
        return !c.holderIneligible(holder) && _termRollable(termDays);
    }

    function _termRollable(uint32 termDays) private view returns (bool) {
        IEarnControls c = controls;
        return address(c) == address(0) || c.rollTermFor(termDays) != 0;
    }

    function _syncShortfall() private {
        uint256 required = requiredReserve();
        uint256 balance = held();
        uint64 since = shortfallSince;
        if (balance < required) {
            if (since == 0) {
                shortfallSince = uint64(block.timestamp);
                emit ReserveShortfall(required, balance);
            }
        } else if (since != 0) {
            shortfallSince = 0;
            emit ReserveShortfallCured(required, balance, since);
        }
    }

    function _payee(address holder) private view returns (address) {
        IEarnControls c = controls;
        return address(c) == address(0) ? holder : c.payeeOf(holder);
    }

    function _unclaimed() private view returns (uint256) {
        ICollateralAgent a = agent;
        return address(a) == address(0) ? 0 : a.unclaimedDistributions();
    }

    function _notEnforced() private view {
        ICollateralAgent a = agent;
        if (address(a) != address(0) && a.enforcementInForce()) revert BondVaultEnforcementInForce();
    }

    function _onlyAgent() private view {
        if (msg.sender != address(agent) || msg.sender == address(0)) revert BondVaultNotAgent(msg.sender);
    }

    /// @dev Once the Agent is named, a change runs only as the exact call it co-signed.
    function _change() private {
        ICollateralAgent a = agent;
        if (address(a) != address(0)) a.consumeChange(keccak256(msg.data));
    }

    /// @dev The ratio a schedule gives a bond due in `d` days: its band's, or zero past the last band.
    function _ratioAt(uint256[] memory bands, uint256 d) private pure returns (uint256) {
        for (uint256 i; i < bands.length; ++i) if (bands[i] >> 16 >= d) return uint16(bands[i]);
        return 0;
    }

    function _bucketFor(uint256 timestamp) private pure returns (uint256) {
        return timestamp <= BUCKET_EPOCH ? 1 : (timestamp - BUCKET_EPOCH) / 1 days + 1;
    }

    function _prefix(mapping(uint256 => uint256) storage tree, uint64 window) private view returns (uint256 due) {
        uint256 i = _bucketFor(block.timestamp + window);
        if (i > BUCKETS) i = BUCKETS;
        for (; i > 0; i -= i & (~i + 1)) due += tree[i];
    }

    function _addDue(mapping(uint256 => uint256) storage tree, uint64 maturity, uint256 face) private {
        uint256 i = _bucketFor(maturity);
        if (i > BUCKETS) revert BondVaultMaturityOutOfRange(maturity);
        for (; i <= BUCKETS; i += i & (~i + 1)) tree[i] += face;
    }

    function _removeAt(mapping(uint256 => uint256) storage tree, uint256 i, uint256 face) private {
        for (; i <= BUCKETS; i += i & (~i + 1)) tree[i] -= face;
    }

    function _removeOutstanding(uint256 bondId) private {
        uint256 indexPlusOne = outstandingIndex[bondId];
        if (indexPlusOne == 0) return;
        uint256 index = indexPlusOne - 1;
        uint256 last = outstanding[outstanding.length - 1];
        outstanding[index] = last;
        outstandingIndex[last] = index + 1;
        outstanding.pop();
        delete outstandingIndex[bondId];
    }
}
