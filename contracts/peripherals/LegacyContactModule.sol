// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/*
 * Minimal local interfaces, checked against ZeroDev's sources rather than imported from them:
 *  - Kernel v3.3 (github.com/zerodevapp/kernel, tag v3.3, commit cd697c7e; the member app's
 *    KERNEL_V3_3) and v3.1 (tag v3.1, commit 03f7f5cf), `src/Kernel.sol`,
 *    `src/core/ValidationManager.sol` and `src/interfaces/IERC7579Account.sol`:
 *      function executeFromExecutor(ExecMode execMode, bytes calldata executionCalldata)
 *          external payable returns (bytes[] memory returnData);       // ExecMode is bytes32
 *      function isModuleInstalled(uint256 moduleType, address module, bytes calldata additionalContext)
 *          external view returns (bool);
 *      function rootValidator() external view returns (ValidationId);  // ValidationId is bytes21
 *    `executeFromExecutor` reverts `InvalidExecutor()` unless the caller is an installed executor.
 *    A single call is encoded as `abi.encodePacked(target, value, callData)` (`ExecLib.decodeSingle`),
 *    under mode 0x00…00 (CALLTYPE_SINGLE 0x00, EXECTYPE_DEFAULT 0x00: revert on failure). A
 *    validator's ValidationId is 0x01 followed by its address (`ValidatorLib.validatorToIdentifier`).
 *  - The ECDSA validator Kernel v3.1 to v3.3 use (0x845ADb2C711129d4f3966735eD98a9F09fC4cE57 per
 *    `@zerodev/ecdsa-validator` 5.4.9 `constants.ts`; source `src/validator/ECDSAValidator.sol` at
 *    both tags):
 *      mapping(address => ECDSAValidatorStorage) public ecdsaValidatorStorage; // { address owner }
 *      function onInstall(bytes calldata _data) external payable {
 *          address owner = address(bytes20(_data[0:20]));
 *          ecdsaValidatorStorage[msg.sender].owner = owner;
 *          emit OwnerRegistered(msg.sender, owner);
 *      }
 *    It has no other owner setter. Called by the account itself, `onInstall` rewrites only that
 *    account's owner; the account's own module records (its validators, executors, hooks) are not
 *    touched. That is the one call this module can make. The v3.0 validator (0x8104e3…) refuses a
 *    second `onInstall` (`AlreadyInitialized`), so on a v3.0 account recovery reverts.
 */

/// @dev The three Kernel account functions this module uses.
interface IKernelAccount {
    function executeFromExecutor(bytes32 execMode, bytes calldata executionCalldata)
        external
        payable
        returns (bytes[] memory returnData);

    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata additionalContext)
        external
        view
        returns (bool);

    function rootValidator() external view returns (bytes21);
}

/// @dev The two ECDSA validator functions this module uses.
interface IKernelECDSAValidator {
    function onInstall(bytes calldata data) external payable;

    function ecdsaValidatorStorage(address account) external view returns (address owner);
}

