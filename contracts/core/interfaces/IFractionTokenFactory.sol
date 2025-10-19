// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/**
 * @title IFractionTokenFactory
 * @dev Interface for the FractionTokenFactory contract
 *      Provides a standardized way for external contracts to interact with token creation
 */
interface IFractionTokenFactory {
    /**
     * @notice Creates a new FractionToken using the clone pattern
     * @param fractionId ID of the fraction this token represents
     * @param name Name of the token
     * @param symbol Symbol of the token
     * @param maxSharesPerWallet Maximum shares per wallet
     * @param burnable Whether burning is enabled
     * @return tokenAddress Address of the created token
     */
    function createFractionToken(
        uint256 fractionId,
        string memory name,
        string memory symbol,
        uint256 maxSharesPerWallet,
        bool burnable
    ) external returns (address tokenAddress);

    /**
     * @notice Returns the token address for a given fraction ID
     * @param fractionId ID of the fraction
     * @return tokenAddress Address of the token, or address(0) if not found
     */
    function getTokenByFractionId(uint256 fractionId) external view returns (address tokenAddress);

    /**
     * @notice Checks if an address is a created token
     * @param tokenAddress Address to check
     * @return Whether the address is a created token
     */
    function isToken(address tokenAddress) external view returns (bool);
}
