// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol, uint256 decimals) 
        ERC20(name, symbol) 
    {
        _mint(msg.sender, 1000000 * 10**decimals);
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
} 