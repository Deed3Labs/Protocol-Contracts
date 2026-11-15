// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../core/interfaces/stable-credit/IStableCredit.sol";
import "../core/interfaces/stable-credit/ICreditIssuer.sol";
import "../core/interfaces/IESADepositVault.sol";
import "./PauseClock.sol";

interface IClearUSDSeizable {
    function seize(address holder, address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ICollateralSeizureSink {
    function recordSeizure(address member, bytes32 kind, uint256 amount) external;
    function recordEnforcementRedemption(address member, bytes32 kind, uint256 units) external;

    function encumberedOfKind(address holder, bytes32 kind) external view returns (uint256);
    function collateralValueOf(address member, bytes32 kind) external view returns (uint256);
    function pledgedItemsOf(address member, bytes32 kind) external view returns (uint256[] memory);
    function isItemPledged(address holder, bytes32 kind, uint256 itemId) external view returns (bool);
    function advancedValueOf(address member, bytes32 kind, uint256 excludeItem) external view returns (uint256);
    function advanceBpsOf(address member, bytes32 kind) external view returns (uint256);
    function enforcementOrderOf(address member, bytes32 kind) external view returns (uint256[] memory);
    function networkRegistry() external view returns (address);
}

/// @dev Whether the default an issuer recorded belongs to the member's current line (Phase 4b, M-C).
interface ICurrentLineDefault {
    function hasDefaultedOnCurrentLine(address member) external view returns (bool);
}

/// @notice The bond collection whose pledged bonds this contract answers for (Phase 2e).
/// @dev It takes no bond and redeems none. A pledged bond is paid under its own terms, by the
/// collection's `payPledged` and `settle`; this contract says whether MB-05 permits enforcement
/// and applies what the bond pays to the Holder's own debt.
interface IEarnBonds {
    function presentValueOf(uint256 bondId) external view returns (uint256);
    function bondVault() external view returns (address);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function collateralKind() external view returns (bytes32);
}

/// @notice The Yield Pool, as the pledge module reads it (Phase 2f, C5): only its collateral kind
/// and what an MB-05 enforcement redemption has queued. Nothing here moves a share; the pool's
/// `seizeShares` is gone and pledged shares leave only through `PoolShareEnforcer`.
/// @dev The name is kept from before Phase 2f so the stored `earnPool` keeps its type.
interface ISeizableShares {
    function collateralKind() external view returns (bytes32);
    function enforcementQueuedOf(address holder) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);
}

/// @dev A term issuer's plans secured under MB-05 (12.14): what a defaulted secured plan owes.
interface ISecuredTermPlans {
    function openPlansOf(address member) external view returns (uint256[] memory);
    function securedPlans(uint256 planId)
        external
        view
        returns (bool, address, uint64 noticeAt, uint64 defaultedAt, uint128 noticeDue);
    function owedOn(uint256 planId) external view returns (uint256);
    function payPlan(uint256 planId, uint256 amount) external;
    function planAt(uint256 planId)
        external
        view
        returns (address, uint256, uint256, uint256 repaid, uint64, uint32 installments, uint64 length, uint256, bool closed);
    function scheduleOf(uint256 planId) external view returns (uint256, uint256, uint32, uint64 scheduleStart);
}

interface IMemberIssuers {
    function issuersOf(address member) external view returns (address[] memory);
}

interface ITierSettler {
    function settleFromCollateral(address member, uint256 tierId, uint256 amount) external;
    function principalOf(address member, uint256 tierId) external view returns (uint256);
    function tierAt(uint256 tierId) external view returns (bytes32 kind, uint256 ratePerCycle, bool active);
    function tierCount() external view returns (uint256);
}

/// @title LiquidatorBase
/// @notice The Liquidator's storage, events, errors and the helpers its two halves share: the
/// Liquidator itself (Savings, the Liquidation Hold and the settings) and `LiquidatorEnforcement`,
/// its delegatecall module (pledged Earn: bonds and pool shares).
/// @dev Storage is the Base Sepolia Liquidator's, in the same order, appended only from the gap.
abstract contract LiquidatorBase is AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @dev The savings collateral kind, as the registry and the issuer both name it.
    bytes32 internal constant SAVINGS_KIND = "SAVINGS";

