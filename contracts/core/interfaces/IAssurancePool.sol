// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IAssurancePool {
    /// @notice enables caller to deposit reserve tokens into the excess reserve.
    /// @param amount amount of deposit token to deposit.
    function deposit(uint256 amount) external;

    /// @notice Called by the stable credit implementation to reimburse an account from the credit token's
    /// reserves. If the amount is covered by the buffer reserve, the buffer reserve is depleted first,
    /// followed by the primary reserve.
    /// @dev The stable credit implementation should not expose this function to the public as it could be
    /// exploited to drain the stable credit's reserves.
    /// @param account address to reimburse from stable credit's reserves.
    /// @param amount amount reserve tokens to withdraw from given stable credit's excess reserve.
    /// @return the amount of reserve tokens reimbursed.
    function reimburse(address account, uint256 amount) external returns (uint256);

    /// @notice enables caller to deposit a given reserve token into a stable credit's
    /// buffer reserve.
    /// @param amount amount of reserve token to deposit.
    function depositIntoBufferReserve(uint256 amount) external;

    /// @notice enables caller to deposit any accepted token into the excess reserve.
    /// @param token address of the token to deposit.
    /// @param amount amount of token to deposit.
    function depositTokenIntoExcess(address token, uint256 amount) external;

    /// @notice enables caller to withdraw any accepted token from the excess reserve.
    /// @param token address of the token to withdraw.
    /// @param amount amount of reserve token equivalent to withdraw.
    function withdrawToken(address token, uint256 amount) external;

    /// @notice this function reallocates needed reserves from the excess reserve to the
    /// primary reserve to attempt to reach the target RTD.
    function reallocateExcessBalance() external;

    /// @notice converts the given stable credit amount to the reserve token denomination.
    /// @param amount stable credit amount to convert to reserve currency denomination.
    /// @return stable credit amount converted to reserve currency denomination.
    function convertStableCreditToReserveToken(uint256 amount) external view returns (uint256);

    /// @notice converts the given reserve token amount to the stable credit denomination.
    /// @param reserveAmount reserve token amount to convert to credit currency denomination.
    /// @return credit currency conversion.
    function convertReserveTokenToStableCredit(uint256 reserveAmount)
        external
        view
        returns (uint256);

    /// @notice Exposes the ERC20 interface of the reserve token.
    /// @return reserve token of the reserve pool.
    function reserveToken() external view returns (IERC20Upgradeable);

    /// @notice returns the amount of current reserve token's excess balance.
    /// @return excess reserve balance.
    function excessBalance() external view returns (uint256);

    /// @notice Recalculate RTD and rebalance reserves based on current token prices
    /// @dev This function should be called periodically to maintain target RTD
    function rebalanceRTD() external;

    /// @notice Recalculate RTD and rebalance reserves based on current token prices (public)
    /// @dev This function can be called by anyone to maintain target RTD
    function rebalanceRTDPublic() external;

    /// @notice Get current RTD status and rebalancing needs
    /// @return currentRTD Current RTD percentage
    /// @return targetRTD Target RTD percentage
    /// @return needsRebalancing True if RTD needs rebalancing
    /// @return rebalanceDirection "to_primary", "from_primary", or "balanced"
    function getRTDStatus() external view returns (
        uint256 currentRTD,
        uint256 targetRTD,
        bool needsRebalancing,
        string memory rebalanceDirection
    );

    /// @notice Get detailed reserve breakdown for RTD analysis
    /// @return primaryAmount Primary reserve amount
    /// @return bufferAmount Buffer reserve amount
    /// @return excessAmount Excess reserve amount
    /// @return totalReserves Total reserves
    /// @return currentRTD Current RTD percentage
    /// @return targetRTD Target RTD percentage
    function getReserveBreakdown() external view returns (
        uint256 primaryAmount,
        uint256 bufferAmount,
        uint256 excessAmount,
        uint256 totalReserves,
        uint256 currentRTD,
        uint256 targetRTD
    );

    /// @notice Set token addresses for withdrawal priority (admin only)
    /// @param _usdcAddress USDC token address
    /// @param _usdtAddress USDT token address  
    /// @param _daiAddress DAI token address
    function setTokenAddresses(address _usdcAddress, address _usdtAddress, address _daiAddress) external;

    /* ========== EVENTS ========== */

    event ExcessReallocated(uint256 excessReserve, uint256 primaryReserve);
    event PrimaryReserveDeposited(uint256 amount);
    event BufferReserveDeposited(uint256 amount);
    event ExcessReserveDeposited(uint256 amount);
    event ExcessReserveWithdrawn(uint256 amount);
    event AccountReimbursed(address account, uint256 amount);
    event ReserveTokenUpdated(address newReserveToken);
    event ConversionRateUpdated(uint256 conversionRate);
    event AssuranceOracleUpdated(address assuranceOracle);
    event RTDRebalanced(uint256 previousRTD, uint256 targetRTD, uint256 newRTD);
}