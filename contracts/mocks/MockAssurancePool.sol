// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockAssurancePool
/// @notice Mock AssurancePool for testing BurnerBond
contract MockAssurancePool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public usdcToken;
    uint256 public _excessBalance;

    constructor(address _usdcToken) {
        usdcToken = IERC20(_usdcToken);
    }

    function depositTokenIntoExcess(address token, uint256 amount) external {
        require(token == address(usdcToken), "Only USDC supported");
        usdcToken.safeTransferFrom(msg.sender, address(this), amount);
        _excessBalance += amount;
    }

    function withdrawToken(address token, uint256 amount) external {
        require(token == address(usdcToken), "Only USDC supported");
        require(amount <= _excessBalance, "Insufficient balance");
        _excessBalance -= amount;
        usdcToken.safeTransfer(msg.sender, amount);
    }

    function excessBalance() external view returns (uint256) {
        return _excessBalance;
    }
}
