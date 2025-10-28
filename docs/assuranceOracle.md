# AssuranceOracle Complete Guide

## 🎯 **Overview**

The AssuranceOracle is a **universal pricing oracle** that provides real-time pricing for any token on Uniswap, with manual fallback for emergency situations. It serves as the pricing backbone for the entire AssurancePool system.

### **Key Features:**
- **Universal Access** - Any Uniswap token can be quoted (no whitelist needed)
- **Real-time Pricing** - Uniswap V3 as primary source of truth
- **Fallback Pricing** - Emergency pricing when Uniswap fails
- **Network Whitelist** - Central list of accepted tokens for the protocol
- **Stablecoin Support** - USDC, USDT, DAI always $1 USD
- **Pure Pricing** - No deposit restrictions, just conversion quotes

## 🎯 **Usage Examples**

### **Basic Quote (Any Token):**
```solidity
// Get quote for any token - no whitelist needed
uint256 wethQuote = oracle.quote(wethAddress, usdcAddress, ethers.parseEther("1"));
uint256 wbtcQuote = oracle.quote(wbtcAddress, usdcAddress, 1 * 10**8);
uint256 usdcQuote = oracle.quote(usdcAddress, usdcAddress, 1000 * 10**6);

// Results: Real-time pricing from Uniswap V3
// WETH → ~$2,500 USDC equivalent
// WBTC → ~$45,000 USDC equivalent  
// USDC → 1000 USDC (1:1 ratio)
```

### **Fallback Pricing Setup (Emergency Only):**
```solidity
// Set fallback price for emergency when Uniswap fails
oracle.setFallbackPrice(customTokenAddress, ethers.parseEther("100"));
// Automatically whitelists the token for network acceptance

// Note: Uniswap is still primary source, fallback only used if Uniswap fails
```

### **Batch Operations:**
```solidity
// Batch whitelist multiple tokens for network acceptance
address[] memory tokens = [token1, token2, token3];
oracle.batchWhitelistTokens(tokens);

// Batch set fallback prices (automatically whitelists tokens)
uint256[] memory prices = [ethers.parseEther("100"), ethers.parseEther("200"), ethers.parseEther("300")];
oracle.batchSetFallbackPrices(tokens, prices);
```

### **Check Token Status:**
```solidity
// Check if token has pricing data (any Uniswap token or with fallback)
bool hasPricing = oracle.hasPricingData(tokenAddress);

// Check if token is whitelisted for network acceptance
bool whitelisted = oracle.isTokenWhitelisted(tokenAddress);

// Check current price source
string memory source = oracle.getPriceSource(tokenAddress);
// Returns: "stablecoin", "uniswap", "fallback", or "default"

// Check if token is the reserve token
bool isReserve = oracle.isReserveToken(tokenAddress);

// Get all whitelisted tokens (for other contracts)
address[] memory whitelistedTokens = oracle.getWhitelistedTokens();
```

## 🔄 **Pricing Priority System**

The oracle uses this priority order for pricing:

1. **Stablecoins** → Always $1.00 USD (hardcoded)
2. **Uniswap V3** → Real-time from pools (primary source of truth)
3. **Fallback Pricing** → If Uniswap fails (available for any token)
4. **Default** → $1.00 USD (safety net)

### **Pricing Logic:**
```solidity
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
```

## 💱 **Core Functions**

### **1. Universal Quote System:**
```solidity
function quote(address depositToken, address reserveToken, uint256 depositAmount)
    external view returns (uint256)
{
    // Get the price ratio between deposit and reserve tokens
    uint256 priceRatio = getPriceRatio(depositToken, reserveToken);
    
    // Convert deposit amount to reserve token amount
    return (depositAmount * priceRatio) / 1e18;
}
```

### **2. Price Ratio Calculation:**
```solidity
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
```

### **3. Uniswap V3 Integration:**
```solidity
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
```

## 🔧 **Network Whitelist Management**

### **Purpose:**
The whitelist is for **network-wide token acceptance** across the protocol, not for pricing restrictions.

### **Whitelist Functions:**
```solidity
// Whitelist a token for network acceptance
function whitelistToken(address token) external onlyOwner;

// Remove a token from whitelist (stablecoins cannot be removed)
function removeTokenFromWhitelist(address token) external onlyOwner;

// Batch whitelist multiple tokens
function batchWhitelistTokens(address[] calldata tokens) external onlyOwner;
```

