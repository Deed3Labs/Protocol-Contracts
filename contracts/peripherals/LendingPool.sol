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
///
/// **Audit fixes (Phase 1).**
/// - H-4: a borrower draws only to the destination stored for it (`borrowDestinationOf`) and only
///   up to its daily cap. The card-settler key used to be able to `borrow(amount, anyAddress)`.
/// - X-7: a queued withdrawal escrows its shares and is priced at claim time, capped at its value
///   when queued, so a depositor who queues just before a loss still carries their share of it.
/// - X-18: cash that arrives outside a tracked deposit or principal repayment (interest) is
///   streamed into the share price over `INTEREST_STREAM_PERIOD`, so a deposit-and-withdraw around
///   a repayment cannot capture it.
/// - M-3: an unreadable encumbrance source no longer unlocks every pledged share. See
///   `encumberedOf`.
contract LendingPool is ERC4626Upgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice May draw from the pool to fund unsecured credit.
    bytes32 public constant BORROWER_ROLE = keccak256("BORROWER_ROLE");
    /// @notice May report a loss on the credit book.
    bytes32 public constant LOSS_REPORTER_ROLE = keccak256("LOSS_REPORTER_ROLE");
    /// @notice May take shares that are backing drawn credit, and only those.
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");

    uint256 internal constant BPS = 10_000;
    /// @notice How long a lump of interest takes to reach the share price in full (audit X-18).
    /// @dev Long enough that a holder who is in the pool only around a repayment captures a small
    /// fraction of it; short enough that depositors see the yield within the cycle it was earned.
    uint256 public constant INTEREST_STREAM_PERIOD = 7 days;

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
    /// @notice Cash reserved for depositors who have queued: each request's value when queued,
    /// which caps what it is paid (audit X-7). Requests queued before that fix burned their
    /// shares, so their part is also deducted from `totalAssets`; see `escrowedQueueCaps`.
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

    /* ========== ADDED BY THE AUDIT FIXES (append-only; 9 slots from the gap) ========== */

    /// @notice Where each borrower's draws must go (audit H-4). Unset means it cannot borrow.
    /// @dev The PayoutPool's destination is itself; the card settler's is the card float.
    mapping(address => address) public borrowDestinationOf;
    /// @notice Most each borrower may draw per UTC day, in assets (audit H-4).
    mapping(address => uint256) public dailyBorrowCapOf;
    /// @dev What each borrower has drawn on `day`.
    struct BorrowWindow {
        uint64 day;
        uint192 drawn;
    }
    mapping(address => BorrowWindow) private borrowWindowOf;
    /// @dev Shares held in escrow by this pool for each queued request (audit X-7). Zero for a
    /// request queued before the fix, whose shares were burned and whose claim is fixed in assets.
    mapping(uint256 => uint256) private requestSharesOf;
    /// @notice The part of `queuedAssets` that belongs to escrowed (priced-at-claim) requests.
    uint256 public escrowedQueueCaps;
    /// @dev Interest not yet streamed into the share price, as it stood at `interestLockedAt`.
    uint192 private lockedInterest;
    uint64 private interestLockedAt;
    /// @dev Cash the pool has accounted for. Anything above it is untracked inflow -- interest.
    uint256 private accountedCash;
    /// @dev False on a proxy upgraded from before X-18 until its first state change, which adopts
    /// the current balance as accounted rather than treating every dollar held as new interest.
    bool private cashAccountingOn;
    /// @notice The lock last read successfully for each holder (audit M-3). If the source later
    /// reverts, a holder with a non-zero record is treated as fully locked.
    mapping(address => uint256) public lastKnownLock;

    uint256[31] private __gap;

    error LendingPoolInvalidAddress();
    error LendingPoolInvalidCurve();
    error LendingPoolInsufficientCash(uint256 available, uint256 requested);
    error LendingPoolNothingQueued(uint256 requestId);
    error LendingPoolNotRequestOwner(uint256 requestId);
    error LendingPoolEncumbered(address holder, uint256 free, uint256 amount);
    error LendingPoolSeizureExceedsEncumbrance(address holder, uint256 encumbered, uint256 amount);
    error LendingPoolDestinationNotAllowed(address borrower, address to);
    error LendingPoolDailyCapExceeded(address borrower, uint256 remaining, uint256 requested);
    error LendingPoolEncumbranceUnreadable(address holder);

    event Borrowed(address indexed borrower, address indexed to, uint256 amount);
    event Repaid(address indexed from, uint256 amount);
    event LossAbsorbed(uint256 reported, uint256 absorbed, uint256 uncovered);
    event WithdrawalQueued(uint256 indexed requestId, address indexed owner, uint256 assets);
    event WithdrawalClaimed(uint256 indexed requestId, address indexed receiver, uint256 assets);
    event RateCurveUpdated(uint256 base, uint256 slope1, uint256 slope2, uint256 kinkBps);
    event EncumbranceSourceUpdated(address indexed source);
    event SharesSeized(address indexed holder, address indexed to, uint256 shares);
    event BorrowerConfigured(address indexed borrower, address indexed destination, uint256 dailyCap);
    event InterestStreamed(uint256 inflow, uint256 locked);
    /// @notice The encumbrance source reverted while a holder's shares moved (audit M-3). Alert on it.
    event EncumbranceSourceReverted(address indexed holder, uint256 lastKnownLock);

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
        cashAccountingOn = true;

        // A conservative starting curve: cheap while the pool is idle, steep once it is not.
        baseRatePerCycle = 25;
        slope1PerCycle = 75;
        slope2PerCycle = 900;
        kinkBps = 8_000;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    /// @notice everything the pool owns, lent or not.
    /// @dev Cash plus what is out on loan, less two things:
    /// - claims of requests queued before the X-7 fix, whose shares were burned (counting them
    ///   would count them twice). Requests queued since keep their shares in escrow, so they stay
    ///   in the share price and share its losses until claimed;
    /// - interest not yet streamed in (X-18).
    function totalAssets() public view override returns (uint256) {
        uint256 total = _cash() + totalBorrowed;
        uint256 deduct = (queuedAssets - escrowedQueueCaps) + unvestedInterest();
        return total > deduct ? total - deduct : 0;
    }

    /// @notice interest received but not yet in the share price (audit X-18).
    /// @dev What was locked at the last sync, decaying linearly over the stream period, plus any
    /// untracked inflow since, which has not started streaming yet.
    function unvestedInterest() public view returns (uint256) {
        uint256 locked = lockedInterest;
        uint256 elapsed = block.timestamp - interestLockedAt;
        uint256 remaining =
            elapsed >= INTEREST_STREAM_PERIOD ? 0 : (locked * (INTEREST_STREAM_PERIOD - elapsed)) / INTEREST_STREAM_PERIOD;
        return remaining + _pendingInflow();
    }

    function _cash() private view returns (uint256) {
        return IERC20Upgradeable(asset()).balanceOf(address(this));
    }

    function _pendingInflow() private view returns (uint256) {
        if (!cashAccountingOn) return 0;
        uint256 cash = _cash();
        return cash > accountedCash ? cash - accountedCash : 0;
    }

    /// @dev Starts streaming any untracked inflow. Called before every state change, so the share
    /// price a deposit or withdrawal is priced at is the one `totalAssets` already reported.
    function _syncInterest() private {
        uint256 cash = _cash();
        if (!cashAccountingOn) {
            cashAccountingOn = true;
            accountedCash = cash;
            return;
        }
        if (cash > accountedCash) {
            uint256 inflow = cash - accountedCash;
            uint256 locked = unvestedInterest(); // includes the inflow
            lockedInterest = uint192(locked);
            interestLockedAt = uint64(block.timestamp);
            emit InterestStreamed(inflow, locked);
        }
        accountedCash = cash;
    }

    /// @dev Records cash that moved through a tracked path (deposit, withdrawal, borrow, claim,
    /// principal repayment), so it is not mistaken for interest.
    function _accountCash() private {
        accountedCash = _cash();
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

    /// @notice what a queued request would pay if claimed now (audit X-7).
    /// @dev The escrowed shares at today's price, capped at what they were worth when queued: a
    /// queued depositor stops earning but still carries their share of any loss. A request from
    /// before the fix pays its fixed amount.
    function requestValue(uint256 requestId) public view returns (uint256) {
        WithdrawalRequest storage request = requests[requestId];
        if (request.claimed) return 0;
        uint256 shares = requestSharesOf[requestId];
        if (shares == 0) return request.assets;
        uint256 value = convertToAssets(shares);
        return value < request.assets ? value : request.assets;
    }

    /// @notice whether a queued request can be paid right now.
    function isClaimable(uint256 requestId) public view returns (bool) {
        WithdrawalRequest storage request = requests[requestId];
        if (request.claimed) return false;
        return _cash() >= requestValue(requestId);
    }

    /* ========== COLLATERAL ========== */

    /// @notice how many of a holder's shares are pledged against drawn credit.
    /// @dev Fails closed for pledgers, open for everyone else (audit M-3). This used to return 0
    /// whenever the source reverted, so a bad registry upgrade -- or a caller sending just enough
    /// gas for the registry call to run out -- unlocked every pledged share with no sign on chain.
    /// Now, when the source reverts, a holder whose last successfully read lock was non-zero is
    /// treated as fully locked; a holder never seen locked (who has never pledged, or whose
    /// pledge was last read as zero) is not frozen. Reads are recorded on every share movement
    /// and by the permissionless `syncEncumbrance`, which the credit side should call after a draw
    /// so the record is current before anything can go wrong.
    function encumberedOf(address holder) public view returns (uint256) {
        (uint256 locked, bool ok) = _readLock(holder);
        if (ok) return locked;
        return lastKnownLock[holder] > 0 ? type(uint256).max : 0;
    }

    /// @notice records a holder's current lock from the source. Permissionless: it can only write
    /// what the source reports, and reverts (writing nothing) if the source cannot be read.
    function syncEncumbrance(address holder) external returns (uint256 locked) {
        if (address(encumbranceSource) == address(0) || collateralKind == bytes32(0)) return 0;
        locked = encumbranceSource.encumberedOfKind(holder, collateralKind);
        lastKnownLock[holder] = locked;
    }

    /// @dev The source's answer, and whether it gave one. Unconfigured is a valid answer of zero.
    function _readLock(address holder) private view returns (uint256 locked, bool ok) {
        if (address(encumbranceSource) == address(0) || collateralKind == bytes32(0)) return (0, true);
        try encumbranceSource.encumberedOfKind(holder, collateralKind) returns (uint256 value) {
            return (value, true);
        } catch {
            return (0, false);
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
        // A seizure needs a real answer: "fully locked" is a reason to refuse a transfer, never a
        // licence to take everything.
        (uint256 encumbered, bool ok) = _readLock(holder);
        if (!ok) revert LendingPoolEncumbranceUnreadable(holder);
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
    ///
    /// Nor by a burn: `withdraw`, `redeem` and `requestWithdrawal` all burn the holder's shares, and
    /// this used to wave every burn through -- so a member could take pledged shares out as cash
    /// while the credit they backed was still drawn. Only a mint skips the check.
    function _beforeTokenTransfer(address from, address to, uint256 amount)
        internal
        virtual
        override
    {
        super._beforeTokenTransfer(from, to, amount);
        if (from == address(0)) return;
        // The pool's own escrow (queued requests, X-7) pledges nothing.
        if (from == address(this)) return;
        if (hasRole(LIQUIDATOR_ROLE, _msgSender())) return;
        (uint256 locked, bool ok) = _readLock(from);
        if (ok) {
            if (locked != lastKnownLock[from]) lastKnownLock[from] = locked;
        } else {
            locked = lastKnownLock[from] > 0 ? type(uint256).max : 0;
            emit EncumbranceSourceReverted(from, lastKnownLock[from]);
        }
        uint256 balance = balanceOf(from);
        uint256 free = balance > locked ? balance - locked : 0;
        if (amount > free) revert LendingPoolEncumbered(from, free, amount);
    }

    /// @dev Every ERC-4626 entry point lands here. Interest is synced first so the price used is
    /// the one already reported, and the deposit is then recorded as accounted cash.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        _syncInterest();
        super._deposit(caller, receiver, assets, shares);
        _accountCash();
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        _syncInterest();
        super._withdraw(caller, receiver, owner, assets, shares);
        _accountCash();
    }

    /* ========== THE QUEUE ========== */

    /// @notice queues a withdrawal the pool has no cash for yet.
    /// @dev The shares go into escrow here and the claim is priced when it is paid, capped at what
    /// the shares were worth when queued (audit X-7). So a depositor who queues stops earning from
    /// that moment, but does not stop carrying loss: burning the shares and fixing the claim in
    /// assets, as this used to, let anyone who saw a default coming queue at the pre-loss price
    /// and push their share of it onto everyone who stayed.
    ///
    /// A queue rather than a revert. A depositor whose money is out on loan has not made a
    /// mistake, and the app can show them where they stand instead of an error.
    /// @param shares shares to redeem.
    /// @param receiver address to pay.
    /// @return requestId the queued claim.
    function requestWithdrawal(uint256 shares, address receiver) external returns (uint256 requestId) {
        if (receiver == address(0)) revert LendingPoolInvalidAddress();
        _syncInterest();
        uint256 assets = previewRedeem(shares);
        // Pledged shares cannot be queued: the transfer runs the same lock check a burn did.
        _transfer(_msgSender(), address(this), shares);
        queuedAssets += assets;
        escrowedQueueCaps += assets;

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
        requestSharesOf[requestId] = shares;
        requestsOf[_msgSender()].push(requestId);
        emit WithdrawalQueued(requestId, _msgSender(), assets);
    }

    /// @notice pays a queued withdrawal once the cash is back.
    function claimWithdrawal(uint256 requestId) external returns (uint256 assets) {
        WithdrawalRequest storage request = requests[requestId];
        if (request.claimed || request.assets == 0) revert LendingPoolNothingQueued(requestId);
        if (request.owner != _msgSender()) revert LendingPoolNotRequestOwner(requestId);

        _syncInterest();
        uint256 cap = request.assets;
        uint256 shares = requestSharesOf[requestId];
        assets = requestValue(requestId);
        uint256 cash = _cash();
        if (cash < assets) revert LendingPoolInsufficientCash(cash, assets);

        request.claimed = true;
        queuedAssets -= cap;
        if (shares > 0) {
            // What the shares were worth above the payout stays in the pool, for the depositors
            // who carried the risk while this one waited.
            escrowedQueueCaps -= cap;
            requestSharesOf[requestId] = 0;
            _burn(address(this), shares);
        }
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), request.receiver, assets);
        _accountCash();
        emit WithdrawalClaimed(requestId, request.receiver, assets);
    }

    /* ========== BORROWING ========== */

    /// @notice draws cash to fund unsecured credit.
    /// @dev Only to the borrower's stored destination and within its daily cap (audit H-4). The
    /// card settler is a key on a server, and `to` used to be anything it liked, which made the
    /// pool's whole cash balance one leaked key away. The signature is unchanged so the PayoutPool,
    /// whose destination is itself, keeps calling it as before.
    function borrow(uint256 amount, address to) external onlyRole(BORROWER_ROLE) {
        address borrower = _msgSender();
        address destination = borrowDestinationOf[borrower];
        if (destination == address(0) || to != destination) revert LendingPoolDestinationNotAllowed(borrower, to);
        _syncInterest();
        uint256 cash = availableCash();
        if (amount > cash) revert LendingPoolInsufficientCash(cash, amount);

        BorrowWindow storage window = borrowWindowOf[borrower];
        uint64 today = uint64(block.timestamp / 1 days);
        uint256 drawnToday = window.day == today ? window.drawn : 0;
        uint256 cap = dailyBorrowCapOf[borrower];
        uint256 remaining = cap > drawnToday ? cap - drawnToday : 0;
        if (amount > remaining) revert LendingPoolDailyCapExceeded(borrower, remaining, amount);
        window.day = today;
        window.drawn = uint192(drawnToday + amount);

        totalBorrowed += amount;
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), to, amount);
        _accountCash();
        emit Borrowed(borrower, to, amount);
    }

    /// @notice what a borrower may still draw today.
    function borrowableToday(address borrower) external view returns (uint256) {
        BorrowWindow storage window = borrowWindowOf[borrower];
        uint256 drawnToday = window.day == uint64(block.timestamp / 1 days) ? window.drawn : 0;
        uint256 cap = dailyBorrowCapOf[borrower];
        return cap > drawnToday ? cap - drawnToday : 0;
    }

    /// @notice returns borrowed cash, and anything above the principal is yield.
    /// @dev Repaying more than was borrowed leaves the surplus as cash against unchanged
    /// liabilities, which is exactly how a share price rises. Carry earned on the tiers this pool
    /// funded arrives here, and it arrives for the depositors rather than for the co-op.
    ///
    /// The surplus streams in rather than landing at once (audit X-18): it is recorded as
    /// untracked inflow and starts vesting immediately.
    function repay(uint256 amount) external {
        _syncInterest();
        SafeERC20Upgradeable.safeTransferFrom(
            IERC20Upgradeable(asset()), _msgSender(), address(this), amount
        );
        uint256 principal = amount > totalBorrowed ? totalBorrowed : amount;
        totalBorrowed -= principal;
        accountedCash += principal;
        _syncInterest();
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

    /// @notice names where a borrower's draws go and how much it may draw per day (audit H-4).
    /// @dev Admin, like granting `BORROWER_ROLE` itself, so this adds no power the admin did not
    /// already hold. A zero destination or cap switches the borrower off.
    function setBorrower(address borrower, address destination, uint256 dailyCap)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (borrower == address(0)) revert LendingPoolInvalidAddress();
        borrowDestinationOf[borrower] = destination;
        dailyBorrowCapOf[borrower] = dailyCap;
        emit BorrowerConfigured(borrower, destination, dailyCap);
    }


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
