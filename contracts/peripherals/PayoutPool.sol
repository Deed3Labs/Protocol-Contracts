// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../core/interfaces/stable-credit/IStableCredit.sol";
import "./MerchantRegistry.sol";

/// @title PayoutPool
/// @notice Turns a merchant's positive balance into money, on a schedule they were promised.
/// @dev A merchant's positive StableCredit is the payables ledger: what the co-op owes them,
/// on-chain, with no parallel record to reconcile against. This is where it becomes cash.
///
/// **Never the AssurancePool.** Redemption there is capped by lost debt outstanding, so paying
/// merchants from it would mean a merchant can only be paid when a member has defaulted, at a
/// rate set by how badly the book is performing. A merchant's balance is a payable -- certain,
/// owed, due on a schedule. The AssurancePool covers a contingency that may never happen. Funding
/// the first from the second is the error, and there is no code path from here to there.
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
/// **Order is claim age, always.** There is no priority field here or in the registry, because a
/// better place in a shared queue is a promise kept at another merchant's expense.
contract PayoutPool is AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice May move value in from somewhere already on chain.
    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

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

    /// @notice cash here that came from members clearing their balances.
    /// @dev The position follows the cash, and this is what tells them apart.
    ///
    /// A claim paid with a member's own repayment is SETTLED, to the extent they have paid: the
    /// obligation went as they paid it, so those credits are burned and supply comes back into step
    /// with what is owed. A member clearing the lot after one cycle and a member three instalments
    /// into a twelve settle their share of it alike -- the rest stays a claim until they pay it.
    /// Moving them instead left the co-op holding a claim on nobody, which is what accumulated
    /// and what made "already paid for" impossible to tell from "still owed".
    ///
    /// A claim paid before the member has repaid is ADVANCED: somebody's capital went out and the
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

    Claim[] private claims;
    /// @dev merchant => claim ids
    mapping(address => uint256[]) private claimsOf;
    /// @dev The next claim in age order that has not been paid.
    uint256 public nextUnpaid;
    /// @notice Total still owed on queued claims.
    uint256 public queuedTotal;

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

    /// @dev Eight slots from the gap: memberFunded, coopIncomeRecipient, capitalOf, funders,
    /// advancedOf, advancedTotal, carriers, inFlight.
    uint256[35] private __gap;


    error PayoutPoolInvalidAddress();
    error PayoutPoolNothingToRedeem(address merchant);
    error PayoutPoolMerchantInactive(address merchant);
    error PayoutPoolClaimAlreadyPaid(uint256 claimId);
    error PayoutPoolOutOfOrder(uint256 claimId, uint256 expected);
    error PayoutPoolInsufficientFunds(uint256 held, uint256 required);

    event Redeemed(address indexed merchant, uint256 amount, bool paidNow, uint256 claimId);
    event ClaimPaid(uint256 indexed claimId, address indexed merchant, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event ShortfallReported(uint256 shortfall);
    event CoopIncomeWithdrawn(address indexed paidTo, uint256 amount);
    event CoopIncomeRecipientUpdated(address indexed recipient);
    event CapitalWithdrawn(address indexed funder, address indexed to, uint256 amount);
    event CarryPaid(address indexed to, uint256 amount);
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

    /// @notice what the pool would need to clear every queued claim today.
    /// @dev Reported rather than judged, so the manual top-up is a number somebody reads instead
    /// of a call somebody makes. A contract cannot wire dollars and cannot decide to on-ramp; it
    /// can say exactly how short it is.
    function shortfall() public view returns (uint256) {
        uint256 balance = held();
        return queuedTotal > balance ? queuedTotal - balance : 0;
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

    /// @notice whether the oldest unpaid claim can be settled now.
    function canPayNext() external view returns (bool) {
        if (nextUnpaid >= claims.length) return false;
        return held() >= claims[nextUnpaid].amount;
    }

    /* ========== REDEMPTION ========== */

    /// @notice converts a merchant's positive balance into money.
    /// @dev Burns the credits either way. What the merchant is owed stops being a claim on the
    /// network the moment it becomes a claim on this pool, so the supply goes and the obligation
    /// is recorded here -- rather than being owed twice, once on each ledger.
    /// @param amount how much to redeem, capped at what the merchant holds.
    /// @return paidNow whether it was settled immediately.
    /// @return claimId the queued claim, when it was not.
    function redeem(uint256 amount) external returns (bool paidNow, uint256 claimId) {
        address merchant = _msgSender();
        if (merchantRegistry.isRegistered(merchant) && !merchantRegistry.isActive(merchant)) {
            revert PayoutPoolMerchantInactive(merchant);
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

        // Funded beats queued: if the money is here, the wait is zero rather than the window.
        if (claimId == nextUnpaid && held() >= redeeming) {
            _pay(claimId);
            paidNow = true;
        } else {
            emit ShortfallReported(shortfall());
        }
        emit Redeemed(merchant, redeeming, paidNow, claimId);
    }

    /// @notice pays the oldest unpaid claim.
    /// @dev Permissionless, and strictly in order. Anybody may push the queue along; nobody may
    /// choose whose claim moves, which is the same thing as saying there is no priority to set.
    function payNext() public returns (uint256 claimId) {
        claimId = nextUnpaid;
        if (claimId >= claims.length) revert PayoutPoolNothingToRedeem(address(0));
        Claim storage claim = claims[claimId];
        if (claim.paid) revert PayoutPoolClaimAlreadyPaid(claimId);

        uint256 balance = held();
        if (balance < claim.amount) revert PayoutPoolInsufficientFunds(balance, claim.amount);
        _pay(claimId);
    }

    /// @notice pays as many queued claims as the pool can cover, oldest first.
    function payQueue(uint256 maxClaims) external returns (uint256 paidCount) {
        for (uint256 i = 0; i < maxClaims; i++) {
            if (nextUnpaid >= claims.length) break;
            if (held() < claims[nextUnpaid].amount) break;
            payNext();
            paidCount++;
        }
    }

    function _pay(uint256 claimId) private {
        Claim storage claim = claims[claimId];
        claim.paid = true;
        queuedTotal -= claim.amount;
        nextUnpaid = claimId + 1;
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
        uint256 settled = amount < memberFunded ? amount : memberFunded;
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
        return balance > inFlight ? balance - inFlight : 0;
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
                uint256 share = (distributed * carrying) / float_;
                if (share == 0) continue;
                left -= share;
                stableCredit.transfer(carrier, share);
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
    function setCoopIncomeRecipient(address recipient) external onlyRole(OPERATOR_ROLE) {
        if (recipient == address(0)) revert PayoutPoolInvalidAddress();
        coopIncomeRecipient = recipient;
        emit CoopIncomeRecipientUpdated(recipient);
    }

    /// @notice what a funder could take back right now.
    /// @dev Their own unspent capital, and never more cash than is actually free: a queued claim's
    /// money is somebody else's, and members' repayments were never the funder's at all.
    function idleCapitalOf(address funder) public view returns (uint256) {
        uint256 free = unencumbered();
        uint256 notMembers = held() > memberFunded ? held() - memberFunded : 0;
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

    /// @notice cash the pool holds that no queued claim is waiting on.
    /// @dev What the co-op may take its fee from. A claim already in the queue is somebody's money
    /// and is never part of this, whatever the co-op is owed.
    function unencumbered() public view returns (uint256) {
        uint256 balance = held();
        return balance > queuedTotal ? balance - queuedTotal : 0;
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
        uint256 owed = stableCredit.balanceOf(coopTreasury);
        paid = amount < owed ? amount : owed;
        uint256 available = unencumbered();
        if (paid > available) paid = available;
        // Only out of members' own money: capital advanced to pay merchants early is not the fee.
        if (paid > memberFunded) paid = memberFunded;
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
    function setCoopTreasury(address treasury) external onlyRole(OPERATOR_ROLE) {
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
    /// @notice what `receiveRepayment` was called before, kept for the upgrade.
    /// @dev The ledger and this pool are separate proxies and cannot be upgraded in one
    /// transaction, so for the moment between them one of the two is old. The old ledger calls
    /// `donate`; without this, every repayment in that window would revert. Upgrade this pool
    /// first, then the ledger, then delete this.
    function donate(uint256 amount) external {
        _receiveRepayment(amount);
    }

    function receiveRepayment(uint256 amount) external {
        _receiveRepayment(amount);
    }

    function _receiveRepayment(uint256 amount) private {
        if (_msgSender() != address(stableCredit)) revert PayoutPoolInvalidAddress();
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        // Members' own money, which settles positions rather than buying them.
        memberFunded += amount;
        emit Funded(_msgSender(), amount);
    }
}
