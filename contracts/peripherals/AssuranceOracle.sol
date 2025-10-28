// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../core/interfaces/IAssuranceOracle.sol";
import "../core/interfaces/IAssurancePool.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

// Uniswap V3 interfaces for real-time pricing
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );
}

/// @title AssuranceOracle
/// @dev This contract is meant to be extended in order to serve the necessary data
/// to the AssurancePool and CreditIssuer contracts to manage network credit risk.
/// @notice Exposes the target reserve to debt ratio (targetRTD) for the AssurancePool
/// and a quote function intended to be overridden to convert deposit tokens to reserve tokens.
contract AssuranceOracle is IAssuranceOracle, Ownable {
    uint256 public targetRTD;
    IAssurancePool public assurancePool;
    
    // Uniswap V3 integration
    IUniswapV3Factory public immutable uniswapFactory;
    address public immutable WETH_ADDRESS;
    
    // Default stablecoins (always accepted, always $1 USD)
    address public immutable USDC_ADDRESS;
    address public immutable USDT_ADDRESS;
    address public immutable DAI_ADDRESS;
    
    // Network whitelist system (for token acceptance across the protocol)
    mapping(address => bool) public whitelistedTokens;
    mapping(address => bool) public isStablecoin;
    
    // Fallback pricing system (emergency pricing when Uniswap fails)
    mapping(address => uint256) public fallbackPrices; // Price in USD (18 decimals)
    mapping(address => bool) public useFallbackPrice; // Force fallback price instead of Uniswap
    
    // Uniswap V3 configuration
    uint24 public constant FEE_TIER = 3000; // 0.3% fee tier for stablecoin pairs
    
    // Events
    event TokenWhitelisted(address indexed token, bool whitelisted);
    event FallbackPriceUpdated(address indexed token, uint256 newPrice);
    event FallbackPriceToggled(address indexed token, bool useFallback);
    
    constructor(
        address _assurancePool, 
        uint256 _targetRTD,
        address _uniswapFactory,
        address _wethAddress,
        address _usdcAddress,
        address _usdtAddress,
        address _daiAddress
    ) {
        assurancePool = IAssurancePool(_assurancePool);
        targetRTD = _targetRTD;
        uniswapFactory = IUniswapV3Factory(_uniswapFactory);
        WETH_ADDRESS = _wethAddress;
        USDC_ADDRESS = _usdcAddress;
        USDT_ADDRESS = _usdtAddress;
        DAI_ADDRESS = _daiAddress;
        
        // Initialize default stablecoins
        isStablecoin[_usdcAddress] = true;
        isStablecoin[_usdtAddress] = true;
        isStablecoin[_daiAddress] = true;
        
        // Set stablecoin fallback prices to $1 USD
        fallbackPrices[_usdcAddress] = 1e18;
        fallbackPrices[_usdtAddress] = 1e18;
        fallbackPrices[_daiAddress] = 1e18;
        
        // Stablecoins are always whitelisted
        whitelistedTokens[_usdcAddress] = true;
        whitelistedTokens[_usdtAddress] = true;
        whitelistedTokens[_daiAddress] = true;
    }

    /// @notice This function provides pricing quotes for token conversions.
    /// @dev Uses Uniswap V3 pricing with manual fallback for accurate USD-pegged conversions
    /// @param depositToken address of the deposit token.
    /// @param reserveToken address of the reserve token.
    /// @param depositAmount amount of deposit token to convert to reserve token.
    /// @return amount of reserve tokens that would be received for the given deposit token amount.
    function quote(address depositToken, address reserveToken, uint256 depositAmount)
        external
        view
        virtual
        override
        returns (uint256)
    {
        // Get the price ratio between deposit and reserve tokens
        uint256 priceRatio = getPriceRatio(depositToken, reserveToken);
        
        // Convert deposit amount to reserve token amount
        return (depositAmount * priceRatio) / 1e18;
    }
    
    /// @notice Gets the price ratio between two tokens using Uniswap V3 or manual pricing
    /// @param tokenA First token address
    /// @param tokenB Second token address  
    /// @return Price ratio as 18-decimal fixed point number
    function getPriceRatio(address tokenA, address tokenB) public view returns (uint256) {
        // If tokens are the same, ratio is 1:1
        if (tokenA == tokenB) {
            return 1e18;
        }
        
        // Get USD prices for both tokens
        uint256 priceA = getTokenPriceInUSD(tokenA);
        uint256 priceB = getTokenPriceInUSD(tokenB);
        
        // Calculate ratio: (priceA / priceB) * 1e18
        return (priceA * 1e18) / priceB;
    }
    
    /// @notice Gets the price of a token in USD using Uniswap V3 as primary source, fallback pricing as backup
    /// @param token Token address to get price for
    /// @return Price in USD (18 decimals)
    function getTokenPriceInUSD(address token) public view returns (uint256) {
        // For stablecoins, always return $1 USD
        if (isStablecoin[token]) {
            return 1e18;
        }
        
        // Try Uniswap V3 pricing first (primary source of truth)
        uint256 uniswapPrice = getUniswapPrice(token);
        if (uniswapPrice > 0) {
            return uniswapPrice;
        }
        
        // Fallback to manual price if Uniswap fails (available for any token)
        if (fallbackPrices[token] > 0) {
            return fallbackPrices[token];
        }
        
        // Default to $1 USD if no price available
        return 1e18;
    }
    
    /// @notice Gets price from Uniswap V3 pool
    /// @param token Token address to get price for
    /// @return Price in USD (18 decimals), 0 if no pool found
    function getUniswapPrice(address token) public view returns (uint256) {
        // Try direct USDC pair first
        address usdcPool = uniswapFactory.getPool(token, USDC_ADDRESS, FEE_TIER);
        if (usdcPool != address(0)) {
            return getPoolPrice(usdcPool, token, USDC_ADDRESS);
        }
        
        // Try via WETH if no direct USDC pair
        address wethPool = uniswapFactory.getPool(token, WETH_ADDRESS, FEE_TIER);
        if (wethPool != address(0)) {
            uint256 tokenWethPrice = getPoolPrice(wethPool, token, WETH_ADDRESS);
            address wethUsdcPool = uniswapFactory.getPool(WETH_ADDRESS, USDC_ADDRESS, FEE_TIER);
            if (wethUsdcPool != address(0)) {
                uint256 wethUsdcPrice = getPoolPrice(wethUsdcPool, WETH_ADDRESS, USDC_ADDRESS);
                return (tokenWethPrice * wethUsdcPrice) / 1e18;
            }
        }
        
        return 0; // No price found
    }
    
    /// @notice Gets price from a specific Uniswap V3 pool
    /// @param poolAddress Address of the Uniswap V3 pool
    /// @param token0 First token in the pair
    /// @param token1 Second token in the pair
    /// @return Price as 18-decimal fixed point number
    function getPoolPrice(address poolAddress, address token0, address token1) 
        internal 
        view 
        returns (uint256) 
    {
        try IUniswapV3Pool(poolAddress).slot0() returns (
            uint160 sqrtPriceX96,
            int24,
            uint16,
            uint16,
            uint16,
            uint8,
            bool
        ) {
            // Convert sqrt price to actual price
            uint256 price = (uint256(sqrtPriceX96) * uint256(sqrtPriceX96)) >> (96 * 2);
            
            // Adjust for token decimals
            uint256 decimals0 = IERC20Metadata(token0).decimals();
            uint256 decimals1 = IERC20Metadata(token1).decimals();
            
            if (decimals0 > decimals1) {
                price = price / (10 ** (decimals0 - decimals1));
            } else if (decimals1 > decimals0) {
                price = price * (10 ** (decimals1 - decimals0));
            }
            
            // Ensure price is in 18 decimals
            if (decimals0 < 18) {
                price = price * (10 ** (18 - decimals0));
            } else if (decimals0 > 18) {
                price = price / (10 ** (decimals0 - 18));
            }
            
            return price;
        } catch {
            return 0; // Pool doesn't exist or call failed
        }
    }
    
    // ========== NETWORK WHITELIST MANAGEMENT ==========
    
    /// @notice Whitelist a token for network acceptance (owner only)
    /// @param token Token address to whitelist
    function whitelistToken(address token) external onlyOwner {
        require(token != address(0), "Invalid token address");
        whitelistedTokens[token] = true;
        emit TokenWhitelisted(token, true);
    }
    
    /// @notice Remove a token from whitelist (owner only)
    /// @param token Token address to remove
    function removeTokenFromWhitelist(address token) external onlyOwner {
        require(!isStablecoin[token], "Cannot remove stablecoin");
        whitelistedTokens[token] = false;
        emit TokenWhitelisted(token, false);
    }
    
    /// @notice Batch whitelist multiple tokens (owner only)
    /// @param tokens Array of token addresses to whitelist
    function batchWhitelistTokens(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "Invalid token address");
            whitelistedTokens[tokens[i]] = true;
            emit TokenWhitelisted(tokens[i], true);
        }
    }
    
    // ========== FALLBACK PRICING MANAGEMENT ==========
    
    /// @notice Set fallback price for a token (owner only)
    /// @param token Token address to set fallback price for
    /// @param price Price in USD (18 decimals)
    function setFallbackPrice(address token, uint256 price) external onlyOwner {
        require(price > 0, "Price must be greater than 0");
        fallbackPrices[token] = price;
        // Automatically whitelist token when fallback price is set
        whitelistedTokens[token] = true;
        emit FallbackPriceUpdated(token, price);
        emit TokenWhitelisted(token, true);
    }
    
    /// @notice Toggle between Uniswap and fallback pricing (owner only)
    /// @dev Fallback pricing is only used when Uniswap fails
    /// @param token Token address to toggle
    /// @param useFallback True to force fallback price, false to use Uniswap (default)
    function toggleFallbackPricing(address token, bool useFallback) external onlyOwner {
        require(fallbackPrices[token] > 0, "Token must have fallback price set");
        useFallbackPrice[token] = useFallback;
        emit FallbackPriceToggled(token, useFallback);
    }
    
    /// @notice Batch set fallback prices (owner only)
    /// @param tokens Array of token addresses
    /// @param prices Array of corresponding prices in USD (18 decimals)
    function batchSetFallbackPrices(address[] calldata tokens, uint256[] calldata prices) 
        external 
        onlyOwner 
    {
        require(tokens.length == prices.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < tokens.length; i++) {
            require(prices[i] > 0, "Price must be greater than 0");
            fallbackPrices[tokens[i]] = prices[i];
            // Automatically whitelist tokens when fallback prices are set
            whitelistedTokens[tokens[i]] = true;
            emit FallbackPriceUpdated(tokens[i], prices[i]);
            emit TokenWhitelisted(tokens[i], true);
        }
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    /// @notice Check if a token is the reserve token
    /// @param token Token address to check
    /// @return True if this is the reserve token
    function isReserveToken(address token) public view returns (bool) {
        // This would need to be implemented based on your AssurancePool's reserve token
        // For now, we'll assume the AssurancePool has a method to get the reserve token
        try assurancePool.reserveToken() returns (IERC20Upgradeable reserveTokenContract) {
            return token == address(reserveTokenContract);
        } catch {
            // If AssurancePool is not set or method doesn't exist, return false
            return false;
        }
    }
    
    /// @notice Check if a token is whitelisted for network acceptance
    /// @param token Token address to check
    /// @return True if whitelisted
    function isTokenWhitelisted(address token) external view returns (bool) {
        return whitelistedTokens[token];
    }
    
    /// @notice Check if a token is a stablecoin
    /// @param token Token address to check
    /// @return True if stablecoin
    function checkIsStablecoin(address token) external view returns (bool) {
        return isStablecoin[token];
    }
    
    /// @notice Get all whitelisted tokens (for other contracts like FundManager)
    /// @return Array of whitelisted token addresses
    function getWhitelistedTokens() external pure returns (address[] memory) {
        // This would need to be implemented with a dynamic array
        // For now, returns empty array - can be enhanced with enumeration
        address[] memory tokens = new address[](0);
        return tokens;
    }
    
    /// @notice Check if a token has pricing data available
    /// @param token Token address to check
    /// @return True if token has pricing data
    function hasPricingData(address token) external view returns (bool) {
        // Any token on Uniswap has pricing data, or tokens with fallback prices
        return getUniswapPrice(token) > 0 || fallbackPrices[token] > 0 || isStablecoin[token];
    }
    
    /// @notice Get current price source for a token
    /// @param token Token address to check
    /// @return "stablecoin", "fallback", "uniswap", or "default"
    function getPriceSource(address token) external view returns (string memory) {
        if (isStablecoin[token]) {
            return "stablecoin";
        }
        if (useFallbackPrice[token] && fallbackPrices[token] > 0) {
            return "fallback";
        }
        if (getUniswapPrice(token) > 0) {
            return "uniswap";
        }
        return "default";
    }

    /// @notice This function allows the risk manager to set the target RTD.
    /// If the target RTD is increased and there is an excess reserve balance, the excess reserve is reallocated
    /// to the primary reserve to attempt to reach the new target RTD.
    /// @param _targetRTD new target RTD.
    function setTargetRTD(uint256 _targetRTD) external onlyOwner {
        uint256 currentTarget = targetRTD;
        // update target RTD
        targetRTD = _targetRTD;
        // if increasing target RTD and there is excess reserves, reallocate excess reserve to primary
        if (_targetRTD > currentTarget && assurancePool.excessBalance() > 0) {
            assurancePool.reallocateExcessBalance();
        }
        emit TargetRTDUpdated(_targetRTD);
    }
}