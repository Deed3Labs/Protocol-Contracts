// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../core/interfaces/stable-credit/IEncumbranceSource.sol";

/// @title LendingPool
/// @notice Member money funding the unsecured tiers, priced by how much of it is in use.
/// @dev ERC-4626 because the interface is worth more than anything a bespoke one would buy: it is
/// auditable against a spec people already know, and composable with everything that speaks it.
/// The vault semantics are kept honest rather than bent -- `maxWithdraw` reports what would
/// actually succeed, and the queue below is a separate path rather than a `withdraw` that
/// silently does something else.
///
/// **Only the unsecured tiers.** Savings-backed and asset-backed credit is funded by the
/// collateral behind it and needs no capital. What needs funding is the part collateral does not
/// reach, which is also the only part that can lose money.
///
/// **The rate rises with utilization, so the pool regulates itself.** Capital arriving faster than
/// demand for it drops the yield, which sends the next dollar somewhere else; demand outrunning
/// capital raises the yield and pulls it back. Nobody has to decide the pool is full, which is
/// good, because deciding that correctly requires knowing tomorrow's loan demand.
///
/// **It takes losses before the AssurancePool does.** That is an ordering fact about the
/// waterfall rather than a reserve arrangement: depositors here are earning the return on
/// unsecured lending, so they carry its first loss. The AssurancePool is what stands behind them
/// once they are exhausted.
contract LendingPool is ERC4626Upgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice May draw from the pool to fund unsecured credit.
    bytes32 public constant BORROWER_ROLE = keccak256("BORROWER_ROLE");
    /// @notice May report a loss on the credit book.
    bytes32 public constant LOSS_REPORTER_ROLE = keccak256("LOSS_REPORTER_ROLE");
    /// @notice May take shares that are backing drawn credit, and only those.
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");

    uint256 internal constant BPS = 10_000;

    /// @notice A depositor waiting for cash the pool has lent out.
    struct WithdrawalRequest {
        address owner;
        address receiver;
        uint256 assets;
        uint64 requestedAt;
        bool claimed;
    }

    /// @notice Principal the pool has lent and not been repaid.
    uint256 public totalBorrowed;
    /// @notice Assets owed to depositors who have queued, already deducted from their shares.
    uint256 public queuedAssets;

    WithdrawalRequest[] private requests;
    /// @dev owner => request ids
    mapping(address => uint256[]) private requestsOf;

    /// @notice Rate at zero utilization, per cycle, in basis points.
    uint256 public baseRatePerCycle;
    /// @notice Additional rate at the kink, per cycle, in basis points.
    uint256 public slope1PerCycle;
    /// @notice Additional rate from the kink to full utilization, per cycle, in basis points.
    uint256 public slope2PerCycle;
    /// @notice Utilization the curve steepens at, in basis points.
    uint256 public kinkBps;

    /// @notice Reports how many of a holder's shares are backing drawn credit.
    /// @dev Pool shares are collateral like anything else, so they need the same two things
    /// CLRUSD has: a refusal to move while pledged, and a way for the co-op to take them when the
    /// member defaults. Recording a pledge in a registry does neither -- the member holds the
    /// shares.
    IEncumbranceSource public encumbranceSource;
    /// @notice The collateral kind these shares are pledged as.
    bytes32 public collateralKind;

    uint256[40] private __gap;

    error LendingPoolInvalidAddress();
    error LendingPoolInvalidCurve();
    error LendingPoolInsufficientCash(uint256 available, uint256 requested);
    error LendingPoolNothingQueued(uint256 requestId);
    error LendingPoolNotRequestOwner(uint256 requestId);
    error LendingPoolEncumbered(address holder, uint256 free, uint256 amount);
    error LendingPoolSeizureExceedsEncumbrance(address holder, uint256 encumbered, uint256 amount);

    event Borrowed(address indexed borrower, address indexed to, uint256 amount);
    event Repaid(address indexed from, uint256 amount);
    event LossAbsorbed(uint256 reported, uint256 absorbed, uint256 uncovered);
    event WithdrawalQueued(uint256 indexed requestId, address indexed owner, uint256 assets);
    event WithdrawalClaimed(uint256 indexed requestId, address indexed receiver, uint256 assets);
    event RateCurveUpdated(uint256 base, uint256 slope1, uint256 slope2, uint256 kinkBps);
    event EncumbranceSourceUpdated(address indexed source);
    event SharesSeized(address indexed holder, address indexed to, uint256 shares);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address reserveToken, string memory name_, string memory symbol_)
        external
        initializer
    {
        if (admin == address(0) || reserveToken == address(0)) {
            revert LendingPoolInvalidAddress();
        }
        __ERC20_init(name_, symbol_);
        __ERC4626_init(IERC20Upgradeable(reserveToken));
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        // A conservative starting curve: cheap while the pool is idle, steep once it is not.
        baseRatePerCycle = 25;
        slope1PerCycle = 75;
        slope2PerCycle = 900;
        kinkBps = 8_000;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    /// @notice everything the pool owns, lent or not.
    /// @dev Cash plus what is out on loan, less what queued depositors are already owed. Leaving
    /// queued assets in would have them counted twice: once in the share price, and once in the
    /// claim that was created when the shares were burned.
    function totalAssets() public view override returns (uint256) {
        uint256 cash = IERC20Upgradeable(asset()).balanceOf(address(this));
        uint256 total = cash + totalBorrowed;
        return total > queuedAssets ? total - queuedAssets : 0;
    }

    /// @notice cash on hand and not already claimed by the queue.
    function availableCash() public view returns (uint256) {
        uint256 cash = IERC20Upgradeable(asset()).balanceOf(address(this));
        return cash > queuedAssets ? cash - queuedAssets : 0;
    }

    /// @notice how much of the pool is lent out, in basis points.
    function utilizationBps() public view returns (uint256) {
        uint256 total = totalAssets();
        if (total == 0) return 0;
        uint256 used = totalBorrowed > total ? total : totalBorrowed;
        return (used * BPS) / total;
    }

    /// @notice what borrowing costs at the current utilization, per cycle, in basis points.
    /// @dev Two slopes meeting at a kink. Below it the rate rises gently, so capital is cheap
    /// while there is plenty; above it steeply, so the last of the cash is expensive and the
    /// pool refills before it runs dry rather than after.
    function borrowRatePerCycle() public view returns (uint256) {
        uint256 utilization = utilizationBps();
        if (utilization <= kinkBps) {
            if (kinkBps == 0) return baseRatePerCycle;
            return baseRatePerCycle + (slope1PerCycle * utilization) / kinkBps;
        }
        uint256 excess = utilization - kinkBps;
        uint256 span = BPS - kinkBps;
        return baseRatePerCycle + slope1PerCycle + (slope2PerCycle * excess) / span;
    }

    /// @notice what depositors earn, per cycle, in basis points.
    /// @dev The borrow rate scaled by how much of the pool is actually earning it. Idle capital
    /// dilutes the yield, which is the mechanism that sends the next dollar elsewhere.
    function supplyRatePerCycle() public view returns (uint256) {
        return (borrowRatePerCycle() * utilizationBps()) / BPS;
    }

    /// @inheritdoc ERC4626Upgradeable
    /// @dev Bounded by cash rather than by holdings, because the spec says this is what would
    /// actually succeed. A depositor whose money is out on loan is not refused silently -- they
    /// are told to queue, which is a different thing from a failed withdrawal.
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 owned = super.maxWithdraw(owner);
        uint256 cash = availableCash();
        return owned < cash ? owned : cash;
    }

    /// @inheritdoc ERC4626Upgradeable
    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 shares = super.maxRedeem(owner);
        uint256 withdrawable = previewWithdraw(maxWithdraw(owner));
        return shares < withdrawable ? shares : withdrawable;
    }

    function requestCount() external view returns (uint256) {
        return requests.length;
    }

    function requestsOwnedBy(address owner) external view returns (uint256[] memory) {
        return requestsOf[owner];
    }

    function requestAt(uint256 requestId)
        external
        view
        returns (address owner, address receiver, uint256 assets, uint64 requestedAt, bool claimed)
    {
        WithdrawalRequest storage request = requests[requestId];
        return (request.owner, request.receiver, request.assets, request.requestedAt, request.claimed);
    }

    /// @notice whether a queued request can be paid right now.
    function isClaimable(uint256 requestId) public view returns (bool) {
        WithdrawalRequest storage request = requests[requestId];
        if (request.claimed) return false;
        return IERC20Upgradeable(asset()).balanceOf(address(this)) >= request.assets;
    }

    /* ========== COLLATERAL ========== */

    /// @notice how many of a holder's shares are pledged against drawn credit.
    function encumberedOf(address holder) public view returns (uint256) {
        if (address(encumbranceSource) == address(0) || collateralKind == bytes32(0)) return 0;
        try encumbranceSource.encumberedOfKind(holder, collateralKind) returns (uint256 locked) {
            return locked;
        } catch {
            // An unreadable source locks nothing. A registry going quiet is a problem to fix; a
            // pool that freezes every depositor until somebody fixes it is a worse one.
            return 0;
        }
    }

    /// @notice how many of a holder's shares may leave.
    function freeSharesOf(address holder) public view returns (uint256) {
        uint256 balance = balanceOf(holder);
        uint256 locked = encumberedOf(holder);
        return balance > locked ? balance - locked : 0;
    }

    /// @notice takes shares that are backing drawn credit.
    /// @dev Bounded by what is actually pledged, so it cannot reach a depositor's free shares or
    /// touch somebody who has drawn nothing. It does not decide whether a default has happened --
    /// the caller does, and the caller should be a contract that checks.
    ///
    /// What it hands over is shares, not money. Turning them back into money is a redemption from
    /// this pool like any other, which may have to wait behind the queue -- collateral can be
    /// sufficient and still not be available today.
    function seizeShares(address holder, address to, uint256 shares)
        external
        onlyRole(LIQUIDATOR_ROLE)
    {
        uint256 encumbered = encumberedOf(holder);
        if (shares > encumbered) {
            revert LendingPoolSeizureExceedsEncumbrance(holder, encumbered, shares);
        }
        _transfer(holder, to, shares);
        emit SharesSeized(holder, to, shares);
    }

    /// @notice sets the contract reporting what is pledged, and the kind to ask about.
    function setEncumbranceSource(address source, bytes32 kind) external onlyRole(OPERATOR_ROLE) {
        encumbranceSource = IEncumbranceSource(source);
        collateralKind = kind;
        emit EncumbranceSourceUpdated(source);
    }

    /// @dev Pledged shares do not leave by an ordinary transfer either. Refusing to let them move
    /// is what makes the pledge mean anything, since the member holds them.
    function _beforeTokenTransfer(address from, address to, uint256 amount)
        internal
        virtual
        override
    {
        super._beforeTokenTransfer(from, to, amount);
        if (from == address(0) || to == address(0)) return;
        if (hasRole(LIQUIDATOR_ROLE, _msgSender())) return;
        uint256 free = freeSharesOf(from);
        if (amount > free) revert LendingPoolEncumbered(from, free, amount);
    }

    /* ========== THE QUEUE ========== */

    /// @notice queues a withdrawal the pool has no cash for yet.
    /// @dev The shares are burned now and the claim is fixed in assets, so a depositor who queues
    /// stops earning and stops carrying loss from that moment. Leaving them in would mean waiting
    /// in line and paying for the privilege.
    ///
    /// A queue rather than a revert. A depositor whose money is out on loan has not made a
    /// mistake, and the app can show them where they stand instead of an error.
    /// @param shares shares to redeem.
    /// @param receiver address to pay.
    /// @return requestId the queued claim.
    function requestWithdrawal(uint256 shares, address receiver) external returns (uint256 requestId) {
        if (receiver == address(0)) revert LendingPoolInvalidAddress();
        uint256 assets = previewRedeem(shares);
        _burn(_msgSender(), shares);
        queuedAssets += assets;

        requestId = requests.length;
        requests.push(
            WithdrawalRequest({
                owner: _msgSender(),
                receiver: receiver,
                assets: assets,
                requestedAt: uint64(block.timestamp),
                claimed: false
            })
        );
        requestsOf[_msgSender()].push(requestId);
        emit WithdrawalQueued(requestId, _msgSender(), assets);
    }

    /// @notice pays a queued withdrawal once the cash is back.
    function claimWithdrawal(uint256 requestId) external returns (uint256 assets) {
        WithdrawalRequest storage request = requests[requestId];
        if (request.claimed || request.assets == 0) revert LendingPoolNothingQueued(requestId);
        if (request.owner != _msgSender()) revert LendingPoolNotRequestOwner(requestId);

        assets = request.assets;
        uint256 cash = IERC20Upgradeable(asset()).balanceOf(address(this));
        if (cash < assets) revert LendingPoolInsufficientCash(cash, assets);

        request.claimed = true;
        queuedAssets -= assets;
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), request.receiver, assets);
        emit WithdrawalClaimed(requestId, request.receiver, assets);
    }

    /* ========== BORROWING ========== */

    /// @notice draws cash to fund unsecured credit.
    function borrow(uint256 amount, address to) external onlyRole(BORROWER_ROLE) {
        if (to == address(0)) revert LendingPoolInvalidAddress();
        uint256 cash = availableCash();
        if (amount > cash) revert LendingPoolInsufficientCash(cash, amount);

        totalBorrowed += amount;
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), to, amount);
        emit Borrowed(_msgSender(), to, amount);
    }

    /// @notice returns borrowed cash, and anything above the principal is yield.
    /// @dev Repaying more than was borrowed leaves the surplus as cash against unchanged
    /// liabilities, which is exactly how a share price rises. Carry earned on the tiers this pool
    /// funded arrives here, and it arrives for the depositors rather than for the co-op.
    function repay(uint256 amount) external {
        SafeERC20Upgradeable.safeTransferFrom(
            IERC20Upgradeable(asset()), _msgSender(), address(this), amount
        );
        totalBorrowed = amount > totalBorrowed ? 0 : totalBorrowed - amount;
        emit Repaid(_msgSender(), amount);
    }

    /* ========== FIRST LOSS ========== */

    /// @notice writes off credit this pool funded, and reports what it could not cover.
    /// @dev The waterfall's first step. Depositors here earn the return on unsecured lending, so
    /// they carry its first loss: the loan stops being an asset, the share price falls, and the
    /// AssurancePool is not touched.
    ///
    /// It reports back rather than reverting when the loss is larger than the pool. A loss that
    /// exceeds first-loss capacity is precisely when the next layer is supposed to act, and a
    /// revert there would stall the write-off instead of escalating it.
    /// @param amount loss to absorb.
    /// @return absorbed what this pool covered.
    /// @return uncovered what the next layer must cover.
    function absorbLoss(uint256 amount)
        external
        onlyRole(LOSS_REPORTER_ROLE)
        returns (uint256 absorbed, uint256 uncovered)
    {
        absorbed = amount > totalBorrowed ? totalBorrowed : amount;
        uncovered = amount - absorbed;
        totalBorrowed -= absorbed;
        emit LossAbsorbed(amount, absorbed, uncovered);
    }

    /* ========== RESTRICTED ========== */

    /// @notice sets the shape of the rate curve.
    function setRateCurve(uint256 base, uint256 slope1, uint256 slope2, uint256 kink)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (kink == 0 || kink >= BPS) revert LendingPoolInvalidCurve();
        baseRatePerCycle = base;
        slope1PerCycle = slope1;
        slope2PerCycle = slope2;
        kinkBps = kink;
        emit RateCurveUpdated(base, slope1, slope2, kink);
    }
}
