// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/**
 * @title IFunctionalContractRegistry
 * @notice The contracts a trust deed may be deposited into under any transfer policy (trust agreement
 *         v5, item 9(c)), and the Coop transfer agents (item 9, Coop policy).
 */
interface IFunctionalContractRegistry {
    /// @return kinds the KIND_* bits the contract was registered with. Kept after removal, so a deed
    ///         already held can still leave and be attributed; 0 if never registered.
    /// @return active false once removed: a removed contract accepts no new deposits (DECISIONS #8).
    function kindOf(address fc) external view returns (uint8 kinds, bool active);
}
