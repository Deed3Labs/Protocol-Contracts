// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @dev What a main contract asks a delegatecall module before pinning it in its constructor.
interface IExtensionKind {
    function extensionKind() external pure returns (bytes32);
}
