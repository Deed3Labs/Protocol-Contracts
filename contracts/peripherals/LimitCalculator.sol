// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./CollateralRegistry.sol";
import "./RevolvingIssuer.sol";
import "../libraries/ExposureMath.sol";

/// @title LimitCalculator
/// @notice Turns what a member has pledged and what has been attested about them into a ceiling.
/// @dev The member sees one ceiling; this decides what it is made of. Collateral-backed tiers are
/// valued from the registry, and the unsecured ones come from underwriting that happens off-chain
/// and arrives as an attestation rather than as raw data.
///
/// **A tier's capacity is its collateral after the same haircut exposure uses.** Not a second
/// parameter that happens to match: the same one. Lending up to `collateral x haircut` means a
/// member drawn to their limit leaves the AssurancePool covering nothing, because the shortfall
/// exposure measures is exactly what the limit refused to lend. Exposure appearing on a
/// collateralized tier then means something specific -- carry has pushed the position past the
/// limit, or the collateral was marked down -- rather than being the normal state of affairs.
///
/// **Two timing rules, because they answer to different people.** A member moving collateral or
/// adding savings caused the change and expects to see it immediately. A change they did not
/// cause -- an income re-estimate, a recalculation of how they have been behaving -- is fixed for
/// the cycle and takes effect at the boundary, so nobody's ceiling moves under them mid-cycle for
/// reasons they cannot see.
contract LimitCalculator is AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @dev Underwriting that only exists off-chain enters as a signed figure, not as raw data.
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    /// @notice A slice of a member's ceiling.
    struct Tier {
        bytes32 kind;
        uint256 capacity;
        uint256 drawn;
        uint256 ratePerCycle;
    }

    /// @notice An underwritten figure, and the one waiting to replace it.
    struct Attestation {
        uint256 current;
        uint256 pending;
        uint64 effectiveFrom;
    }

    CollateralRegistry public collateralRegistry;
    RevolvingIssuer public issuer;

    /// @dev member => kind => attested capacity
    mapping(address => mapping(bytes32 => Attestation)) private attestations;
    /// @dev kind => what the collateral behind it yields per cycle, in basis points
    mapping(bytes32 => uint256) public collateralYieldOf;

    uint256[43] private __gap;

    error LimitCalculatorInvalidAddress();
    error LimitCalculatorYieldExceedsCarry(bytes32 kind, uint256 yieldBps, uint256 rateBps);

    event Attested(address indexed member, bytes32 indexed kind, uint256 value, uint64 effectiveFrom);
    event CollateralYieldUpdated(bytes32 indexed kind, uint256 yieldPerCycleBps);
    event CapacitiesPushed(address indexed member, uint256 total);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address _collateralRegistry, address _issuer)
        external
        initializer
    {
        if (admin == address(0) || _collateralRegistry == address(0) || _issuer == address(0)) {
            revert LimitCalculatorInvalidAddress();
        }
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(ATTESTOR_ROLE, admin);
        collateralRegistry = CollateralRegistry(_collateralRegistry);
        issuer = RevolvingIssuer(_issuer);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    /// @notice a member's ceiling, broken into the tiers it is composed of.
    function tiersOf(address member) public view returns (Tier[] memory tiers) {
        uint256 count = issuer.tierCount();
        tiers = new Tier[](count);
        for (uint256 i = 0; i < count; i++) {
            (bytes32 kind, uint256 ratePerCycle,) = issuer.tierAt(i);
            tiers[i] = Tier({
                kind: kind,
                capacity: capacityOf(member, kind),
                drawn: issuer.principalOf(member, i),
                ratePerCycle: ratePerCycle
            });
        }
    }

    /// @notice what a member may draw in one tier.
    /// @dev Collateral-backed kinds are valued live, so a member who has just pledged sees it at
    /// once. Kinds with no collateral behind them come from the attested figure, which changes
    /// only at a cycle boundary.
    function capacityOf(address member, bytes32 kind) public view returns (uint256) {
        uint256 collateralValue = collateralRegistry.collateralValueOf(member, kind);
        if (collateralValue > 0) {
            (, uint256 haircutBps,,) = collateralRegistry.collateralTypes(kind);
            return (collateralValue * haircutBps) / ExposureMath.BPS;
        }
        return effectiveAttestationOf(member, kind);
    }

    /// @notice the attested figure in force right now.
    /// @dev A pending figure only counts once its boundary has passed. Nobody's ceiling moves
    /// under them mid-cycle for a reason they did not cause and cannot see.
    function effectiveAttestationOf(address member, bytes32 kind) public view returns (uint256) {
        Attestation storage attestation = attestations[member][kind];
        if (attestation.effectiveFrom != 0 && block.timestamp >= attestation.effectiveFrom) {
            return attestation.pending;
        }
        return attestation.current;
    }

    /// @notice the attested figure waiting to take effect, and when it does.
    function pendingAttestationOf(address member, bytes32 kind)
        external
        view
        returns (uint256 value, uint64 effectiveFrom)
    {
        Attestation storage attestation = attestations[member][kind];
        if (attestation.effectiveFrom == 0 || block.timestamp >= attestation.effectiveFrom) {
            return (0, 0);
        }
        return (attestation.pending, attestation.effectiveFrom);
    }

    /// @notice a member's whole ceiling.
    function totalCapacityOf(address member) public view returns (uint256 total) {
        Tier[] memory tiers = tiersOf(member);
        for (uint256 i = 0; i < tiers.length; i++) {
            total += tiers[i].capacity;
        }
    }

    /* ========== MUTATIVE ========== */

    /// @notice writes a member's tier capacities onto the issuer.
    /// @dev Permissionless. The figures are derived from collateral anyone can read and
    /// attestations only an attestor can write, so there is nothing here for a caller to choose
    /// -- and a member whose collateral just moved should not have to wait for an operator to
    /// notice.
    function pushCapacities(address member) external returns (uint256 total) {
        uint256 count = issuer.tierCount();
        for (uint256 i = 0; i < count; i++) {
            (bytes32 kind, uint256 ratePerCycle,) = issuer.tierAt(i);
            uint256 capacity = capacityOf(member, kind);

            // Yield-bearing collateral has to cost more than it yields. A bond paying more than
            // it costs to borrow against is a member drawing free money out of the co-op, and the
            // cheapest place to refuse it is before the capacity is granted.
            if (capacity > 0) {
                uint256 collateralYield = collateralYieldOf[kind];
                if (collateralYield >= ratePerCycle && collateralYield > 0) {
                    revert LimitCalculatorYieldExceedsCarry(kind, collateralYield, ratePerCycle);
                }
            }

            issuer.setTierCapacity(member, i, capacity);
            total += capacity;
        }
        collateralRegistry.refresh(member);
        emit CapacitiesPushed(member, total);
    }

    /* ========== RESTRICTED ========== */

    /// @notice records an underwritten figure for a member.
    /// @dev Income and Boost are underwritten off-chain and arrive as an attestation rather than
    /// as raw data. They take effect at the boundary given, not on arrival: the member did not
    /// cause this change, so it is announced rather than applied.
    /// @param member address of the member.
    /// @param kind tier kind the figure is for.
    /// @param value new capacity.
    /// @param effectiveFrom timestamp it takes effect, usually the next cycle boundary.
    function attest(address member, bytes32 kind, uint256 value, uint64 effectiveFrom)
        external
        onlyRole(ATTESTOR_ROLE)
    {
        Attestation storage attestation = attestations[member][kind];
        // Fold in anything that has already matured, so a new attestation never discards one that
        // was in force.
        if (attestation.effectiveFrom != 0 && block.timestamp >= attestation.effectiveFrom) {
            attestation.current = attestation.pending;
        }
        attestation.pending = value;
        attestation.effectiveFrom = effectiveFrom;
        emit Attested(member, kind, value, effectiveFrom);
    }

    /// @notice records what the collateral behind a tier yields.
    /// @param kind tier kind.
    /// @param yieldPerCycleBps yield per cycle, in basis points.
    function setCollateralYield(bytes32 kind, uint256 yieldPerCycleBps)
        external
        onlyRole(OPERATOR_ROLE)
    {
        collateralYieldOf[kind] = yieldPerCycleBps;
        emit CollateralYieldUpdated(kind, yieldPerCycleBps);
    }
}
