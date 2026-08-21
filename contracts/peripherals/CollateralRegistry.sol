// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../core/interfaces/stable-credit/IExposureSource.sol";
import "../core/interfaces/stable-credit/IEncumbranceSource.sol";
import "../core/interfaces/stable-credit/ICreditPositionSource.sol";
import "../core/interfaces/stable-credit/INetworkRegistry.sol";
import "../libraries/ExposureMath.sol";

/// @title CollateralRegistry
/// @notice What each member has pledged, and what the AssurancePool would pay if it all defaulted.
/// @dev Two jobs that are really one. Pool exposure is not a property of a debt or of a pledge
/// separately -- it is the gap between what is owed and what the pledge behind it would realize --
/// so whatever knows about pledges is where the two get put together.
///
/// Exposure is maintained, not iterated. Summing over every member on read does not scale, and
/// summing over every member on write scales worse. Instead each member's exposure is computed
/// from their own positions, which are few, and a running total is adjusted by the difference
/// whenever one of them changes. `refresh` is permissionless so the total can be corrected by
/// anyone rather than only by whoever caused the change.
///
/// Haircuts are per collateral type and governed. An internal claim -- a bond, a pool share -- is
/// a claim on the co-op itself, and seizing it cancels an obligation rather than realizing an
/// asset, so it is haircut against known redemption terms. An external asset has a market price.
/// Sharing a haircut between them over-reserves one and under-reserves the other.
contract CollateralRegistry is
    IExposureSource,
    IEncumbranceSource,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice A kind of pledge, and the terms it is valued on.
    struct CollateralType {
        /// @dev How exposure treats debt drawn under this kind.
        ExposureMath.Backing backing;
        /// @dev Assumed realizable share of the pledged value, in basis points.
        uint256 haircutBps;
        /// @dev What one unit of the pledge is worth in ledger units, scaled by 1e18.
        /// @dev Carries the exchange rate and the decimal difference together, because splitting
        /// them invites getting one right and the other wrong. CLRUSD at par against a six-decimal
        /// ledger is 1e18; an eighteen-decimal token worth a dollar against the same ledger is
        /// 1e6, since one of its units is a millionth of a millionth of a ledger unit.
        uint256 unitPrice;
        bool registered;
    }

    INetworkRegistry public networkRegistry;

    /// @dev kind => terms
    mapping(bytes32 => CollateralType) public collateralTypes;
    bytes32[] private kinds;

    /// @dev member => kind => units pledged
    mapping(address => mapping(bytes32 => uint256)) public pledgedOf;
    /// @dev member => exposure last folded into the running total
    mapping(address => uint256) public recordedExposureOf;

    /// @notice What the AssurancePool would pay across every member, as last recorded.
    uint256 public totalExposure;

    /// @notice The collateral kind that is held as CLRUSD in the member's own account.
    /// @dev The one kind whose lock the token itself can enforce, because the member holds it
    /// directly rather than having pledged something held elsewhere.
    bytes32 public clrusdKind;

    uint256[42] private __gap;

    error CollateralRegistryInvalidAddress();
    error CollateralRegistryUnknownType(bytes32 kind);
    error CollateralRegistryTypeExists(bytes32 kind);
    error CollateralRegistryHaircutTooHigh(uint256 haircutBps);
    error CollateralRegistryEncumbered(address member, bytes32 kind, uint256 free, uint256 amount);

    event CollateralTypeRegistered(
        bytes32 indexed kind, ExposureMath.Backing backing, uint256 haircutBps
    );
    event CollateralTypeUpdated(bytes32 indexed kind, uint256 haircutBps, uint256 unitPrice);
    event Pledged(address indexed member, bytes32 indexed kind, uint256 amount);
    event Released(address indexed member, bytes32 indexed kind, uint256 amount);
    event Seized(address indexed member, bytes32 indexed kind, uint256 amount);
    event ExposureRefreshed(address indexed member, uint256 previous, uint256 current);
    event ClrusdKindUpdated(bytes32 indexed kind);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address _networkRegistry) external initializer {
        if (admin == address(0) || _networkRegistry == address(0)) {
            revert CollateralRegistryInvalidAddress();
        }
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        networkRegistry = INetworkRegistry(_networkRegistry);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    /// @notice every registered collateral kind.
    function collateralKinds() external view returns (bytes32[] memory) {
        return kinds;
    }

    /// @notice What one unit price is scaled by.
    uint256 public constant PRICE_SCALE = 1e18;

    /// @notice the value of what a member has pledged under one kind, before the haircut.
    function collateralValueOf(address member, bytes32 kind) public view returns (uint256) {
        CollateralType storage collateral = collateralTypes[kind];
        if (!collateral.registered) return 0;
        uint256 units = pledgedOf[member][kind];
        if (units == 0) return 0;
        return (units * collateral.unitPrice) / PRICE_SCALE;
    }

    /// @notice what the pool would pay if this member defaulted on everything.
    /// @dev Walks the member's own positions, which are a handful of tiers and a handful of
    /// plans. Savings-backed contributes nothing, asset-backed contributes the shortfall left
    /// after its haircut, and anything else contributes in full.
    function exposureOf(address member) public view returns (uint256 exposure) {
        address[] memory issuers = networkRegistry.issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            (bytes32[] memory positionKinds, uint256[] memory amounts) =
                ICreditPositionSource(issuers[i]).debtByKind(member);

            for (uint256 j = 0; j < positionKinds.length; j++) {
                bytes32 kind = positionKinds[j];
                CollateralType storage collateral = collateralTypes[kind];
                exposure += ExposureMath.positionExposure(
                    collateral.registered ? collateral.backing : ExposureMath.backingOf(kind),
                    amounts[j],
                    collateralValueOf(member, kind),
                    collateral.haircutBps
                );
            }
        }
    }

    /// @notice how much of a member's pledge under one kind is not backing anything.
    /// @dev A pledge is locked while the credit it backs is drawn. Freeing it while the debt
    /// stands would leave the pool covering a position it had been told was collateralized.
    function freeCollateralOf(address member, bytes32 kind) public view returns (uint256) {
        CollateralType storage collateral = collateralTypes[kind];
        if (!collateral.registered) return 0;
        uint256 units = pledgedOf[member][kind];
        if (units == 0) return 0;

        uint256 required = _requiredUnits(member, kind, collateral);
        return units > required ? units - required : 0;
    }

    /// @notice the units of a kind that must stay pledged to cover what is drawn under it.
    function _requiredUnits(address member, bytes32 kind, CollateralType storage collateral)
        private
        view
        returns (uint256)
    {
        uint256 drawn = _drawnUnder(member, kind);
        if (drawn == 0) return 0;
        // Collateral that realizes nothing can never free itself while anything is drawn on it.
        if (collateral.haircutBps == 0 || collateral.unitPrice == 0) return type(uint256).max;

        // The value the haircut has to reach, converted back into units.
        uint256 neededValue = (drawn * ExposureMath.BPS) / collateral.haircutBps;
        return (neededValue * PRICE_SCALE) / collateral.unitPrice;
    }

    /// @notice a member's outstanding principal drawn under one kind.
    function _drawnUnder(address member, bytes32 kind) private view returns (uint256 drawn) {
        address[] memory issuers = networkRegistry.issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            (bytes32[] memory positionKinds, uint256[] memory amounts) =
                ICreditPositionSource(issuers[i]).debtByKind(member);
            for (uint256 j = 0; j < positionKinds.length; j++) {
                if (positionKinds[j] == kind) drawn += amounts[j];
            }
        }
    }

    /// @inheritdoc IExposureSource
    function poolExposure() external view override returns (uint256) {
        return totalExposure;
    }

    /// @inheritdoc IEncumbranceSource
    /// @dev The credit line's own rule, read from the asset's side: withdrawable CLRUSD is the
    /// balance less what has been drawn against it. Scales with the draw rather than the pledge,
    /// so a member who has drawn nothing is not locked up and one who repays sees the lock
    /// recede. There is no pay-back date and no pay button; this is the enforcement.
    function encumberedOf(address holder) external view override returns (uint256) {
        bytes32 kind = clrusdKind;
        if (kind == bytes32(0)) return 0;
        CollateralType storage collateral = collateralTypes[kind];
        if (!collateral.registered) return 0;
        return _requiredUnits(holder, kind, collateral);
    }

    /// @notice names the collateral kind held as CLRUSD in members' own accounts.
    function setClrusdKind(bytes32 kind) external onlyRole(OPERATOR_ROLE) {
        if (kind != bytes32(0) && !collateralTypes[kind].registered) {
            revert CollateralRegistryUnknownType(kind);
        }
        clrusdKind = kind;
        emit ClrusdKindUpdated(kind);
    }

    /* ========== MUTATIVE ========== */

    /// @notice recomputes a member's exposure and folds the difference into the total.
    /// @dev Permissionless. Anyone may correct the running total, so a missed call by whoever
    /// caused a change does not leave the figure the AssurancePool reserves against stale.
    /// @param member address of the member.
    /// @return the member's exposure now.
    function refresh(address member) public returns (uint256) {
        uint256 previous = recordedExposureOf[member];
        uint256 current = exposureOf(member);
        if (current != previous) {
            totalExposure = totalExposure + current - previous;
            recordedExposureOf[member] = current;
            emit ExposureRefreshed(member, previous, current);
        }
        return current;
    }

    /// @notice records a pledge.
    /// @dev Records rather than escrows. The member's smart account holds the collateral, and an
    /// ERC-7579 module on that account is what actually stops it moving while encumbered. This is
    /// the ledger of what was promised; enforcement lives where the asset does.
    /// @param member address pledging.
    /// @param kind collateral type.
    /// @param amount units pledged.
    function pledge(address member, bytes32 kind, uint256 amount) external onlyRole(OPERATOR_ROLE) {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        pledgedOf[member][kind] += amount;
        emit Pledged(member, kind, amount);
        refresh(member);
    }

    /// @notice releases a pledge that is not backing anything.
    /// @param member address releasing.
    /// @param kind collateral type.
    /// @param amount units to release.
    function release(address member, bytes32 kind, uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        uint256 free = freeCollateralOf(member, kind);
        if (amount > free) revert CollateralRegistryEncumbered(member, kind, free, amount);
        pledgedOf[member][kind] -= amount;
        emit Released(member, kind, amount);
        refresh(member);
    }

    /// @notice records collateral taken from a member on default.
    /// @dev Distinct from `release`, which refuses to free anything backing drawn credit. That is
    /// exactly what a seizure takes, so it cannot go through the same door -- and if it did not go
    /// through any door the registry would go on counting collateral that is no longer there,
    /// reporting a position as covered by a pledge somebody else now holds.
    /// @param member address the collateral was taken from.
    /// @param kind collateral type.
    /// @param amount units taken.
    function recordSeizure(address member, bytes32 kind, uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        uint256 pledged = pledgedOf[member][kind];
        pledgedOf[member][kind] = amount > pledged ? 0 : pledged - amount;
        emit Seized(member, kind, amount);
        refresh(member);
    }

    /* ========== RESTRICTED ========== */

    /// @notice registers a kind of collateral and the terms it is valued on.
    /// @param kind tier kind this collateral backs.
    /// @param backing how exposure treats debt drawn under it.
    /// @param haircutBps assumed realizable share of pledged value, in basis points.
    /// @param unitPrice value of one unit in ledger units, scaled by 1e18.
    function registerCollateralType(
        bytes32 kind,
        ExposureMath.Backing backing,
        uint256 haircutBps,
        uint256 unitPrice
    ) external onlyRole(OPERATOR_ROLE) {
        if (collateralTypes[kind].registered) revert CollateralRegistryTypeExists(kind);
        if (haircutBps > ExposureMath.BPS) revert CollateralRegistryHaircutTooHigh(haircutBps);
        collateralTypes[kind] = CollateralType(backing, haircutBps, unitPrice, true);
        kinds.push(kind);
        emit CollateralTypeRegistered(kind, backing, haircutBps);
    }

    /// @notice revalues a collateral type.
    /// @dev Start the haircut high and lower it with evidence. Raising it, or marking a type down,
    /// increases what the pool reserves against every position drawn under it -- which is the
    /// point, and why the figure is governed rather than read from wherever the asset trades.
    function setCollateralTerms(bytes32 kind, uint256 haircutBps, uint256 unitPrice)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        if (haircutBps > ExposureMath.BPS) revert CollateralRegistryHaircutTooHigh(haircutBps);
        collateralTypes[kind].haircutBps = haircutBps;
        collateralTypes[kind].unitPrice = unitPrice;
        emit CollateralTypeUpdated(kind, haircutBps, unitPrice);
    }
}
