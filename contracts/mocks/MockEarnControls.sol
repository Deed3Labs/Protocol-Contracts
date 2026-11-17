// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../peripherals/interfaces/IPoolEarnControls.sol";

/// @title MockEarnControls
/// @notice Test-only stand-in for the shared `EarnControls` the Yield Pool reads (decision 1).
/// @dev Everyone is eligible with tag "506C" unless refused; wallets are linked into members by
/// `link`; transfers are allowed between wallets of one member, or a pair approved as a Successor.
/// An attestation, when given, is the exemption tag itself (`abi.encode(bytes32)`).
contract MockEarnControls is IPoolEarnControls {
    bool public paused;
    mapping(address => bool) public refused;
    mapping(address => address) public memberOf;
    mapping(address => address[]) internal walletsOfMember;
    mapping(address => mapping(address => bool)) public successor;
    bytes32 public defaultCode = "506C";
    uint256 public checks;

    error Ineligible(address payer);

    function setPaused(bool p) external {
        paused = p;
    }

    function setRefused(address payer, bool r) external {
        refused[payer] = r;
    }

    function setSuccessor(address from, address to, bool ok) external {
        successor[from][to] = ok;
    }

    /// @notice links `wallet` to `member` (a wallet starts as its own member).
    function link(address member, address wallet) external {
        if (walletsOfMember[member].length == 0) {
            walletsOfMember[member].push(member);
            memberOf[member] = member;
        }
        walletsOfMember[member].push(wallet);
        memberOf[wallet] = member;
    }

    function checkSubscription(address payer, address, uint256, bytes calldata attestation)
        external
        returns (bytes32)
    {
        if (refused[payer]) revert Ineligible(payer);
        checks++;
        return attestation.length == 32 ? abi.decode(attestation, (bytes32)) : defaultCode;
    }

    function subscriptionsPaused() external view returns (bool) {
        return paused;
    }

    function walletsOf(address account) public view returns (address[] memory wallets) {
        address member = memberOf[account];
        if (member == address(0)) {
            wallets = new address[](1);
            wallets[0] = account;
            return wallets;
        }
        return walletsOfMember[member];
    }

    function transferAllowed(address from, address to) external view returns (bool) {
        if (successor[from][to]) return true;
        address m = memberOf[from];
        return m != address(0) && m == memberOf[to];
    }
}
