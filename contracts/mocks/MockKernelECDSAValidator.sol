// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title MockKernelECDSAValidator
/// @notice Test only. The owner bookkeeping of ZeroDev's ECDSAValidator as Kernel v3.1 to v3.3 use it
/// (github.com/zerodevapp/kernel, tags v3.1 and v3.3, `src/validator/ECDSAValidator.sol`): `onInstall`
/// writes the calling account's owner without checking for an earlier one, `onUninstall` clears it,
/// and `ecdsaValidatorStorage` reads it. Signature checks are left out: the mock account checks the
/// owner as `msg.sender`, which is what Kernel's root-validator hook (`preCheck`) does for a direct
/// call.
contract MockKernelECDSAValidator {
    struct ECDSAValidatorStorage {
        address owner;
    }

    event OwnerRegistered(address indexed kernel, address indexed owner);

    error NotInitialized(address smartAccount);

    mapping(address => ECDSAValidatorStorage) public ecdsaValidatorStorage;

    function onInstall(bytes calldata _data) external payable {
        address owner = address(bytes20(_data[0:20]));
        ecdsaValidatorStorage[msg.sender].owner = owner;
        emit OwnerRegistered(msg.sender, owner);
    }

    function onUninstall(bytes calldata) external payable {
        if (ecdsaValidatorStorage[msg.sender].owner == address(0)) revert NotInitialized(msg.sender);
        delete ecdsaValidatorStorage[msg.sender];
    }

    function isModuleType(uint256 typeID) external pure returns (bool) {
        return typeID == 1 || typeID == 4;
    }
}
