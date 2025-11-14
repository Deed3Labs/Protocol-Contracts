// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

interface ITokenRegistry {
    /// @notice Basic token info (no mappings returnable in ABI)
    struct TokenInfo {
        bool whitelisted;
        bool stablecoin;
        uint8 decimals;
        string symbol;
        string name;
    }

    // Write API (owner/admin only in implementation)
    function setStablecoin(address token, bool isStablecoin) external;
    function setTokenMetadata(address token, string calldata symbol, string calldata name, uint8 decimals) external;
    function setChainAddress(address token, uint256 chainId, address chainTokenAddress) external;
    function removeToken(address token) external;

    // Read API
    function getIsWhitelisted(address token) external view returns (bool);
    function getIsStablecoin(address token) external view returns (bool);
    function getTokenInfo(address token) external view returns (TokenInfo memory);
    function getChainAddress(address token, uint256 chainId) external view returns (address);
    function getWhitelistedTokens() external view returns (address[] memory);

    // Registration convenience (presence implies whitelisted)
    function registerToken(address token, uint256 chainId, address chainTokenAddress, uint256 fallbackPrice) external;

    // Fallback pricing API
    function setFallbackPrice(address token, uint256 price) external;
    function batchSetFallbackPrices(address[] calldata tokens, uint256[] calldata prices) external;
    function getFallbackPrice(address token) external view returns (uint256);
    function hasPricingData(address token) external view returns (bool);
    function getPriceSource(address token) external view returns (string memory);
}


