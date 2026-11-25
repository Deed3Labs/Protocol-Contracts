// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../core/interfaces/IHousingAllowanceRecord.sol";

/// @notice Stands in for the Housing Allowance Record in Points Issuer tests: a SIGNED flag per
/// member and home, a cap, and the Credit Portion it was given.
contract MockHousingAllowanceRecord is IHousingAllowanceRecord {
    mapping(address => mapping(uint256 => bool)) public signed;
    mapping(address => mapping(uint256 => uint256)) public creditPortion;
    mapping(address => uint256) public lifetimeCreditPortion;
    uint256 public cap = 54_000e6;

    error NotSigned();
    error OverCap();

    function setSigned(address member, uint256 homeId, bool s) external {
        signed[member][homeId] = s;
    }

    function setCap(uint256 c) external {
        cap = c;
    }

    function closeMatchPeriodOn(address issuer, address member) external {
        (bool ok, bytes memory ret) = issuer.call(abi.encodeWithSignature("closeMatchPeriod(address)", member));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function creditFromCredits(address member, uint256 homeId, uint256 usd) external override {
        if (!signed[member][homeId]) revert NotSigned();
        if (lifetimeCreditPortion[member] + usd > cap) revert OverCap();
        creditPortion[member][homeId] += usd;
        lifetimeCreditPortion[member] += usd;
    }

    function reverseFromCredits(address member, uint256 homeId, uint256 usd) external override {
        creditPortion[member][homeId] -= usd;
    }
}
