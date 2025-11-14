// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../core/interfaces/ITokenRegistry.sol";

contract TokenRegistry is ITokenRegistry, Ownable {
    struct InternalTokenInfo {
        bool stablecoin;
        uint8 decimals;
        string symbol;
        string name;
        mapping(uint256 => address) chainAddresses; // chainId => token address
        bool initialized;
    }

    mapping(address => InternalTokenInfo) private tokenInfo; // keyed by token address on this chain
    address[] private whitelistedList;
    mapping(address => bool) private isWhitelisted;

    event TokenWhitelisted(address indexed token, bool whitelisted);
    event TokenStablecoinFlagUpdated(address indexed token, bool isStablecoin);
    event TokenMetadataUpdated(address indexed token, string symbol, string name, uint8 decimals);
    event TokenChainAddressSet(address indexed token, uint256 indexed chainId, address chainTokenAddress);
    event FallbackPriceUpdated(address indexed token, uint256 newPrice);

    // Fallback pricing storage
    mapping(address => uint256) private fallbackPrices; // Price in USD (18 decimals)
    // Note: Oracle now owns the fallback toggle/selection policy

    // Removed setWhitelisted/batchSetWhitelisted in favor of registerToken/removeToken

    function setStablecoin(address token, bool isStablecoin) external override onlyOwner {
        require(token != address(0), "TokenRegistry: invalid token");
        tokenInfo[token].stablecoin = isStablecoin;
        emit TokenStablecoinFlagUpdated(token, isStablecoin);
    }

    function setTokenMetadata(address token, string calldata symbol, string calldata name, uint8 decimals) external override onlyOwner {
        require(token != address(0), "TokenRegistry: invalid token");
        InternalTokenInfo storage info = tokenInfo[token];
        info.symbol = symbol;
        info.name = name;
        info.decimals = decimals;
        info.initialized = true;
        emit TokenMetadataUpdated(token, symbol, name, decimals);
    }

    function setChainAddress(address token, uint256 chainId, address chainTokenAddress) external override onlyOwner {
        require(token != address(0), "TokenRegistry: invalid token");
        require(chainTokenAddress != address(0), "TokenRegistry: invalid chain token address");
        tokenInfo[token].chainAddresses[chainId] = chainTokenAddress;
        emit TokenChainAddressSet(token, chainId, chainTokenAddress);
    }

    function getIsWhitelisted(address token) external view override returns (bool) {
        return isWhitelisted[token];
    }

    function getIsStablecoin(address token) external view override returns (bool) {
        return tokenInfo[token].stablecoin;
    }

    function getTokenInfo(address token) external view override returns (TokenInfo memory) {
        InternalTokenInfo storage info = tokenInfo[token];
        bool whitelisted = isWhitelisted[token];
        // attempt to auto-populate metadata on-chain if not initialized
        if (!info.initialized && token != address(0)) {
            try IERC20Metadata(token).decimals() returns (uint8 d) {
                // no state change in view, just read; leave info as-is
                return TokenInfo(whitelisted, info.stablecoin, d, info.symbol, info.name);
            } catch {
                return TokenInfo(whitelisted, info.stablecoin, info.decimals, info.symbol, info.name);
            }
        }
        return TokenInfo(whitelisted, info.stablecoin, info.decimals, info.symbol, info.name);
    }

    function getChainAddress(address token, uint256 chainId) external view override returns (address) {
        return tokenInfo[token].chainAddresses[chainId];
    }

    function getWhitelistedTokens() external view override returns (address[] memory) {
        return whitelistedList;
    }

    // ===== Registration convenience =====

    /// @notice Register a token with chain-specific address, fallback price and whitelist flag
    /// @param token Token address (this chain key)
    /// @param chainId Chain ID for the provided chainTokenAddress
    /// @param chainTokenAddress Address of the token on the chainId
    /// @param fallbackPrice Price in USD (18 decimals); if 0, defaults to $1
    function registerToken(
        address token,
        uint256 chainId,
        address chainTokenAddress,
        uint256 fallbackPrice
    ) external override onlyOwner {
        require(token != address(0), "TokenRegistry: invalid token");
        require(chainTokenAddress != address(0), "TokenRegistry: invalid chain token address");

        // Set chain address
        tokenInfo[token].chainAddresses[chainId] = chainTokenAddress;
        emit TokenChainAddressSet(token, chainId, chainTokenAddress);

        // Set fallback price (default to $1 if zero)
        uint256 price = fallbackPrice == 0 ? 1e18 : fallbackPrice;
        fallbackPrices[token] = price;
        emit FallbackPriceUpdated(token, price);

        // Always whitelist on register
        if (!isWhitelisted[token]) {
            whitelistedList.push(token);
            isWhitelisted[token] = true;
            emit TokenWhitelisted(token, true);
        }
    }

    /// @notice Remove a token and all associated data
    /// @param token Token address to remove
    function removeToken(address token) external override onlyOwner {
        require(token != address(0), "TokenRegistry: invalid token");
        // Remove from whitelist list if present
        if (isWhitelisted[token]) {
            for (uint256 i = 0; i < whitelistedList.length; i++) {
                if (whitelistedList[i] == token) {
                    whitelistedList[i] = whitelistedList[whitelistedList.length - 1];
                    whitelistedList.pop();
                    break;
                }
            }
            isWhitelisted[token] = false;
            emit TokenWhitelisted(token, false);
        }
        // Clear fallback price
        delete fallbackPrices[token];
        // Clear token info (metadata, stablecoin flag, chain addresses)
        delete tokenInfo[token];
    }

    // ===== Fallback pricing =====
    function setFallbackPrice(address token, uint256 price) public override onlyOwner {
        require(price > 0, "TokenRegistry: price must be > 0");
        fallbackPrices[token] = price;
        // Automatically whitelist token when fallback price is set
        if (!isWhitelisted[token]) {
            whitelistedList.push(token);
            isWhitelisted[token] = true;
            emit TokenWhitelisted(token, true);
        }
        emit FallbackPriceUpdated(token, price);
    }

    // Toggle of fallback usage is managed by the Oracle, not the registry

    function batchSetFallbackPrices(address[] calldata tokens, uint256[] calldata prices) external override onlyOwner {
        require(tokens.length == prices.length, "TokenRegistry: length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            setFallbackPrice(tokens[i], prices[i]);
        }
    }

    function getFallbackPrice(address token) external view override returns (uint256) {
        return fallbackPrices[token];
    }

    // No getUseFallback: the Oracle tracks its own preference

    function hasPricingData(address token) external view override returns (bool) {
        return fallbackPrices[token] > 0 || tokenInfo[token].stablecoin;
    }

    function getPriceSource(address token) external view override returns (string memory) {
        if (tokenInfo[token].stablecoin) return "stablecoin";
        if (fallbackPrices[token] > 0) return "fallback";
        return "default";
    }
}