    IStableCredit public stableCredit;
    IClearUSDSeizable public clrusd;
    IESADepositVault public vault;
    IERC20Upgradeable public reserveToken;
    ICollateralSeizureSink public collateralRegistry;

    /// @notice issuers a member may settle against with their own savings, and whose debt the
    /// pledge module answers for. Operator-set.
    mapping(address => bool) public trustedSavingsIssuer;

    /* ========== SECTION 12 (appended) ========== */

    /// @notice Why enforcement against a member is held (spec 12.6).
    enum HoldReason {
        NONE,
        BANKRUPTCY,
        DEATH,
        BILLING_DISPUTE,
        LATE_NOTICE
    }

    /// @notice A Liquidation Hold. Active only once a second signer confirms it, and only until
    /// `until`, which never passes `setAt` + the reason's governed maximum.
    struct Hold {
        address proposer;
        HoldReason reason;
        bool confirmed;
        uint64 setAt;
        /// @dev The signer a renewal must differ from: the confirmer, then each renewer.
        address lastSigner;
        uint64 until;
        /// @dev The first of the two signers clearing an active hold.
        address clearProposer;
    }

    /// @notice May propose, confirm, renew and clear a Liquidation Hold. Two different holders
    /// are needed for every step that keeps or ends one.
    bytes32 public constant HOLD_ROLE = keccak256("HOLD_ROLE");
    /// @notice No reason's maximum may be governed above this.
    uint64 public constant MAX_HOLD_CEILING = 365 days;
    /// @notice The governed wait between a shortfall notice and its settlement is never shorter
    /// than the addendum's 72 hours, nor longer than this ceiling.
    uint64 public constant MIN_SHORTFALL_WAIT = 72 hours;
    uint64 public constant MAX_SHORTFALL_WAIT = 30 days;
    uint256 internal constant BPS = 10_000;
    bytes32 internal constant INCOME_KIND = "INCOME";
    bytes32 internal constant BOOST_KIND = "BOOST";

    /// @dev member => hold
    mapping(address => Hold) internal _holds;
    /// @dev reason => governed maximum, in seconds. Zero reads as the default (`maxHoldOf`).
    mapping(HoldReason => uint64) internal _maxHold;
    /// @notice When a member's Shortfall was noticed; zero when none is open. Since Phase 2f
    /// (decision 21) the Shortfall is one combined figure per member, kept under issuer zero; entries
    /// under an issuer's address are from before and are not read.
    mapping(address => mapping(address => uint64)) public shortfallNoticedAt;
    /// @notice The Yield Pool whose pledged shares MB-05 reaches, through `PoolShareEnforcer` only.
    ISeizableShares public earnPool;
    /// @dev Governed wait after a shortfall notice. Zero reads as `MIN_SHORTFALL_WAIT`.
    uint64 internal _shortfallWait;
    /// @notice The bond collection whose pledged bonds this contract answers for. Admin-set.
    IEarnBonds public earnBonds;
    /// @dev Retired in Phase 2e with the seize-and-redeem path. The slot stays so nothing moves.
    /// @custom:oz-renamed-from _enforcing
    address internal retiredEnforcing;
    /// @dev Re-entry lock on every enforcement path. Packs into `retiredEnforcing`'s slot.
    bool internal _locked;

    /// @dev member => evidence behind their current or last hold. A hold that lapsed is proposed
    /// again only with new evidence (owner decision, 2026-11-13).
    mapping(address => bytes32) public holdEvidence;

    /// @notice Retired in Phase 2f (C5): what seized pool shares still owed from the queue. Nothing
    /// is seized any more and nothing writes or reads it; the slot stays so nothing below it moves.
    mapping(address => uint256) public realizedPendingOf;

