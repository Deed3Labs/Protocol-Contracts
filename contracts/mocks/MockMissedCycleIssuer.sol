// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockMissedCycleIssuer
/// @notice Test-only stand-in for a revolving issuer after a missed cycle (spec 12.5, 12.8).
/// @dev Lets the Liquidator's section 12 paths be tested without the RevolvingIssuer change that
/// computes `unsecuredExcessOf` and `missedInRowOf` (Phase 2b, parent branch). Tiers, principal,
/// the excess and default are set directly. `settleFromCollateral` takes the reserve token and
/// lowers principal the way the real issuer does, and lowers the excess with any unsecured
/// settlement, as halving-then-repaying does on the real one. Never deploy this.
contract MockMissedCycleIssuer {
    IERC20 public immutable reserve;
    bytes32[] private kinds;

    mapping(address => mapping(uint256 => uint256)) public principalOf;
    mapping(address => uint256) public unsecuredExcessOf;
    mapping(address => uint8) public missedInRowOf;
    mapping(address => bool) public inDefault;

    constructor(address reserve_, bytes32[] memory kinds_) {
        reserve = IERC20(reserve_);
        kinds = kinds_;
    }

    function tierCount() external view returns (uint256) {
        return kinds.length;
    }

    function tierAt(uint256 tierId) external view returns (bytes32 kind, uint256 ratePerCycle, bool active) {
        return (kinds[tierId], 0, true);
    }

    function hasDefaulted(address) external pure returns (bool) {
        return false;
    }

    /// @dev What the Liquidator reads since Phase 4b (M-C).
    function hasDefaultedOnCurrentLine(address) external pure returns (bool) {
        return false;
    }

    function setPrincipal(address member, uint256 tierId, uint256 amount) external {
        principalOf[member][tierId] = amount;
    }

    function setMissedCycle(address member, uint8 missedInRow, uint256 excess) external {
        missedInRowOf[member] = missedInRow;
        unsecuredExcessOf[member] = excess;
    }

    function setInDefault(address member, bool value) external {
        inDefault[member] = value;
    }

    /// @dev The shape the CollateralRegistry reads: one entry per tier with principal.
    function debtByKind(address member) external view returns (bytes32[] memory out, uint256[] memory amounts) {
        out = new bytes32[](kinds.length);
        amounts = new uint256[](kinds.length);
        for (uint256 i = 0; i < kinds.length; i++) {
            out[i] = kinds[i];
            amounts[i] = principalOf[member][i];
        }
    }

    function settleFromCollateral(address member, uint256 tierId, uint256 amount) external {
        uint256 principal = principalOf[member][tierId];
        uint256 pay = principal < amount ? principal : amount;
        if (pay == 0) return;
        require(reserve.transferFrom(msg.sender, address(this), pay), "pull");
        principalOf[member][tierId] = principal - pay;
        if (kinds[tierId] == "INCOME" || kinds[tierId] == "BOOST") {
            uint256 excess = unsecuredExcessOf[member];
            unsecuredExcessOf[member] = excess > pay ? excess - pay : 0;
        }
    }
}
