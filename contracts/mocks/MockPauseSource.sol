// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @dev Test stand-in for CLRUSD's and the vault's pause clocks (Phase 2g, 10c), with the view
/// signatures `audit/phase-2g-delisting-legacy` fixes. One global pause and per-account pauses, each
/// counted while in force. Tests do not overlap them.
contract MockPauseSource {
    uint256 public globalTotal;
    uint64 public globalSince;
    mapping(address => uint256) public accountTotal;
    mapping(address => uint64) public accountSince;

    function pauseAll() external {
        if (globalSince == 0) globalSince = uint64(block.timestamp);
    }

    function unpauseAll() external {
        if (globalSince != 0) {
            globalTotal += block.timestamp - globalSince;
            globalSince = 0;
        }
    }

    function pauseAccount(address account) external {
        if (accountSince[account] == 0) accountSince[account] = uint64(block.timestamp);
    }

    function unpauseAccount(address account) external {
        uint64 since = accountSince[account];
        if (since != 0) {
            accountTotal[account] += block.timestamp - since;
            accountSince[account] = 0;
        }
    }

    function _global() private view returns (uint256) {
        return globalTotal + (globalSince != 0 ? block.timestamp - globalSince : 0);
    }

    // CLRUSD shape
    function pauseClock(address account) external view returns (uint256) {
        uint64 since = accountSince[account];
        return _global() + accountTotal[account] + (since != 0 ? block.timestamp - since : 0);
    }

    function isPauseInForce(address account) external view returns (bool) {
        return globalSince != 0 || accountSince[account] != 0;
    }

    // vault shape
    function pauseClock() external view returns (uint256) {
        return _global();
    }

    function isPauseInForce() external view returns (bool) {
        return globalSince != 0;
    }
}