/// @title LegacyContactModule
/// @notice Compliance spec 10f: an optional recovery module for a member's Kernel smart account. The
/// member names one or more Legacy Contacts and a waiting period. A contact may open a recovery
/// request; the member can cancel it at any time during the wait; after the full wait, with no
/// cancellation, that contact can make the account rotate the owner of its root ECDSA validator to a
/// key the contact named. Nothing else.
/// @dev An ERC-7579 executor (module type 2), one deployment shared by every account; all state is
/// keyed by the account.
///
/// **The member alone controls it.** The account installs it (`installModule`, which Kernel lets only
/// the EntryPoint, the account itself or its root key call), configures it and uninstalls it. Every
/// setter here acts on `msg.sender`'s own record, so the only way to change a member's set-up is a
/// call from the member's account, signed by the member.
///
/// **No admin.** No owner, role, upgrade, pause or setter outside the account's own calls. The Clear
/// addresses that may never be a contact (or the key a recovery hands the account to) are a fixed
/// list given at deployment (Phase 2g decision 11): reading roles from AccessManager was rejected,
/// because a Clear admin could then interfere with recovery.
///
/// **One call, structurally.** `recover` takes no calldata from anyone. It builds the single call
/// `ECDSA_VALIDATOR.onInstall(abi.encodePacked(newOwner))` itself, with a value of zero, in single
/// mode, and sends it through `executeFromExecutor`. The target is an immutable, the selector a
/// constant, and the only variable is the 20-byte key the contact named when opening the request,
/// which is never a Clear address or zero. So the module can never transfer, approve, mint, redeem,
/// pledge or burn anything, install or uninstall a module, or touch the Pledge Module, a pledge lock,
/// the Liquidation Hold or any pause: none of those is reachable from that call, and all of them
/// keep applying to the account after a rotation.
///
/// Not deployed and not shown in the app until externally audited and published in MB-03 Schedule 2
/// (Phase 2g decision 13).
contract LegacyContactModule {
    uint256 public constant MODULE_TYPE_EXECUTOR = 2;
    /// @notice The shortest waiting period a member may set (10f).
    uint64 public constant MIN_WAIT = 30 days;
    /// @notice The waiting period when the member names none (10f).
    uint64 public constant DEFAULT_WAIT = 90 days;
    /// @notice A bound on the contact list, to keep every loop over it small.
    uint256 public constant MAX_CONTACTS = 10;
    /// @dev Kernel's single-call, revert-on-failure execution mode.
    bytes32 private constant EXEC_MODE_SINGLE = bytes32(0);
    /// @dev Kernel's validation type for a plain validator (VALIDATION_TYPE_VALIDATOR).
    bytes1 private constant VALIDATION_TYPE_VALIDATOR = 0x01;

    /// @notice The ECDSA validator whose owner a recovery rotates. Fixed at deployment.
    address public immutable ECDSA_VALIDATOR;

    /// @dev The Clear addresses that may never be a contact or a recovered owner. Written only by the
    /// constructor.
    mapping(address => bool) private _clear;

    struct Config {
        uint64 wait;
        bool initialized;
    }

    /// @notice An open recovery request: who opened it, the key it names, when, and the wait then.
    struct Request {
        address contact;
        uint64 openedAt;
        address newOwner;
        uint64 wait;
    }

    mapping(address => Config) private _config;
    mapping(address => address[]) private _contacts;
    mapping(address => Request) private _request;

    error LegacyContactNotInitialized(address account);
    error LegacyContactWaitTooShort(uint64 wait);
    error LegacyContactInvalidContacts();
    /// @notice thrown when a contact, or a key a recovery would hand the account to, is a Clear
    /// address.
    error LegacyContactClearAddress(address account);
    error LegacyContactNotContact(address caller);
    error LegacyContactNotInstalled(address account);
    error LegacyContactRequestOpen(address account);
    error LegacyContactNoRequest(address account);
    error LegacyContactInvalidOwner(address newOwner);
    /// @notice thrown before the full wait has passed: `executableAt` is the first second it may run.
    error LegacyContactWaitNotOver(uint256 executableAt);
    /// @notice thrown when the account's root validator is not the ECDSA validator this module rotates.
    error LegacyContactRootNotECDSA(address account);
    error LegacyContactRotationFailed(address account);

    event LegacyContactConfigured(address indexed account, address[] contacts, uint64 wait);
    event LegacyContactUninstalled(address indexed account);
    /// @notice A contact opened a recovery request. The app notifies the member at once, on every
    /// channel, so the member can cancel before `executableAt`.
    event RecoveryRequested(address indexed account, address indexed contact, address newOwner, uint256 executableAt);
    event RecoveryCancelled(address indexed account, address indexed contact, address newOwner);
    event OwnerRotated(address indexed account, address indexed contact, address previousOwner, address newOwner);

    /// @param ecdsaValidator the ECDSA validator Kernel accounts use as their root validator.
    /// @param clearAddresses every Clear entity address, fixed here for good.
    constructor(address ecdsaValidator, address[] memory clearAddresses) {
        if (ecdsaValidator == address(0)) revert LegacyContactInvalidOwner(address(0));
        ECDSA_VALIDATOR = ecdsaValidator;
        for (uint256 i; i < clearAddresses.length; i++) {
            _clear[clearAddresses[i]] = true;
        }
    }

    /* ========== ERC-7579 module ========== */

    /// @notice called by the account when the member installs the module.
    /// @param data `abi.encode(address[] contacts, uint64 wait)`; a wait of zero means DEFAULT_WAIT.
    function onInstall(bytes calldata data) external {
        (address[] memory contacts, uint64 wait) = abi.decode(data, (address[], uint64));
        _cancel(msg.sender);
        _config[msg.sender].initialized = true;
        _setContacts(msg.sender, contacts);
        _setWait(msg.sender, wait);
        _announce(msg.sender);
    }

    /// @notice called by the account when the member uninstalls the module. Clears everything,
    /// including an open request.
    function onUninstall(bytes calldata) external {
        delete _config[msg.sender];
        delete _contacts[msg.sender];
        delete _request[msg.sender];
        emit LegacyContactUninstalled(msg.sender);
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    function isInitialized(address account) external view returns (bool) {
        return _config[account].initialized;
    }

    /* ========== The member, through the account ========== */

    /// @notice replaces the calling account's contacts. Any open request is cancelled.
    function setContacts(address[] calldata contacts) external {
        _requireInitialized(msg.sender);
        _cancel(msg.sender);
        _setContacts(msg.sender, contacts);
        _announce(msg.sender);
    }

    /// @notice sets the calling account's waiting period: zero means DEFAULT_WAIT, under MIN_WAIT
    /// reverts. Any open request is cancelled.
    function setWait(uint64 wait) external {
        _requireInitialized(msg.sender);
        _cancel(msg.sender);
        _setWait(msg.sender, wait);
        _announce(msg.sender);
    }

    /// @notice cancels the calling account's open recovery request: the member's one signature.
    function cancelRecovery() external {
        if (_request[msg.sender].contact == address(0)) revert LegacyContactNoRequest(msg.sender);
        _cancel(msg.sender);
    }

    /* ========== A contact ========== */

    /// @notice opens a recovery request for `account`, naming the key it should be handed to.
    /// @dev Only one request is open at a time. It starts the member's full waiting period.
    function requestRecovery(address account, address newOwner) external {
        _requireContact(account, msg.sender);
        if (_request[account].contact != address(0)) revert LegacyContactRequestOpen(account);
        if (newOwner == address(0) || newOwner == account) revert LegacyContactInvalidOwner(newOwner);
        if (_clear[newOwner]) revert LegacyContactClearAddress(newOwner);
        if (!IKernelAccount(account).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(this), "")) {
            revert LegacyContactNotInstalled(account);
        }
        uint64 wait = _config[account].wait;
        _request[account] =
            Request({contact: msg.sender, openedAt: uint64(block.timestamp), newOwner: newOwner, wait: wait});
        emit RecoveryRequested(account, msg.sender, newOwner, block.timestamp + wait);
    }

    /// @notice after the full wait, with no cancellation, the contact who opened the request makes
    /// the account rotate its root ECDSA validator's owner to the key the request named. The one
    /// function a contact can call to act on an account.
    function recover(address account) external {
        Request memory r = _request[account];
        if (r.contact == address(0)) revert LegacyContactNoRequest(account);
        if (r.contact != msg.sender) revert LegacyContactNotContact(msg.sender);
        _requireContact(account, msg.sender);
        uint256 executableAt = uint256(r.openedAt) + r.wait;
        if (block.timestamp < executableAt) revert LegacyContactWaitNotOver(executableAt);
        if (IKernelAccount(account).rootValidator() != bytes21(abi.encodePacked(VALIDATION_TYPE_VALIDATOR, ECDSA_VALIDATOR))) {
            revert LegacyContactRootNotECDSA(account);
        }
        delete _request[account];

        address previousOwner = IKernelECDSAValidator(ECDSA_VALIDATOR).ecdsaValidatorStorage(account);
        // The one call: built here, never taken from a caller.
        bytes memory call = abi.encodeCall(IKernelECDSAValidator.onInstall, (abi.encodePacked(r.newOwner)));
        bytes[] memory results =
            IKernelAccount(account).executeFromExecutor(EXEC_MODE_SINGLE, abi.encodePacked(ECDSA_VALIDATOR, uint256(0), call));
        // One call ran, and it left the named key as the owner.
        if (results.length != 1 || IKernelECDSAValidator(ECDSA_VALIDATOR).ecdsaValidatorStorage(account) != r.newOwner) {
            revert LegacyContactRotationFailed(account);
        }
        emit OwnerRotated(account, msg.sender, previousOwner, r.newOwner);
    }

    /* ========== Views ========== */

    /// @notice whether `addr` is on the fixed list of Clear addresses.
    function isClearAddress(address addr) external view returns (bool) {
        return _clear[addr];
    }

    function contactsOf(address account) external view returns (address[] memory) {
        return _contacts[account];
    }

    function waitOf(address account) external view returns (uint64) {
        return _config[account].wait;
    }

    function isContact(address account, address contact) public view returns (bool) {
        address[] storage list = _contacts[account];
        for (uint256 i; i < list.length; i++) {
            if (list[i] == contact) return true;
        }
        return false;
    }

    /// @notice the account's open request (zeros if none), and the first second it may run.
    function requestOf(address account) external view returns (Request memory request, uint256 executableAt) {
        request = _request[account];
        if (request.contact != address(0)) executableAt = uint256(request.openedAt) + request.wait;
    }

    /* ========== Internal ========== */

    function _setContacts(address account, address[] memory contacts) private {
        if (contacts.length == 0 || contacts.length > MAX_CONTACTS) revert LegacyContactInvalidContacts();
        delete _contacts[account];
        address[] storage list = _contacts[account];
        for (uint256 i; i < contacts.length; i++) {
            address c = contacts[i];
            if (c == address(0) || c == account) revert LegacyContactInvalidContacts();
            if (_clear[c]) revert LegacyContactClearAddress(c);
            for (uint256 j; j < i; j++) {
                if (contacts[j] == c) revert LegacyContactInvalidContacts();
            }
            list.push(c);
        }
    }

    function _setWait(address account, uint64 wait) private {
        if (wait == 0) wait = DEFAULT_WAIT;
        if (wait < MIN_WAIT) revert LegacyContactWaitTooShort(wait);
        _config[account].wait = wait;
    }

    function _cancel(address account) private {
        Request memory r = _request[account];
        if (r.contact == address(0)) return;
        delete _request[account];
        emit RecoveryCancelled(account, r.contact, r.newOwner);
    }

    function _announce(address account) private {
        emit LegacyContactConfigured(account, _contacts[account], _config[account].wait);
    }

    function _requireInitialized(address account) private view {
        if (!_config[account].initialized) revert LegacyContactNotInitialized(account);
    }

    function _requireContact(address account, address caller) private view {
        if (!_config[account].initialized) revert LegacyContactNotInitialized(account);
        if (!isContact(account, caller)) revert LegacyContactNotContact(caller);
    }
}
