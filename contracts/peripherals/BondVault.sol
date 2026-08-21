// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

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

    uint256[42] private __gap;

    error BondVaultInvalidAddress();
    error BondVaultUnknownBond(uint256 bondId);
    error BondVaultBondExists(uint256 bondId);
    error BondVaultAlreadySettled(uint256 bondId);
    error BondVaultReserveFloorOutOfBounds(uint256 bps);
    error BondVaultWouldBreachReserve(uint256 deployable, uint256 requested);
    error BondVaultInsufficientFunds(uint256 held, uint256 required);

    event PurchaseRecorded(uint256 indexed bondId, uint256 principal, uint256 faceValue, uint64 maturity);
    event Settled(uint256 indexed bondId, address indexed to, uint256 faceValue);
    event DeployableWithdrawn(address indexed to, uint256 amount);
    event ReserveTermsUpdated(uint64 window, uint256 minReserveBps);

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
    function deployableExcess() public view returns (uint256) {
        uint256 balance = held();
        uint256 reserve = requiredReserve();
        return balance > reserve ? balance - reserve : 0;
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
    /// @dev Paid out of the vault's own holdings and nothing else. A bondholder is not exposed to
    /// how the credit book is performing, which is what being senior means.
    function settle(uint256 bondId, address to) external onlyRole(BOND_ROLE) returns (uint256) {
        Obligation storage obligation = obligations[bondId];
        if (obligation.faceValue == 0) revert BondVaultUnknownBond(bondId);
        if (obligation.settled) revert BondVaultAlreadySettled(bondId);

        uint256 faceValue = obligation.faceValue;
        uint256 balance = held();
        if (balance < faceValue) revert BondVaultInsufficientFunds(balance, faceValue);

        obligation.settled = true;
        totalFaceOutstanding -= faceValue;
        totalFaceSettled += faceValue;
        _removeOutstanding(bondId);

        reserveToken.safeTransfer(to, faceValue);
        emit Settled(bondId, to, faceValue);
        return faceValue;
    }

    /* ========== TREASURY ========== */

    /// @notice takes what the vault does not owe soon.
    /// @dev The only way money leaves except by paying a bondholder. The reserve is subtracted
    /// before the request is considered, so there is no ordering in which the Safe empties the
    /// vault and the redemption reserve is restored afterwards.
    function withdrawDeployable(uint256 amount, address to) external onlyRole(TREASURY_ROLE) {
        if (to == address(0)) revert BondVaultInvalidAddress();
        uint256 deployable = deployableExcess();
        if (amount > deployable) revert BondVaultWouldBreachReserve(deployable, amount);

        reserveToken.safeTransfer(to, amount);
        emit DeployableWithdrawn(to, amount);
    }

    /* ========== RESTRICTED ========== */

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
