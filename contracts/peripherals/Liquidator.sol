// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../core/interfaces/stable-credit/IStableCredit.sol";
import "../core/interfaces/stable-credit/ICreditIssuer.sol";
import "../core/interfaces/IESADepositVault.sol";

interface IClearUSDSeizable {
    function seize(address holder, address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ICollateralSeizureSink {
    function recordSeizure(address member, bytes32 kind, uint256 amount) external;
    function recordItemSeizure(address member, bytes32 kind, uint256 itemId) external;

    function encumberedOfKind(address holder, bytes32 kind) external view returns (uint256);
    function isItemEncumbered(address holder, bytes32 kind, uint256 itemId) external view returns (bool);
    function collateralValueOf(address member, bytes32 kind) external view returns (uint256);
    function pledgedItemsOf(address member, bytes32 kind) external view returns (uint256[] memory);
    function collateralTypes(bytes32 kind)
        external
        view
        returns (uint8 backing, uint256 haircutBps, uint256 unitPrice, address valuer, bool registered);
}

/// @notice What a revolving issuer reports after a missed cycle (spec 12.5).
/// @dev `unsecuredExcessOf` is unsecured (INCOME + BOOST) drawn less the halved limit after a miss,
/// and zero otherwise; `missedInRowOf` counts consecutive missed cycles. RevolvingIssuer adds both
/// in Phase 2b; until it does, a trusted issuer without them cannot be settled this way.
/// @dev Whether the default an issuer recorded belongs to the member's current line (Phase 4b, M-C).
interface ICurrentLineDefault {
    function hasDefaultedOnCurrentLine(address member) external view returns (bool);
}

interface IMissedCycleSource {
    function unsecuredExcessOf(address member) external view returns (uint256);
    function missedInRowOf(address member) external view returns (uint8);
}

/// @notice The bond collection whose pledged bonds the Liquidator may take and redeem early.
interface IEarnBonds {
    function seizeBond(uint256 bondId, address from, address to) external;
    function redeemEarly(uint256 bondId) external returns (uint256);
    function presentValueOf(uint256 bondId) external view returns (uint256);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function collateralKind() external view returns (bytes32);
}

interface ISeizableShares {
    function seizeShares(address holder, address to, uint256 shares) external;
    function balanceOf(address account) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256);
    function requestWithdrawal(uint256 shares, address receiver) external returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function collateralKind() external view returns (bytes32);
}

interface ITierSettler {
    function settleFromCollateral(address member, uint256 tierId, uint256 amount) external;
    function principalOf(address member, uint256 tierId) external view returns (uint256);
    function tierAt(uint256 tierId) external view returns (bytes32 kind, uint256 ratePerCycle, bool active);
    function tierCount() external view returns (uint256);
}

/// @title Liquidator
/// @notice Turns a defaulted member's pledged savings into a repayment of their own debt.
/// @dev This is why there is far less lost debt here than in the ledger this forked from. A
/// default normally orphans supply: the credits were spent and are in someone else's hands, the
/// obligation is written off, and the claims remain with nothing behind them. Seizing the
/// collateral first covers the position instead, so nothing is orphaned and no lost debt is
/// created -- which is the entire justification for RTD counting only what collateral does not
/// reach.
///
/// The path is deliberately mundane. Take the CLRUSD that was standing behind the credit, redeem
/// it at the vault for the USDC that always backed it, and repay the member's balance with that
/// USDC. Every step is a thing the system already does; nothing is invented for the default case,
/// which is the case least likely to be exercised before it matters.
///
/// Repayment goes through the ledger's public path, so the issuers are told and each absorbs its
/// share through the same cost-ordered waterfall an ordinary payment would follow. A liquidation
/// is not a special kind of money.
///
/// Section 12 adds three paths and one brake, all in this contract:
///  - `settleExcess` (12.5): after one missed cycle halves the unsecured limit, the excess is
///    settled from pledged pool shares, then bonds. Never Savings.
///  - `noticeShortfall` / `settleShortfall` (12.8): when an Earn pledge no longer backs what is
///    drawn against it, a notice, a governed wait, then the smallest redemption that closes the
///    gap, pool shares first. Never Savings.
///  - Savings (`liquidate`) only on a computed default, only against the savings tier, and only up
///    to what the savings lock holds.
///  - The Liquidation Hold (12.6) delays every enforcement path for one member. It moves nothing
///    and blocks nothing the member does with their own unencumbered assets.
contract Liquidator is AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @dev The savings collateral kind, as the registry and the issuer both name it.
    bytes32 private constant SAVINGS_KIND = "SAVINGS";

    IStableCredit public stableCredit;
    IClearUSDSeizable public clrusd;
    IESADepositVault public vault;
    IERC20Upgradeable public reserveToken;
    ICollateralSeizureSink public collateralRegistry;

