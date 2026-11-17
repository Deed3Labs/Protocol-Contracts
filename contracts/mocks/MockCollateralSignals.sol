// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title MockCollateralSignals
/// @notice Test-only stand-in for the CollateralRegistry (encumbrance) and a credit issuer
///         (default status), with a switch that makes every encumbrance read revert, so the
///         fail-closed paths (audit M-3) and the bounded bond seizure (audit M-6) can be exercised.
contract MockCollateralSignals {
    mapping(address => uint256) public lockOf;
    mapping(address => mapping(uint256 => bool)) public itemEncumbered;
    mapping(address => bool) public defaulted;
    bool public broken;

    function setLock(address holder, uint256 amount) external {
        lockOf[holder] = amount;
    }

    function setItemEncumbered(address holder, uint256 itemId, bool encumbered) external {
        itemEncumbered[holder][itemId] = encumbered;
    }

    function setInDefault(address member, bool value) external {
        defaulted[member] = value;
    }

    function setBroken(bool value) external {
        broken = value;
    }

    function encumberedOf(address holder) external view returns (uint256) {
        require(!broken, "source broken");
        return lockOf[holder];
    }

    function encumberedOfKind(address holder, bytes32) external view returns (uint256) {
        require(!broken, "source broken");
        return lockOf[holder];
    }

    function isItemEncumbered(address holder, bytes32, uint256 itemId) external view returns (bool) {
        require(!broken, "source broken");
        return itemEncumbered[holder][itemId];
    }

    /// @dev Pledged whether or not anything is drawn (Phase 2e). An encumbered item is pledged too.
    mapping(address => mapping(uint256 => bool)) public itemPledged;

    function setItemPledged(address holder, uint256 itemId, bool pledged) external {
        itemPledged[holder][itemId] = pledged;
    }

    function isItemPledged(address holder, bytes32, uint256 itemId) external view returns (bool) {
        require(!broken, "source broken");
        return itemPledged[holder][itemId] || itemEncumbered[holder][itemId];
    }

    function releaseRetiredItem(address holder, bytes32, uint256 itemId) external {
        itemPledged[holder][itemId] = false;
        itemEncumbered[holder][itemId] = false;
    }

    function rollItem(address, bytes32, uint256, uint256) external {}

    function inDefault(address member) external view returns (bool) {
        return defaulted[member];
    }
}
