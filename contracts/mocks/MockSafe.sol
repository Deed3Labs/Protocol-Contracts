// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @dev Test stand-in for a Safe: reports its owners and threshold, and forwards a call once
///      `threshold` distinct owners have confirmed the same call. Used by the vault timelock
///      handover tests to show a Clear Financial Safe needs two people to act.
contract MockSafe {
    address[] private s_owners;
    uint256 private s_threshold;
    mapping(address => bool) public isOwner;
    mapping(bytes32 => mapping(address => bool)) public confirmed;
    mapping(bytes32 => uint256) public confirmations;

    constructor(address[] memory owners_, uint256 threshold_) {
        require(threshold_ > 0 && threshold_ <= owners_.length, "MockSafe: threshold");
        for (uint256 i = 0; i < owners_.length; i++) isOwner[owners_[i]] = true;
        s_owners = owners_;
        s_threshold = threshold_;
    }

    function getOwners() external view returns (address[] memory) {
        return s_owners;
    }

    function getThreshold() external view returns (uint256) {
        return s_threshold;
    }

    /// @notice an owner confirms `target.call(data)`; the confirmation that reaches the threshold runs it.
    function confirmAndExecute(address target, bytes calldata data) external returns (bool ran) {
        require(isOwner[msg.sender], "MockSafe: not owner");
        bytes32 id = keccak256(abi.encode(target, data));
        require(!confirmed[id][msg.sender], "MockSafe: already confirmed");
        confirmed[id][msg.sender] = true;
        if (++confirmations[id] < s_threshold) return false;
        confirmations[id] = 0;
        for (uint256 i = 0; i < s_owners.length; i++) confirmed[id][s_owners[i]] = false;
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return true;
    }
}
