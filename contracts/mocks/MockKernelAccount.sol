// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

interface IMockKernelValidator {
    function onInstall(bytes calldata data) external payable;
    function ecdsaValidatorStorage(address account) external view returns (address owner);
}

interface IMockKernelModule {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
}

/// @title MockKernelAccount
/// @notice Test only. The parts of a ZeroDev Kernel v3.3 account (github.com/zerodevapp/kernel, tag
/// v3.3, `src/Kernel.sol`) that the Legacy Contact module meets, with the same signatures and rules:
///  - `installModule`, `uninstallModule` and `execute` pass only for the EntryPoint, the account
///    itself, or the root ECDSA validator's owner calling directly (`onlyEntryPointOrSelfOrRoot`,
///    whose root-validator hook checks `msgSender == owner`);
///  - an executor is installed with `hook (20 bytes) ++ abi.encode(executorData, hookData)` and its
///    `onInstall(executorData)` is called; uninstalling calls `onUninstall` and ignores a failure
///    (`ModuleLib.uninstallModule`);
///  - `executeFromExecutor` reverts `InvalidExecutor()` unless the caller is an installed executor,
///    and runs a single call `abi.encodePacked(target, value, callData)` in mode 0x00…00;
///  - `rootValidator()` is 0x01 followed by the validator's address.
/// Batch, delegatecall and try modes, hooks, the 4337 path and signatures are left out.
contract MockKernelAccount {
    address public immutable entrypoint;
    bytes21 public rootValidator;
    mapping(address => bool) private _executor;

    error InvalidCaller();
    error InvalidExecutor();
    error InvalidModuleType();
    error Unsupported();

    event ModuleInstalled(uint256 moduleTypeId, address module);
    event ModuleUninstalled(uint256 moduleTypeId, address module);

    constructor(address entrypoint_, address ecdsaValidator, address owner_) {
        entrypoint = entrypoint_;
        rootValidator = bytes21(abi.encodePacked(bytes1(0x01), ecdsaValidator));
        IMockKernelValidator(ecdsaValidator).onInstall(abi.encodePacked(owner_));
    }

    modifier onlyEntryPointOrSelfOrRoot() {
        if (msg.sender != entrypoint && msg.sender != address(this) && msg.sender != owner()) revert InvalidCaller();
        _;
    }

    /// @notice the root ECDSA validator's owner for this account.
    function owner() public view returns (address) {
        return IMockKernelValidator(address(bytes20(rootValidator << 8))).ecdsaValidatorStorage(address(this));
    }

    function execute(bytes32 execMode, bytes calldata executionCalldata) external payable onlyEntryPointOrSelfOrRoot {
        _execute(execMode, executionCalldata);
    }

    function executeFromExecutor(bytes32 execMode, bytes calldata executionCalldata)
        external
        payable
        returns (bytes[] memory returnData)
    {
        if (!_executor[msg.sender]) revert InvalidExecutor();
        returnData = new bytes[](1);
        returnData[0] = _execute(execMode, executionCalldata);
    }

    function installModule(uint256 moduleType, address module, bytes calldata initData)
        external
        payable
        onlyEntryPointOrSelfOrRoot
    {
        if (moduleType != 2) revert InvalidModuleType();
        (bytes memory executorData,) = abi.decode(initData[20:], (bytes, bytes));
        _executor[module] = true;
        IMockKernelModule(module).onInstall(executorData);
        emit ModuleInstalled(moduleType, module);
    }

    function uninstallModule(uint256 moduleType, address module, bytes calldata deInitData)
        external
        payable
        onlyEntryPointOrSelfOrRoot
    {
        if (moduleType != 2) revert InvalidModuleType();
        _executor[module] = false;
        (bool ok,) = module.call(abi.encodeCall(IMockKernelModule.onUninstall, (deInitData)));
        ok;
        emit ModuleUninstalled(moduleType, module);
    }

    function isModuleInstalled(uint256 moduleType, address module, bytes calldata) external view returns (bool) {
        return moduleType == 2 && _executor[module];
    }

    function _execute(bytes32 execMode, bytes calldata executionCalldata) private returns (bytes memory result) {
        if (execMode != bytes32(0)) revert Unsupported();
        address target = address(bytes20(executionCalldata[0:20]));
        uint256 value = uint256(bytes32(executionCalldata[20:52]));
        bool ok;
        (ok, result) = target.call{value: value}(executionCalldata[52:]);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    receive() external payable {}
}
