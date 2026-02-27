// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/utils/Create2.sol";

/// @title Create2Deployer
/// @notice Minimal CREATE2 helper for deterministic deployments.
contract Create2Deployer {
    event Deployed(address indexed addr, bytes32 indexed salt);

    error Create2DeployerEmptyBytecode();

    function deploy(bytes32 salt, bytes calldata creationCode) external payable returns (address addr) {
        if (creationCode.length == 0) revert Create2DeployerEmptyBytecode();
        addr = Create2.deploy(msg.value, salt, creationCode);
        emit Deployed(addr, salt);
    }

    function computeAddress(bytes32 salt, bytes32 creationCodeHash)
        external
        view
        returns (address)
    {
        return Create2.computeAddress(salt, creationCodeHash, address(this));
    }
}