    /// @notice issuers a member may settle against with their own savings. Operator-set.
    /// @dev A member names the issuer in `settleFromSavings`, and the redeemed USDC is approved to
    /// it -- so an untrusted issuer would be a way to walk locked collateral out of the lock. Only
    /// issuers on this list are ever handed the member's savings.
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
    uint256 private constant BPS = 10_000;
    bytes32 private constant INCOME_KIND = "INCOME";
    bytes32 private constant BOOST_KIND = "BOOST";

    /// @dev member => hold
    mapping(address => Hold) private _holds;
    /// @dev reason => governed maximum, in seconds. Zero reads as the default (`maxHoldOf`).
    mapping(HoldReason => uint64) private _maxHold;
    /// @notice When a member's Earn shortfall with an issuer was noticed; zero when none is open.
    mapping(address => mapping(address => uint64)) public shortfallNoticedAt;
    /// @notice The lending pool whose pledged shares the section 12 paths take. Admin-set.
    ISeizableShares public earnPool;
    /// @dev Governed wait after a shortfall notice. Zero reads as `MIN_SHORTFALL_WAIT`.
    uint64 private _shortfallWait;
    /// @notice The bond collection whose pledged bonds the section 12 paths take. Admin-set.
    IEarnBonds public earnBonds;
    /// @dev The member this contract is taking a bond from, for the length of that one call.
    address private _enforcing;
    /// @dev Re-entry lock on every enforcement path. Packs into `_enforcing`'s slot, so the gap
    /// is unchanged.
    bool private _locked;

    /// @dev member => evidence behind their current or last hold. A hold that lapsed is proposed
    /// again only with new evidence (owner decision, 2026-11-13).
    mapping(address => bytes32) public holdEvidence;

    /// @notice member => what their seized pool shares still owe this contract from the withdrawal
    /// queue, valued when queued (Phase 4, L-H). `settleRealized` may apply no more than this to
    /// the member, so one member's queued proceeds cannot pay another's debt. One slot from the gap.
    mapping(address => uint256) public realizedPendingOf;

    uint256[34] private __gap;

    error LiquidatorReentered();

    modifier noReenter() {
        if (_locked) revert LiquidatorReentered();
        _locked = true;
        _;
        _locked = false;
    }

    error LiquidatorInvalidAddress();
    error LiquidatorNotInDefault(address member, address issuer);
    error LiquidatorNothingToSeize(address member);
    error LiquidatorNotRealizable(address collateral, uint256 seized);
    error LiquidatorUntrustedIssuer(address issuer);
    error LiquidatorNotSavingsTier(uint256 tierId, bytes32 kind);
    error LiquidatorOnHold(address member, HoldReason reason, uint64 until);
    error LiquidatorHoldExists(address member);
    error LiquidatorNoHold(address member);
    error LiquidatorSameSigner(address signer);
    error LiquidatorBadParameter();
    error LiquidatorNoExcess(address member);
    error LiquidatorNoShortfall(address member);
    error LiquidatorShortfallNoticed(address member);
    error LiquidatorShortfallNotDue(address member, uint256 dueAt);
    error LiquidatorBelowPresentValue(uint256 bondId, uint256 received, uint256 presentValue);

    event SharesSeized(
        address indexed member, address indexed pool, uint256 shares, uint256 realized, bool queued
    );

