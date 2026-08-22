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

    Claim[] private claims;
    /// @dev merchant => claim ids
    mapping(address => uint256[]) private claimsOf;
    /// @dev The next claim in age order that has not been paid.
    uint256 public nextUnpaid;
    /// @notice Total still owed on queued claims.
    uint256 public queuedTotal;

    uint256[43] private __gap;

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
        stableCredit.transferFrom(merchant, coopTreasury, redeeming);

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
        emit ClaimPaid(claimId, claim.merchant, claim.amount);
    }

    /* ========== FUNDING ========== */

    /// @notice moves value in from somewhere already on chain.
    /// @dev Savings forfeiture, incoming deposits, Move-to-Earn proceeds and merchant drawdown
    /// netting can all arrive without anyone deciding to send them. Anything crossing the fiat
    /// boundary cannot: a contract cannot wire dollars and cannot decide to on-ramp, so that stays
    /// a multisig action and this only reports how much of one is needed.
    function fund(uint256 amount) external onlyRole(FUNDER_ROLE) {
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        emit Funded(_msgSender(), amount);
    }

    /// @notice moves the co-op's side of the position.
    function setCoopTreasury(address treasury) external onlyRole(OPERATOR_ROLE) {
        if (treasury == address(0)) revert PayoutPoolInvalidAddress();
        coopTreasury = treasury;
    }

    /// @notice takes value in from anybody willing to send it.
    /// @dev The multisig top-up path, and deliberately open: refusing money because the sender
    /// lacks a role would be a strange way to run a pool that reports being short.
    function donate(uint256 amount) external {
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        emit Funded(_msgSender(), amount);
    }
}
