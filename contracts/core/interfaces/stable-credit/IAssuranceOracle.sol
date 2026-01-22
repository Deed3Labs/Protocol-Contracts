// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

interface IAssuranceOracle {
    /// @notice This function is called by the AssurancePool to quote the amount of reserve tokens
    /// that would be received for a given deposit token amount.
    /// @dev this function is meant to be overridden to convert deposit tokens to reserve tokens via
    /// on chain pricing data (ex. Uniswap, Chainlink, ect.)
    /// @param depositToken address of the deposit token.
    /// @param reserveToken address of the reserve token.
    /// @param depositAmount amount of deposit token to convert to reserve token.
    /// @return amount of reserve tokens that would be received for the given deposit token amount.
    function quote(address depositToken, address reserveToken, uint256 depositAmount)
        external
        view
        returns (uint256);

    /// @notice The target reserve to debt ratio (RTD) for the AssurancePool.
    function targetRTD() external view returns (uint256);
    
    /// @notice Check if a token is whitelisted for network acceptance
    /// @param token Token address to check
    /// @return True if whitelisted
    function isTokenWhitelisted(address token) external view returns (bool);
    
    /// @notice Check if a token is a stablecoin
    /// @param token Token address to check
    /// @return True if stablecoin
    function checkIsStablecoin(address token) external view returns (bool);

    /* ========== EVENTS ========== */

    event TargetRTDUpdated(uint256 newTargetRTD);
}