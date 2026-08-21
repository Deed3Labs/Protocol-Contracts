// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../core/interfaces/stable-credit/IAssuranceOracle.sol";
import "../core/interfaces/stable-credit/IAssurancePool.sol";
import "../core/interfaces/ITokenRegistry.sol";
import "../core/interfaces/stable-credit/ITargetRTDSource.sol";
import "../libraries/TickMath.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

// Uniswap V3 interfaces for real-time pricing
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);

    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// @title AssuranceOracle
/// @dev This contract is meant to be extended in order to serve the necessary data
/// to the AssurancePool and CreditIssuer contracts to manage network credit risk.
/// @notice Exposes the target reserve to debt ratio (targetRTD) for the AssurancePool
/// and a quote function intended to be overridden to convert deposit tokens to reserve tokens.
contract AssuranceOracle is IAssuranceOracle, OwnableUpgradeable, UUPSUpgradeable {
    /// @notice Operator-set target RTD, used when no ITargetRTDSource is registered.
    uint256 public staticTargetRTD;
    /// @notice Optional risk model supplying the target RTD from predicted default rate.
    ITargetRTDSource public targetRTDSource;
    IAssurancePool public assurancePool;
    
    // Uniswap V3 integration.
    // Storage rather than immutable, deliberately. These are the addresses most likely to be
    // wrong on a chain nobody has deployed to before -- a testnet WETH, a factory at a different
    // address -- and immutable makes every one of those mistakes a redeployment that also loses
    // the registry-fallback flags set since.
    IUniswapV3Factory public uniswapFactory;
    address public WETH_ADDRESS;
    
    // Default stablecoins (always accepted, always $1 USD)
    address public USDC_ADDRESS;
    address public USDT_ADDRESS;
    address public DAI_ADDRESS;

    // Centralized token registry
    ITokenRegistry public tokenRegistry;
    
    // Uniswap V3 configuration
    uint24 public constant FEE_TIER = 3000; // 0.3% fee tier for stablecoin pairs

    /// @notice Averaging window for pool prices, in seconds.
    /// @dev Prices read here gate how much token leaves the AssurancePool, so a spot read is a
    /// drain vector: a flash loan can move `slot0` within a single transaction and move it back.
    /// A time-weighted average cannot be moved that way without holding the price across blocks.
    uint32 public twapPeriod;

    /// @dev Bounds on `twapPeriod`. Too short is manipulable; too long is stale.
    uint32 public constant MIN_TWAP_PERIOD = 300; // 5 minutes
    uint32 public constant MAX_TWAP_PERIOD = 86400; // 1 day

    error TwapPeriodOutOfBounds(uint32 period);
    
    // Events
    // Fallback pricing related events are emitted by TokenRegistry
    event ForceRegistryFallbackSet(address indexed token, bool force);
    event TwapPeriodUpdated(uint32 newPeriod);
    event TargetRTDSourceUpdated(address indexed source);
    event PricingAddressesUpdated(address indexed uniswapFactory, address indexed weth);
    
    /// @notice initializes the oracle.
    /// @dev Upgradeable for the same reason the rest of the system is, and for one of its own: the
    /// pool can already be re-pointed at a new oracle with `setAssuranceOracle`, but replacing it
    /// silently drops every `forceRegistryFallback` override set since deployment. An upgrade
    /// keeps them.
    function initialize(
        address _assurancePool, 
        uint256 _targetRTD,
        address _uniswapFactory,
        address _wethAddress,
        address _usdcAddress,
        address _usdtAddress,
        address _daiAddress,
        address _tokenRegistry
    ) external initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        assurancePool = IAssurancePool(_assurancePool);
        staticTargetRTD = _targetRTD;
        twapPeriod = 1800; // 30 minutes
        uniswapFactory = IUniswapV3Factory(_uniswapFactory);
        WETH_ADDRESS = _wethAddress;
        USDC_ADDRESS = _usdcAddress;
        USDT_ADDRESS = _usdtAddress;
        DAI_ADDRESS = _daiAddress;

        tokenRegistry = ITokenRegistry(_tokenRegistry);
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
        if (depositAmount == 0) {
            return 0;
        }

        // Get the price ratio between deposit and reserve tokens
        uint256 priceRatio = getPriceRatio(depositToken, reserveToken);

        // Convert deposit amount by price ratio first (18-decimal fixed point)
        uint256 reserveAmount = (depositAmount * priceRatio) / 1e18;

        // Normalize raw units across token decimals so reserveAmount is in reserve token units.
        uint8 depositDecimals = IERC20Metadata(depositToken).decimals();
        uint8 reserveDecimals = IERC20Metadata(reserveToken).decimals();
        return _rescaleAmount(reserveAmount, depositDecimals, reserveDecimals);
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
        require(priceA > 0 && priceB > 0, "No price data");
        
        // Calculate ratio: (priceA / priceB) * 1e18
        return (priceA * 1e18) / priceB;
    }
    
    /// @notice Gets the price of a token in USD using Uniswap V3 as primary source, fallback pricing as backup
    /// @param token Token address to get price for
    /// @return Price in USD (18 decimals)
    function getTokenPriceInUSD(address token) public view returns (uint256) {
        // For stablecoins, always return $1 USD
        if (_isStablecoin(token)) {
            return 1e18;
        }
        
        // If force flag is enabled and registry has a price, prefer it over Uniswap
        if (forceRegistryFallback[token] && address(tokenRegistry) != address(0)) {
            uint256 forced = tokenRegistry.getFallbackPrice(token);
            if (forced > 0) {
                return forced;
            }
        }

        // Try Uniswap V3 pricing first (primary source of truth)
        uint256 uniswapPrice = getUniswapPrice(token);
        if (uniswapPrice > 0) {
            return uniswapPrice;
        }
        
        // Fallback to registry price if Uniswap fails
        if (address(tokenRegistry) != address(0)) {
            uint256 fp = tokenRegistry.getFallbackPrice(token);
            if (fp > 0) return fp;
        }

        // Unknown pricing must fail closed to prevent reserve accounting exploits.
        revert("No price data");
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
    /// @param baseToken Token being priced
    /// @param quoteToken Quote token for the price pair
    /// @return Price as 18-decimal fixed point number
    function getPoolPrice(address poolAddress, address baseToken, address quoteToken)
        internal 
        view 
        returns (uint256) 
    {
        uint160 sqrtPriceX96 = _twapSqrtPriceX96(poolAddress);
        {
            if (sqrtPriceX96 == 0 || uint256(sqrtPriceX96) > type(uint128).max) {
                return 0;
            }

            address poolToken0;
            address poolToken1;
            try IUniswapV3Pool(poolAddress).token0() returns (address t0) {
                poolToken0 = t0;
            } catch {
                return 0;
            }
            try IUniswapV3Pool(poolAddress).token1() returns (address t1) {
                poolToken1 = t1;
            } catch {
                return 0;
            }

            // priceRaw = token1_raw / token0_raw, scaled to 1e18
            uint256 sqrtPriceSquared = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
            uint256 priceToken1PerToken0 = (sqrtPriceSquared * 1e18) >> 192;
            if (priceToken1PerToken0 == 0) {
                return 0;
            }

            uint8 decimals0 = IERC20Metadata(poolToken0).decimals();
            uint8 decimals1 = IERC20Metadata(poolToken1).decimals();

            // Convert raw-unit ratio to whole-token ratio.
            uint256 adjustedPrice =
                (priceToken1PerToken0 * _pow10(decimals0)) / _pow10(decimals1);
            if (adjustedPrice == 0) {
                return 0;
            }

            if (baseToken == poolToken0 && quoteToken == poolToken1) {
                return adjustedPrice;
            }
            if (baseToken == poolToken1 && quoteToken == poolToken0) {
                return (1e36) / adjustedPrice;
            }
            return 0;
        }
    }

    /// @notice Reads a pool's time-weighted average price over `twapPeriod` as a sqrt price.
    /// @dev Returns 0 rather than falling back to `slot0` when the pool cannot serve the window.
    /// A pool whose observation cardinality has never been increased holds a single observation
    /// and cannot produce an average; falling back to spot there would reintroduce exactly the
    /// manipulation this replaces, on precisely the pools most likely to be thin. Callers treat 0
    /// as "no price", which routes to the token registry fallback and ultimately fails closed.
    /// @param poolAddress Address of the Uniswap V3 pool.
    /// @return sqrtPriceX96 Time-weighted sqrt price, or 0 if unavailable.
    function _twapSqrtPriceX96(address poolAddress) internal view returns (uint160) {
        uint32 period = twapPeriod;
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = period;
        secondsAgos[1] = 0;

        try IUniswapV3Pool(poolAddress).observe(secondsAgos) returns (
            int56[] memory tickCumulatives,
            uint160[] memory
        ) {
            if (tickCumulatives.length < 2) return 0;

            int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
            int24 averageTick = int24(tickDelta / int56(uint56(period)));
            // Integer division truncates toward zero; the average tick must round down so the
            // derived price is never rounded in the pool's favour.
            if (tickDelta < 0 && (tickDelta % int56(uint56(period)) != 0)) averageTick--;

            if (averageTick < TickMath.MIN_TICK || averageTick > TickMath.MAX_TICK) return 0;
            return TickMath.getSqrtRatioAtTick(averageTick);
        } catch {
            // Pool does not exist, or holds too few observations to cover the window.
            return 0;
        }
    }
    
    // ========== TOKEN REGISTRY INTEGRATION ==========
    function _isStablecoin(address token) internal view returns (bool) {
        // Always treat constructor-stablecoins as stable
        if (token == USDC_ADDRESS || token == USDT_ADDRESS || token == DAI_ADDRESS) return true;
        if (address(tokenRegistry) == address(0)) return false;
        return tokenRegistry.getIsStablecoin(token);
    }

    function _rescaleAmount(uint256 amount, uint8 fromDecimals, uint8 toDecimals)
        internal
        pure
        returns (uint256)
    {
        if (fromDecimals == toDecimals) {
            return amount;
        }
        if (fromDecimals > toDecimals) {
            return amount / _pow10(fromDecimals - toDecimals);
        }
        return amount * _pow10(toDecimals - fromDecimals);
    }

    function _pow10(uint8 exp) internal pure returns (uint256) {
        require(exp <= 77, "Unsupported decimals");
        return 10 ** exp;
    }
    
    // ========== FALLBACK PRICING SELECTION ==========
    // The oracle can optionally force usage of registry fallback for a token
    mapping(address => bool) public forceRegistryFallback;

    /// @notice Toggle preference to use TokenRegistry fallback price ahead of Uniswap
    /// @param token Token to configure
    /// @param force When true, prefer registry fallback price over Uniswap
    function setForceRegistryFallback(address token, bool force) external onlyOwner {
        require(token != address(0), "invalid token");
        if (force) {
            require(address(tokenRegistry) != address(0), "no registry");
            require(tokenRegistry.getFallbackPrice(token) > 0, "no fallback price");
        }
        forceRegistryFallback[token] = force;
        emit ForceRegistryFallbackSet(token, force);
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
        if (token == USDC_ADDRESS || token == USDT_ADDRESS || token == DAI_ADDRESS) return true;
        if (address(tokenRegistry) == address(0)) return false;
        return tokenRegistry.getIsWhitelisted(token);
    }
    
    /// @notice Check if a token is a stablecoin
    /// @param token Token address to check
    /// @return True if stablecoin
    function checkIsStablecoin(address token) external view returns (bool) {
        return _isStablecoin(token);
    }
    
    /// @notice Get all whitelisted tokens (for other contracts like FundManager)
    /// @return Array of whitelisted token addresses
    function getWhitelistedTokens() external view returns (address[] memory) {
        if (address(tokenRegistry) == address(0)) {
            address[] memory empty;
            return empty;
        }
        return tokenRegistry.getWhitelistedTokens();
    }
    
    /// @notice Check if a token has pricing data available
    /// @param token Token address to check
    /// @return True if token has pricing data
    function hasPricingData(address token) external view returns (bool) {
        // Any token on Uniswap has pricing data, or tokens with registry fallback prices, or stablecoins
        if (_isStablecoin(token)) return true;
        if (getUniswapPrice(token) > 0) return true;
        if (address(tokenRegistry) != address(0)) {
            return tokenRegistry.hasPricingData(token);
        }
        return false;
    }
    
    /// @notice Get current price source for a token
    /// @param token Token address to check
    /// @return "stablecoin", "fallback", "uniswap", or "default"
    function getPriceSource(address token) external view returns (string memory) {
        if (_isStablecoin(token)) return "stablecoin";
        if (forceRegistryFallback[token]) return "fallback";
        if (getUniswapPrice(token) > 0) return "uniswap";
        if (address(tokenRegistry) != address(0)) return tokenRegistry.getPriceSource(token);
        return "default";
    }

    /// @notice This function allows the risk manager to set the target RTD.
    /// If the target RTD is increased and there is an excess reserve balance, the excess reserve is reallocated
    /// to the primary reserve to attempt to reach the new target RTD.
    /// @param _targetRTD new target RTD.
    function setTargetRTD(uint256 _targetRTD) external onlyOwner {
        uint256 currentTarget = targetRTD();
        // update target RTD
        staticTargetRTD = _targetRTD;
        // if increasing target RTD and there is excess reserves, reallocate excess reserve to primary
        if (_targetRTD > currentTarget && assurancePool.excessBalance() > 0) {
            assurancePool.reallocateExcessBalance();
        }
        emit TargetRTDUpdated(_targetRTD);
    }

    /// @notice The target reserve to debt ratio the AssurancePool reserves toward.
    /// @dev Served by the registered risk model when there is one, and by the operator-set
    /// constant otherwise. See ITargetRTDSource: the target is meant to be produced by the
    /// predicted default rate rather than chosen.
    /// @return target RTD, where 1 ether == 100%.
    function targetRTD() public view override returns (uint256) {
        if (address(targetRTDSource) != address(0)) return targetRTDSource.targetRTD();
        return staticTargetRTD;
    }

    /// @notice Registers the risk model supplying the target RTD.
    /// @param _source address of the source, or address(0) to fall back to the set constant.
    function setTargetRTDSource(address _source) external onlyOwner {
        targetRTDSource = ITargetRTDSource(_source);
        emit TargetRTDSourceUpdated(_source);
    }

    /// @dev The oracle decides what a deposit is worth and what the reserve target is. Neither is
    /// a new power for the owner -- they can already set a fallback price and force it to be
    /// preferred over Uniswap -- but both are worth being able to correct without losing the
    /// settings around them.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Re-points the oracle at a different Uniswap deployment or token set.
    /// @dev The reason these are no longer immutable. Getting one wrong used to mean a redeploy.
    function setPricingAddresses(
        address _uniswapFactory,
        address _wethAddress,
        address _usdcAddress,
        address _usdtAddress,
        address _daiAddress
    ) external onlyOwner {
        uniswapFactory = IUniswapV3Factory(_uniswapFactory);
        WETH_ADDRESS = _wethAddress;
        USDC_ADDRESS = _usdcAddress;
        USDT_ADDRESS = _usdtAddress;
        DAI_ADDRESS = _daiAddress;
        emit PricingAddressesUpdated(_uniswapFactory, _wethAddress);
    }

    /// @notice Sets the averaging window used for pool prices.
    /// @param _period new window in seconds, within [MIN_TWAP_PERIOD, MAX_TWAP_PERIOD].
    function setTwapPeriod(uint32 _period) external onlyOwner {
        if (_period < MIN_TWAP_PERIOD || _period > MAX_TWAP_PERIOD) {
            revert TwapPeriodOutOfBounds(_period);
        }
        twapPeriod = _period;
        emit TwapPeriodUpdated(_period);
    }
}
