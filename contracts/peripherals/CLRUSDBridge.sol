// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface ICLRUSDBridgeToken {
    function mint(address account, uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}

/// @title CLRUSDBridge
/// @notice Non-CCIP bridge adapter for CLRUSD using threshold signatures from trusted relayer signers.
/// @dev Chain agnostic by mapping remote chain IDs to remote bridge + token addresses.
contract CLRUSDBridge is AccessControl, Pausable {
    using ECDSA for bytes32;

    bytes32 public constant RELAYER_SIGNER_ROLE = keccak256("RELAYER_SIGNER_ROLE");

    struct RemoteChainConfig {
        address remoteBridge;
        address remoteToken;
        bool enabled;
    }

    struct BridgeMessage {
        uint256 srcChainId;
        uint256 dstChainId;
        address srcBridge;
        address srcToken;
        address recipient;
        uint256 amount;
        uint256 nonce;
    }

    address public immutable clrusd;
    uint256 public outboundNonce;
    uint256 public signerThreshold;
    uint256 public signerCount;

    mapping(uint256 => RemoteChainConfig) public remoteChainConfig;
    mapping(bytes32 => bool) public processedMessages;

    event RemoteChainConfigured(
        uint256 indexed chainId,
        address indexed remoteBridge,
        address indexed remoteToken,
        bool enabled
    );
    event SignerThresholdUpdated(uint256 threshold);
    event BridgeOutInitiated(
        bytes32 indexed messageId,
        uint256 indexed srcChainId,
        uint256 indexed dstChainId,
        address sender,
        address recipient,
        uint256 amount,
        uint256 nonce
    );
    event BridgeInFinalized(
        bytes32 indexed messageId,
        uint256 indexed srcChainId,
        address indexed recipient,
        uint256 amount,
        uint256 nonce
    );

    error CLRUSDBridgeInvalidAddress();
    error CLRUSDBridgeInvalidAmount();
    error CLRUSDBridgeInvalidChain();
    error CLRUSDBridgeRemoteChainDisabled();
    error CLRUSDBridgeRemoteBridgeMismatch();
    error CLRUSDBridgeRemoteTokenMismatch();
    error CLRUSDBridgeInvalidThreshold();
    error CLRUSDBridgeInvalidSignatureCount();
    error CLRUSDBridgeSignerNotAuthorized();
    error CLRUSDBridgeDuplicateSigner();
    error CLRUSDBridgeNotEnoughUniqueSigners();
    error CLRUSDBridgeMessageAlreadyProcessed();

    constructor(
        address clrusd_,
        address admin,
        address[] memory initialSigners,
        uint256 threshold
    ) {
        if (clrusd_ == address(0) || admin == address(0)) revert CLRUSDBridgeInvalidAddress();
        if (threshold == 0 || threshold > initialSigners.length) revert CLRUSDBridgeInvalidThreshold();

        clrusd = clrusd_;
        signerThreshold = threshold;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        for (uint256 i = 0; i < initialSigners.length; i++) {
            if (initialSigners[i] == address(0)) revert CLRUSDBridgeInvalidAddress();
            if (hasRole(RELAYER_SIGNER_ROLE, initialSigners[i])) continue;
            _grantRole(RELAYER_SIGNER_ROLE, initialSigners[i]);
            signerCount++;
        }
    }

    function setRemoteChainConfig(
        uint256 chainId,
        address remoteBridge,
        address remoteToken,
        bool enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (chainId == 0) revert CLRUSDBridgeInvalidChain();
        if (enabled && (remoteBridge == address(0) || remoteToken == address(0))) {
            revert CLRUSDBridgeInvalidAddress();
        }

        remoteChainConfig[chainId] = RemoteChainConfig({
            remoteBridge: remoteBridge,
            remoteToken: remoteToken,
            enabled: enabled
        });

        emit RemoteChainConfigured(chainId, remoteBridge, remoteToken, enabled);
    }

    function setSignerThreshold(uint256 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (threshold == 0 || threshold > signerCount) revert CLRUSDBridgeInvalidThreshold();
        signerThreshold = threshold;
        emit SignerThresholdUpdated(threshold);
    }

    function grantRole(bytes32 role, address account) public virtual override onlyRole(getRoleAdmin(role)) {
        bool alreadyHasRole = hasRole(role, account);
        super.grantRole(role, account);
        if (!alreadyHasRole && role == RELAYER_SIGNER_ROLE) {
            signerCount++;
        }
    }

    function revokeRole(bytes32 role, address account) public virtual override onlyRole(getRoleAdmin(role)) {
        bool hadRole = hasRole(role, account);
        super.revokeRole(role, account);
        if (hadRole && role == RELAYER_SIGNER_ROLE) {
            if (signerCount == 0) revert CLRUSDBridgeInvalidThreshold();
            signerCount--;
            if (signerThreshold > signerCount) revert CLRUSDBridgeInvalidThreshold();
        }
    }

    function renounceRole(bytes32 role, address account) public virtual override {
        bool hadRole = hasRole(role, account);
        super.renounceRole(role, account);
        if (hadRole && role == RELAYER_SIGNER_ROLE) {
            if (signerCount == 0) revert CLRUSDBridgeInvalidThreshold();
            signerCount--;
            if (signerThreshold > signerCount) revert CLRUSDBridgeInvalidThreshold();
        }
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function bridgeOut(
        uint256 dstChainId,
        address recipient,
        uint256 amount
    ) external whenNotPaused returns (bytes32 messageId) {
        if (recipient == address(0)) revert CLRUSDBridgeInvalidAddress();
        if (amount == 0) revert CLRUSDBridgeInvalidAmount();

        RemoteChainConfig memory cfg = remoteChainConfig[dstChainId];
        if (!cfg.enabled) revert CLRUSDBridgeRemoteChainDisabled();

        ICLRUSDBridgeToken(clrusd).burnFrom(msg.sender, amount);

        uint256 nonce = ++outboundNonce;
        BridgeMessage memory message = BridgeMessage({
            srcChainId: block.chainid,
            dstChainId: dstChainId,
            srcBridge: address(this),
            srcToken: clrusd,
            recipient: recipient,
            amount: amount,
            nonce: nonce
        });

        messageId = hashMessage(message);
        emit BridgeOutInitiated(
            messageId,
            message.srcChainId,
            message.dstChainId,
            msg.sender,
            recipient,
            amount,
            nonce
        );
    }

    function bridgeIn(
        BridgeMessage calldata message,
        bytes[] calldata signatures
    ) external whenNotPaused returns (bytes32 messageId) {
        if (message.dstChainId != block.chainid) revert CLRUSDBridgeInvalidChain();
        if (message.recipient == address(0)) revert CLRUSDBridgeInvalidAddress();
        if (message.amount == 0) revert CLRUSDBridgeInvalidAmount();

        RemoteChainConfig memory cfg = remoteChainConfig[message.srcChainId];
        if (!cfg.enabled) revert CLRUSDBridgeRemoteChainDisabled();
        if (cfg.remoteBridge != message.srcBridge) revert CLRUSDBridgeRemoteBridgeMismatch();
        if (cfg.remoteToken != message.srcToken) revert CLRUSDBridgeRemoteTokenMismatch();

        messageId = hashMessage(message);
        if (processedMessages[messageId]) revert CLRUSDBridgeMessageAlreadyProcessed();

        _validateSignatures(messageId, signatures);
        processedMessages[messageId] = true;

        ICLRUSDBridgeToken(clrusd).mint(message.recipient, message.amount);
        emit BridgeInFinalized(
            messageId,
            message.srcChainId,
            message.recipient,
            message.amount,
            message.nonce
        );
    }

    function hashMessage(BridgeMessage memory message) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                message.srcChainId,
                message.dstChainId,
                message.srcBridge,
                message.srcToken,
                message.recipient,
                message.amount,
                message.nonce
            )
        );
    }

    function toEthSignedMessageHash(bytes32 messageId) public pure returns (bytes32) {
        return ECDSA.toEthSignedMessageHash(messageId);
    }

    function _validateSignatures(bytes32 messageId, bytes[] calldata signatures) internal view {
        if (signatures.length < signerThreshold) revert CLRUSDBridgeInvalidSignatureCount();

        bytes32 digest = ECDSA.toEthSignedMessageHash(messageId);
        address[] memory seen = new address[](signatures.length);
        uint256 uniqueSignerCount;

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            if (!hasRole(RELAYER_SIGNER_ROLE, signer)) revert CLRUSDBridgeSignerNotAuthorized();

            for (uint256 j = 0; j < uniqueSignerCount; j++) {
                if (seen[j] == signer) revert CLRUSDBridgeDuplicateSigner();
            }

            seen[uniqueSignerCount] = signer;
            uniqueSignerCount++;
        }

        if (uniqueSignerCount < signerThreshold) revert CLRUSDBridgeNotEnoughUniqueSigners();
    }

}
