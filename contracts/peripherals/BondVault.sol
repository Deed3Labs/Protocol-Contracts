// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./interfaces/IBondBackstop.sol";

/// @title BondVault
/// @notice Where bond proceeds live, and what keeps them senior.
/// @dev Bondholders lent money and are creditors. Proceeds used to go into the AssurancePool's
/// excess reserve and redemptions came back out of the same pool, which put bondholder principal
/// to work absorbing other people's defaults and left redemption competing with the losses it was
/// funding. A bond could fail to pay because the credit book had a bad quarter -- the one thing a
/// zero-coupon bond is not supposed to do.
///
/// The fix is not a rule about where to send money. It is that the money is somewhere else.
///
/// **The redemption reserve is derived, not decided.** It is whatever is coming due inside the
/// window, floored at a share of everything outstanding, so it rises on its own as maturities
/// approach and nobody has to notice. An operator cannot lower it below what is owed soon,
/// because the figure is not theirs to set.
///
/// **The Safe takes only the deployable excess.** Money does have to reach human control -- a
/// contract cannot wire dollars to a card processor or originate a lease -- but sending proceeds
/// straight to a multisig turns the redemption reserve into a policy somebody has to remember.
/// Here it is a subtraction that happens before the withdrawal is allowed.
contract BondVault is AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice The bond contract. Records purchases and settles maturities.
    bytes32 public constant BOND_ROLE = keccak256("BOND_ROLE");
    /// @notice The multisig. May take what the vault does not owe soon.
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    uint256 internal constant BPS = 10_000;

    /// @notice What the vault owes on one bond.
    struct Obligation {
        uint256 principal;
        uint256 faceValue;
        uint64 maturity;
        bool settled;
    }

    IERC20Upgradeable public reserveToken;

    /// @dev bond id => obligation
    mapping(uint256 => Obligation) public obligations;
    uint256[] private outstanding;
    /// @dev bond id => index in `outstanding`, plus one
    mapping(uint256 => uint256) private outstandingIndex;

    /// @notice Principal taken in across every bond, settled or not.
    uint256 public totalPrincipal;
    /// @notice Face value still owed.
    uint256 public totalFaceOutstanding;
    /// @notice Face value already paid.
    uint256 public totalFaceSettled;

    /// @notice How far ahead the reserve looks.
    uint64 public reserveWindow;
    /// @notice Floor on the reserve, as a share of face outstanding.
    uint256 public minReserveBps;
    /// @dev Bounds on that floor, so it stays a parameter rather than a decision.
    uint256 public constant MIN_RESERVE_FLOOR_BPS = 2_000;
    uint256 public constant MAX_RESERVE_FLOOR_BPS = 10_000;

    /* ========== ADDED AFTER DEPLOYMENT: five slots from the gap ========== */

    /// @notice The co-op's treasury, the Safe. Pays a bond the vault cannot, up to the allowance it
    /// has given this vault, before the AssurancePool is asked.
    address public treasury;
    /// @notice The reserve of last resort for a bond neither the vault nor the treasury can pay.
    address public assurancePool;
    /// @notice The payout pool, which may borrow the deployable excess for a claim that has come due.
    address public payoutPool;
    /// @notice Reserve tokens out with the payout pool, repaid with carry.
    uint256 public lentToPayoutPool;
    /// @notice What the AssurancePool lent for a bond, repaid from new proceeds before the Safe
    /// can take anything.
    uint256 public owedToReserve;

    uint256[37] private __gap;

    error BondVaultInvalidAddress();
    error BondVaultUnknownBond(uint256 bondId);
    error BondVaultBondExists(uint256 bondId);
    error BondVaultAlreadySettled(uint256 bondId);
    error BondVaultReserveFloorOutOfBounds(uint256 bps);
    error BondVaultWouldBreachReserve(uint256 deployable, uint256 requested);
    error BondVaultInsufficientFunds(uint256 held, uint256 required);

    event PurchaseRecorded(uint256 indexed bondId, uint256 principal, uint256 faceValue, uint64 maturity);
    event Settled(uint256 indexed bondId, address indexed to, uint256 faceValue);
    event Rolled(
        uint256 indexed oldBondId,
        uint256 indexed newBondId,
        uint256 rolledPrincipal,
        uint256 newFaceValue,
        uint64 newMaturity
    );
    event SettledEarly(
        uint256 indexed bondId, address indexed to, uint256 presentValue, uint256 faceValue
    );
    event DeployableWithdrawn(address indexed to, uint256 amount);
    event ReserveTermsUpdated(uint64 window, uint256 minReserveBps);
    event BackstopsUpdated(address indexed treasury, address indexed assurancePool, address indexed payoutPool);
    event DrewFromTreasury(uint256 amount);
    event DrewFromReserve(uint256 amount, uint256 owed);
    event RepaidReserve(uint256 amount, uint256 owed);
    event LentToPayoutPool(uint256 amount, uint256 outstanding);
    event RepaidFromPayoutPool(uint256 amount, uint256 outstanding);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address _reserveToken, uint64 _reserveWindow)
        external
        initializer
    {
        if (admin == address(0) || _reserveToken == address(0)) {
            revert BondVaultInvalidAddress();
        }
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        reserveToken = IERC20Upgradeable(_reserveToken);
        reserveWindow = _reserveWindow;
        // Roughly seventy deployable to thirty held, before the window pushes it higher.
        minReserveBps = 3_000;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    function held() public view returns (uint256) {
        return reserveToken.balanceOf(address(this));
    }

    function outstandingCount() external view returns (uint256) {
        return outstanding.length;
    }

    function outstandingBonds() external view returns (uint256[] memory) {
        return outstanding;
    }

    /// @notice face value falling due inside a window.
    function faceDueWithin(uint64 window) public view returns (uint256 due) {
        uint256 horizon = block.timestamp + window;
        for (uint256 i = 0; i < outstanding.length; i++) {
            Obligation storage obligation = obligations[outstanding[i]];
            if (obligation.maturity <= horizon) due += obligation.faceValue;
        }
    }

    /// @notice what the vault must keep back.
    /// @dev The larger of what is coming due inside the window and a floor across everything
    /// outstanding. It rises on its own as maturities approach, which is the point: a reserve
    /// that has to be raised by hand is one that gets raised late.
    function requiredReserve() public view returns (uint256) {
        uint256 nearTerm = faceDueWithin(reserveWindow);
        uint256 floor = (totalFaceOutstanding * minReserveBps) / BPS;
        return nearTerm > floor ? nearTerm : floor;
    }

    /// @notice what the Safe may take.
    /// @dev What the AssurancePool lent for a bond comes off first: it is going back there, and
    /// the Safe taking it would leave the reserve holding the bondholders' shortfall.
    function deployableExcess() public view returns (uint256) {
        uint256 balance = held();
        uint256 reserve = requiredReserve() + owedToReserve;
        return balance > reserve ? balance - reserve : 0;
    }

    /// @notice what the treasury can put up for a bond right now: its allowance to this vault,
    /// capped at what it holds.
    function treasuryAvailable() public view returns (uint256) {
        if (treasury == address(0)) return 0;
        uint256 allowed = reserveToken.allowance(treasury, address(this));
        uint256 balance = reserveToken.balanceOf(treasury);
        return allowed < balance ? allowed : balance;
    }

    /// @notice face value due inside the window that neither the vault nor the treasury can pay.
    /// @dev What the AssurancePool backs as the last resort, and so what its RTD counts.
    function uncoveredNearTerm() external view returns (uint256) {
        uint256 due = faceDueWithin(reserveWindow);
        uint256 have = held() + treasuryAvailable();
        return due > have ? due - have : 0;
    }

    /// @notice whether the vault can pay everything due inside the window.
    /// @dev Solvency in aggregate is not the same as solvency on timing, which is why this asks
    /// about the window rather than the total.
    function coversNearTermMaturities() external view returns (bool) {
        return held() >= faceDueWithin(reserveWindow);
    }

    /* ========== BOND LIFECYCLE ========== */

    /// @notice records a purchase and the obligation it creates.
    /// @dev The proceeds arrive here rather than in the AssurancePool, which is the whole change.
    /// The face value is booked at the same moment, so the vault knows what it owes from the
    /// instant it holds the money rather than discovering it at maturity.
    function recordPurchase(uint256 bondId, uint256 principal, uint256 faceValue, uint64 maturity)
        external
        onlyRole(BOND_ROLE)
    {
        if (obligations[bondId].faceValue != 0) revert BondVaultBondExists(bondId);

        obligations[bondId] =
            Obligation({principal: principal, faceValue: faceValue, maturity: maturity, settled: false});
        outstanding.push(bondId);
        outstandingIndex[bondId] = outstanding.length;

        totalPrincipal += principal;
        totalFaceOutstanding += faceValue;
        emit PurchaseRecorded(bondId, principal, faceValue, maturity);
    }

    /// @notice pays a matured bond.
    /// @dev Paid out of the vault's own holdings first, then the treasury, then the AssurancePool as
    /// the last resort. A bondholder is still not exposed to how the credit book performs: the
    /// reserve only lends from what it holds above the primary cover, and the vault pays it back.
    function settle(uint256 bondId, address to) external onlyRole(BOND_ROLE) returns (uint256) {
        Obligation storage obligation = obligations[bondId];
        if (obligation.faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (obligation.settled) revert BondVaultAlreadySettled(bondId);

        uint256 faceValue = obligation.faceValue;
        _cover(faceValue);

        obligation.settled = true;
        totalFaceOutstanding -= faceValue;
        totalFaceSettled += faceValue;
        _removeOutstanding(bondId);

        reserveToken.safeTransfer(to, faceValue);
        emit Settled(bondId, to, faceValue);
        return faceValue;
    }

    /// @notice pays a bond before its maturity, at what it is worth today.
    /// @dev The obligation goes at face value -- the vault stops owing the whole of it -- while
    /// only the present value is paid out. What is left is the interest the term did not run for,
    /// and it stays here rather than being handed to somebody who did not wait for it.
    ///
    /// This is what makes taking a bond as collateral realisable on a default without waiting out
    /// the term, and what the haircut on that collateral is paying for.
    /// @param bondId the bond
    /// @param to who is paid
    /// @param presentValue what the bond is worth today
    function settleEarly(uint256 bondId, address to, uint256 presentValue)
        external
        onlyRole(BOND_ROLE)
    {
        Obligation storage obligation = obligations[bondId];
        if (obligation.faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (obligation.settled) revert BondVaultAlreadySettled(bondId);

        _cover(presentValue);

        uint256 faceValue = obligation.faceValue;
        obligation.settled = true;
        totalFaceOutstanding -= faceValue;
        totalFaceSettled += faceValue;
        _removeOutstanding(bondId);

        reserveToken.safeTransfer(to, presentValue);
        emit SettledEarly(bondId, to, presentValue, faceValue);
    }

    /// @notice rolls a matured obligation into a new one without paying it out.
    /// @dev A pledged bond that simply matures leaves the member's limit contracting hard on the
    /// day it does, and if they have already spent the proceeds there is nothing to replace it
    /// with. Rolling keeps the position instead.
    ///
    /// No cash moves. The vault already holds what the matured bond was worth, and that is what
    /// buys the replacement -- which is why the new face value is larger: the same money, bought
    /// at a discount again.
    function roll(uint256 oldBondId, uint256 newBondId, uint256 newFaceValue, uint64 newMaturity)
        external
        onlyRole(BOND_ROLE)
    {
        Obligation storage matured = obligations[oldBondId];
        if (matured.faceValue == 0) revert BondVaultUnknownBond(oldBondId);
        if (matured.settled) revert BondVaultAlreadySettled(oldBondId);
        if (obligations[newBondId].faceValue != 0) revert BondVaultBondExists(newBondId);

        uint256 rolled = matured.faceValue;
        matured.settled = true;
        totalFaceOutstanding -= rolled;
        _removeOutstanding(oldBondId);

        obligations[newBondId] = Obligation({
            principal: rolled,
            faceValue: newFaceValue,
            maturity: newMaturity,
            settled: false
        });
        outstanding.push(newBondId);
        outstandingIndex[newBondId] = outstanding.length;
        totalFaceOutstanding += newFaceValue;

        emit Rolled(oldBondId, newBondId, rolled, newFaceValue, newMaturity);
    }

    /* ========== TREASURY ========== */

    /// @notice takes what the vault does not owe soon.
    /// @dev The only way money leaves except by paying a bondholder. The reserve is subtracted
    /// before the request is considered, so there is no ordering in which the Safe empties the
    /// vault and the redemption reserve is restored afterwards.
    function withdrawDeployable(uint256 amount, address to) external onlyRole(TREASURY_ROLE) {
        if (to == address(0)) revert BondVaultInvalidAddress();
        _repayReserve();
        uint256 deployable = deployableExcess();
        if (amount > deployable) revert BondVaultWouldBreachReserve(deployable, amount);

        reserveToken.safeTransfer(to, amount);
        emit DeployableWithdrawn(to, amount);
    }

    /* ========== BACKSTOPS ========== */

    /// @dev Makes sure the vault holds `amount` before it pays a bondholder: its own holdings, then
    /// the treasury up to its allowance, then the AssurancePool. Reverts only when all three together
    /// cannot, and then nothing has moved.
    function _cover(uint256 amount) private {
        uint256 balance = held();
        if (balance >= amount) return;
        uint256 short = amount - balance;

        uint256 fromTreasury = treasuryAvailable();
        if (fromTreasury > short) fromTreasury = short;
        if (fromTreasury > 0) {
            reserveToken.safeTransferFrom(treasury, address(this), fromTreasury);
            short -= fromTreasury;
            emit DrewFromTreasury(fromTreasury);
        }
        if (short > 0 && assurancePool != address(0)) {
            uint256 lent = IBondReserve(assurancePool).lendToBondVault(short);
            if (lent > 0) {
                owedToReserve += lent;
                short -= lent;
                emit DrewFromReserve(lent, owedToReserve);
            }
        }
        balance = held();
        if (balance < amount) revert BondVaultInsufficientFunds(balance, amount);
    }

    /// @notice pays the AssurancePool back from what the vault does not owe soon.
    /// @dev Permissionless: new proceeds arriving should restore the reserve without anybody having
    /// to remember. The treasury is not repaid here; what it put in comes back as deployable excess,
    /// which the Safe takes in the ordinary way.
    function repayReserve() external returns (uint256 paid) {
        return _repayReserve();
    }

    function _repayReserve() private returns (uint256 paid) {
        if (owedToReserve == 0 || assurancePool == address(0)) return 0;
        uint256 balance = held();
        uint256 reserve = requiredReserve();
        uint256 spare = balance > reserve ? balance - reserve : 0;
        paid = spare < owedToReserve ? spare : owedToReserve;
        if (paid == 0) return 0;
        owedToReserve -= paid;
        reserveToken.approve(assurancePool, paid);
        IBondReserve(assurancePool).repayFromBondVault(paid);
        emit RepaidReserve(paid, owedToReserve);
    }

    /// @notice lends the deployable excess for a payout claim that has come due.
    /// @dev After the yield pool and before the treasury. Only the excess, never the redemption
    /// reserve, so a bondholder is no worse off for it; and it comes back with carry.
    /// @param amount what the payout pool is short.
    /// @return lent what the vault could put up, which may be nothing.
    function lendToPayoutPool(uint256 amount) external returns (uint256 lent) {
        if (payoutPool == address(0) || _msgSender() != payoutPool) revert BondVaultInvalidAddress();
        uint256 deployable = deployableExcess();
        lent = amount < deployable ? amount : deployable;
        if (lent == 0) return 0;
        lentToPayoutPool += lent;
        reserveToken.safeTransfer(payoutPool, lent);
        emit LentToPayoutPool(lent, lentToPayoutPool);
    }

    /// @notice takes back what the payout pool borrowed, and any carry on it.
    function repayFromPayoutPool(uint256 amount) external {
        reserveToken.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 principal = lentToPayoutPool < amount ? lentToPayoutPool : amount;
        lentToPayoutPool -= principal;
        emit RepaidFromPayoutPool(amount, lentToPayoutPool);
    }

    /* ========== RESTRICTED ========== */

    /// @notice names the treasury, the reserve of last resort, and the payout pool.
    function setBackstops(address _treasury, address _assurancePool, address _payoutPool) external onlyRole(OPERATOR_ROLE) {
        treasury = _treasury;
        assurancePool = _assurancePool;
        payoutPool = _payoutPool;
        emit BackstopsUpdated(_treasury, _assurancePool, _payoutPool);
    }

    /// @notice sets how far ahead the reserve looks and the floor beneath it.
    /// @dev Bounded rather than free. The floor is a risk parameter, and one an operator could
    /// set to zero would not be a floor.
    function setReserveTerms(uint64 window, uint256 floorBps) external onlyRole(OPERATOR_ROLE) {
        if (floorBps < MIN_RESERVE_FLOOR_BPS || floorBps > MAX_RESERVE_FLOOR_BPS) {
            revert BondVaultReserveFloorOutOfBounds(floorBps);
        }
        reserveWindow = window;
        minReserveBps = floorBps;
        emit ReserveTermsUpdated(window, floorBps);
    }

    function _removeOutstanding(uint256 bondId) private {
        uint256 indexPlusOne = outstandingIndex[bondId];
        if (indexPlusOne == 0) return;
        uint256 index = indexPlusOne - 1;
        uint256 last = outstanding[outstanding.length - 1];
        outstanding[index] = last;
        outstandingIndex[last] = index + 1;
        outstanding.pop();
        delete outstandingIndex[bondId];
    }
}
