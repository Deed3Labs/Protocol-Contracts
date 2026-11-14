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
/// so the valuation, holdback, suspension, rate-model and deployment functions run in
/// `YieldPoolValuation` by delegatecall. Both inherit this contract and declare no storage of
/// their own, so they read and write the same slots. Never add a state variable to either child.
///
/// Storage is append-only against the Base Sepolia implementation recorded in
/// `.openzeppelin/base-sepolia.json` (slots 351-360, then a 40-slot gap). Slots 361-369 hold the
/// Phase 1 audit fields, which were never deployed there; the Yield Pool fields follow from 370.
abstract contract LendingPoolBase is ERC4626Upgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    using MathUpgradeable for uint256;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice Retired: direct borrowing is off (decision 17). Kept so role scripts still resolve.
    bytes32 public constant BORROWER_ROLE = keccak256("BORROWER_ROLE");
    /// @notice Retired: single-signer loss reports are replaced by two-person postings (§6).
    bytes32 public constant LOSS_REPORTER_ROLE = keccak256("LOSS_REPORTER_ROLE");
    /// @notice May take shares that are backing drawn credit, and only those. Removed in stage 2
    /// with `seizeShares` (C5).
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
    /// @notice The Holdback Percentage, in basis points (allowance ÷ Pool Assets, rounded up).
    uint16 internal _holdbackBps;
    /// @notice The holder cap, per member, in basis points of outstanding shares.
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

    uint256[50] private __gap;

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

    /* ========== EVENTS ========== */

    event Repaid(address indexed from, uint256 amount);
    event WithdrawalClaimed(uint256 indexed requestId, address indexed receiver, uint256 assets);
    event EncumbranceSourceUpdated(address indexed source);
    event SharesSeized(address indexed holder, address indexed to, uint256 shares);
    /// @notice The encumbrance source reverted while a holder's shares moved (audit M-3). Alert on it.
    event EncumbranceSourceReverted(address indexed holder, uint256 lastKnownLock);

    event YieldPoolInitialized(address controls, address deploymentAccount, uint256 openingDeployedBalance);
    event EarnControlsUpdated(address indexed controls);
    event DeploymentAccountUpdated(address indexed account);
    event EnforcementDestinationUpdated(address indexed destination);
    event HolderCapUpdated(uint256 bps);
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
    event AllowancePosted(uint256 value, uint256 holdbackBps, uint256 poolAssets, bytes32 evidenceHash, address proposer, address approver);
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

    /* ========== ACCOUNTING ========== */

    /// @notice Pool Assets: Vault Cash, the Deployed Balance and accrued unpaid Pool Interest.
    /// @dev Vault Cash excludes Holdback Amounts, cash owed to pre-2f queued requests and payments
    /// waiting to be claimed. The Pool Loss Allowance is not subtracted (§6).
    function totalAssets() public view virtual override returns (uint256) {
        return _poolAssets();
    }

    function _poolAssets() internal view returns (uint256) {
        uint256 gross = _cash() + totalBorrowed + interestAccrued + _pendingInterest();
        uint256 owed = _spokenFor();
        return gross > owed ? gross - owed : 0;
    }

    function _cash() internal view returns (uint256) {
        return IERC20Upgradeable(asset()).balanceOf(address(this));
    }

    /// @dev USDC in the vault that is not the pool's: holdbacks, pre-2f claims, unclaimed payments.
    function _spokenFor() internal view returns (uint256) {
        return _totalHoldback + (queuedAssets - escrowedQueueCaps) + _totalUnpaid;
    }

    function _vaultCash() internal view returns (uint256) {
        uint256 cash = _cash();
        uint256 owed = _spokenFor();
        return cash > owed ? cash - owed : 0;
    }

    /// @dev Utilization from stored values: (Pool Assets − Vault Cash) ÷ Pool Assets, as WAD.
    function _utilization(uint256 pending) internal view returns (uint256) {
        uint256 out = totalBorrowed + interestAccrued + pending;
        uint256 total = out + _vaultCash();
        return total == 0 ? 0 : out.mulDiv(WAD, total);
    }

    /// @dev R = R₀ + S₁·(U/K) up to the kink, then R₀ + S₁ + S₂·((U−K)/(1−K)) (IV-02 Sch. 2).
    function _rateAt(uint256 u) internal view returns (uint256) {
        RateModel memory m = _rateModel;
        if (u > WAD) u = WAD;
        if (u <= m.k) return m.k == 0 ? m.r0 : m.r0 + (uint256(m.s1) * u) / m.k;
        return m.r0 + m.s1 + (uint256(m.s2) * (u - m.k)) / (WAD - m.k);
    }

    /// @dev Pool Interest since the last accrual, per second on the Deployed Balance at the
    /// Funding Rate, on a 365-day year.
    function _pendingInterest() internal view returns (uint256) {
        uint256 since = _lastAccrualAt;
        if (since == 0 || since >= block.timestamp || totalBorrowed == 0) return 0;
        return (totalBorrowed * _rateAt(_utilization(0)) * (block.timestamp - since)) / (365 days * WAD);
    }

    /// @dev Books the interest accrued so far. Called before anything that moves the Deployed
    /// Balance, Vault Cash or the rate.
    function _accrue() internal {
        uint256 pending = _pendingInterest();
        if (pending > 0) {
            uint256 rate = _rateAt(_utilization(0));
            interestAccrued += pending;
            emit InterestAccrued(pending, rate, interestAccrued);
        }
        if (_lastAccrualAt != 0) _lastAccrualAt = uint64(block.timestamp);
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