    /// @notice Where the member's pause clock is read (Phase 2g, 10c). Set once. While a pause
    /// affecting the member is in force no enforcement path runs (`payPledged` included), and a
    /// shortfall's wait runs longer by the paused time since its notice. Unset, nothing is paused.
    address public pauseClock;
    /// @dev member => issuer (zero since Phase 2f) => the pause clock when the shortfall was noticed.
    mapping(address => mapping(address => uint256)) internal shortfallClockAt;

    /* ========== PHASE 2F (two slots from the gap) ========== */

    /// @notice The pledge module's pool-share side (decisions 7 and 10): the only caller that may
    /// apply an enforcement redemption's proceeds. Admin-set. It can only bring USDC in.
    address public poolShareEnforcer;

    /// @dev What enforcement has applied against one revolving default (decision 22), per episode
    /// (the cure amount's due point): against the past-due Secured Minimum (`sm`) and against the
    /// unpaid Rebalance Amount (`ra`). The issuer lowers neither recorded figure for a settlement
    /// out of collateral, so the pledge module counts what it applied.
    struct Enforced {
        uint64 episode;
        uint96 sm;
        uint96 ra;
    }
    /// @dev member => revolving issuer => what enforcement applied in the current default episode.
    mapping(address => mapping(address => Enforced)) internal enforcedOn;

    uint256[30] private __gap;

    /* ========== ERRORS ========== */

    error LiquidatorReentered();
    error LiquidatorPauseClockSet();
    error LiquidatorPauseInForce(address member);
    error LiquidatorInvalidAddress();
    error LiquidatorNotInDefault(address member, address issuer);
    error LiquidatorNothingToSeize(address member);
    error LiquidatorUntrustedIssuer(address issuer);
    error LiquidatorNotSavingsTier(uint256 tierId, bytes32 kind);
    error LiquidatorOnHold(address member, HoldReason reason, uint64 until);
    error LiquidatorHoldExists(address member);
    error LiquidatorNoHold(address member);
    error LiquidatorSameSigner(address signer);
    error LiquidatorBadParameter();
    error LiquidatorNoShortfall(address member);
    error LiquidatorShortfallNoticed(address member);
    /// @dev Only the bond collection, paying a bond under its own terms, applies a bond payment.
    error LiquidatorNotEarnBonds(address caller);
    /// @dev Only `poolShareEnforcer` applies an enforcement redemption's proceeds.
    error LiquidatorNotPoolShareEnforcer(address caller);

    /* ========== EVENTS ========== */

    event PauseClockSet(address clock);
    event Liquidated(address indexed member, address indexed issuer, uint256 seized, uint256 redeemed, uint256 repaid);
    event TrustedSavingsIssuerUpdated(address indexed issuer, bool trusted);
    event SettledFromSavings(address indexed member, address indexed issuer, uint256 seized, uint256 repaid);
    event HoldProposed(address indexed member, HoldReason reason, address indexed proposer, uint64 until, bytes32 evidenceHash);
    event HoldConfirmed(address indexed member, address indexed signer, uint64 until);
    event HoldRenewed(address indexed member, address indexed signer, uint64 until);
    event HoldLapsed(address indexed member);
    event HoldClearProposed(address indexed member, address indexed signer);
    event HoldCleared(address indexed member, address indexed signer);
    event MaxHoldUpdated(HoldReason reason, uint64 maxSeconds);
    event ShortfallWaitUpdated(uint64 waitSeconds);
    event EarnSourcesUpdated(address indexed pool, address indexed bonds);
    event PoolShareEnforcerUpdated(address indexed enforcer);
    /// @notice A pledged bond's payment under its pledge payment term was applied (IV-01 §4.9).
    event PledgePaymentApplied(
        address indexed member, address indexed issuer, bool onDefault, uint256 amount, uint256 applied, uint256 surplus
    );
    /// @notice A pledged bond's Maturity Instruction was applied to the Holder's Asset-Backed Drawn.
    event MaturityInstructionApplied(address indexed member, uint256 toDebt, uint256 applied);
    /// @notice An enforcement redemption of pledged pool shares was filled and its proceeds applied
    /// (MB-05 §§7.3(b), 7.5, 7.6): `shares` left the pledge, `applied` paid Defaulted Amounts or
    /// ended the Shortfall, and `surplus` went to the Holder.
    event PoolProceedsApplied(address indexed member, uint256 shares, uint256 amount, uint256 applied, uint256 surplus);
    /// @notice A pledged bond's share of a distribution round went to its Holder's Defaulted Amounts
    /// (`applied`) and to the Holder (`toHolder`) (decision 19).
    event DistributionApplied(address indexed member, uint256 amount, uint256 applied, uint256 toHolder);
    /// @notice The member's combined Shortfall (decision 21) was noticed; its 72-hour wait starts.
    event ShortfallNoticed(address indexed member, uint256 gap);
    event ShortfallCleared(address indexed member);

