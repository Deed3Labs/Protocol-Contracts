// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../core/interfaces/stable-credit/IEncumbranceSource.sol";
import "./interfaces/IPoolEarnControls.sol";
import "./IExtensionKind.sol";

/// @title LendingPoolBase
/// @notice Everything the Yield Pool (`LendingPool`) and its valuation module share: storage,
/// errors, events and the internal accounting.
/// @dev The pool outgrew the 24 KiB limit when it became the Yield Pool (Phase 2f, decision 16),
/// so the valuation, holdback and deployment functions run in `YieldPoolValuation`, and Pool
/// Interest, Suspension, the rate model, recoveries, the legend and the restart leftover run in
/// `YieldPoolLedger`, both by delegatecall. All three inherit this contract and declare no storage
/// of their own, so they read and write the same slots. Never add a state variable to a child.
///
/// The pool's transfer hook (the pledge lock and the transfer allowlist) is `LendingPool`'s alone.
/// Share movements made in the module run without it, so the module moves shares only where the
/// hook would let them through anyway: out of the pool's escrow (a cancellation), into an
/// enforcement escrow (exempt), and a run-off of shares already checked free. Nothing seizes a
/// share: the Liquidator's `seizeShares` and its exemption are gone (Phase 2f stage 2, C5).
///
/// Storage is append-only against the Base Sepolia implementation recorded in
/// `.openzeppelin/base-sepolia.json` (slots 351-360, then a 40-slot gap). Slots 361-369 hold the
/// Phase 1 audit fields, which were never deployed there; the Yield Pool fields follow from 370.
/// The Settlement Funding lane (decision 54) follows the Yield Pool gap.
abstract contract LendingPoolBase is ERC4626Upgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    using MathUpgradeable for uint256;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice Retired: direct borrowing is off (decision 17). Kept so role scripts still resolve.
    bytes32 public constant BORROWER_ROLE = keccak256("BORROWER_ROLE");
    /// @notice Retired: single-signer loss reports are replaced by two-person postings (§6).
    bytes32 public constant LOSS_REPORTER_ROLE = keccak256("LOSS_REPORTER_ROLE");
    /// @notice Retired with `seizeShares` and its transfer exemption (Phase 2f stage 2, C5): it
    /// grants nothing. Kept so role scripts can still find and revoke it.
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");
    /// @notice An authorized individual for the valuation postings: one proposes, another approves.
    bytes32 public constant VALUATION_ROLE = keccak256("VALUATION_ROLE");
    /// @notice An authorized individual for Deployments: one proposes, another approves.
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");
    /// @notice An authorized individual for a Suspension.
    bytes32 public constant SUSPENSION_ROLE = keccak256("SUSPENSION_ROLE");
    /// @notice Clear Lending's chief compliance officer; may also sign a Suspension.
    bytes32 public constant CCO_ROLE = keccak256("CCO_ROLE");
    /// @notice Clear Lending's treasurer; may also sign a Suspension.
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    /// @notice The MB-05 pledge enforcer (stage 2's `PoolShareEnforcer`).
    bytes32 public constant ENFORCER_ROLE = keccak256("ENFORCER_ROLE");

    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    /// @notice Smallest subscription, in whole asset units (FIXED floor, §6).
    uint256 public constant MIN_SUBSCRIPTION_UNITS = 250;
    /// @notice Highest utilization a Deployment may leave behind (FIXED, §6).
    uint256 public constant MAX_UTILIZATION = 0.9e18;
    /// @notice How long a restart leftover takes to be recognized into Vault Cash (decision 29).
    uint256 public constant LEFTOVER_PERIOD = 30 days;
    /// @notice Rate model bounds (FIXED, IV-02 Sch. 2), as annual WAD rates.
    uint256 internal constant MAX_R0 = 0.05e18;
    uint256 internal constant MAX_S1 = 0.06e18;
    uint256 internal constant MIN_K = 0.6e18;
    uint256 internal constant MAX_K = 0.9e18;
    uint256 internal constant MAX_S2 = 0.10e18;
    uint256 internal constant MAX_RATE_SUM = 0.10e18;
    /// @notice Suspension reason codes (FIXED, §8).
    uint8 public constant LOSS_EVENT = 1;
    uint8 public constant LEGAL_ORDER = 2;
    uint8 public constant USDC_OR_NETWORK = 3;
    uint8 public constant VALUATION_PENDING = 4;
    /// @dev `redeemOrQueue` returns this as the request id when nothing was queued.
    uint256 public constant NO_REQUEST = type(uint256).max;

    /* ========== BASE SEPOLIA LAYOUT (slots 351-360) ========== */

    /// @dev Retired shape of a queued withdrawal: requests queued before Phase 2f, whose shares
    /// were burned and whose claim is fixed in assets. They are paid by `claimWithdrawal`.
    struct WithdrawalRequest {
        address owner;
        address receiver;
        uint256 assets;
        uint64 requestedAt;
        bool claimed;
    }

    /// @notice The Deployed Balance: Deployments plus capitalised interest, less Returns and
    /// Pool Loss Charges (IV-02). The name is kept for the apps and the storage report.
    uint256 public totalBorrowed;
    /// @notice Cash still owed to requests queued before Phase 2f. Outside Pool Assets.
    uint256 public queuedAssets;
    WithdrawalRequest[] internal requests;
    /// @dev Retired.
    mapping(address => uint256[]) internal requestsOf;
    /// @dev Retired per-cycle rate curve (replaced by `rateModel`).
    uint256 internal baseRatePerCycle;
    uint256 internal slope1PerCycle;
    uint256 internal slope2PerCycle;
    uint256 internal kinkBps;
    /// @notice Reports how many of a holder's shares are pledged.
    IEncumbranceSource public encumbranceSource;
    /// @notice The collateral kind these shares are pledged as.
    bytes32 public collateralKind;

    /* ========== PHASE 1 AUDIT FIELDS (slots 361-369, never deployed on Base Sepolia) ========== */

    /// @dev Retired with direct borrowing (decision 17).
    mapping(address => address) internal borrowDestinationOf;
    mapping(address => uint256) internal dailyBorrowCapOf;
    struct BorrowWindow {
        uint64 day;
        uint192 drawn;
    }
    mapping(address => BorrowWindow) internal borrowWindowOf;
    /// @dev Retired with X-7 (C4).
    mapping(uint256 => uint256) internal requestSharesOf;
    uint256 internal escrowedQueueCaps;
    /// @dev Retired with X-18: Pool Interest now accrues per second.
    uint192 internal lockedInterest;
    uint64 internal interestLockedAt;
    uint256 internal accountedCash;
    bool internal cashAccountingOn;
    /// @notice The lock last read successfully for each holder (audit M-3).
    mapping(address => uint256) public lastKnownLock;

    /* ========== YIELD POOL (Phase 2f, from slot 370) ========== */

    /// @dev A FIFO redemption request. Its shares wait in escrow in the pool, keep earning and
    /// bear losses, and are priced at fill (C4).
    struct QueueRequest {
        address owner;
        uint64 requestedAt;
        bool enforcement;
        address receiver;
        uint128 shares;
    }

    /// @dev One Loss Holdback (§6A): G and the held amount H. Open while H > 0.
    struct Holdback {
        address holder;
        uint64 createdAt;
        /// @dev `holdbackMaxAge` when it was created; a later raise never applies to it.
        uint32 maxAge;
        uint128 gross;
        uint128 held;
    }

    /// @dev A lowering of `holdbackMaxAge`, applied to every holdback with an id below `boundary`.
    /// Kept as a stack whose values rise with the boundary, so the first entry above an id is the
    /// lowest age limit that reaches it.
    struct AgeCap {
        uint128 boundary;
        uint128 maxAge;
    }

    /// @dev The Funding Rate model (IV-02 Sch. 2), annual rates as WAD.
    struct RateModel {
        uint64 r0;
        uint64 s1;
        uint64 k;
        uint64 s2;
    }

    struct PendingRate {
        RateModel model;
        uint64 effectiveAt;
        bool lowers;
    }

    /// @dev A posted Pool Loss Charge being applied to the open holdbacks in batches.
    struct LossCharge {
        uint128 amount;
        uint128 absorbed;
        uint256 denominator;
        uint64 cursor;
        uint64 end;
        uint64 id;
        bool pending;
    }

    struct Suspension {
        uint64 eventId;
        uint8 reason;
        uint64 startedAt;
        uint64 expiresAt;
        address lastSigner;
        bytes32 evidenceHash;
    }

    /// @notice The shared Earn controls: eligibility, exemption tag, pauses, wallets, transfers.
    IPoolEarnControls internal _earnControls;
    /// @notice Clear Lending's registered lending account: the only place a Deployment goes.
    address internal _deploymentAccount;
    /// @notice Where an MB-05 enforcement redemption pays (the pledge module's enforcer).
    address internal _enforcementDestination;
    /// @notice Pool Interest accrued and unpaid, as of `lastAccrualAt`.
    uint256 internal interestAccrued;
    uint64 internal _lastAccrualAt;
    /// @notice The first issue of Pool Shares; the Final Maturity Date is its 20th anniversary.
    uint64 internal _initialClosing;
    /// @dev Retired: the Holdback Percentage is now kept at full precision (`_holdbackRate`).
    uint16 internal _holdbackBps;
    /// @dev Retired: the holder cap is `EarnControls`' (per household, above its floor).
    uint16 internal _holderCapBps;
    /// @dev 0 none; 1 a holder is queuing their own shares; 2 an enforcement is queuing pledged ones.
    uint8 internal escrowMode;
    /// @notice The current Funding Rate model.
    RateModel internal _rateModel;
    /// @notice A rate-model change waiting for its notice period.
    PendingRate internal _pendingRate;
    /// @notice The calendar quarter (year × 4 + quarter, plus one) of the last rate-lowering change.
    uint32 internal _lastLoweringQuarter;

    QueueRequest[] internal queue;
    /// @notice The first request that may still be open.
    uint256 internal _queueHead;
    /// @notice Shares waiting in the queue.
    uint256 internal _queuedShares;
    /// @notice Shares each owner has waiting in the queue.
    mapping(address => uint256) internal _queuedSharesOf;
    /// @notice Pledged shares of each holder queued by an enforcement redemption.
    mapping(address => uint256) internal _enforcementQueuedOf;

    Holdback[] internal holdbacks;
    /// @notice The first holdback that may still be open.
    uint256 internal _holdbackHead;
    /// @notice Σ H of open holdbacks: held in the vault, outside Vault Cash and Pool Assets.
    uint256 internal _totalHoldback;
    /// @dev Σ G of open holdbacks, for the loss-charge denominator.
    uint256 internal openHoldbackGross;
    /// @notice Σ H of each Holder's open holdbacks.
    mapping(address => uint256) internal _holdbackOf;
    /// @notice The maximum age of a holdback, in seconds (governed; initially 540 days).
    uint256 internal _holdbackMaxAge;
    AgeCap[] internal ageCaps;
    /// @notice The last posted Pool Loss Allowance, and when.
    uint256 internal _poolLossAllowance;
    uint64 internal _allowancePostedAt;
    /// @dev A release pass after a lower posting: ids [releaseCursor, releaseEnd).
    uint64 internal releaseCursor;
    uint64 internal releaseEnd;
    /// @notice Releases from a lower posting not yet fully processed.
    bool internal _releasePending;
    LossCharge internal lossCharge;
    /// @notice Pool Loss Charges posted so far.
    uint256 internal _lossChargeCount;

    /// @notice The current or last Suspension.
    Suspension internal _suspension;
    /// @dev When the last Suspension on this evidence ended or is due to end.
    mapping(bytes32 => uint256) internal evidenceEndedAt;

    /// @notice The first signer of a two-person action still waiting for its second.
    mapping(bytes32 => address) internal _proposerOf;

    /// @notice Payments to an account its token transfer refused, claimable by that account.
    mapping(address => uint256) internal _unpaidOf;
    uint256 internal _totalUnpaid;

    /// @notice Deployments made, and their total.
    uint256 internal _deploymentCount;
    uint256 internal _totalDeployed;

    /* ========== IV-02 CONFORMANCE (Phase 2f; slots 406-416, the first 11 of the old 50-slot gap) ========== */

    /// @notice The Holdback Percentage as a WAD fraction (Pool Loss Allowance ÷ Pool Assets, as
    /// posted), so each Holdback Amount is rounded once, up, and never by a rounded percentage.
    uint256 internal _holdbackRate;
    /// @notice Pool Interest of the last month ended, still unpaid, due at `_billedDueAt`
    /// (IV-02 §4.6). Part of `interestAccrued`.
    uint256 internal _billedInterest;
    /// @notice When the billed interest is due: 23:59:59 Pacific on the 5th weekday after month end.
    uint64 internal _billedDueAt;
    /// @notice The end of the current interest month: 23:59:59 Pacific on its last day.
    uint64 internal _periodEnd;
    /// @notice Since when Utilization has stayed below 50% (IV-02 §2.6), or 0.
    uint64 internal _lowUtilSince;
    /// @notice When the restart leftover was set aside (decision 29).
    uint64 internal _leftoverStart;
    /// @notice The leftover set aside at a restart, recognized into Vault Cash over 30 days.
    uint256 internal _leftover;
    /// @notice Pool Loss Charges not yet restored by a recovery (IV-02 §5.4, decision 25).
    uint256 internal _unrestoredCharges;
    /// @notice The posted outstanding principal of the Pool Tiers plus Margin Advances: the
    /// Deployed Balance's ceiling (IV-02 §4.3).
    uint256 internal _poolTierPrincipal;
    uint64 internal _poolTierPostedAt;
    /// @notice When the pending Valuation Event was recorded (Exhibit A, A4; decision 26).
    uint64 internal _valuationEventAt;
    /// @notice When a scheduled legend change may take effect (decision 27).
    uint64 internal _legendEffectiveAt;
    bool internal _valuationEventPending;
    /// @notice Whether the pending Valuation Event has had its one VALUATION_PENDING Suspension.
    bool internal _valuationSuspended;
    /// @dev The start, counted back over earlier suspensions on the same facts, of the last
    /// suspension on this evidence, so the 10-Business-Day and 30-day limits count the total.
    mapping(bytes32 => uint256) internal evidenceStartedAt;
    /// @notice The IV-02 §8.4 legend the Register carries, and a scheduled replacement.
    string internal _legend;
    string internal _pendingLegend;
    /// @notice Pool Interest capitalized into the Deployed Balance so far.
    uint256 internal _totalCapitalized;

    /* ========== ENFORCEMENT (Phase 2f stage 2; slot 417, the 12th of the old 50-slot gap) ========== */

    /// @dev What the queue has filled of each holder's enforcement redemptions, cumulatively:
    /// the pledged shares it burned and what it paid to `enforcementDestination` for them (net of
    /// the holdback). `PoolShareEnforcer` applies the difference since it last looked (stage 2).
    struct EnforcementFill {
        uint128 shares;
        uint128 paid;
    }
    mapping(address => EnforcementFill) internal _enforcementFilled;

    /* ========== LEGAL HOLDS (Phase 2f stage 3; slots 418-419) ========== */

    /// @dev A hold required by law (IV-02 §7.5; decision 34): `shares` of `holder`'s Pool Shares
    /// may not be redeemed, queued, transferred or pledged until two signers release it or
    /// `expiresAt` (the order's stated expiry; 0 for none) passes. It moves and burns nothing.
    struct LegalHold {
        address holder;
        uint64 expiresAt;
        bool released;
        uint128 shares;
        bytes32 orderHash;
    }
    LegalHold[] internal _legalHolds;
    /// @dev The ids of each holder's holds not yet released (expired ones until pruned).
    mapping(address => uint256[]) internal _openHoldsOf;

    /// @dev Room for later fields. Named apart from the Base Sepolia `__gap` (slots 361-400), which
    /// the fields above have used up and run past, as the last contract in the layout may.
    /// OpenZeppelin's layout check recognizes a gap only by the names `__gap` and `__gap_*`, so it
    /// cannot be shrunk under the check against the deployed layout: later fields follow it.
    uint256[36] private __yieldPoolGap;

    /* ========== SETTLEMENT FUNDING LANE (decision 54; slots 456-459, after the Yield Pool gap) ========== */

    /// @dev The automated Settlement Funding lane (IV-02 §4.3A; L-01 §8.4A): a Standing Approval
    /// (C-01 §6.14) with a fixed destination (the registered deployment account), a per-period limit
    /// and an immediate stop. One registered funder may make a Deployment alone, up to `capPerPeriod`
    /// in each period of `periodSeconds` counted from when it was set. `epoch` counts the stops, so a
    /// proposal made before a stop cannot restart the lane with one signature after it.
    struct SettlementLane {
        address funder;
        uint64 periodSeconds;
        bool stopped;
        uint24 epoch;
        /// @dev The start of the period last used, and what the lane deployed in it.
        uint64 periodStart;
        uint192 used;
        uint256 capPerPeriod;
    }
    SettlementLane internal _settlementLane;
    /// @notice How far above the posted Pool Tier principal the lane (only) may take the Deployed
    /// Balance: credit portions authorized and not yet settled (IV-02 §4.3A).
    uint256 internal _settlementHeadroom;

    /// @dev Room for later fields, named as OpenZeppelin's check recognizes a gap.
    uint256[46] private __gap_settlementLane;

    /* ========== ERRORS ========== */

    error LendingPoolInvalidAddress();
    error LendingPoolInsufficientCash(uint256 available, uint256 requested);
    error LendingPoolNothingQueued(uint256 requestId);
    error LendingPoolNotRequestOwner(uint256 requestId);
    error LendingPoolEncumbered(address holder, uint256 free, uint256 amount);
    error LendingPoolSeizureExceedsEncumbrance(address holder, uint256 encumbered, uint256 amount);
    error LendingPoolEncumbranceUnreadable(address holder);
    error LendingPoolDirectBorrowOff();
    error LendingPoolNoControls();
    error LendingPoolSubscriptionsPaused();
    error LendingPoolBelowMinimum(uint256 assets);
    error LendingPoolHolderCap(address member, uint256 held, uint256 cap);
    error LendingPoolTransferNotAllowed(address from, address to);
    error LendingPoolSuspended();
    error LendingPoolChargePending();
    error LendingPoolReleasePending();
    error LendingPoolQueueOpen();
    error LendingPoolFinalMaturity();
    error LendingPoolNotFinalMaturity();
    error LendingPoolUtilizationCap(uint256 utilization);
    error LendingPoolNotAuthorized(address account);
    error LendingPoolSameSigner(address account);
    error LendingPoolInvalidAmount();
    error LendingPoolInvalidRateModel();
    error LendingPoolRateNotice(uint256 effectiveAt);
    error LendingPoolRateQuarter(uint256 quarter);
    error LendingPoolBadReason(uint8 reason);
    error LendingPoolNotSuspended();
    error LendingPoolSuspensionCeiling();
    error LendingPoolResolutionRequired();
    error LendingPoolNotRenewable();
    error LendingPoolAlreadyInitialized();
    error LendingPoolModuleMismatch();
    error LendingPoolTierCap(uint256 deployedBalance, uint256 poolTierPrincipal);
    error LendingPoolNoValuationEvent();
    error LendingPoolNotYet(uint256 effectiveAt);
    error LendingPoolReceiverNotOwner(address receiver);
    error LendingPoolSettlementCap(uint256 usedInPeriod, uint256 capPerPeriod, uint256 amount);

    /* ========== EVENTS ========== */

    event Repaid(address indexed from, uint256 amount);
    event WithdrawalClaimed(uint256 indexed requestId, address indexed receiver, uint256 assets);
    event EncumbranceSourceUpdated(address indexed source);
    /// @notice The encumbrance source reverted while a holder's shares moved (audit M-3). Alert on it.
    event EncumbranceSourceReverted(address indexed holder, uint256 lastKnownLock);

    event YieldPoolInitialized(address controls, address deploymentAccount, uint256 openingDeployedBalance);
    event EarnControlsUpdated(address indexed controls);
    event DeploymentAccountUpdated(address indexed account);
    event EnforcementDestinationUpdated(address indexed destination);
    event InitialClosingRecorded(uint256 at, uint256 finalMaturity);
    event Subscribed(address indexed payer, address indexed receiver, uint256 assets, uint256 shares, bytes32 exemptionCode);
    event InterestAccrued(uint256 amount, uint256 rate, uint256 interestAccrued);
    event Deployed(uint256 indexed deploymentId, address indexed to, uint256 amount, address proposer, address approver);
    event Returned(address indexed from, uint256 interestPaid, uint256 principalPaid, uint256 excess);
    event QueueRequested(uint256 indexed requestId, address indexed owner, address indexed receiver, uint256 shares, bool enforcement);
    event QueueFilled(uint256 indexed requestId, uint256 shares, uint256 gross, uint256 paid, uint256 remainingShares);
    event QueueCancelled(uint256 indexed requestId, address indexed by, uint256 shares, uint256 remainingShares);
    event HoldbackRecorded(address indexed holder, uint256 indexed id, uint256 gross, uint256 held);
    event HoldbackReleased(uint256 indexed id, uint256 amount);
    event HoldbackApplied(uint256 indexed id, uint256 amount, uint256 indexed lossChargeId);
    event HoldbackMaxAgeUpdated(uint256 maxAge);
    /// @param holdbackRate the Holdback Percentage as a WAD fraction.
    event AllowancePosted(uint256 value, uint256 holdbackRate, uint256 poolAssets, bytes32 evidenceHash, address proposer, address approver);
    event LossChargePosted(uint256 indexed lossChargeId, uint256 value, uint256 denominator, bytes32 evidenceHash, address proposer, address approver);
    event LossChargeCompleted(uint256 indexed lossChargeId, uint256 absorbed, uint256 toDeployed, uint256 toInterest, uint256 paidOut);
    event ActionProposed(bytes32 indexed action, address indexed proposer);
    event ActionApproved(bytes32 indexed action, address indexed proposer, address indexed approver);
    event Suspended(uint256 indexed eventId, uint8 reason, bytes32 evidenceHash, uint256 expiresAt, address proposer, address approver);
    event SuspensionRenewed(uint256 indexed eventId, uint256 expiresAt, address signer, bytes32 resolutionHash, bytes32 orderHash);
    event SuspensionLifted(uint256 indexed eventId, address signer);
    event RateModelProposed(uint256 r0, uint256 s1, uint256 k, uint256 s2, uint256 effectiveAt, bool lowers);
    event RateModelApplied(uint256 r0, uint256 s1, uint256 k, uint256 s2);
    event RunOffRequested(address indexed holder, uint256 requestId, uint256 shares);
    event PaymentDeferred(address indexed to, uint256 amount);
    event UnpaidClaimed(address indexed to, uint256 amount);
    event InterestBilled(uint256 amount, uint256 dueAt);
    event InterestCapitalized(uint256 amount, uint256 deployedBalance);
    event LeftoverSetAside(uint256 amount, uint256 recognizedBy);
    event RecoveryPosted(uint256 value, uint256 unrestored, bytes32 evidenceHash, address proposer, address approver);
    event ValuationEventRecorded(bytes32 evidenceHash, address proposer, address approver);
    event ValuationEventCleared();
    event PoolTierPrincipalPosted(uint256 value, bytes32 evidenceHash, address proposer, address approver);
    event LegendScheduled(bytes32 indexed legendHash, string legend, uint256 effectiveAt);
    event LegendSet(bytes32 indexed legendHash, string legend);
    event LegalHoldPlaced(uint256 indexed holdId, address indexed holder, uint256 shares, bytes32 orderHash, uint256 expiresAt, address proposer, address approver);
    event LegalHoldReleased(uint256 indexed holdId, address indexed holder, address proposer, address approver);
    event SuccessorRedemptionRequested(address indexed holder, address indexed successor, uint256 requestId, uint256 shares);
    /// @notice The Settlement Funding lane (decision 54).
    event SettlementFunderSet(address indexed funder, uint256 capPerPeriod, uint64 periodSeconds, address proposer, address approver);
    event SettlementHeadroomSet(uint256 amount, address proposer, address approver);
    event SettlementFunderStopped(address indexed funder, address indexed by);
    /// @param periodUsed what the lane has deployed in the period running, this Deployment included.
    event SettlementDeployed(uint256 indexed id, uint256 amount, bytes32 ref, uint256 periodUsed);

    /* ========== ACCOUNTING ========== */

    /// @notice Pool Assets: Vault Cash, the Deployed Balance and accrued unpaid Pool Interest.
    /// @dev From stored values: exact once `_accrue` has run in this block. `LendingPool` projects
    /// the interest since then for its views (`YieldPoolLedger.projectedPoolAssets`).
    function totalAssets() public view virtual override returns (uint256) {
        return _poolAssets();
    }

    /// @dev Vault Cash excludes Holdback Amounts, cash owed to pre-2f queued requests, payments
    /// waiting to be claimed and the unrecognized restart leftover. The Pool Loss Allowance is not
    /// subtracted (§5.5).
    function _poolAssets() internal view returns (uint256) {
        uint256 gross = _cash() + totalBorrowed + interestAccrued;
        uint256 owed = _spokenFor() + _unrecognized();
        return gross > owed ? gross - owed : 0;
    }

    function _cash() internal view returns (uint256) {
        return IERC20Upgradeable(asset()).balanceOf(address(this));
    }

    /// @dev USDC in the vault that is not the pool's: holdbacks, pre-2f claims, unclaimed payments.
    function _spokenFor() internal view returns (uint256) {
        return _totalHoldback + (queuedAssets - escrowedQueueCaps) + _totalUnpaid;
    }

    /// @dev The part of the restart leftover not yet recognized: it falls linearly to zero over
    /// `LEFTOVER_PERIOD` (decision 29), rounded up so recognition never runs ahead.
    function _unrecognized() internal view returns (uint256) {
        uint256 end = uint256(_leftoverStart) + LEFTOVER_PERIOD;
        if (block.timestamp >= end) return 0;
        return _leftover.mulDiv(end - block.timestamp, LEFTOVER_PERIOD, MathUpgradeable.Rounding.Up);
    }

    function _vaultCash() internal view returns (uint256) {
        uint256 cash = _cash();
        uint256 owed = _spokenFor() + _unrecognized();
        return cash > owed ? cash - owed : 0;
    }

    /// @dev Utilization: the Deployed Balance ÷ (the Deployed Balance + Vault Cash), as WAD
    /// (IV-02 §1.2). Accrued interest is not in it; zero when both are zero.
    function _utilizationOf(uint256 deployed, uint256 cash) internal pure returns (uint256) {
        return deployed == 0 ? 0 : deployed.mulDiv(WAD, deployed + cash);
    }

    /// @dev The low-Utilization clock (IV-02 §2.6), after every change to the Deployed Balance or
    /// Vault Cash: set when Utilization is below 50% and was not, cleared when it is at least 50%.
    function _syncClock() internal {
        if (_lastAccrualAt == 0) return;
        uint256 d = totalBorrowed;
        bool low = d == 0 || d < _vaultCash();
        if (!low) {
            if (_lowUtilSince != 0) _lowUtilSince = 0;
        } else if (_lowUtilSince == 0) {
            _lowUtilSince = uint64(block.timestamp);
        }
    }

    /// @dev The ledger module, where Pool Interest is booked.
    function _ledgerModule() internal view virtual returns (address);

    /// @dev Books Pool Interest to now, billing and capitalizing as months end and fall due
    /// (`YieldPoolLedger.accrue`). Called before anything that moves the Deployed Balance, Vault
    /// Cash or the rate. Once per block is enough.
    function _accrue() internal virtual {
        if (_lastAccrualAt == block.timestamp) return;
        _delegate(_ledgerModule(), abi.encodeWithSignature("accrue()"));
    }

    /// @dev Runs `data` in `target` against this contract's storage, bubbling any revert.
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function _delegate(address target, bytes memory data) internal returns (bytes memory ret) {
        bool ok;
        (ok, ret) = target.delegatecall(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    /// @dev H for a gross amount G: G × the Holdback Percentage, rounded up (Exhibit A, A6).
    function _heldOf(uint256 gross) internal view returns (uint256) {
        return gross.mulDiv(_holdbackRate, WAD, MathUpgradeable.Rounding.Up);
    }

    /// @notice whether a Suspension is in force.
    function isSuspended() public view returns (bool) {
        return _suspension.expiresAt > block.timestamp;
    }

    /// @dev Pays an account. A transfer its token refuses (a blocked address) is kept for it to
    /// claim instead, so one refused payment cannot hold up the queue or a holdback batch.
    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        address token = asset();
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Upgradeable.transfer, (to, amount)));
        if (ok && (ret.length == 0 ? token.code.length > 0 : abi.decode(ret, (bool)))) return;
        _unpaidOf[to] += amount;
        _totalUnpaid += amount;
        emit PaymentDeferred(to, amount);
    }

    /// @dev Closes or shrinks holdback `id` by `amount`, keeping the totals in step.
    function _reduceHoldback(uint256 id, uint256 amount) internal returns (Holdback storage h) {
        h = holdbacks[id];
        uint256 held = h.held - amount;
        h.held = uint128(held);
        _totalHoldback -= amount;
        _holdbackOf[h.holder] -= amount;
        if (held == 0) openHoldbackGross -= h.gross;
    }

    /// @dev When holdback `id` reaches its maximum age: its creation plus the lowest maximum age
    /// in force since it was created. That is the smaller of its own (the value at creation) and
    /// the first age cap above its id, since the caps' values rise with their boundaries.
    function _releaseAt(uint256 id) internal view returns (uint256) {
        Holdback storage h = holdbacks[id];
        uint256 age = h.maxAge;
        uint256 lo;
        uint256 hi = ageCaps.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (ageCaps[mid].boundary > id) hi = mid;
            else lo = mid + 1;
        }
        if (lo < ageCaps.length && ageCaps[lo].maxAge < age) age = ageCaps[lo].maxAge;
        return uint256(h.createdAt) + age;
    }

    function _dequeue(QueueRequest storage r, uint256 shares) internal {
        _queuedShares -= shares;
        _queuedSharesOf[r.owner] -= shares;
        if (r.enforcement) _enforcementQueuedOf[r.owner] -= shares;
    }

    function _enqueue(address owner, address receiver, uint256 shares, bool enforcement) internal returns (uint256 id) {
        if (receiver == address(0) || shares == 0) revert LendingPoolInvalidAmount();
        escrowMode = enforcement ? 2 : 1;
        _transfer(owner, address(this), shares);
        escrowMode = 0;
        id = queue.length;
        queue.push(QueueRequest(owner, uint64(block.timestamp), enforcement, receiver, uint128(shares)));
        _queuedShares += shares;
        _queuedSharesOf[owner] += shares;
        emit QueueRequested(id, owner, receiver, shares, enforcement);
    }

    function _readLock(address holder) internal view returns (uint256 locked, bool ok) {
        if (address(encumbranceSource) == address(0) || collateralKind == bytes32(0)) return (0, true);
        try encumbranceSource.encumberedOfKind(holder, collateralKind) returns (uint256 value) {
            return (value, true);
        } catch {
            return (0, false);
        }
    }

    /// @dev The lock still on a holder's own balance: pledged shares already queued by an
    /// enforcement redemption count against it.
    function _lockOnBalance(address holder, uint256 locked) internal view returns (uint256) {
        uint256 queued = _enforcementQueuedOf[holder];
        return locked > queued ? locked - queued : 0;
    }

    /// @dev Fails closed for pledgers, open for everyone else (audit M-3).
    function _encumberedOf(address holder) internal view returns (uint256) {
        (uint256 locked, bool ok) = _readLock(holder);
        if (ok) return locked;
        return lastKnownLock[holder] > 0 ? type(uint256).max : 0;
    }

    /// @dev Shares free of the pledge lock and of any legal hold in force.
    function _freeSharesOf(address holder) internal view returns (uint256) {
        uint256 locked = _encumberedOf(holder);
        if (locked != type(uint256).max) locked = _lockOnBalance(holder, locked);
        return _unheld(balanceOf(holder), locked, holder);
    }

    /// @dev `balance` less `locked`, less the shares under a legal hold in force, floored at zero.
    function _unheld(uint256 balance, uint256 locked, address holder) internal view returns (uint256 free) {
        free = balance > locked ? balance - locked : 0;
        uint256 held = _legallyHeld(holder);
        free = free > held ? free - held : 0;
    }

    /// @dev The shares of `holder` under legal holds still in force: not released, and before the
    /// order's stated expiry (IV-02 §7.5; decision 34).
    function _legallyHeld(address holder) internal view returns (uint256 held) {
        uint256[] storage ids = _openHoldsOf[holder];
        for (uint256 i; i < ids.length; ++i) {
            LegalHold storage h = _legalHolds[ids[i]];
            if (h.expiresAt == 0 || block.timestamp < h.expiresAt) held += h.shares;
        }
    }

    /// @dev The two-person rule: the first authorized signer's call proposes `action`; the same
    /// call from a different authorized signer applies it. Returns the first signer when applied.
    function _pair(bytes32 action, bytes32 role) internal returns (bool done, address first) {
        if (!hasRole(role, msg.sender)) revert LendingPoolNotAuthorized(msg.sender);
        first = _proposerOf[action];
        if (first == msg.sender) revert LendingPoolSameSigner(msg.sender);
        if (first == address(0) || !hasRole(role, first)) {
            _proposerOf[action] = msg.sender;
            emit ActionProposed(action, msg.sender);
            return (false, address(0));
        }
        delete _proposerOf[action];
        emit ActionApproved(action, first, msg.sender);
        return (true, first);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
