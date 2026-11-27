// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import "./interfaces/IFunctionalContractRegistry.sol";

/**
 * @title FunctionalContractRegistry
 * @notice The Functional Contracts trust deeds may be deposited into under any transfer policy (trust
 *         agreement v5, item 9(c)): subdivision, fractionalizer, escrows, bridges and the Coop transfer agent.
 * @dev DECISIONS #8: additions go through the Foundation multisig plus the Deed timelock, so
 *      REGISTRAR_ROLE is granted only to the Deed TimelockController. Removals are immediate (REMOVER_ROLE,
 *      the Foundation multisig) but only block new deposits: a removed contract keeps its kinds, so a deed it
 *      already holds can still leave it and is still attributed to its depositor. Not upgradeable; a new
 *      registry needs a DeedNFT upgrade, which sits behind the same timelock.
 */
contract FunctionalContractRegistry is AccessControl, IFunctionalContractRegistry {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant REMOVER_ROLE = keccak256("REMOVER_ROLE");

    /// @notice Holds deeds for a depositor and implements IDeedCustody.
    uint8 public constant KIND_CUSTODY = 1;
    /// @notice A CoopTransferAgent: the only route by which a Coop-policy deed changes hands.
    uint8 public constant KIND_COOP_AGENT = 2;

    struct Entry {
        uint8 kinds;
        bool active;
    }

    mapping(address => Entry) private _entries;

    event FunctionalContractRegistered(address indexed fc, uint8 kinds);
    event FunctionalContractRemoved(address indexed fc);

    error NotAContract(address account);
    error InvalidKinds(uint8 kinds);
    error NotRegistered(address fc);

    /**
     * @param admin the Deed TimelockController: role admin and registrar.
     * @param remover the Foundation multisig, which may remove at once.
     */
    constructor(address admin, address remover) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
        _grantRole(REMOVER_ROLE, admin);
        if (remover != address(0)) _grantRole(REMOVER_ROLE, remover);
    }

    /// @notice Adds (or re-activates) a Functional Contract. Timelocked through REGISTRAR_ROLE.
    function register(address fc, uint8 kinds) external onlyRole(REGISTRAR_ROLE) {
        if (fc.code.length == 0) revert NotAContract(fc);
        if (kinds == 0 || kinds > (KIND_CUSTODY | KIND_COOP_AGENT)) revert InvalidKinds(kinds);
        _entries[fc] = Entry(kinds, true);
        emit FunctionalContractRegistered(fc, kinds);
    }

    /// @notice Stops new deposits into `fc` at once. Deeds it holds can still leave.
    function remove(address fc) external onlyRole(REMOVER_ROLE) {
        if (_entries[fc].kinds == 0) revert NotRegistered(fc);
        _entries[fc].active = false;
        emit FunctionalContractRemoved(fc);
    }

    /// @inheritdoc IFunctionalContractRegistry
    function kindOf(address fc) external view returns (uint8 kinds, bool active) {
        Entry memory e = _entries[fc];
        return (e.kinds, e.active);
    }

    /// @notice Registered and not removed.
    function isActive(address fc) external view returns (bool) {
        return _entries[fc].active;
    }
}
