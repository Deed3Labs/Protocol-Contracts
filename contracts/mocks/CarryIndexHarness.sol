// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../libraries/CarryIndex.sol";

/// @notice Test-only wrapper exposing CarryIndex over real storage.
/// @dev Positions are held exactly as an issuer would hold them: a normalized amount and the
/// cumulative principal drawn, with no accrued figure written anywhere.
contract CarryIndexHarness {
    using CarryIndex for CarryIndex.Index;

    struct Position {
        uint256 normalized;
        uint256 principalDrawn;
    }

    mapping(bytes32 => CarryIndex.Index) private indices;
    mapping(bytes32 => mapping(address => Position)) private positions;

    function initIndex(bytes32 key, uint256 ratePerCycle, uint64 cycleLength, uint64 startedAt)
        external
    {
        indices[key].init(ratePerCycle, cycleLength, startedAt);
    }

    function setRate(bytes32 key, uint256 newRatePerCycle, uint256 timestamp) external {
        indices[key].setRate(newRatePerCycle, timestamp);
    }

    function currentIndex(bytes32 key, uint256 timestamp) external view returns (uint256) {
        return indices[key].currentIndex(timestamp);
    }

    /// @notice draws against a tier. A zero amount is a real interaction that writes nothing,
    /// which is what "touching" a position means here.
    function draw(bytes32 key, address member, uint256 amount, uint256 timestamp) external {
        uint256 index = indices[key].currentIndex(timestamp);
        Position storage p = positions[key][member];
        p.normalized += CarryIndex.normalize(amount, index);
        p.principalDrawn += amount;
    }

    /// @notice re-derives the stored normalized amount from what is owed right now.
    /// @dev The rebasing that normalized accounting exists to avoid, kept so a test can show the
    /// difference rather than assert it.
    function rebase(bytes32 key, address member, uint256 timestamp) external {
        uint256 index = indices[key].currentIndex(timestamp);
        Position storage p = positions[key][member];
        p.normalized = CarryIndex.normalize(CarryIndex.denormalize(p.normalized, index), index);
    }

    function owed(bytes32 key, address member, uint256 timestamp) external view returns (uint256) {
        return CarryIndex.denormalize(
            positions[key][member].normalized, indices[key].currentIndex(timestamp)
        );
    }

    function accruedCarry(bytes32 key, address member, uint256 timestamp)
        external
        view
        returns (uint256)
    {
        Position storage p = positions[key][member];
        return CarryIndex.accruedCarry(
            p.normalized, indices[key].currentIndex(timestamp), p.principalDrawn
        );
    }

    function positionOf(bytes32 key, address member) external view returns (uint256, uint256) {
        Position storage p = positions[key][member];
        return (p.normalized, p.principalDrawn);
    }

    function RAY() external pure returns (uint256) { return CarryIndex.RAY; }
}