### **Automatic Whitelisting:**
```solidity
// When fallback price is set, token is automatically whitelisted
function setFallbackPrice(address token, uint256 price) external onlyOwner {
    require(price > 0, "Price must be greater than 0");
    fallbackPrices[token] = price;
    // Automatically whitelist token when fallback price is set
    whitelistedTokens[token] = true;
    emit FallbackPriceUpdated(token, price);
    emit TokenWhitelisted(token, true);
}
```

## 🔄 **Fallback Pricing Management**

### **Set Fallback Prices:**
```solidity
// Set fallback price for a token (automatically whitelists)
function setFallbackPrice(address token, uint256 price) external onlyOwner;

// Toggle between Uniswap and fallback pricing
function toggleFallbackPricing(address token, bool useFallback) external onlyOwner;

// Batch set fallback prices
function batchSetFallbackPrices(address[] calldata tokens, uint256[] calldata prices) 
    external onlyOwner;
```

### **Fallback Usage:**
- **Primary**: Uniswap V3 pricing (real-time market data)
- **Fallback**: Manual pricing (emergency only)
- **Default**: $1 USD (safety net)

## 🎯 **Real-World Integration**

### **Frontend Pricing Display:**
```solidity
contract PricingService {
    function getTokenPrice(address token) external view returns (uint256) {
        // Works for any token on Uniswap
        return oracle.getTokenPriceInUSD(token);
    }
    
    function getConversionQuote(address fromToken, address toToken, uint256 amount) external view returns (uint256) {
        // Works for any token pair
        return oracle.quote(fromToken, toToken, amount);
    }
}
```

### **Multi-Token Deposit System:**
```solidity
contract UniversalDepositor {
    function depositAnyToken(address token, uint256 amount) external {
        // Get quote for any token
        uint256 reserveEquivalent = oracle.quote(token, reserveToken, amount);
        
        // Convert token to reserve token via DEX
        uint256 reserveAmount = _swapToken(token, reserveToken, amount);
        
        // Deposit into pool
        pool.deposit(reserveAmount);
        
        // Give user credits based on reserve equivalent
        _mintCredits(msg.sender, reserveEquivalent);
    }
}
```

## 🔍 **Price Impact Monitoring**

### **Check Price Impact:**
```solidity
// Check if price changes require rebalancing
(bool needsRebalancing, uint256 priceImpact) = pool.checkPriceImpact();

if (needsRebalancing) {
    console.log("Price impact:", priceImpact, "%");
    pool.rebalanceRTDPublic();
}
```

### **Monitor RTD Status:**
```solidity
// Get current RTD status
(uint256 currentRTD, uint256 targetRTD, bool needsRebalancing, string memory direction) = pool.getRTDStatus();

if (needsRebalancing) {
    console.log("RTD:", currentRTD, "Target:", targetRTD, "Direction:", direction);
    pool.rebalanceRTDPublic();
}
```

## 🎯 **Key Benefits**

### **1. Universal Access:**
- ✅ **Any Uniswap token** can be quoted (no whitelist needed)
- ✅ **Real-time market data** from active pools
- ✅ **Automatic price discovery** for all tokens

### **2. Emergency Control:**
- ✅ **Fallback pricing** when Uniswap fails
- ✅ **Network whitelist** for protocol-wide token acceptance
- ✅ **System reliability** even when markets fail

### **3. Clean Architecture:**
- ✅ **Pure pricing oracle** (no deposit restrictions)
- ✅ **Separation of concerns** (oracle vs pool)
- ✅ **Flexible integration** with any system

## 📊 **Events**

The oracle emits events for all important operations:

```solidity
// Network whitelist management
event TokenWhitelisted(address indexed token, bool whitelisted);

// Fallback pricing management  
event FallbackPriceUpdated(address indexed token, uint256 newPrice);
event FallbackPriceToggled(address indexed token, bool useFallback);

// RTD management
event TargetRTDUpdated(uint256 newTargetRTD);
```

## 🚀 **Summary**

The AssuranceOracle is a **universal pricing system** that:

1. **Uses Uniswap as primary source** for real-time market data
2. **Falls back to emergency pricing** only when markets fail
3. **Supports any Uniswap token** without restrictions
4. **Provides network whitelist** for protocol-wide token acceptance
5. **Maintains emergency control** for critical situations
6. **Provides clean integration** with any protocol

**Perfect for protocols that need reliable pricing with market truth, network token management, and emergency control!** 🚀