    modifier noReenter() {
        if (_locked) revert LiquidatorReentered();
        _locked = true;
        _;
        _locked = false;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== SHARED HELPERS ========== */

    /// @dev Every enforcement path calls this first. A hold only delays: it reverts the call and
    /// touches nothing else. A lapsed hold is dropped and logged on the way through.
    function _requireNoHold(address member) internal {
        // 10c: a pause never causes enforcement; every path waits while one is in force.
        if (_pauseInForce(member)) revert LiquidatorPauseInForce(member);
        Hold storage hold = _holds[member];
        if (!hold.confirmed) return;
        if (block.timestamp < hold.until) revert LiquidatorOnHold(member, hold.reason, hold.until);
        delete _holds[member];
        emit HoldLapsed(member);
    }

    /// @dev Whether a confirmed hold is active, or a pause is in force, for the member now.
    function _blocked(address member) internal view returns (bool) {
        Hold storage hold = _holds[member];
        return (hold.confirmed && block.timestamp < hold.until) || _pauseInForce(member);
    }

    function _pauseClockOf(address member) internal view returns (uint256) {
        address clock = pauseClock;
        return clock == address(0) ? 0 : IPauseClock(clock).pausedSeconds(member);
    }

    function _pauseInForce(address member) internal view returns (bool) {
        address clock = pauseClock;
        return clock != address(0) && IPauseClock(clock).inForce(member);
    }

    /// @notice the governed wait between a shortfall notice and its settlement.
    function shortfallWait() public view returns (uint64) {
        uint64 stored = _shortfallWait;
        return stored == 0 ? MIN_SHORTFALL_WAIT : stored;
    }

    /// @dev Whether the member is in default with a revolving issuer on the line they hold now: the
    /// issuer computes it (`inDefault`) or recorded it on this line (Phase 4b, M-C).
    function _currentDefault(address member, address issuer) internal view returns (bool) {
        return ICreditIssuer(issuer).inDefault(member) || ICurrentLineDefault(issuer).hasDefaultedOnCurrentLine(member);
    }

    /// @dev Decision 22: the Defaulted Amounts still open on a revolving line, as the issuer records
    /// them: what was past due when the grace period ended, less what has been paid or enforced
    /// since. The whole balance never counts: the line has no on-chain closing apart from default,
    /// and a default does not by itself make the balance due. Zero without a current default, or when
    /// the issuer cannot answer (fails closed: nothing is enforced). Read from the issuer's
    /// `cycleStateOf`, whose fields are all fixed-size, so its words 10-13 are `securedPastDue`
    /// (what the judged cycle's Rebalance Amount and Secured Minimum still lack; any payment lowers
    /// it), `pastDueSM` (the Secured Minimum part of that, when judged), `cureAmount` (the second
    /// consecutive Rebalance Amount still unpaid; a payment lowers it, a settlement out of collateral
    /// does not) and `cureDueAt`.
    /// @return sm the past-due Secured Minimum: the Defaulted Amount of the line's secured
    /// (Savings- and asset-backed) positions, MB-05 §§7.1(a), (b) and 7.2.
    /// @return ra the unpaid Rebalance Amount: the Defaulted Amount of the unsecured positions, which
    /// pledged Earn left after §7.1(b) may pay (§7.1(d)).
    /// @return episode the cure amount's due point, which names this default episode.
    function _revolvingDue(address member, address issuer) internal view returns (uint256 sm, uint256 ra, uint64 episode) {
        if (!_currentDefault(member, issuer)) return (0, 0, 0);
        (bool ok, bytes memory data) = issuer.staticcall(abi.encodeWithSignature("cycleStateOf(address)", member));
        if (!ok || data.length < 448) return (0, 0, 0);
        uint256[14] memory s = abi.decode(data, (uint256[14]));
        episode = uint64(s[13]);
        Enforced memory e = enforcedOn[member][issuer];
        if (e.episode != episode) e = Enforced(episode, 0, 0);
        sm = s[11] > e.sm ? s[11] - e.sm : 0;
        if (s[10] < sm) sm = s[10];
        ra = s[12] > e.ra ? s[12] - e.ra : 0;
    }

    /// @dev Records that enforcement applied `sm` against the past-due Secured Minimum and `ra`
    /// against the unpaid Rebalance Amount of a revolving default's episode.
    function _noteEnforced(address member, address issuer, uint64 episode, uint256 sm, uint256 ra) internal {
        Enforced memory e = enforcedOn[member][issuer];
        if (e.episode != episode) e = Enforced(episode, 0, 0);
        enforcedOn[member][issuer] = Enforced(episode, uint96(e.sm + sm), uint96(e.ra + ra));
    }

    /// @dev Settles up to `budget` held here against the revolving tiers of `kinds`, in turn, never
    /// more than the line's open Defaulted Amount of that part (decision 22): the past-due Secured
    /// Minimum for secured tiers (`secured`), the unpaid Rebalance Amount for unsecured ones.
    function _applyRevolving(address member, address issuer, bytes32[] memory kinds, uint256 budget, bool secured)
        internal
        returns (uint256 applied)
    {
        (uint256 sm, uint256 ra, uint64 episode) = _revolvingDue(member, issuer);
        uint256 due = secured ? sm : ra;
        if (due < budget) budget = due;
        for (uint256 k = 0; k < kinds.length && applied < budget; k++) {
            applied += _settleTier(member, issuer, kinds[k], budget - applied);
        }
        if (applied > 0) _noteEnforced(member, issuer, episode, secured ? applied : 0, secured ? 0 : applied);
    }

    /// @dev Settles up to `amount` held here against the issuer's tier of `kind`, if it has one.
    function _settleTier(address member, address issuer, bytes32 kind, uint256 amount) internal returns (uint256 pay) {
        (bool found, uint256 tierId) = _tierOf(issuer, kind);
        if (!found) return 0;
        pay = _min(ITierSettler(issuer).principalOf(member, tierId), amount);
        if (pay == 0) return 0;
        reserveToken.forceApprove(issuer, pay);
        ITierSettler(issuer).settleFromCollateral(member, tierId, pay);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _earnKinds() internal view returns (bytes32 poolKind, bytes32 bondKind) {
        if (address(earnPool) != address(0)) poolKind = earnPool.collateralKind();
        if (address(earnBonds) != address(0)) bondKind = earnBonds.collateralKind();
    }

    /// @dev The issuer's tier for a kind, if it has one.
    function _tierOf(address issuer, bytes32 kind) internal view returns (bool found, uint256 tierId) {
        if (kind == bytes32(0)) return (false, 0);
        uint256 count = ITierSettler(issuer).tierCount();
        for (; tierId < count; tierId++) {
            (bytes32 tierKind, , ) = ITierSettler(issuer).tierAt(tierId);
            if (tierKind == kind) return (true, tierId);
        }
        return (false, 0);
    }

    /// @dev The member's issuers, as the network registry lists them.
    function _issuersOf(address member) internal view returns (address[] memory) {
        return IMemberIssuers(collateralRegistry.networkRegistry()).issuersOf(member);
    }

    /// @dev How many tiers an issuer has; zero for one without tiers (a term issuer).
    function _tierCountOf(address issuer) internal view returns (uint256) {
        try ITierSettler(issuer).tierCount() returns (uint256 count) {
            return count;
        } catch {
            return 0;
        }
    }
}
