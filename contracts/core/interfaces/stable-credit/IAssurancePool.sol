// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title IAssurancePool
/// @notice The co-op's Assurance contract (section 13): segregated compartments, two-person
/// control, and a governance timelock.
/// @dev Nothing in credit, savings, payouts or bonds calls this. The interface exists for the
/// co-op's own tooling and for tests; every caller here is a person (a signer, an allowlisted
/// payer or Lending Co.'s Registered Draw Address) or the governance timelock.
interface IAssurancePool {
    /// @notice Where an inflow came from (13c).
    enum SourceTag {
        CREDIT_ENHANCEMENT_FEE,
        RECOVERY,
        INTERCHANGE,
        BOARD_ALLOCATION
    }

    /// @notice A draw's state. Requested until a signer decides it; Approved until a second
    /// signer releases it; Closed when the whole request was disputed (approved at zero).
    enum DrawStatus {
        None,
        Requested,
        Approved,
        Released,
        Closed
    }

    struct Draw {
        uint64 periodId;
        DrawStatus status;
        address approver;
        uint128 requested;
        uint128 approved;
        bytes32 evidenceHash;
    }

    struct Transfer {
        bytes32 from;
        bytes32 to;
        uint256 amount;
        bytes32 resolutionHash;
        address proposer;
        uint64 proposedAt;
        bool executed;
    }

    /* ========== INFLOWS ========== */

    /// @notice the one way value enters a compartment.
    function deposit(SourceTag sourceTag, uint256 amount) external;

    /* ========== VIEWS ========== */

    function backstopFloor() external view returns (uint256);
    function backstopBalance() external view returns (uint256);
    function availableCoverage() external view returns (uint256);
    function coveredBookPrincipal() external view returns (uint256);
    function balanceOf(bytes32 compartment) external view returns (uint256);
    function totalAccounted() external view returns (uint256);

    /* ========== EVENTS (13g) ========== */

    event CompartmentCredited(SourceTag indexed sourceTag, bytes32 indexed compartment, uint256 amount);
    event FloorInputsSet(
        uint256 timingBufferShortfall,
        uint256 coverageCap,
        uint256 attestedCoveredBook,
        bytes32 indexed evidenceHash,
        address proposer,
        address approver
    );
    event AllocationSet(uint256 indexed programYear, bytes32[] compartments, uint16[] bps);
    event DrawRequested(uint256 indexed drawId, uint256 indexed periodId, uint256 amount, bytes32 evidenceHash);
    event DrawApproved(uint256 indexed drawId, uint256 approvedAmount, address indexed approver);
    event DrawReleased(uint256 indexed drawId, uint256 amount, address indexed to, address indexed releaser);
    event AssuranceReleased(
        bytes32 indexed grantId, uint256 amount, bytes32 evidenceHash, address indexed to, address approver
    );
    event TransferProposed(
        uint256 indexed transferId,
        bytes32 indexed from,
        bytes32 indexed to,
        uint256 amount,
        bytes32 resolutionHash,
        address proposer
    );
    event TransferExecuted(
        uint256 indexed transferId, bytes32 indexed from, bytes32 indexed to, uint256 amount, address executor
    );
}
