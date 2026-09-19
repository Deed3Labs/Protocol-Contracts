// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @dev Stands in for RevolvingIssuer's mandate, settlers and principal in TermIssuer tests.
contract MockRevolvingMandate {
    mapping(address => bool) public autoRepayEnabled;
    mapping(address => bool) public isCardSettler;
    mapping(address => uint256) public totalPrincipalOf;

    function setAutoRepay(address member, bool enabled) external {
        autoRepayEnabled[member] = enabled;
    }

    function setCardSettler(address account, bool enabled) external {
        isCardSettler[account] = enabled;
    }

    function setPrincipal(address member, uint256 amount) external {
        totalPrincipalOf[member] = amount;
    }
}
