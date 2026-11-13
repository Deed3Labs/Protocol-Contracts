// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./SavingsIntentEscrow.sol";

/// @title SavingsIntentFactory
/// @notice Predicts deterministic escrow addresses so users can fund them in one transaction,
///         then lets a sponsored settler deploy and finalize the escrow later.
/// @dev **The address commits to the whole config (audit H-4).** The clone salt used to be the
///      caller's salt alone, so the address a member funded said nothing about what it would do:
///      the settler chose `receiver`, `vault` and `depositor` when it settled, and `finalize`
///      approved that vault. The clone salt is now `keccak256(abi.encode(userSalt, config))`, so a
///      member who funds `predictIntentAddress(userSalt, config)` has fixed every field of `config`
///      -- any other config deploys somewhere else, where none of their money is.
contract SavingsIntentFactory is AccessControl {
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    address public immutable escrowImplementation;

    struct IntentConfig {
        address depositor;
        address receiver;
        address transferToken;
        address vaultToken;
        address vault;
        uint256 amount;
        uint64 expiry;
        uint8 action;
    }

    error SavingsIntentFactoryInvalidAddress();

    event IntentCreated(bytes32 indexed salt, address indexed escrow, address indexed depositor, uint8 action, uint256 amount);
    event IntentSettled(bytes32 indexed salt, address indexed escrow, uint256 resultAmount);
    event IntentRefunded(bytes32 indexed salt, address indexed escrow, uint256 refundedAmount);

    constructor(address admin) {
        if (admin == address(0)) revert SavingsIntentFactoryInvalidAddress();

        escrowImplementation = address(new SavingsIntentEscrow());

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CREATOR_ROLE, admin);
        _grantRole(SETTLER_ROLE, admin);
    }

    /// @notice The clone salt for an intent: the caller's salt bound to the full config.
    function intentSalt(bytes32 userSalt, IntentConfig calldata config) public pure returns (bytes32) {
        return keccak256(abi.encode(userSalt, config));
    }

    /// @notice The escrow address for `config` under `userSalt`. Funding this address commits the
    ///         funder to exactly this config.
    function predictIntentAddress(bytes32 userSalt, IntentConfig calldata config) public view returns (address) {
        return Clones.predictDeterministicAddress(escrowImplementation, intentSalt(userSalt, config), address(this));
    }

    function createIntentDeterministic(bytes32 salt, IntentConfig calldata config)
        external
        onlyRole(CREATOR_ROLE)
        returns (address escrow)
    {
        escrow = _provisionIntent(salt, config);
    }

    function settleDeterministic(bytes32 salt, IntentConfig calldata config)
        external
        onlyRole(SETTLER_ROLE)
        returns (address escrow, uint256 resultAmount)
    {
        escrow = _provisionIntent(salt, config);
        resultAmount = SavingsIntentEscrow(payable(escrow)).finalize();

        emit IntentSettled(salt, escrow, resultAmount);
    }

    function refundDeterministic(bytes32 salt, IntentConfig calldata config)
        external
        onlyRole(SETTLER_ROLE)
        returns (address escrow, uint256 refundedAmount)
    {
        escrow = _provisionIntent(salt, config);
        refundedAmount = SavingsIntentEscrow(payable(escrow)).refund();

        emit IntentRefunded(salt, escrow, refundedAmount);
    }

    function _provisionIntent(bytes32 salt, IntentConfig calldata config) internal returns (address escrow) {
        bytes32 cloneSalt = intentSalt(salt, config);
        escrow = Clones.predictDeterministicAddress(escrowImplementation, cloneSalt, address(this));

        if (escrow.code.length == 0) {
            escrow = Clones.cloneDeterministic(escrowImplementation, cloneSalt);
            SavingsIntentEscrow(payable(escrow)).initialize(
                address(this),
                config.depositor,
                config.receiver,
                config.transferToken,
                config.vaultToken,
                config.vault,
                config.amount,
                config.expiry,
                config.action
            );

            emit IntentCreated(salt, escrow, config.depositor, config.action, config.amount);
            return escrow;
        }

        // Defence in depth: the salt already pins the config, but an escrow that exists must still
        // agree with it field by field.
        _assertConfigMatches(escrow, config);
    }


    function _assertConfigMatches(address escrow, IntentConfig calldata config) internal view {
        SavingsIntentEscrow intent = SavingsIntentEscrow(payable(escrow));

        require(intent.factory() == address(this), "SavingsIntentFactory: factory mismatch");
        require(intent.depositor() == config.depositor, "SavingsIntentFactory: depositor mismatch");
        require(intent.receiver() == config.receiver, "SavingsIntentFactory: receiver mismatch");
        require(intent.transferToken() == config.transferToken, "SavingsIntentFactory: transfer token mismatch");
        require(intent.vaultToken() == config.vaultToken, "SavingsIntentFactory: vault token mismatch");
        require(intent.vault() == config.vault, "SavingsIntentFactory: vault mismatch");
        require(intent.amount() == config.amount, "SavingsIntentFactory: amount mismatch");
        require(intent.expiry() == config.expiry, "SavingsIntentFactory: expiry mismatch");
        require(uint8(intent.action()) == config.action, "SavingsIntentFactory: action mismatch");
    }
}
