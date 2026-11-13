// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @dev Test double for ESADepositVault.lastDepositAt (section 12.4's deposit test).
contract MockDepositSource {
    mapping(address => uint256) public lastDepositAt;

    function deposit(address member) external {
        lastDepositAt[member] = block.timestamp;
    }
}
