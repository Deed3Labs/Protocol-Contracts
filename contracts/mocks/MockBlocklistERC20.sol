// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./MockERC20.sol";

/// @title MockBlocklistERC20
/// @notice Test-only token that refuses transfers to blocked addresses, as USDC does for a
/// blacklisted account, so the Yield Pool's deferred-payment path can be exercised.
contract MockBlocklistERC20 is MockERC20 {
    mapping(address => bool) public blocked;

    constructor(string memory name, string memory symbol, uint8 decimals_) MockERC20(name, symbol, decimals_) {}

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function _beforeTokenTransfer(address, address to, uint256) internal view override {
        require(!blocked[to], "blocked");
    }
}
