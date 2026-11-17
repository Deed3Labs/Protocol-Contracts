// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../core/interfaces/stable-credit/IStableCredit.sol";
import "./MerchantRegistry.sol";
import "./interfaces/IPayoutLenders.sol";

/// @title PayoutPool
/// @notice Turns a merchant's positive balance into money, on a schedule they were promised.
/// @dev A merchant's positive StableCredit is the payables ledger: what the co-op owes them,
/// on-chain, with no parallel record to reconcile against. This is where it becomes cash.
///
/// **The AssurancePool never funds and never lends here** (compliance addendum 12.11, section
/// 13). A merchant's balance is a payable -- certain, owed, due on a schedule -- and the co-op's
/// Assurance compartments cover a contingency that may never happen, so no redemption, payout or
/// force-settlement path touches them. This contract holds no address to call the pool with.
///
/// **A merchant is paid by drawdown first.** One holding credit of their own has it reduced
/// before any surplus becomes redeemable, and only the surplus can be withdrawn. That falls out
/// of the ledger holding one signed balance rather than being a rule enforced here, and it is the
/// cheapest possible payout because it costs no reserve at all.
///
/// **Funded beats queued.** If the pool covers the claim it pays now; if it is short the claim
/// queues at the merchant's own terms. Net-30 is the floor, not the promise -- a well funded pool
/// simply beats it, and directing spare capital here turns cash into merchant satisfaction, which
/// is the scarcest thing at ten merchants.
///
/// **Order is deadline, then claim age** (compliance addendum 12.10). Each claim is due at the time
/// it was queued plus the merchant's payout window, and the unpaid claim due soonest is paid first;
/// claims due at the same moment are paid oldest first. Strict claim age let a net-14 merchant miss
/// their deadline behind older net-30 claims that still had weeks to run. There is still no
/// priority field here or in the registry: the order follows from terms already agreed, and nobody
/// can move a claim.
///
/// One FIFO queue per payout window. Inside a queue every claim has the same window, so deadlines
/// rise with claim age and the queue's head is its earliest. Picking the next claim compares only
/// the heads, so the cost grows with the number of distinct windows queued at once (in practice
/// net-14 and net-30), never with the number of claims.
contract PayoutPool is AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice May move value in from somewhere already on chain.
    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");
    /// @notice A co-op address, named by the admin, that may redeem credit it holds.
    /// @dev The co-op's own accounts (the treasury holding positions it paid for) are not merchants
    /// but still need to turn a position into cash. They are named one by one, by the admin;
    /// nobody else who merely holds credit may redeem it (audit C-1, DECISIONS #3).
    bytes32 public constant REDEEMER_ROLE = keccak256("REDEEMER_ROLE");

    /// @notice A claim waiting to be paid.
    struct Claim {
        address merchant;
        uint256 amount;
        uint64 claimedAt;
        uint64 dueBy;
        bool paid;
    }

    IStableCredit public stableCredit;
    IERC20Upgradeable public reserveToken;
    MerchantRegistry public merchantRegistry;

    /// @notice Who takes over the merchant's side of the position.
    /// @dev Redemption moves the credits rather than destroying them. Burning would leave the
    /// member still owing and nobody holding the matching claim -- supply and obligation out of
    /// step, which is the shape of lost debt even though nothing was lost. The co-op paid cash
    /// for the position, so the co-op holds it, and the ledger still nets to zero.
    address public coopTreasury;

    Claim[] private claims;
    /// @dev merchant => claim ids
    mapping(address => uint256[]) private claimsOf;
    /// @dev The next unpaid claim among those queued before deadline ordering (the legacy queue).
    /// Its slot was `nextUnpaid`, the strict claim-age cursor. Claims queued since then are paid
    /// from the per-window queues, and `nextUnpaid()` is now a view over both.
    /// @custom:oz-renamed-from nextUnpaid
    uint256 private legacyNext;
    /// @notice Total still owed on queued claims.
    uint256 public queuedTotal;

    /* ========== ADDED AFTER DEPLOYMENT ==========
     *
     * Everything below this line came later, and its order is fixed by what is already on chain:
     * new storage goes after every variable the deployed implementation knows about, never among
     * them. Inserting `memberFunded` and `coopIncomeRecipient` further up compiled perfectly well
     * and would have shifted `claims`, `nextUnpaid` and `queuedTotal` underneath a live pool --
     * the upgrade validator refused it, which is what that check is for.
     */

    /// @notice cash here that came from members paying down their balances.
    /// @dev The position follows the cash, and this is what tells them apart.
    ///
    /// A claim paid with a member's own repayment is SETTLED, to the extent they have paid: the
    /// obligation went as they paid it, so those credits are burned and supply comes back into step
    /// with what is owed. A member clearing the lot after one cycle and a member three instalments
    /// into a twelve settle their share of it alike -- the rest stays a claim until they pay it.
    /// Moving them instead left the co-op holding a claim on nobody, which is what accumulated
    /// and what made "already paid for" impossible to tell from "still owed".
    ///
    /// A claim paid before the member has repaid is bought: somebody's capital went out and the
    /// member still owes it, so the credits move to whoever put the money in. That party now holds
    /// the position, exactly as the LendingPool does on the unsecured tiers it funds.
    uint256 public memberFunded;

    /// @notice where the co-op's income is PAID, when that is not where it accrues.
    /// @dev Two questions, two addresses. `coopTreasury` is who holds the claim -- the co-op's
    /// multisig, whose balance falls when it is paid. This is where the money lands, which an
    /// operator may well want somewhere else entirely: an on-ramp account, a different custodian,
    /// an account that pays the co-op's own bills. Unset means it lands with the holder of the
    /// claim, which is the ordinary case.
    address public coopIncomeRecipient;

    /// @notice capital each funder has here that has not bought a position yet.
    /// @dev Positions land with whoever actually paid for them, so more than one party can fund
    /// payouts without anybody having to work out afterwards whose money went where. The yield pool
    /// advancing cash so a merchant is paid on time holds what it funded; the co-op funding
    /// directly holds what it funded, on the same terms.
    mapping(address => uint256) public capitalOf;

    /// @dev Funders with capital still unspent, oldest first. Drawn down in that order, so the
    /// money that has been waiting longest is the money that gets used.
    address[] private funders;

    /// @notice position principal each funder is currently carrying, having paid a claim for it.
    /// @dev What the carry is split by. A funder bearing the float between a merchant being paid
    /// and a member repaying earns the carry on what they are bearing, in proportion -- the rule
    /// the unsecured tiers already follow, applied where the issuer cannot see who funded what.
    mapping(address => uint256) public advancedOf;
    uint256 public advancedTotal;
    /// @dev Funders carrying a position, for the split to walk.
    address[] private carriers;

    /// @notice credits held between a merchant redeeming and their claim being paid.
    /// @dev Tracked rather than inferred from the balance, because carry arrives as credits too:
    /// without this the pool could not tell a position in transit from carry to be split, and
    /// would settle one as the other.
    uint256 public inFlight;

    /// @notice refunds owed to members the pool could not cover when they were given back.
    /// @dev Their own money, waiting on the pool to have it again. Settled ahead of claims: a
    /// merchant queueing for a payout is waiting to be paid, and a member here is waiting for
    /// money they already handed over for something they gave back.
    mapping(address => uint256) private refundOwedTo;
    address[] private refundees;
    uint256 public refundsOwed;

    /// @notice where the pool draws when a claim has come due and there is nothing to pay it with.
    /// @dev The yield pool's unlent cash first, then the bond vault, then the treasury
    /// (`drawForDueClaim`). The lenders are REPAID rather than handed the position: the yield
    /// pool's share price is cash plus what is out on loan, so a credit claim sitting there would
    /// read as a hole in its books until somebody redeemed it. The co-op funding directly is
    /// different and still holds what it pays for -- it has no such books to hold straight.
    address public yieldPool;
    /// @dev Retired (section 13, decision 4): the AssurancePool never lends here and the payout
    /// pool holds no address to call it with. The slot stays so nothing below it moves.
    /// @custom:oz-renamed-from reserve
    address private retiredReserve;
    /// @notice what the pool owes each of them, and in total.
    uint256 public borrowedFromYield;
    /// @dev Retired with the pool's loans. A loan the old Base Sepolia pool made is not repaid to
    /// the new one: the old pool is retired with its books.
    /// @custom:oz-renamed-from borrowedFromReserve
    uint256 private retiredBorrowedFromReserve;
    /// @notice carry this pool has earned on positions it bought with borrowed money.
    /// @dev The lenders' return, held as credits until the member's repayment arrives -- and it
    /// arrives with it, because carry is added to what the member owes and paid in the same cash.
    /// Tracked rather than inferred, so it is neither handed out again as somebody else's carry
    /// nor mistaken for a position.
    uint256 public carryEarned;

    /* ========== APPEND BELOW THIS LINE ==========
     *
     * New storage goes HERE, under everything above it, and nowhere else. Slots are assigned in
     * declaration order, so a variable added among the ones already deployed shifts every variable
     * beneath it on a live proxy -- the queue reads as somebody else's number and nothing says so.
     * It compiles, and every test passes, because a fresh deployment lays them out consistently.
     * Only `upgrades.validateUpgrade` catches it, which it has done three times here.
     */

    /// @dev Sixteen slots from the gap: memberFunded, coopIncomeRecipient, capitalOf, funders,
    /// advancedOf, advancedTotal, carriers, inFlight, yieldPool, reserve, borrowedFromYield,
    /// borrowedFromReserve, carryEarned, refundOwedTo, refundees, refundsOwed.
    /// @notice the bond vault, which lends its deployable excess after the yield pool.
    address public bondVault;
    /// @notice what the pool owes the bond vault.
    uint256 public borrowedFromVault;

    /// @dev Two more slots from the gap: bondVault, borrowedFromVault.

    /* ---------- deadline ordering (compliance addendum 12.10): four slots from the gap ---------- */

    /// @dev payout window => claim ids queued under it, oldest first. Deadlines rise along it.
    mapping(uint32 => uint256[]) private windowQueue;
    /// @dev payout window => index in `windowQueue` of its first unpaid claim.
    mapping(uint32 => uint256) private windowHead;
    /// @dev Payout windows with at least one unpaid claim.
    uint32[] private queuedWindows;
    /// @dev How many claims existed when deadline ordering began, plus one; zero until then.
    /// Claims below it are the legacy queue, paid from `legacyNext` in the order they were
    /// promised. On a fresh deployment the first redemption sets it to one, so there is none.
    uint256 private legacyEnd;

    uint256[21] private __gap;

    /// @notice how many distinct payout windows may have claims queued at once.
    /// @dev A bound on the gas of picking the next claim, which reads one head per window. It is
    /// not a business figure: windows come from MerchantRegistry, and in practice there are two.
    uint256 public constant MAX_QUEUED_WINDOWS = 16;
    /// @dev Marks the legacy queue in `_head`.
    uint256 private constant LEGACY = type(uint256).max;


    error PayoutPoolInvalidAddress();
    error PayoutPoolNothingToRedeem(address merchant);
    error PayoutPoolMerchantInactive(address merchant);
    /// @dev Neither a registered, active merchant nor a named co-op address.
    error PayoutPoolNotEligible(address holder);
    /// @dev Drawing on anybody is for a claim past its terms, never for paying one early.
    error PayoutPoolClaimNotDue(uint256 claimId, uint64 dueBy);
    error PayoutPoolClaimAlreadyPaid(uint256 claimId);
    error PayoutPoolOutOfOrder(uint256 claimId, uint256 expected);
    error PayoutPoolInsufficientFunds(uint256 held, uint256 required);
    /// @dev Too many distinct payout windows queued at once (`MAX_QUEUED_WINDOWS`).
    error PayoutPoolTooManyWindows(uint32 window);

    event Redeemed(address indexed merchant, uint256 amount, bool paidNow, uint256 claimId);
    event ClaimPaid(uint256 indexed claimId, address indexed merchant, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event ShortfallReported(uint256 shortfall);
    event CoopIncomeWithdrawn(address indexed paidTo, uint256 amount);
    event CoopIncomeRecipientUpdated(address indexed recipient);
    event CapitalWithdrawn(address indexed funder, address indexed to, uint256 amount);
    event CarryPaid(address indexed to, uint256 amount);
    event RefundPaid(address indexed member, uint256 amount);
    event RefundQueued(address indexed member, uint256 amount);
    event YieldPoolUpdated(address indexed yieldPool);
    event DrewFromYieldPool(uint256 amount);
    event RepaidYieldPool(uint256 amount);
    event DrewFromBondVault(uint256 amount);
    event DrewFromTreasury(uint256 amount);
    event RepaidBondVault(uint256 amount);
    event BondVaultUpdated(address indexed bondVault);
    event InterestPaid(address indexed lender, uint256 amount);
    event PositionSettled(uint256 amount);
    event PositionAdvanced(address indexed funder, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address _stableCredit,
        address _reserveToken,
        address _merchantRegistry,
        address _coopTreasury
    ) external initializer {
        if (
            admin == address(0) || _stableCredit == address(0) || _reserveToken == address(0)
                || _merchantRegistry == address(0) || _coopTreasury == address(0)
        ) revert PayoutPoolInvalidAddress();
        coopTreasury = _coopTreasury;
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        stableCredit = IStableCredit(_stableCredit);
        reserveToken = IERC20Upgradeable(_reserveToken);
        merchantRegistry = MerchantRegistry(_merchantRegistry);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    function held() public view returns (uint256) {
        return reserveToken.balanceOf(address(this));
    }

    /// @dev What a claim may be paid from: everything here except refunds members are still owed.
    /// That money is theirs and settled ahead of any claim, so every path that pays one asks this
    /// rather than `held()`.
    ///
    /// Only the members' money that refunds can actually use is held back: a refund is paid out of
    /// members' money and nothing else (audit X-12), so reserving capital for one would only stop
    /// that capital paying a claim it is allowed to pay.
    function _payable() private view returns (uint256) {
        uint256 balance = held();
        uint256 reserved = _reservedForRefunds();
        return balance > reserved ? balance - reserved : 0;
    }

    /// @dev Members' money set aside for refunds still owed.
    function _reservedForRefunds() private view returns (uint256) {
        return refundsOwed < memberFunded ? refundsOwed : memberFunded;
    }

    /// @dev Members' money free to settle claims, after refunds owed have first call on it.
    function _memberFundedFree() private view returns (uint256) {
        return memberFunded - _reservedForRefunds();
    }

    /// @notice what the pool would need to clear every queued claim today.
    /// @dev Reported rather than judged, so the manual top-up is a number somebody reads instead
    /// of a call somebody makes. A contract cannot wire dollars and cannot decide to on-ramp; it
    /// can say exactly how short it is. Refunds owed come first, so they are part of it.
    function shortfall() public view returns (uint256) {
        uint256 spoken = queuedTotal + refundsOwed;
        uint256 balance = held();
        return spoken > balance ? spoken - balance : 0;
    }

    /// @notice what a merchant could redeem right now.
    /// @dev Their surplus, which is their positive balance. A merchant carrying credit of their
    /// own has already had it netted against what they hold, because the ledger keeps one signed
    /// number rather than two.
    function redeemableOf(address merchant) public view returns (uint256) {
        return stableCredit.balanceOf(merchant);
    }

    function claimCount() external view returns (uint256) {
        return claims.length;
    }

    function claimAt(uint256 claimId)
        external
        view
        returns (address merchant, uint256 amount, uint64 claimedAt, uint64 dueBy, bool paid)
    {
        Claim storage claim = claims[claimId];
        return (claim.merchant, claim.amount, claim.claimedAt, claim.dueBy, claim.paid);
    }

    function claimsOwnedBy(address merchant) external view returns (uint256[] memory) {
        return claimsOf[merchant];
    }

    /// @notice the claim paid next: the unpaid claim due soonest, the oldest on a tie.
    /// @return the claim id, or `claimCount()` when nothing is queued.
    function nextUnpaid() public view returns (uint256) {
        (uint256 claimId,) = _head();
        return claimId;
    }

    /// @notice whether the next claim (`nextUnpaid`) can be settled now.
    function canPayNext() external view returns (bool) {
        (uint256 claimId,) = _head();
        if (claimId >= claims.length) return false;
        return _payable() >= claims[claimId].amount;
    }

    /// @notice payout windows that have claims queued.
    function queuedWindowsList() external view returns (uint32[] memory) {
        return queuedWindows;
    }

    /// @notice the unpaid claims due within `horizon` seconds from now, and what paying them needs.
    /// @dev For the operator who funds the pool ahead of merchants' deadlines (addendum 12.10:
    /// Clear Lending Co. funds each financed charge no later than two business days before the
    /// merchant's payout deadline). Business days are the operator's to count; this takes a plain
    /// horizon in seconds. Claims due inside the horizon come before every other claim in payment
    /// order, so `short` is the cash that must arrive for all of them to be paid on time. Overdue
    /// claims are included. At most `maxClaims` are listed and `amount` covers those only; the list
    /// is grouped by window, not sorted.
    /// @return ids the claims.
    /// @return amount what they add up to.
    /// @return short what the pool lacks to pay them, after refunds owed to members.
    function dueWithin(uint256 horizon, uint256 maxClaims)
        external
        view
        returns (uint256[] memory ids, uint256 amount, uint256 short)
    {
        uint256 cutoff = horizon > type(uint64).max ? type(uint64).max : block.timestamp + horizon;
        ids = new uint256[](maxClaims);
        uint256 n;
        // The legacy queue is in claim-age order, not deadline order, so all of it is read.
        uint256 end = _legacyEnd();
        for (uint256 id = legacyNext; id < end && n < maxClaims; id++) {
            if (claims[id].dueBy <= cutoff) {
                ids[n++] = id;
                amount += claims[id].amount;
            }
        }
        for (uint256 w = 0; w < queuedWindows.length && n < maxClaims; w++) {
            uint32 window = queuedWindows[w];
            uint256[] storage queue = windowQueue[window];
            for (uint256 i = windowHead[window]; i < queue.length && n < maxClaims; i++) {
                Claim storage claim = claims[queue[i]];
                // Deadlines rise along a window's queue, so the first one past the cutoff ends it.
                if (claim.dueBy > cutoff) break;
                ids[n++] = queue[i];
                amount += claim.amount;
            }
        }
        assembly {
            mstore(ids, n)
        }
        uint256 usable = _payable();
        short = amount > usable ? amount - usable : 0;
    }

    /* ========== ORDER ========== */

    /// @dev Where the legacy queue ends: every claim, until deadline ordering has queued one.
    function _legacyEnd() private view returns (uint256) {
        return legacyEnd == 0 ? claims.length : legacyEnd - 1;
    }

    /// @dev The next claim to pay, and the queue it heads (`LEGACY`, or an index into
    /// `queuedWindows`). Each queue's head is its earliest deadline, so the earliest head is the
    /// earliest unpaid claim; a tie goes to the lower id, which is the older claim. The legacy
    /// queue keeps the claim-age order it was promised in and competes through its head.
    function _head() private view returns (uint256 claimId, uint256 queue) {
        claimId = claims.length;
        queue = LEGACY;
        uint64 best = type(uint64).max;
        if (legacyNext < _legacyEnd()) {
            claimId = legacyNext;
            best = claims[claimId].dueBy;
        }
        uint256 count = queuedWindows.length;
        for (uint256 i = 0; i < count; i++) {
            uint32 window = queuedWindows[i];
            uint256 id = windowQueue[window][windowHead[window]];
            uint64 due = claims[id].dueBy;
            if (due < best || (due == best && id < claimId)) {
                best = due;
                claimId = id;
                queue = i;
            }
        }
    }

    /// @dev Queues a new claim behind every earlier claim on the same window.
    function _enqueue(uint32 window, uint256 claimId) private {
        uint256[] storage queue = windowQueue[window];
        if (windowHead[window] == queue.length) {
            if (queuedWindows.length >= MAX_QUEUED_WINDOWS) revert PayoutPoolTooManyWindows(window);
            queuedWindows.push(window);
        }
        queue.push(claimId);
    }

    /// @dev Moves past a claim just paid at the head of `queue`.
    function _advance(uint256 claimId, uint256 queue) private {
        if (queue == LEGACY) {
            legacyNext = claimId + 1;
            return;
        }
        uint32 window = queuedWindows[queue];
        uint256 next = windowHead[window] + 1;
        windowHead[window] = next;
        if (next == windowQueue[window].length) {
            queuedWindows[queue] = queuedWindows[queuedWindows.length - 1];
            queuedWindows.pop();
        }
    }

    /* ========== REDEMPTION ========== */

    /// @notice converts a merchant's positive balance into money.
    /// @dev Moves the credits here either way. What the merchant is owed stops being a claim on the
    /// network the moment it becomes a claim on this pool; when the claim is paid, the position is
    /// burned or handed to whoever funded it (`_placePosition`), so it is never owed twice.
    /// @param amount how much to redeem, capped at what the merchant holds.
    /// @return paidNow whether it was settled immediately.
    /// @return claimId the queued claim, when it was not.
    function redeem(uint256 amount) external returns (bool paidNow, uint256 claimId) {
        address merchant = _msgSender();
        /*
         * Only a registered, active merchant, or a co-op address the admin has named, turns credit
         * into cash. Paying any positive holder is what let a credit line become USDC at par
         * through a wallet that was never a merchant (audit C-1, H-1, M-1). This is the eligibility
         * check (DECISIONS #3); the payment order below is addendum 12.10's.
         *
         * A funder named with FUNDER_ROLE counts as a named co-op address: it holds positions it
         * paid for (`_placePosition`) and redeeming them is how it gets its capital back.
         */
        if (merchantRegistry.isRegistered(merchant)) {
            if (!merchantRegistry.isActive(merchant)) revert PayoutPoolMerchantInactive(merchant);
        } else if (!hasRole(REDEEMER_ROLE, merchant) && !hasRole(FUNDER_ROLE, merchant)) {
            revert PayoutPoolNotEligible(merchant);
        }

        uint256 available = redeemableOf(merchant);
        uint256 redeeming = amount < available ? amount : available;
        if (redeeming == 0) revert PayoutPoolNothingToRedeem(merchant);

        // The position changes hands here rather than at payout, so a queued merchant is owed by
        // this pool and no longer by the network. The merchant approves this contract for the
        // credits, the same way any transfer on their behalf works.
        // The pool holds the position until the claim is paid, because until then nobody knows
        // whose money will pay it -- the member's, and it is settled, or somebody's capital, and
        // they own it. Deciding at redemption is what forced the old guess.
        stableCredit.transferFrom(merchant, address(this), redeeming);
        inFlight += redeeming;
        // A funder redeeming is taking back what they advanced, so they stop carrying it.
        uint256 carrying = advancedOf[merchant];
        if (carrying > 0) {
            uint256 returned = carrying < redeeming ? carrying : redeeming;
            advancedOf[merchant] = carrying - returned;
            advancedTotal -= returned;
        }

        uint32 window = merchantRegistry.payoutWindowOf(merchant);
        // The first claim under deadline ordering marks where the legacy queue ends.
        if (legacyEnd == 0) legacyEnd = claims.length + 1;
        claimId = claims.length;
        claims.push(
            Claim({
                merchant: merchant,
                amount: redeeming,
                claimedAt: uint64(block.timestamp),
                dueBy: uint64(block.timestamp) + window,
                paid: false
            })
        );
        claimsOf[merchant].push(claimId);
        queuedTotal += redeeming;
        _enqueue(window, claimId);

        // Funded beats queued: if the money is here, the wait is zero rather than the window. But
        // only when no unpaid claim is due sooner (or as soon, and older): the money is theirs first.
        (uint256 head, uint256 queue) = _head();
        if (head == claimId && _payable() >= redeeming) {
            _pay(claimId, queue);
            paidNow = true;
        } else {
            emit ShortfallReported(shortfall());
        }
        emit Redeemed(merchant, redeeming, paidNow, claimId);
    }

    /// @notice names the yield pool the pool draws on first when a claim has come due.
    /// @dev Admin, not operator, like every setting below that decides where money goes: an
    /// operator hot key that could repoint the treasury, the income recipient or a lender could
    /// send positions and income to itself (audit H-4). Zero switches it off. Replaces
    /// `setLenders(yieldPool, reserve)`: there is no reserve lender any more (section 13).
    function setYieldPool(address yieldPool_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        yieldPool = yieldPool_;
        emit YieldPoolUpdated(yieldPool_);
    }

    /// @notice what the pool owes its lenders.
    function borrowed() public view returns (uint256) {
        return borrowedFromYield + borrowedFromVault;
    }

    /// @notice names the bond vault the pool may borrow from.
    function setBondVault(address vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bondVault = vault;
        emit BondVaultUpdated(vault);
    }

    /// @notice what the treasury can put up for a claim right now: its allowance to this pool,
    /// capped at what it holds.
    function treasuryAvailable() public view returns (uint256) {
        uint256 allowed = reserveToken.allowance(coopTreasury, address(this));
        uint256 balance = reserveToken.balanceOf(coopTreasury);
        return allowed < balance ? allowed : balance;
    }

    /// @notice finds the money for a claim whose turn has come and whose terms have run out.
    /// @dev Nothing decides to pay anybody early: this is only ever for the next claim
    /// (`nextUnpaid`), once it is past its deadline with nothing here to pay it. The yield pool
    /// first, because lending is what its depositors are here for and they are paid for it; then
    /// the bond vault's deployable excess, which earns carry toward what bondholders are owed and
    /// never touches their redemption reserve; then the treasury, up to the allowance the Safe has
    /// given this pool, as capital that holds the position it pays for.
    ///
    /// Never the AssurancePool (addendum 12.11): no payout path touches it. A claim those three cannot cover waits for funding; `dueWithin` says how much.
    ///
    /// Permissionless. A merchant owed money and past their terms should not also be waiting on
    /// somebody remembering to run this.
    function drawForDueClaim() external returns (uint256 drawn) {
        (uint256 claimId,) = _head();
        if (claimId >= claims.length) revert PayoutPoolNothingToRedeem(address(0));
        Claim storage claim = claims[claimId];
        if (claim.paid) revert PayoutPoolClaimAlreadyPaid(claimId);
        if (block.timestamp < claim.dueBy) revert PayoutPoolClaimNotDue(claimId, claim.dueBy);

        uint256 usable = _payable();
        if (usable >= claim.amount) return 0;
        uint256 short = claim.amount - usable;

        if (yieldPool != address(0)) {
            uint256 cash = ILendingPool(yieldPool).availableCash();
            // The yield pool caps what each borrower may take in a day (audit H-4); asking for
            // more would revert the whole draw.
            uint256 allowed = ILendingPool(yieldPool).borrowableToday(address(this));
            if (allowed < cash) cash = allowed;
            uint256 take = cash < short ? cash : short;
            if (take > 0) {
                ILendingPool(yieldPool).borrow(take, address(this));
                borrowedFromYield += take;
                drawn += take;
                short -= take;
                emit DrewFromYieldPool(take);
            }
        }
        if (short > 0 && bondVault != address(0)) {
            uint256 lent = IPayoutLender(bondVault).lendToPayoutPool(short);
            if (lent > 0) {
                borrowedFromVault += lent;
                drawn += lent;
                short -= lent;
                emit DrewFromBondVault(lent);
            }
        }
        if (short > 0) {
            // The co-op's own money, so it is capital rather than a loan: the treasury holds the
            // position this pays for and earns its carry, as it does when the Safe funds by hand.
            uint256 take = treasuryAvailable();
            if (take > short) take = short;
            if (take > 0) {
                reserveToken.safeTransferFrom(coopTreasury, address(this), take);
                if (capitalOf[coopTreasury] == 0) funders.push(coopTreasury);
                capitalOf[coopTreasury] += take;
                drawn += take;
                short -= take;
                emit DrewFromTreasury(take);
                emit Funded(coopTreasury, take);
            }
        }
        /*
         * All or nothing (audit X-20). Borrowing part of a claim left the cash idle, counted as
         * though it were funding, while the next repayment went to the lender before the claim;
         * the position was then handed to whoever happened to be last. If every source together
         * cannot pay this claim, none of them lends: the revert unwinds every draw above.
         */
        if (drawn == 0 || _payable() < claim.amount) {
            revert PayoutPoolInsufficientFunds(_payable(), claim.amount);
        }
        // Funded beats queued, and it is their turn: pay it rather than making them come back.
        // The head is read again after the external calls above rather than trusted.
        (uint256 head, uint256 queue) = _head();
        if (head != claimId) revert PayoutPoolOutOfOrder(head, claimId);
        _pay(claimId, queue);
    }

    /// @dev Members' money goes back to whoever fronted it before it does anything else. They put
    /// cash up for a claim this member's debt stood behind, and this is that debt being paid --
    /// principal first, and then what they earned for the time it was out.
    ///
    /// The return needs no converting. Carry is added to what a member owes, so the repayment that
    /// settles the principal carries the interest in the same cash; all this does is hand it on and
    /// burn the claim it stood for.
    function _repayLenders(uint256 available) private returns (uint256 left) {
        // Shares as they stood before this repayment: a lender repaid in full by it still bore its
        // part of the float the carry was charged for.
        uint256 owed = borrowed();
        uint256 fromVault = borrowedFromVault;
        left = _repayPrincipal(available);
        if (left == 0 || carryEarned == 0) return left;

        uint256 interest = carryEarned < left ? carryEarned : left;
        // Split between them as the principal was, so each is paid for what it actually bore. The
        // division's remainder goes to the yield pool, as all of it does when nothing was owed, so a
        // lender that put up nothing is never handed dust.
        uint256 toVault = owed == 0 ? 0 : (interest * fromVault) / owed;
        uint256 toYield = interest - toVault;

        // Only what actually reaches a lender counts as paid. A lender unnamed since it lent keeps
        // its return owed here, with its principal, until it is named again.
        uint256 handed;
        if (toYield > 0 && yieldPool != address(0)) {
            // Sent, not `repay`d. The yield pool's `repay` takes everything as principal while
            // anybody owes it -- the card settler too -- so a return paid that way would come off
            // someone else's loan instead of reaching the depositors. Cash arriving against
            // unchanged loans is what raises the share price.
            reserveToken.safeTransfer(yieldPool, toYield);
            handed += toYield;
            emit InterestPaid(yieldPool, toYield);
        }
        if (toVault > 0 && bondVault != address(0)) {
            reserveToken.approve(bondVault, toVault);
            IPayoutLender(bondVault).repayFromPayoutPool(toVault);
            handed += toVault;
            emit InterestPaid(bondVault, toVault);
        }
        if (handed > 0) {
            carryEarned -= handed;
            left -= handed;
            // The claim it stood for goes with it: the member has paid that carry.
            stableCredit.settleClaim(address(this), handed);
        }
    }

    /// @dev What they put up, before what they earned on it.
    function _repayPrincipal(uint256 available) private returns (uint256 left) {
        left = available;
        if (borrowedFromYield > 0 && yieldPool != address(0)) {
            uint256 pay = borrowedFromYield < left ? borrowedFromYield : left;
            if (pay > 0) {
                borrowedFromYield -= pay;
                left -= pay;
                reserveToken.approve(yieldPool, pay);
                ILendingPool(yieldPool).repay(pay);
                emit RepaidYieldPool(pay);
            }
        }
        if (borrowedFromVault > 0 && bondVault != address(0) && left > 0) {
            uint256 pay = borrowedFromVault < left ? borrowedFromVault : left;
            if (pay > 0) {
                borrowedFromVault -= pay;
                left -= pay;
                reserveToken.approve(bondVault, pay);
                IPayoutLender(bondVault).repayFromPayoutPool(pay);
                emit RepaidBondVault(pay);
            }
        }
    }

    /// @notice pays the next claim: the unpaid claim due soonest, the oldest on a tie.
    /// @dev Permissionless, and strictly in order. Anybody may push the queue along; nobody may
    /// choose whose claim moves, which is the same thing as saying there is no priority to set.
    /// A claim the pool cannot cover stops the queue: a smaller claim due later does not jump it.
    function payNext() public returns (uint256 claimId) {
        uint256 queue;
        (claimId, queue) = _head();
        if (claimId >= claims.length) revert PayoutPoolNothingToRedeem(address(0));
        Claim storage claim = claims[claimId];
        if (claim.paid) revert PayoutPoolClaimAlreadyPaid(claimId);

        uint256 balance = _payable();
        if (balance < claim.amount) revert PayoutPoolInsufficientFunds(balance, claim.amount);
        _pay(claimId, queue);
    }

    /// @notice pays as many queued claims as the pool can cover, in `payNext` order.
    function payQueue(uint256 maxClaims) external returns (uint256 paidCount) {
        for (uint256 i = 0; i < maxClaims; i++) {
            (uint256 claimId, uint256 queue) = _head();
            if (claimId >= claims.length) break;
            if (_payable() < claims[claimId].amount) break;
            _pay(claimId, queue);
            paidCount++;
        }
    }

    function _pay(uint256 claimId, uint256 queue) private {
        Claim storage claim = claims[claimId];
        claim.paid = true;
        queuedTotal -= claim.amount;
        _advance(claimId, queue);
        reserveToken.safeTransfer(claim.merchant, claim.amount);
        _placePosition(claim.amount);
        emit ClaimPaid(claimId, claim.merchant, claim.amount);
    }

    /// @notice the position follows the cash that paid for it.
    /// @dev Settled where a member's repayment paid it: their obligation went when they paid, so
    /// the credits are burned and supply comes back into step with what is owed. Sold where
    /// capital paid it: the member still owes, and the funder holds the claim until they do.
    function _placePosition(uint256 amount) private {
        // Bounded by what came in with a redemption, never by the balance: carry sits here too,
        // and settling that as if it were a position would burn somebody's earnings.
        if (inFlight < amount) amount = inFlight;
        inFlight -= amount;
        // Members' money owed back to members on refunds is not this claim's to use.
        uint256 freeMembers = _memberFundedFree();
        uint256 settled = amount < freeMembers ? amount : freeMembers;
        if (settled > 0) {
            memberFunded -= settled;
            stableCredit.settleClaim(address(this), settled);
            emit PositionSettled(settled);
        }
        uint256 advanced = amount - settled;
        if (advanced == 0) return;

        // Each funder gets the position their own cash paid for, oldest capital first. Nobody has
        // to reconstruct afterwards whose money went where, and a funder's return is exactly what
        // it funded.
        for (uint256 i = 0; i < funders.length && advanced > 0; i++) {
            address funder = funders[i];
            uint256 capital = capitalOf[funder];
            if (capital == 0) continue;
            uint256 take = capital < advanced ? capital : advanced;
            capitalOf[funder] = capital - take;
            advanced -= take;
            if (advancedOf[funder] == 0) carriers.push(funder);
            advancedOf[funder] += take;
            advancedTotal += take;
            stableCredit.transfer(funder, take);
            emit PositionAdvanced(funder, take);
        }
        _forgetSpentFunders();

        /*
         * Bought with borrowed money, so the pool keeps it.
         *
         * A lender is repaid in cash rather than handed the position, which means somebody has to
         * hold it in the meantime -- and it must not be the co-op, which would collect the carry on
         * a float the yield pool or the bond vault was bearing. The pool holds it, and the carry it
         * earns on it is the lenders' return to pass on.
         */
        uint256 owed = borrowed();
        uint256 mine = advancedOf[address(this)];
        uint256 unbacked = owed > mine ? owed - mine : 0;
        if (advanced > 0 && unbacked > 0) {
            uint256 keep = advanced < unbacked ? advanced : unbacked;
            if (mine == 0) carriers.push(address(this));
            advancedOf[address(this)] += keep;
            advancedTotal += keep;
            advanced -= keep;
            emit PositionAdvanced(address(this), keep);
        }

        // Cash from before any of this was tracked, or a top-up the ledger never saw. The co-op
        // holds it rather than the position vanishing.
        if (advanced > 0) {
            stableCredit.transfer(coopTreasury, advanced);
            emit PositionAdvanced(coopTreasury, advanced);
        }
    }

    /// @notice carry sitting here waiting to be split.
    /// @dev Everything the pool holds that is not a position in transit. Carry reaches the pool
    /// because the issuers name it as their recipient; it is credits, like any other claim, and it
    /// belongs to whoever bore the float it was charged for.
    function distributableCarry() public view returns (uint256) {
        uint256 balance = stableCredit.balanceOf(address(this));
        // Positions in transit are not carry, and neither are the ones this pool is holding
        // because it bought them with borrowed money.
        uint256 notCarry = inFlight + advancedOf[address(this)] + carryEarned;
        return balance > notCarry ? balance - notCarry : 0;
    }

    /// @notice hands carry to whoever bore the float it was charged for.
    /// @dev Each funder's share is what they are carrying measured against EVERY claim outstanding,
    /// not against what funders carry between them. A funder bearing 600 of a 1,000 float earns
    /// three fifths of the carry; dividing by the funders alone would hand them all of it for
    /// bearing part of it, which is not what "split by who funded the payout" means.
    ///
    /// What is left goes to the co-op: the float nobody else funded, plus the truncation on each
    /// share. That is the right answer at both ends -- with nobody funding anything the co-op takes
    /// all of it, exactly as it did before any of this existed, and with the yield pool bearing
    /// half the float its depositors earn half.
    ///
    /// Permissionless, because it moves nobody's money anywhere but where it is owed, and a split
    /// that needed an operator would quietly stop happening.
    ///
    /// In proportion to positions held now rather than to how long each was held. A distribution
    /// run often enough is the same thing, and integrating over time on chain is not worth what it
    /// would cost -- the sweep calls this on its pass.
    function distributeCarry() external returns (uint256 distributed) {
        distributed = distributableCarry();
        if (distributed == 0) return 0;

        // Every claim outstanding, less the carry being handed out and the positions in transit:
        // what is being measured is the float the carry was charged for, not this pool's holdings.
        uint256 float_ = stableCredit.totalSupply();
        float_ = float_ > distributed ? float_ - distributed : 0;
        float_ = float_ > inFlight ? float_ - inFlight : 0;

        uint256 left = distributed;
        if (float_ > 0) {
            for (uint256 i = 0; i < carriers.length; i++) {
                address carrier = carriers[i];
                uint256 carrying = advancedOf[carrier];
                if (carrying == 0) continue;
                // A carrier can only be carrying what it still holds. A position settled or moved
                // somewhere this pool did not see stops earning carry here (audit X-8).
                if (carrier != address(this)) {
                    uint256 holds = stableCredit.balanceOf(carrier);
                    if (carrying > holds) {
                        advancedTotal -= carrying - holds;
                        advancedOf[carrier] = holds;
                        carrying = holds;
                        if (carrying == 0) continue;
                    }
                }
                uint256 share = (distributed * carrying) / float_;
                // Never more than is left: a stale share must not underflow the split (audit X-8).
                if (share > left) share = left;
                if (share == 0) continue;
                left -= share;
                if (carrier == address(this)) {
                    // Earned on what borrowed money bought, so it belongs to whoever lent it.
                    carryEarned += share;
                } else {
                    stableCredit.transfer(carrier, share);
                }
                emit CarryPaid(carrier, share);
            }
            _forgetSettledCarriers();
        }
        // The rest: the float the co-op bore itself, and the truncation on every share above.
        if (left > 0) {
            stableCredit.transfer(coopTreasury, left);
            emit CarryPaid(coopTreasury, left);
        }
    }

    /// @dev Keeps the carrier list to funders still carrying something.
    function _forgetSettledCarriers() private {
        uint256 i = 0;
        while (i < carriers.length) {
            if (advancedOf[carriers[i]] == 0) {
                carriers[i] = carriers[carriers.length - 1];
                carriers.pop();
            } else {
                i++;
            }
        }
    }

    /// @dev Keeps the list to funders who still have something in it, so the loop above stays short.
    function _forgetSpentFunders() private {
        uint256 i = 0;
        while (i < funders.length) {
            if (capitalOf[funders[i]] == 0) {
                funders[i] = funders[funders.length - 1];
                funders.pop();
            } else {
                i++;
            }
        }
    }

    /* ========== FUNDING ========== */

    /// @notice moves value in from somewhere already on chain.
    /// @dev Savings forfeiture, incoming deposits, Move-to-Earn proceeds and merchant drawdown
    /// netting can all arrive without anyone deciding to send them. Anything crossing the fiat
    /// boundary cannot: a contract cannot wire dollars and cannot decide to on-ramp, so that stays
    /// a multisig action and this only reports how much of one is needed.
    function fund(uint256 amount) external onlyRole(FUNDER_ROLE) {
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        if (capitalOf[_msgSender()] == 0) funders.push(_msgSender());
        capitalOf[_msgSender()] += amount;
        emit Funded(_msgSender(), amount);
    }

    /// @notice funders with capital here that has not been spent.
    function fundersWithCapital() external view returns (address[] memory) {
        return funders;
    }

    /// @notice where the co-op's income is paid, which need not be where it accrues.
    function setCoopIncomeRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert PayoutPoolInvalidAddress();
        coopIncomeRecipient = recipient;
        emit CoopIncomeRecipientUpdated(recipient);
    }

    /// @notice what a funder could take back right now.
    /// @dev Their own unspent capital, and never more cash than is actually free: a queued claim's
    /// money is somebody else's, and members' repayments were never the funder's at all.
    function idleCapitalOf(address funder) public view returns (uint256) {
        uint256 balance = held();
        // Queued claims may be paid from capital, so they hold it back. Refunds owed do not: only
        // members' money may pay those (audit X-12), and that is excluded below already.
        uint256 free = balance > queuedTotal ? balance - queuedTotal : 0;
        uint256 notMembers = balance > memberFunded ? balance - memberFunded : 0;
        if (notMembers < free) free = notMembers;
        uint256 own = capitalOf[funder];
        return own < free ? own : free;
    }

    /// @notice takes a funder's own idle capital back out.
    /// @dev Only what they never spent. Capital that has already paid a claim is not here to be
    /// withdrawn -- it bought the position, and the funder recovers it by redeeming that position
    /// as the member repays, which for a plan split over cycles is exactly as those arrive.
    function withdrawCapital(uint256 amount, address to) external returns (uint256 taken) {
        if (to == address(0)) revert PayoutPoolInvalidAddress();
        uint256 idle = idleCapitalOf(_msgSender());
        taken = amount < idle ? amount : idle;
        if (taken == 0) revert PayoutPoolNothingToRedeem(_msgSender());
        capitalOf[_msgSender()] -= taken;
        _forgetSpentFunders();
        reserveToken.safeTransfer(to, taken);
        emit CapitalWithdrawn(_msgSender(), to, taken);
    }

    /// @notice gives a member back money they paid in, for a purchase that was given back.
    /// @dev A withdrawal, not a claim. What a member paid is sitting here because the routing put
    /// it here; handing it back takes nothing from the merchants in the queue, because the merchant
    /// whose sale it was gives it back on the ledger at the same moment (StableCredit.repayRefund).
    /// So it does not queue and has no priority field: it is their own money going home.
    ///
    /// Only the ledger may call it, and the ledger only does so as one leg of a refund that nets.
    ///
    /// Paid from what is here. A pool short of it pays what it can and the rest is owed: the
    /// merchant's balance has already fallen by the whole amount, so the money reaches the member
    /// as repayments arrive rather than being lost. `refundsOwed` is what has not reached them yet,
    /// and it is settled before any claim, because money already belonging to a member is not the
    /// pool's to pay somebody else with.
    function payRefund(address member, uint256 amount) external returns (uint256 paid) {
        if (_msgSender() != address(stableCredit)) revert PayoutPoolInvalidAddress();
        if (member == address(0)) revert PayoutPoolInvalidAddress();

        // Members' own money only. Funder capital paying a refund was a loss the funder never saw:
        // `capitalOf` stayed put while the cash behind it left (audit X-12). What member money
        // cannot cover yet is owed, and paid as repayments arrive.
        uint256 available = _refundable();
        paid = amount < available ? amount : available;
        uint256 short = amount - paid;
        if (short > 0) {
            if (refundOwedTo[member] == 0) refundees.push(member);
            refundOwedTo[member] += short;
            refundsOwed += short;
            emit RefundQueued(member, short);
        }
        if (paid > 0) {
            memberFunded -= paid;
            reserveToken.safeTransfer(member, paid);
            emit RefundPaid(member, paid);
        }
    }

    /// @dev Cash a refund may be paid from: members' money that is actually here.
    function _refundable() private view returns (uint256) {
        uint256 balance = held();
        return memberFunded < balance ? memberFunded : balance;
    }

    /// @notice pays what is still owed to members whose refunds outran the cash.
    /// @dev Before claims, and permissionless for the same reason `distributeCarry` is: a member
    /// waiting on their own money should not also be waiting on somebody remembering to run this.
    function payRefundsOwed() external returns (uint256 paid) {
        return payRefundsOwedUpTo(DEFAULT_REFUND_PAGE);
    }

    /// @notice how many members `payRefundsOwed` looks at in one call.
    uint256 public constant DEFAULT_REFUND_PAGE = 100;

    /// @notice `payRefundsOwed`, looking at no more than `maxRefundees` members (audit L-7).
    /// @dev One pass: a member paid in full is dropped from the list there and then, so the list
    /// never has to be walked a second time to tidy it.
    function payRefundsOwedUpTo(uint256 maxRefundees) public returns (uint256 paid) {
        uint256 looked;
        uint256 i = 0;
        while (i < refundees.length && looked < maxRefundees && _refundable() > 0) {
            looked++;
            address member = refundees[i];
            uint256 owed = refundOwedTo[member];
            // Members' money only, as in `payRefund` (audit X-12).
            uint256 available = _refundable();
            uint256 take = owed < available ? owed : available;
            if (take > 0) {
                refundOwedTo[member] = owed - take;
                refundsOwed -= take;
                paid += take;
                memberFunded -= take;
                reserveToken.safeTransfer(member, take);
                emit RefundPaid(member, take);
            }
            if (refundOwedTo[member] == 0) {
                refundees[i] = refundees[refundees.length - 1];
                refundees.pop();
            } else {
                i++;
            }
        }
    }

    /// @notice what members are still owed on refunds the pool could not cover.
    function refundOwedOf(address member) external view returns (uint256) {
        return refundOwedTo[member];
    }

    /// @notice cash the pool holds that no queued claim is waiting on.
    /// @dev What the co-op may take its fee from. A claim already in the queue is somebody's money
    /// and is never part of this, whatever the co-op is owed.
    function unencumbered() public view returns (uint256) {
        uint256 spoken = queuedTotal + refundsOwed;
        uint256 balance = held();
        return balance > spoken ? balance - spoken : 0;
    }

    /// @notice pays the co-op what it is owed, without queueing for it.
    /// @dev The 2.5% was never the merchant's money: on a $100 purchase the merchant is owed
    /// $97.50 and the co-op $2.50, and a $100 repayment covers both. So the fee is not a claim and
    /// takes no place in the queue -- but it comes only out of cash no queued claim is waiting on,
    /// because the co-op is the one party here that must not be able to pay itself first.
    ///
    /// The credits are burned: the co-op's fee is paid out of members' own repayments, so the
    /// position is settled rather than sold to anybody.
    function withdrawCoopIncome(uint256 amount) external onlyRole(OPERATOR_ROLE) returns (uint256 paid) {
        // Income only. Positions the treasury bought with capital sit in the same balance, and
        // burning them as income left `advancedOf` standing for a claim that no longer existed --
        // the carry split then underflowed or overpaid the co-op (audit X-8). The treasury
        // recovers those by redeeming them.
        uint256 balance = stableCredit.balanceOf(coopTreasury);
        uint256 positions = advancedOf[coopTreasury];
        uint256 owed = balance > positions ? balance - positions : 0;
        paid = amount < owed ? amount : owed;
        uint256 available = unencumbered();
        if (paid > available) paid = available;
        // Only out of members' own money that no refund is waiting on: capital advanced to pay
        // merchants early is not the fee.
        uint256 freeMembers = _memberFundedFree();
        if (paid > freeMembers) paid = freeMembers;
        if (paid == 0) revert PayoutPoolNothingToRedeem(coopTreasury);

        // The claim comes off the holder's balance; the money goes where the co-op wants it. A
        // multisig holding the position does not have to be the account that receives the cash.
        address recipient = coopIncomeRecipient == address(0) ? coopTreasury : coopIncomeRecipient;
        memberFunded -= paid;
        stableCredit.settleClaim(coopTreasury, paid);
        reserveToken.safeTransfer(recipient, paid);
        emit CoopIncomeWithdrawn(recipient, paid);
    }

    /// @notice moves the co-op's side of the position.
    function setCoopTreasury(address treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury == address(0)) revert PayoutPoolInvalidAddress();
        coopTreasury = treasury;
    }

    /// @notice takes value in from anybody willing to send it.
    /// @dev The multisig top-up path, and deliberately open: refusing money because the sender
    /// lacks a role would be a strange way to run a pool that reports being short.
    /// @notice a member paid down their balance, and this is that money.
    /// @dev Only the ledger may call it, because what arrives here decides whether a claim is
    /// settled or sold. It was once `donate`, open to anybody, which is the wrong name for the only
    /// thing it now means: cash from anyone else would burn claims whose obligations nobody had
    /// paid, leaving members owing with nothing holding the debt. Putting working capital in is
    /// `fund`, which buys positions rather than settling them.
    function receiveRepayment(uint256 amount) external {
        _receiveRepayment(amount);
    }

    function _receiveRepayment(uint256 amount) private {
        if (_msgSender() != address(stableCredit)) revert PayoutPoolInvalidAddress();
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        /*
         * Whoever fronted the cash gets it back first. They put money up for a claim that this
         * member's debt stood behind, and this is that debt being paid -- leaving it here to settle
         * claims instead would keep the pool borrowing against money it already had.
         */
        uint256 owedBefore = borrowed();
        uint256 left = _repayLenders(amount);
        /*
         * What the lenders took back was paid for by a position this pool is holding, and the
         * member has just settled the debt behind it -- so that much of it is burned. Leaving it
         * standing would have the pool holding a claim on somebody who owes nothing, which is the
         * thing this whole settlement model exists to avoid.
         *
         * The PRINCIPAL they took back, not what they were handed in total: the interest settled
         * its own claim on the way out, and burning against it again would take a claim nobody
         * still holds.
         */
        uint256 repaid = owedBefore - borrowed();
        uint256 mine = advancedOf[address(this)];
        if (repaid > 0 && mine > 0) {
            uint256 settling = repaid < mine ? repaid : mine;
            advancedOf[address(this)] = mine - settling;
            advancedTotal -= settling;
            stableCredit.settleClaim(address(this), settling);
            emit PositionSettled(settling);
        }
        // What is left is members' own money, which settles positions rather than buying them.
        memberFunded += left;
        emit Funded(_msgSender(), amount);
    }
}
