// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./CreditIssuer.sol";
import "../core/interfaces/stable-credit/ICreditPositionSource.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/// @title OffersIssuer
/// @notice The co-op's $10 offer to a new member, on a credit line of its own.
/// @dev The offer is mutual credit like everything else on the ledger. This contract holds a capped
/// line and gives each new member the offer from it: its balance goes down by the offer and theirs
/// up, so nothing has to be funded in advance. The member spends it at a shop, the shop redeems it
/// through the payout pool like any other sale, and what the co-op owes for offers is this
/// contract's balance and nobody else's -- apart from the Safe, and apart from members' credit.
///
/// **Clearing it is not tied to any one offer.** Credits are interchangeable, so there is no
/// telling which shop holds which ten dollars, and no need to. `settle` pays the line down with the
/// Safe's USDC, up to the allowance the Safe has given this contract, and the ledger sends that
/// repayment where repayments go: the payout pool first, while it holds less than every claim
/// outstanding, so shops are paid out of it without the pool borrowing anything.
///
/// **An unspent offer expires.** After the expiry window, whatever of a member's offer they have
/// not spent comes back off their balance and off this line. Spending is followed by enrolling each
/// member with this issuer at a zero limit, so the ledger tells it when they send credits; their
/// first spends count against the offer.
///
/// **It is not exposure.** The line is the co-op owing itself, not a member who might default, so
/// `debtByKind` reports nothing and the AssurancePool's RTD does not reserve against it. What it
/// owes is shown as its own figure instead.
contract OffersIssuer is CreditIssuer, ICreditPositionSource {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /* ========== STATE VARIABLES ========== */

    /// @notice The co-op's treasury, the Safe, which pays the line down.
    address public treasury;
    /// @notice What one offer is worth, in credits.
    uint256 public offerAmount;
    /// @notice How long a member has to spend it before what is left comes back.
    uint64 public expiryWindow;

    /// @notice What of a member's offer they have not spent.
    mapping(address => uint256) public unspentOf;
    /// @notice When a member was given their offer, or zero if they have not been. One each, ever.
    mapping(address => uint64) public grantedAt;

    /// @notice Offers given, credits taken back on expiry, and the line paid down, all time.
    uint256 public totalGranted;
    uint256 public totalExpired;
    uint256 public totalSettled;
    /// @notice Offers given and not yet spent or expired, across every member.
    uint256 public totalUnspent;

    uint256[40] private __gap;

    /* ========== ERRORS AND EVENTS ========== */

    error OffersIssuerAlreadyGranted(address member);
    error OffersIssuerOverCap(uint256 owed, uint256 cap);
    error OffersIssuerNotExpired(address member, uint256 expiresAt);
    error OffersIssuerInvalidTerms();

    event OfferGranted(address indexed member, uint256 amount);
    event OfferSpent(address indexed member, uint256 amount, uint256 unspent);
    event OfferExpired(address indexed member, uint256 amount);
    event LineSettled(uint256 credits, uint256 reserve, uint256 owed);
    event CapUpdated(uint256 cap);
    event TermsUpdated(uint256 offerAmount, uint64 expiryWindow);
    event TreasuryUpdated(address indexed treasury);

    /* ========== INITIALIZER ========== */

    /// @param _stableCredit the ledger.
    /// @param _treasury the Safe, which pays the line down.
    /// @param _offerAmount one offer, in credits.
    /// @param _expiryWindow how long a member has to spend it.
    function initialize(address _stableCredit, address _treasury, uint256 _offerAmount, uint64 _expiryWindow)
        external
        initializer
    {
        __CreditIssuer_init(_stableCredit);
        if (_offerAmount == 0 || _expiryWindow == 0) revert OffersIssuerInvalidTerms();
        treasury = _treasury;
        offerAmount = _offerAmount;
        expiryWindow = _expiryWindow;
    }

    /* ========== VIEWS ========== */

    /// @notice the most the co-op can owe for offers at once.
    function cap() public view returns (uint256) {
        return stableCredit.creditLimitOf(address(this));
    }

    /// @notice what the co-op owes for offers now: this line's balance.
    function owed() public view returns (uint256) {
        return stableCredit.creditBalanceOf(address(this));
    }

    /// @notice how many more offers the line can give before it reaches its cap.
    function offersLeft() external view returns (uint256) {
        uint256 c = cap();
        uint256 o = owed();
        return c > o ? (c - o) / offerAmount : 0;
    }

    /// @notice when a member's unspent offer can be taken back, or zero if they have none.
    function expiresAt(address member) public view returns (uint256) {
        if (grantedAt[member] == 0 || unspentOf[member] == 0) return 0;
        return uint256(grantedAt[member]) + expiryWindow;
    }

    /// @notice what the treasury can put toward the line right now: its allowance to this contract,
    /// capped at what it holds.
    function treasuryAvailable() public view returns (uint256) {
        if (treasury == address(0)) return 0;
        IERC20Upgradeable reserve = stableCredit.assurancePool().reserveToken();
        uint256 allowed = reserve.allowance(treasury, address(this));
        uint256 balance = reserve.balanceOf(treasury);
        return allowed < balance ? allowed : balance;
    }

    /// @inheritdoc ICreditPositionSource
    /// @dev Nothing: the line is the co-op owing itself, so the AssurancePool does not reserve
    /// against it, and a member enrolled here for spend tracking owes this issuer nothing.
    function debtByKind(address)
        external
        pure
        override
        returns (bytes32[] memory kinds, uint256[] memory amounts)
    {
        return (kinds, amounts);
    }

    /* ========== OFFERS ========== */

    /// @notice gives a new member their offer from this line.
    /// @dev Called by the backend when someone joins. One per member, ever, and never past the cap:
    /// the ledger refuses a draw beyond the line's limit, and this says why first.
    /// @param member the new member.
    function grant(address member) external onlyOperator notNull(member) {
        if (grantedAt[member] != 0) revert OffersIssuerAlreadyGranted(member);
        uint256 amount = offerAmount;
        uint256 after_ = owed() + amount;
        if (after_ > cap()) revert OffersIssuerOverCap(after_, cap());

        grantedAt[member] = uint64(block.timestamp);
        unspentOf[member] = amount;
        totalGranted += amount;
        totalUnspent += amount;
        // Enrolled at a zero limit, so the ledger tells this issuer when they send credits. It
        // adds nothing to their ceiling and nothing to anything the AssurancePool reserves against.
        INetworkRegistry registry = stableCredit.networkRegistry();
        if (!registry.isEnrolled(member, address(this))) stableCredit.createCreditLine(member, 0, 0);
        // Drawn from this line: its balance goes down by the offer and the member's up.
        stableCredit.transfer(member, amount);
        emit OfferGranted(member, amount);
    }

    /// @notice takes back what a member did not spend, once their window has passed.
    /// @dev Permissionless: an expired offer should come off the line without anybody having to
    /// remember. Only what they still hold of it, and only as much as the line still owes -- once
    /// the line has been paid down, that offer is backed by cash and is theirs to keep.
    /// @param member the member whose offer expired.
    /// @return amount what came back.
    function expire(address member) external returns (uint256 amount) {
        uint256 at = expiresAt(member);
        if (at == 0) return 0;
        if (block.timestamp < at) revert OffersIssuerNotExpired(member, at);

        amount = unspentOf[member];
        uint256 held = stableCredit.balanceOf(member);
        if (held < amount) amount = held;
        uint256 o = owed();
        if (o < amount) amount = o;

        totalUnspent -= unspentOf[member];
        unspentOf[member] = 0;
        if (amount == 0) return 0;
        totalExpired += amount;
        // The grant run backwards: the member's credits burned against this line's obligation.
        stableCredit.reversePurchase(address(this), amount, member, amount, address(0), 0);
        emit OfferExpired(member, amount);
    }

    /// @notice pays the line down with the treasury's USDC, up to its allowance.
    /// @dev Permissionless, so a schedule or anybody can keep it cleared. The repayment goes where
    /// the ledger sends repayments: the payout pool first, while it holds less than the claims
    /// outstanding, then loss absorption.
    /// @return credits how much of the line was paid down.
    function settle() external returns (uint256 credits) {
        uint256 o = owed();
        if (o == 0) return 0;
        IAssurancePool pool = stableCredit.assurancePool();
        uint256 needed = pool.convertStableCreditToReserveToken(o);
        uint256 available = treasuryAvailable();
        if (available == 0 || needed == 0) return 0;

        credits = o;
        if (available < needed) credits = (o * available) / needed;
        uint256 reserveAmount = pool.convertStableCreditToReserveToken(credits);
        if (credits == 0 || reserveAmount == 0) return 0;

        IERC20Upgradeable reserve = pool.reserveToken();
        reserve.safeTransferFrom(treasury, address(this), reserveAmount);
        reserve.safeApprove(address(stableCredit), 0);
        reserve.safeApprove(address(stableCredit), reserveAmount);
        stableCredit.repayCreditBalance(address(this), uint128(credits));
        totalSettled += credits;
        emit LineSettled(credits, reserveAmount, owed());
    }

    /* ========== HOOKS ========== */

    /// @dev This issuer polices nobody: its own line has no period, and members are enrolled here
    /// only so their spending can be followed.
    function _validateCreditTransaction(address, address, uint256) internal pure override returns (bool) {
        return true;
    }

    /// @dev A member sending credits spends their offer first.
    function _syncCreditPositions(address sender, address, uint256 amount) internal override {
        uint256 left = unspentOf[sender];
        if (left == 0 || amount == 0) return;
        uint256 spent = amount < left ? amount : left;
        unspentOf[sender] = left - spent;
        totalUnspent -= spent;
        emit OfferSpent(sender, spent, left - spent);
    }

    /* ========== RESTRICTED ========== */

    /// @notice sets the most the co-op can owe for offers at once, opening the line the first time.
    function setCap(uint256 _cap) external onlyOperator {
        INetworkRegistry registry = stableCredit.networkRegistry();
        if (!registry.isEnrolled(address(this), address(this))) stableCredit.createCreditLine(address(this), _cap, 0);
        else stableCredit.updateCreditLimit(address(this), _cap);
        emit CapUpdated(_cap);
    }

    /// @notice sets one offer's worth and how long a member has to spend it. Offers already given
    /// keep the window they were given under only as far as `grantedAt` + the current window.
    function setTerms(uint256 _offerAmount, uint64 _expiryWindow) external onlyOperator {
        if (_offerAmount == 0 || _expiryWindow == 0) revert OffersIssuerInvalidTerms();
        offerAmount = _offerAmount;
        expiryWindow = _expiryWindow;
        emit TermsUpdated(_offerAmount, _expiryWindow);
    }

    /// @notice names the treasury that pays the line down.
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }
}
