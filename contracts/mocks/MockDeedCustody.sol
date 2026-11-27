// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface ITrustApprove {
    function approveTrustAction(bytes32 digest) external;
}

/// @dev Test-only Functional Contract that can also be named trustee (it approves its acceptance by a call),
///      to exercise the "transfer makes the trustee the holder" rule (Addendum 1; DECISIONS, Addendum 1 item 6).
contract MockDeedCustody is IERC721Receiver {
    mapping(uint256 => address) public depositorOf;

    function approveTrust(address deed, bytes32 digest) external {
        ITrustApprove(deed).approveTrustAction(digest);
    }

    function onERC721Received(address, address from, uint256 tokenId, bytes calldata) external returns (bytes4) {
        depositorOf[tokenId] = from;
        return IERC721Receiver.onERC721Received.selector;
    }

    function beneficialOwnerOf(uint256 tokenId) external view returns (address) {
        return depositorOf[tokenId];
    }
}