    event Liquidated(
        address indexed member,
        address indexed issuer,
        uint256 seized,
        uint256 redeemed,
        uint256 repaid
    );

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
    event BondRedeemed(address indexed member, uint256 indexed bondId, uint256 presentValue);
    event ExcessSettled(address indexed member, address indexed issuer, uint256 excess, uint256 realized, uint256 applied);
    event ShortfallNoticed(address indexed member, uint256 gap);
    event ShortfallSettled(address indexed member, address indexed issuer, uint256 realized, uint256 applied, uint256 gapAfter);
    event ShortfallCleared(address indexed member, address indexed issuer);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address _stableCredit,
        address _clrusd,
        address _vault,
        address _reserveToken,
        address _collateralRegistry
    ) external initializer {
        if (
            admin == address(0) || _stableCredit == address(0) || _clrusd == address(0)
                || _vault == address(0) || _reserveToken == address(0)
                || _collateralRegistry == address(0)
        ) revert LiquidatorInvalidAddress();
        collateralRegistry = ICollateralSeizureSink(_collateralRegistry);
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        stableCredit = IStableCredit(_stableCredit);
        clrusd = IClearUSDSeizable(_clrusd);
        vault = IESADepositVault(_vault);
        reserveToken = IERC20Upgradeable(_reserveToken);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @notice allows or revokes an issuer members may settle against with their own savings.
    function setTrustedSavingsIssuer(address issuer, bool trusted) external onlyRole(OPERATOR_ROLE) {
        if (issuer == address(0)) revert LiquidatorInvalidAddress();
        trustedSavingsIssuer[issuer] = trusted;
        emit TrustedSavingsIssuerUpdated(issuer, trusted);
    }

    /// @notice the member settles their savings-backed credit out of the savings that back it.
    /// @dev The same move as a liquidation, chosen instead of suffered: the member's locked CLRUSD is
    /// seized past the lock, redeemed one-for-one, and settled against the savings tier. Their savings
    /// and their debt shrink by the same amount, and the lock lifts with it.
    ///
    /// Only ever the caller's own savings against the caller's own SAVINGS tier:
    ///  - the issuer must be trusted, because it is handed the redeemed USDC;
    ///  - the tier must be the savings tier, or collateral pledged against it could settle a dearer
    ///    tier and leave the savings tier drawn against a pledge that no longer exists;
    ///  - the seizure is recorded as SAVINGS, so it reduces the pledge it actually came from;
    ///  - it is capped at what the tier owes, what the member holds, and (in the token) what is
    ///    encumbered -- collateral beyond the debt stays theirs.
    /// @param issuer address of the issuer holding the savings tier.
    /// @param tierId the savings tier.
    /// @param amount the most to settle, in ledger units.
    /// @return repaid amount settled against the member's debt.
    function settleFromSavings(address issuer, uint256 tierId, uint256 amount) external noReenter returns (uint256 repaid) {
        if (!trustedSavingsIssuer[issuer]) revert LiquidatorUntrustedIssuer(issuer);
        (bytes32 kind, , ) = ITierSettler(issuer).tierAt(tierId);
        if (kind != SAVINGS_KIND) revert LiquidatorNotSavingsTier(tierId, kind);

        address member = _msgSender();
        uint256 owed = ITierSettler(issuer).principalOf(member, tierId);
        uint256 available = clrusd.balanceOf(member);
        uint256 seizing = amount;
        if (owed < seizing) seizing = owed;
        if (available < seizing) seizing = available;
        if (seizing == 0) revert LiquidatorNothingToSeize(member);

        clrusd.seize(member, address(this), seizing);
        collateralRegistry.recordSeizure(member, SAVINGS_KIND, seizing);
        clrusd.approve(address(vault), seizing);
        uint256 redeemed = vault.redeem(address(reserveToken), seizing, address(this));
        reserveToken.forceApprove(issuer, redeemed);
        ITierSettler(issuer).settleFromCollateral(member, tierId, redeemed);
        repaid = redeemed;

        emit SettledFromSavings(member, issuer, seizing, repaid);
    }

    /// @notice covers a defaulted member's debt out of the collateral they pledged.
    /// @dev The default is checked against the issuer that holds the position rather than taken
    /// on the caller's word. The token bounds the seizure to what is actually encumbered, so the
    /// worst a mistaken call can do is repay somebody's debt with their own collateral early.
    /// @param member address of the defaulted member.
    /// @param issuer address of the issuer the member defaulted with.
    /// @return repaid amount of the member's balance settled.
    ///
    /// Permissionless (compliance spec 10b): default is computed on chain by the issuer -- the
    /// period and grace ended without the member returning to equilibrium -- and recorded only by
    /// that computation, so no role can declare one. Anyone may call this once it holds, and it
    /// reverts otherwise. Only issuers the admin has marked trusted are asked, so a contract that
    /// merely claims a default cannot trigger a seizure. Never more than the CLRUSD the registry
    /// computes as locked for this kind, nor more than the tier owes; the proceeds go only to that
    /// tier's debt.
    function liquidate(address member, address issuer, uint256 tierId, bytes32 kind)
        external
        noReenter
        returns (uint256 repaid)
    {
        if (!trustedSavingsIssuer[issuer]) revert LiquidatorUntrustedIssuer(issuer);
        _requireNoHold(member);
        // Savings settle only the savings tier (spec 12.5): seized CLRUSD sent to another tier
        // would leave the savings tier drawn, its lock unchanged, and the next call free to take
        // more savings than Savings-backed drawn.
        (bytes32 tierKind, , ) = ITierSettler(issuer).tierAt(tierId);
        if (kind != SAVINGS_KIND || tierKind != SAVINGS_KIND) revert LiquidatorNotSavingsTier(tierId, tierKind);
        // `inDefault` reads the credit period, and expiring one deletes it, so a member
        // liquidated after the write-off would read as never having defaulted at all. The recorded
        // default must be this line's, though (Phase 4b, M-C): `hasDefaulted` is for ever, and a
        // member who settled and was given a new line is current on it.
        _requireCurrentDefault(member, issuer);

        // Never take more than the tier the collateral was pledged against still owes. Collateral
        // beyond that is still the member's; a default is not a forfeiture of everything they
        // saved.
        uint256 owed = ITierSettler(issuer).principalOf(member, tierId);
        uint256 available = clrusd.balanceOf(member);
        uint256 seizing = owed < available ? owed : available;
        uint256 encumbered = collateralRegistry.encumberedOfKind(member, kind);
        if (encumbered < seizing) seizing = encumbered;
        if (seizing == 0) revert LiquidatorNothingToSeize(member);

        clrusd.seize(member, address(this), seizing);
        // The registry has to stop counting a pledge that is no longer there, or it will report
        // the position as covered by collateral somebody else now holds.
        collateralRegistry.recordSeizure(member, kind, seizing);

        // The CLRUSD was always backed one-for-one by USDC in the vault. Redeeming turns the
        // collateral back into the thing a repayment is actually made in.
        clrusd.approve(address(vault), seizing);
        uint256 redeemed = vault.redeem(address(reserveToken), seizing, address(this));

        // Settled against the tier the collateral backed rather than through the waterfall, which
        // would put it toward whichever tier costs most and leave this one drawn against a pledge
        // that no longer exists.
        reserveToken.forceApprove(issuer, redeemed);
        ITierSettler(issuer).settleFromCollateral(member, tierId, redeemed);
        repaid = redeemed;

        emit Liquidated(member, issuer, seizing, redeemed, repaid);
    }

    /// @notice covers a defaulted member's debt out of pool shares they pledged.
    /// @dev The other half of liquidation. Savings-backed collateral is CLRUSD, which redeems
    /// one-for-one on demand, so seizing it and settling the debt happen in the same breath. Pool
    /// shares do not work that way: they are a claim on a pool that may have lent the money out,
    /// so turning them into cash can land in the withdrawal queue behind other depositors.
    ///
    /// That is the timing risk the haircut does not price. A haircut says what the collateral is
    /// worth; it says nothing about when. So this settles what it can realize now and queues the
    /// rest, rather than pretending a claim on a lent-out pool is money.
    ///
    /// The debt is not forgiven while that happens. The member still owes it, the co-op holds the
    /// shares, and settlement follows the cash.
    /// @param member address of the defaulted member.
    /// @param issuer address of the issuer holding the position.
    /// @param tierId tier the shares were pledged against.
    /// @param kind collateral type, as the registry knows it.
    /// @param pool the share pool.
    /// @return realized amount settled against the member's debt now.
    /// @return queued whether the remainder is waiting on the pool.
    function liquidateShares(
        address member,
        address issuer,
        uint256 tierId,
        bytes32 kind,
        address pool
    ) external onlyRole(OPERATOR_ROLE) noReenter returns (uint256 realized, bool queued) {
        _requireNoHold(member);
        _requireCurrentDefault(member, issuer);

        ISeizableShares shares = ISeizableShares(pool);
        uint256 held = shares.balanceOf(member);
        if (held == 0) revert LiquidatorNothingToSeize(member);

        // Never take more than the tier owes, valued at what the shares would fetch.
        uint256 owed = ITierSettler(issuer).principalOf(member, tierId);
        uint256 needed = shares.previewRedeem(held) > owed && shares.previewRedeem(held) > 0
            ? (held * owed) / shares.previewRedeem(held)
            : held;
        if (needed == 0) revert LiquidatorNothingToSeize(member);

        (realized, , queued) = _takeShares(member, kind, shares, needed);
        if (realized > 0) {
            reserveToken.forceApprove(issuer, realized);
            ITierSettler(issuer).settleFromCollateral(member, tierId, realized);
        }
    }

    /// @dev Seizes pledged shares, redeems what the pool can pay today and queues the rest.
    /// Waiting in line rather than failing: the claim is real; the cash is not here yet.
    /// @return realized cash in hand now.
    /// @return queuedValue what the queued remainder was worth when it was queued.
    /// @return queued whether anything was queued.
    function _takeShares(address member, bytes32 kind, ISeizableShares pool, uint256 count)
        private
        returns (uint256 realized, uint256 queuedValue, bool queued)
    {
        pool.seizeShares(member, address(this), count);
        collateralRegistry.recordSeizure(member, kind, count);

        uint256 redeemableNow = pool.maxRedeem(address(this));
        if (redeemableNow > count) redeemableNow = count;
        if (redeemableNow > 0) realized = pool.redeem(redeemableNow, address(this), address(this));

        uint256 leftover = count - redeemableNow;
        if (leftover > 0) {
            queuedValue = pool.previewRedeem(leftover);
            realizedPendingOf[member] += queuedValue;
            pool.requestWithdrawal(leftover, address(this));
            queued = true;
        }
        emit SharesSeized(member, address(pool), count, realized, queued);
    }

    /// @notice settles a member's debt with cash the co-op has since collected on their behalf.
    /// @dev What a queued redemption pays out eventually still belongs against the debt it was
    /// seized for. The co-op holds it in the meantime; this is how it gets there.
    /// @param member address of the member.
    /// @param issuer address of the issuer holding the position.
    /// @param tierId tier to settle.
    /// @param amount amount of reserve token to apply; capped at the member's own queued proceeds.
    function settleRealized(address member, address issuer, uint256 tierId, uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
        noReenter
    {
        // Only this member's own queued proceeds (Phase 4, L-H).
        uint256 pending = realizedPendingOf[member];
        if (amount > pending) amount = pending;
        if (amount == 0) revert LiquidatorNothingToSeize(member);
        realizedPendingOf[member] = pending - amount;
        reserveToken.forceApprove(issuer, amount);
        ITierSettler(issuer).settleFromCollateral(member, tierId, amount);
    }

    /* ========== SECTION 12: MISSED-CYCLE EXCESS (12.5) ========== */

    /// @notice settles the unsecured excess a missed cycle left, out of the member's pledged Earn.
    /// @dev Permissionless, and only for a trusted issuer: the issuer computes the excess (unsecured
    /// drawn less the halved limit) and nobody declares it. Pool shares go first, then bonds at
    /// their full present value, for the smallest amount that covers the excess; the proceeds
    /// settle BOOST, then INCOME. Savings are never touched: a missed cycle is not a default.
    /// A bond is indivisible, so what it realizes above the excess goes back to the member in cash.
    /// @param member address of the member.
    /// @param issuer the revolving issuer that halved the limit.
    /// @return applied amount settled against BOOST and INCOME now.
    function settleExcess(address member, address issuer) external noReenter returns (uint256 applied) {
        _requireTrusted(issuer);
        _requireNoHold(member);
        IMissedCycleSource source = IMissedCycleSource(issuer);
        uint256 excess = source.missedInRowOf(member) == 0 ? 0 : source.unsecuredExcessOf(member);
        if (excess == 0) revert LiquidatorNoExcess(member);

        (uint256 realized, uint256 queuedValue) = _realizeShares(member, excess);
        (bytes32 poolKind, bytes32 bondKind) = _earnKinds();
        bytes32 spill = poolKind;
        if (realized + queuedValue < excess) {
            uint256 fromBonds = _realizeBonds(member, excess - realized - queuedValue);
            if (fromBonds > 0) (realized, spill) = (realized + fromBonds, bondKind);
        }
        if (realized == 0 && queuedValue == 0) revert LiquidatorNothingToSeize(member);

        // What is queued is settled through `settleRealized` when the pool pays it. What a whole
        // bond realizes above the excess goes to the tier that bond backed, then to the member.
        applied = _settle(member, issuer, [BOOST_KIND, INCOME_KIND, spill], realized, excess - _min(queuedValue, excess));
        emit ExcessSettled(member, issuer, excess, realized, applied);
    }

    /* ========== SECTION 12: EARN SHORTFALL (12.8) ========== */

    /// @notice what a member's Earn pledges fail to back, per kind, with one issuer.
    /// @dev Per kind, as the registry locks and values them: a kind's gap is what is drawn against
    /// it less its haircut value (`collateralValueOf` x haircut). Measured per kind because only
    /// that kind's pledge is locked behind its tier, so only it can be taken to close the gap.
    function earnGapOf(address member, address issuer) public view returns (uint256 poolGap, uint256 bondGap) {
        (bytes32 poolKind, bytes32 bondKind) = _earnKinds();
        poolGap = _gapOf(member, issuer, poolKind);
        bondGap = _gapOf(member, issuer, bondKind);
    }

    /// @notice records that a member's Earn pledge no longer backs what is drawn against it.
    /// @dev Permissionless. Starts the governed wait (`shortfallWait`, 72 hours by default); the
    /// notice itself moves nothing.
    function noticeShortfall(address member, address issuer) external returns (uint256 gap) {
        _requireTrusted(issuer);
        if (shortfallNoticedAt[member][issuer] != 0) revert LiquidatorShortfallNoticed(member);
        (uint256 poolGap, uint256 bondGap) = earnGapOf(member, issuer);
        gap = poolGap + bondGap;
        if (gap == 0) revert LiquidatorNoShortfall(member);
        shortfallNoticedAt[member][issuer] = uint64(block.timestamp);
        emit ShortfallNoticed(member, gap);
    }

    /// @notice after the wait, redeems the smallest amount of Earn pledge that closes the gap.
    /// @dev Permissionless, and only once the notice is `shortfallWait` old. Pool shares first,
    /// then bonds at their full present value; the proceeds settle the tier that pledge backs.
    /// Redeeming r of a kind with haircut h closes r x (1 - h) of its gap, so the smallest r is
    /// gap / (1 - h), rounded up. Never Savings. If the gap closed meanwhile it moves nothing and
    /// clears the notice.
    function settleShortfall(address member, address issuer) external noReenter returns (uint256 applied) {
        _requireTrusted(issuer);
        _requireNoHold(member);
        uint256 noticedAt = shortfallNoticedAt[member][issuer];
        uint256 dueAt = noticedAt + shortfallWait();
        if (noticedAt == 0 || block.timestamp < dueAt) revert LiquidatorShortfallNotDue(member, dueAt);

        (bytes32 poolKind, bytes32 bondKind) = _earnKinds();
        uint256 realized;
        uint256 need = _closing(member, issuer, poolKind);
        if (need > 0) {
            (uint256 now_, ) = _realizeShares(member, need);
            realized = now_;
            applied = _settle(member, issuer, [poolKind, bytes32(0), bytes32(0)], now_, now_);
        }
        need = _closing(member, issuer, bondKind);
        if (need > 0) {
            uint256 got = _realizeBonds(member, need);
            realized += got;
            // A bond is indivisible: all it realizes settles the tier it backed, so the tier is
            // not left drawn against a bond that is gone.
            applied += _settle(member, issuer, [bondKind, bytes32(0), bytes32(0)], got, got);
        }

        (uint256 poolGap, uint256 bondGap) = earnGapOf(member, issuer);
        if (poolGap + bondGap == 0) {
            delete shortfallNoticedAt[member][issuer];
            emit ShortfallCleared(member, issuer);
        }
        emit ShortfallSettled(member, issuer, realized, applied, poolGap + bondGap);
    }

    /// @notice the governed wait between a shortfall notice and its settlement.
    function shortfallWait() public view returns (uint64) {
        uint64 stored = _shortfallWait;
        return stored == 0 ? MIN_SHORTFALL_WAIT : stored;
    }

    /// @notice sets the shortfall wait. It can only lengthen the addendum's 72 hours.
    function setShortfallWait(uint64 waitSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (waitSeconds < MIN_SHORTFALL_WAIT || waitSeconds > MAX_SHORTFALL_WAIT) revert LiquidatorBadParameter();
        _shortfallWait = waitSeconds;
        emit ShortfallWaitUpdated(waitSeconds);
    }

    /// @notice names the pool and the bond collection the section 12 paths take Earn from.
    /// @dev Either may be zero, which turns that leg off. What can be taken stays bounded by each
    /// one's own seize gate and by the registry's computed lock.
    function setEarnSources(address pool, address bonds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        earnPool = ISeizableShares(pool);
        earnBonds = IEarnBonds(bonds);
        emit EarnSourcesUpdated(pool, bonds);
    }

    /* ========== SECTION 12: LIQUIDATION HOLD (12.6) ========== */

    /// @notice a member's hold, and whether it is active now.
    function holdOf(address member) external view returns (Hold memory hold, bool active) {
        hold = _holds[member];
        active = hold.confirmed && block.timestamp < hold.until;
    }

    /// @notice the governed longest a hold for this reason may run from when it was set.
    /// @dev Defaults: bankruptcy 180 days, death 90 days (decision 5), billing dispute 90 days,
    /// late default notice 30 days.
    function maxHoldOf(HoldReason reason) public view returns (uint64) {
        uint64 stored = _maxHold[reason];
        if (stored != 0) return stored;
        if (reason == HoldReason.BANKRUPTCY) return 180 days;
        if (reason == HoldReason.DEATH || reason == HoldReason.BILLING_DISPUTE) return 90 days;
        if (reason == HoldReason.LATE_NOTICE) return 30 days;
        return 0;
    }

    /// @notice governs a reason's maximum. Never above `MAX_HOLD_CEILING`.
    function setMaxHold(HoldReason reason, uint64 maxSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (reason == HoldReason.NONE || maxSeconds == 0 || maxSeconds > MAX_HOLD_CEILING) {
            revert LiquidatorBadParameter();
        }
        _maxHold[reason] = maxSeconds;
        emit MaxHoldUpdated(reason, maxSeconds);
    }

    /// @notice proposes a hold on enforcement against a member. Inactive until a second signer
    /// confirms it.
    /// @param duration seconds from now; never more than the reason's maximum.
    /// @param evidenceHash hash of the evidence (a filing, a death report, a dispute record). A hold
    /// that lapsed is proposed again only with different evidence, and runs its own maximum.
    function proposeHold(address member, HoldReason reason, uint64 duration, bytes32 evidenceHash)
        external
        onlyRole(HOLD_ROLE)
    {
        if (
            member == address(0) || reason == HoldReason.NONE || duration == 0 || duration > maxHoldOf(reason)
                || evidenceHash == bytes32(0)
        ) {
            revert LiquidatorBadParameter();
        }
        Hold storage hold = _holds[member];
        if (hold.confirmed) {
            if (block.timestamp < hold.until) revert LiquidatorHoldExists(member);
            if (evidenceHash == holdEvidence[member]) revert LiquidatorBadParameter();
            emit HoldLapsed(member);
        }
        uint64 until = uint64(block.timestamp) + duration;
        _holds[member] = Hold(_msgSender(), reason, false, uint64(block.timestamp), _msgSender(), until, address(0));
        holdEvidence[member] = evidenceHash;
        emit HoldProposed(member, reason, _msgSender(), until, evidenceHash);
    }

    /// @notice confirms a proposed hold. Must be a different signer from the proposer.
    function confirmHold(address member) external onlyRole(HOLD_ROLE) {
        Hold storage hold = _holds[member];
        if (hold.setAt == 0 || hold.confirmed || block.timestamp >= hold.until) revert LiquidatorNoHold(member);
        if (_msgSender() == hold.proposer) revert LiquidatorSameSigner(_msgSender());
        hold.confirmed = true;
        hold.lastSigner = _msgSender();
        emit HoldConfirmed(member, _msgSender(), hold.until);
    }

    /// @notice extends an active hold. A different signer from the last one, and never past the
    /// reason's maximum from when the hold was set.
    function renewHold(address member, uint64 until) external onlyRole(HOLD_ROLE) {
        Hold storage hold = _holds[member];
        if (!hold.confirmed || block.timestamp >= hold.until) revert LiquidatorNoHold(member);
        if (_msgSender() == hold.lastSigner) revert LiquidatorSameSigner(_msgSender());
        if (until <= hold.until || until > hold.setAt + maxHoldOf(hold.reason)) revert LiquidatorBadParameter();
        hold.until = until;
        hold.lastSigner = _msgSender();
        hold.clearProposer = address(0);
        emit HoldRenewed(member, _msgSender(), until);
    }

    /// @notice ends a hold. An active hold needs two different signers: the first call proposes,
    /// the second clears. A proposal nobody confirmed, or a hold that has lapsed, is simply dropped.
    function clearHold(address member) external onlyRole(HOLD_ROLE) {
        Hold storage hold = _holds[member];
        if (hold.setAt == 0) revert LiquidatorNoHold(member);
        if (hold.confirmed && block.timestamp >= hold.until) {
            delete _holds[member];
            emit HoldLapsed(member);
        } else if (hold.confirmed && (hold.clearProposer == address(0) || hold.clearProposer == _msgSender())) {
            hold.clearProposer = _msgSender();
            emit HoldClearProposed(member, _msgSender());
        } else {
            delete _holds[member];
            emit HoldCleared(member, _msgSender());
        }
    }

    /// @dev Every enforcement path calls this first. A hold only delays: it reverts the call and
    /// touches nothing else. A lapsed hold is dropped and logged on the way through.
    function _requireNoHold(address member) private {
        Hold storage hold = _holds[member];
        if (!hold.confirmed) return;
        if (block.timestamp < hold.until) revert LiquidatorOnHold(member, hold.reason, hold.until);
        delete _holds[member];
        emit HoldLapsed(member);
    }

    /// @dev Reverts unless the member is in default with `issuer` now, or the default it recorded
    /// is a default of the line the member holds today (Phase 4b, M-C). A default before the line
    /// was opened ended an earlier line; liquidation reaches only the episode that triggered it.
    function _requireCurrentDefault(address member, address issuer) private view {
        if (
            !ICreditIssuer(issuer).inDefault(member)
                && !ICurrentLineDefault(issuer).hasDefaultedOnCurrentLine(member)
        ) revert LiquidatorNotInDefault(member, issuer);
    }

    /* ========== SECTION 12: BOND SEIZE GATE ========== */

    /// @notice answers BurnerBond's settlement gate (owner decision on 12.5/12.8 vs audit M-6).
    /// @dev BurnerBond's default gate stays the issuer's computed default. This second gate is true
    /// only for the member this contract is taking a bond from, inside that one `settleExcess` or
    /// `settleShortfall` call, after it has checked on chain that an excess stands or a shortfall
    /// notice has matured. It declares no default and takes only the smallest covering bond, and
    /// `redeemEarly` must realize at least present value.
    function mayTakeBond(address member) external view returns (bool) {
        return member != address(0) && member == _enforcing;
    }

    /// @dev A seized bond arrives here for the length of one enforcement call, and nothing else may.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external view returns (bytes4) {
        if (_enforcing == address(0)) revert LiquidatorBadParameter();
        return this.onERC1155Received.selector;
    }

    /* ========== SECTION 12: HELPERS ========== */

    function _requireTrusted(address issuer) private view {
        if (!trustedSavingsIssuer[issuer]) revert LiquidatorUntrustedIssuer(issuer);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _earnKinds() private view returns (bytes32 poolKind, bytes32 bondKind) {
        if (address(earnPool) != address(0)) poolKind = earnPool.collateralKind();
        if (address(earnBonds) != address(0)) bondKind = earnBonds.collateralKind();
    }

    /// @dev The issuer's tier for a kind, if it has one.
    function _tierOf(address issuer, bytes32 kind) private view returns (bool found, uint256 tierId) {
        if (kind == bytes32(0)) return (false, 0);
        uint256 count = ITierSettler(issuer).tierCount();
        for (; tierId < count; tierId++) {
            (bytes32 tierKind, , ) = ITierSettler(issuer).tierAt(tierId);
            if (tierKind == kind) return (true, tierId);
        }
        return (false, 0);
    }

    function _haircutOf(bytes32 kind) private view returns (uint256 haircutBps) {
        (, haircutBps, , , ) = collateralRegistry.collateralTypes(kind);
    }

    function _gapOf(address member, address issuer, bytes32 kind) private view returns (uint256) {
        (bool found, uint256 tierId) = _tierOf(issuer, kind);
        if (!found) return 0;
        uint256 drawn = ITierSettler(issuer).principalOf(member, tierId);
        uint256 backing = (collateralRegistry.collateralValueOf(member, kind) * _haircutOf(kind)) / BPS;
        return drawn > backing ? drawn - backing : 0;
    }

    /// @dev The smallest value of a kind's pledge whose redemption closes its gap, capped at the
    /// pledge's value. With a 100% haircut no partial redemption closes it, so the whole pledge.
    function _closing(address member, address issuer, bytes32 kind) private view returns (uint256 need) {
        uint256 gap = _gapOf(member, issuer, kind);
        if (gap == 0) return 0;
        uint256 value = collateralRegistry.collateralValueOf(member, kind);
        uint256 haircut = _haircutOf(kind);
        need = haircut >= BPS ? value : Math.mulDiv(gap, BPS, BPS - haircut, Math.Rounding.Up);
        if (need > value) need = value;
    }

    /// @dev Takes pledged pool shares worth `need`, bounded by what the registry's lock holds.
    function _realizeShares(address member, uint256 need) private returns (uint256 realized, uint256 queuedValue) {
        ISeizableShares pool = earnPool;
        if (address(pool) == address(0)) return (0, 0);
        bytes32 kind = pool.collateralKind();
        uint256 count = pool.previewWithdraw(need);
        count = _min(count, _min(pool.balanceOf(member), collateralRegistry.encumberedOfKind(member, kind)));
        if (count == 0) return (0, 0);
        (realized, queuedValue, ) = _takeShares(member, kind, pool, count);
    }

    /// @dev Takes pledged bonds until their present value covers `need`: the smallest bond that
    /// covers what is left, or else the largest and on again. Each is redeemed early and must pay
    /// at least its present value.
    function _realizeBonds(address member, uint256 need) private returns (uint256 realized) {
        IEarnBonds bonds = earnBonds;
        if (address(bonds) == address(0)) return 0;
        bytes32 kind = bonds.collateralKind();
        uint256[] memory items = collateralRegistry.pledgedItemsOf(member, kind);
        uint256[] memory values = new uint256[](items.length);
        for (uint256 i = 0; i < items.length; i++) {
            if (bonds.balanceOf(member, items[i]) > 0 && collateralRegistry.isItemEncumbered(member, kind, items[i])) {
                values[i] = bonds.presentValueOf(items[i]);
            }
        }
        while (realized < need) {
            uint256 left = need - realized;
            uint256 pick = type(uint256).max;
            uint256 best;
            bool covers;
            for (uint256 i = 0; i < values.length; i++) {
                uint256 v = values[i];
                if (v == 0) continue;
                if (v >= left ? (!covers || v < best) : (!covers && v > best)) {
                    (pick, best, covers) = (i, v, v >= left);
                }
            }
            if (pick == type(uint256).max) break;
            values[pick] = 0;
            realized += _redeemBond(member, kind, items[pick], best);
        }
    }

    function _redeemBond(address member, bytes32 kind, uint256 bondId, uint256 presentValue)
        private
        returns (uint256 received)
    {
        _enforcing = member;
        earnBonds.seizeBond(bondId, member, address(this));
        _enforcing = address(0);
        collateralRegistry.recordItemSeizure(member, kind, bondId);
        uint256 before = reserveToken.balanceOf(address(this));
        earnBonds.redeemEarly(bondId);
        received = reserveToken.balanceOf(address(this)) - before;
        if (received < presentValue) revert LiquidatorBelowPresentValue(bondId, received, presentValue);
        emit BondRedeemed(member, bondId, received);
    }

    /// @dev Settles up to `target` of `realized` against the tiers of `order[0]` then `order[1]`,
    /// then whatever is left against `order[2]` (the tier the taken collateral backed), and returns
    /// the rest to the member: it was theirs, and the debt it was taken for is met.
    function _settle(address member, address issuer, bytes32[3] memory order, uint256 realized, uint256 target)
        private
        returns (uint256 applied)
    {
        for (uint256 k = 0; k < 3; k++) {
            uint256 budget = k < 2 ? _min(realized, target) : realized;
            (bool found, uint256 tierId) = _tierOf(issuer, order[k]);
            if (!found || budget <= applied) continue;
            uint256 pay = _min(ITierSettler(issuer).principalOf(member, tierId), budget - applied);
            if (pay == 0) continue;
            reserveToken.forceApprove(issuer, pay);
            ITierSettler(issuer).settleFromCollateral(member, tierId, pay);
            applied += pay;
        }
        if (realized > applied) reserveToken.safeTransfer(member, realized - applied);
    }
}
