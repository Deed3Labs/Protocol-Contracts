# AssurancePool Complete System Guide

## 🎯 **Overview**

The AssurancePool is a **multi-token reserve management system** that handles deposits, withdrawals, and RTD (Reserve-to-Debt Ratio) rebalancing using the AssuranceOracle for real-time pricing. It provides a complete solution for managing diverse token reserves while maintaining system stability.

### **Key Features:**
- **Multi-Token Deposits** - Accept any whitelisted token (stablecoins, reserve token, whitelisted tokens)
- **Smart Withdrawals** - Provide equivalent value using available tokens
- **Price-Aware RTD Rebalancing** - Automatically detects and compensates for price changes
- **Reserve Management** - Primary, buffer, and excess reserve allocation
- **Oracle Integration** - Real-time pricing from AssuranceOracle

## 🔄 **Multi-Token Deposit System**

### **Accepted Tokens:**
1. **Reserve Token** - Primary token (e.g., USDC)
2. **Stablecoins** - USDC, USDT, DAI (always accepted)
3. **Whitelisted Tokens** - Any token with fallback pricing or Uniswap pricing

### **Deposit Functions:**
```solidity
// Deposit any accepted token (allocated based on RTD needs)
function depositToken(address token, uint256 amount) public nonReentrant;

// Direct deposit into specific reserves
function depositTokenIntoPrimary(address token, uint256 amount) public;
function depositTokenIntoBuffer(address token, uint256 amount) public;
function depositTokenIntoExcess(address token, uint256 amount) public;
```

### **Deposit Allocation Logic:**
```solidity
function _depositToken(address token, uint256 amount) internal {
    // Transfer token from caller
    IERC20Upgradeable(token).safeTransferFrom(_msgSender(), address(this), amount);
    
    // Convert to reserve token equivalent using oracle
    uint256 reserveTokenAmount = _convertToReserveToken(token, amount);
    
    // Calculate reserves needed to reach target RTD
    uint256 _neededReserves = neededReserves();
    
    if (_neededReserves > reserveTokenAmount) {
        // All goes to primary reserve (RTD not met)
        primaryReserve[address(reserveToken)] += reserveTokenAmount;
    } else {
        // Some to primary, rest to excess
        primaryReserve[address(reserveToken)] += _neededReserves;
        excessReserve[address(reserveToken)] += (reserveTokenAmount - _neededReserves);
    }
}
```

## 💰 **Smart Withdrawal System**

### **Two-Phase Withdrawal Process:**

1. **Direct Withdrawal** - If pool has enough of requested token
2. **Smart Withdrawal** - If not enough, provide equivalent value using available tokens

### **Withdrawal Logic:**
```solidity
function withdrawToken(address token, uint256 amount) public nonReentrant {
    // Calculate how much of requested token user should get
    uint256 tokenAmount = _convertFromReserveToken(token, amount);
    
    // Check if we have enough
    uint256 tokenBalance = IERC20Upgradeable(token).balanceOf(address(this));
    
    if (tokenBalance >= tokenAmount) {
        // ✅ Direct withdrawal - we have enough
        IERC20Upgradeable(token).safeTransfer(_msgSender(), tokenAmount);
    } else {
        // 🔄 Smart withdrawal - provide equivalent value
        _withdrawEquivalentValue(token, amount);
    }
}
```

### **Smart Withdrawal Algorithm:**
```solidity
function _withdrawEquivalentValue(address requestedToken, uint256 amount) internal {
    uint256 remainingAmount = amount;
    
    // Priority order for withdrawal (most cost-effective first)
    address[] memory priorityTokens = _getWithdrawalPriority();
    
    for (uint256 i = 0; i < priorityTokens.length && remainingAmount > 0; i++) {
        address token = priorityTokens[i];
        uint256 tokenBalance = IERC20Upgradeable(token).balanceOf(address(this));
        
        if (tokenBalance > 0) {
            // Calculate how much of this token we can use
            uint256 tokenValue = _convertToReserveToken(token, tokenBalance);
            
            if (tokenValue <= remainingAmount) {
                // Use all of this token
                IERC20Upgradeable(token).safeTransfer(_msgSender(), tokenBalance);
                remainingAmount -= tokenValue;
            } else {
                // Use partial amount of this token
                uint256 neededTokenAmount = _convertFromReserveToken(token, remainingAmount);
                IERC20Upgradeable(token).safeTransfer(_msgSender(), neededTokenAmount);
                remainingAmount = 0;
            }
        }
    }
}
```

### **Withdrawal Priority Order:**
1. **Reserve Token** - Most liquid, no conversion needed
2. **Stablecoins** - Highly liquid, stable value (USDC, USDT, DAI)
3. **Whitelisted Tokens** - Other accepted tokens

## 🔄 **Price-Aware RTD Rebalancing System**

### **The Problem Solved:**
The original system couldn't detect when token prices changed, leading to inaccurate RTD calculations.

### **Example of the Problem:**
```solidity
// Initial state:
// - Pool holds: 1 WETH (worth 2,500 USDC equivalent)
// - Primary Reserve: 2,500 USDC equivalent
// - RTD: 100% (perfect)

// WETH price drops 20%:
// - Pool still holds: 1 WETH (now worth 2,000 USDC equivalent)
// - Primary Reserve: 2,500 USDC equivalent (stored amount unchanged!)
// - RTD: Still shows 100% (WRONG! Should be 80%)
```

### **Solution: Price-Aware Rebalancing:**
```solidity
function rebalanceRTD() external onlyOperator {
    // First, update reserve values based on current token prices
    _updateReserveValues();  // ← NEW: Detects price changes
    
    uint256 currentRTD = RTD();
    uint256 targetRTD = targetRTD();
    
    // Then rebalance based on updated values
    if (currentRTD < targetRTD) {
        _rebalanceToPrimary();
    } else if (currentRTD > targetRTD) {
        _rebalanceFromPrimary();
    }
}
```

### **Price Update Mechanism:**
```solidity
function _updateReserveValues() internal {
    // Get all tokens held in the pool
    address[] memory heldTokens = _getHeldTokens();
    
    // Reset all reserves to zero
    primaryReserve[address(reserveToken)] = 0;
    bufferReserve[address(reserveToken)] = 0;
    excessReserve[address(reserveToken)] = 0;
    
    // Recalculate reserve values based on current prices
    for (uint256 i = 0; i < heldTokens.length; i++) {
        address token = heldTokens[i];
        uint256 tokenBalance = IERC20Upgradeable(token).balanceOf(address(this));
        
        if (tokenBalance > 0) {
            // Convert token balance to reserve token equivalent using current prices
            uint256 reserveTokenEquivalent = _convertToReserveToken(token, tokenBalance);
            
            // Allocate to appropriate reserve based on current RTD needs
            _allocateToReserves(reserveTokenEquivalent);
        }
    }
}
```

## 📊 **Real-World Examples**

### **Example 1: WETH Price Drop Recovery**

#### **Initial State:**
```solidity
// Pool holds:
// - 1 WETH (worth 2,500 USDC equivalent)
// - 500 USDC (worth 500 USDC equivalent)
// - Total: 3,000 USDC equivalent

// Reserve allocation:
// - Primary Reserve: 2,500 USDC equivalent
// - Buffer Reserve: 0 USDC equivalent
// - Excess Reserve: 500 USDC equivalent

// System state:
// - Total Debt: 2,500 stable credit
// - RTD: 100% (2,500 / 2,500)
// - Target RTD: 100%
```

#### **WETH Price Drops 20%:**
```solidity
// WETH price drops from 2,500 to 2,000 USDC
// Pool still holds:
// - 1 WETH (now worth 2,000 USDC equivalent)
// - 500 USDC (worth 500 USDC equivalent)
// - Total: 2,500 USDC equivalent

// But stored reserves still show:
// - Primary Reserve: 2,500 USDC equivalent (stored)
// - RTD: 100% (WRONG! Should be 80%)
```

#### **Call Rebalancing:**
```solidity
pool.rebalanceRTD();
```

#### **What Happens:**
```solidity
// 1. _updateReserveValues() detects WETH price dropped to 2,000 USDC
// 2. Recalculates: Primary Reserve = 2,000 USDC equivalent
// 3. RTD now shows 80% (accurate!)
// 4. _rebalanceToPrimary() moves reserves to restore 100% RTD
// 5. System automatically compensates for price drop

// After rebalancing:
// - Pool holds: 1 WETH (worth 2,000 USDC equivalent)
// - Primary Reserve: 2,500 USDC equivalent (rebalanced)
// - RTD: 100% (restored through rebalancing)
```

### **Example 2: Smart Withdrawal**

#### **Pool State:**
```solidity
// Pool holds:
// - 100 USDC
// - 2 WETH  
// - 0.5 WBTC

// User wants 1,000 USDC equivalent in WETH
pool.withdrawToken(wethAddress, 1000 * 10**6);
// Requested: 0.4 WETH, but pool only has 0.3 WETH available

// Smart withdrawal provides:
// 1. 0.3 WETH (all available WETH)
// 2. 100 USDC (remaining 100 USDC equivalent)
// 3. 0.02 WBTC (remaining 100 USDC equivalent)
// Total: 1,000 USDC equivalent value
```

### **Example 3: Multi-Token Deposit**

#### **User Deposits 1 WETH:**
```solidity
pool.depositToken(wethAddress, 1 ether);

// What happens:
// 1. Transfer 1 WETH from user to pool
// 2. Oracle converts: 1 WETH = 2,500 USDC equivalent
// 3. Allocate to primary reserve (RTD < target)
// 4. Update accounting: primaryReserve += 2,500 USDC equivalent

// New state:
// - 0 USDC (reserve token)
// - 1 WETH (physical token)
// - 0 WBTC
// - Primary Reserve: 2,500 USDC equivalent
// - Total Debt: 100,000 stable credit
// - RTD: 2.5% (2,500 / 100,000)
```

## 🔧 **Configuration & Management**

### **Set Token Addresses:**
```solidity
// Admin sets priority token addresses for withdrawal priority
function setTokenAddresses(address _usdcAddress, address _usdtAddress, address _daiAddress) external onlyAdmin;
```

### **Oracle Integration:**
```solidity
// Set the oracle for pricing
function setAssuranceOracle(address _assuranceOracle) external onlyAdmin;
```

### **Reserve Management:**
```solidity
// Check RTD status
function getRTDStatus() external view returns (
    uint256 currentRTD,
    uint256 targetRTD,
    bool needsRebalancing,
    string memory rebalanceDirection
);

// Get detailed reserve breakdown
function getReserveBreakdown() external view returns (
    uint256 primaryAmount,
    uint256 bufferAmount,
    uint256 excessAmount,
    uint256 totalReserves,
    uint256 currentRTD,
    uint256 targetRTD
);
```

## 🎯 **Key Benefits**

### **1. Multi-Token Support:**
- ✅ **Any whitelisted token** can be deposited
- ✅ **Automatic conversion** to reserve equivalent
- ✅ **Flexible token acceptance** based on oracle pricing

### **2. Smart Withdrawals:**
- ✅ **Always works** - Never fails due to token unavailability
- ✅ **Gets equivalent value** - User receives full requested amount
- ✅ **Cost-effective** - Uses most liquid tokens first

### **3. Price-Aware Rebalancing:**
- ✅ **Automatic price detection** through live oracle integration
- ✅ **Accurate RTD calculations** using current token values
- ✅ **Proactive rebalancing** to maintain system stability

### **4. System Robustness:**
- ✅ **Handles edge cases** - Works even with limited token availability
- ✅ **Maintains accounting** - Proper reserve tracking
- ✅ **Prevents failures** - Always provides equivalent value

## 🔍 **Monitoring & Alerts**

### **Price Impact Monitoring:**
```solidity
// Check if price changes require rebalancing
(bool needsRebalancing, uint256 priceImpact) = pool.checkPriceImpact();

if (needsRebalancing) {
    console.log("Price impact:", priceImpact, "%");
    pool.rebalanceRTDPublic();
}
```

### **RTD Status Monitoring:**
```solidity
// Get current RTD status
(uint256 currentRTD, uint256 targetRTD, bool needsRebalancing, string memory direction) = pool.getRTDStatus();

if (needsRebalancing) {
    console.log("RTD:", currentRTD, "Target:", targetRTD, "Direction:", direction);
    pool.rebalanceRTDPublic();
}
```

## 🚀 **Usage Patterns**

### **1. Scheduled Rebalancing:**
```solidity
// Daily rebalancing (operators)
pool.rebalanceRTD();
```

### **2. Event-Driven Rebalancing:**
```solidity
// After significant price movements
// - WETH drops 10%+
// - WBTC drops 15%+
// - Market volatility

pool.rebalanceRTDPublic();
```

### **3. Multi-Token Operations:**
```solidity
// Deposit any token
pool.depositToken(wethAddress, 1 ether);
pool.depositToken(wbtcAddress, 0.1 * 10**8);
pool.depositToken(usdcAddress, 1000 * 10**6);

// Withdraw any token
pool.withdrawToken(wethAddress, 1000 * 10**6);
pool.withdrawToken(usdcAddress, 500 * 10**6);
```

## 📊 **Events**

The system emits events for all important operations:

```solidity
// RTD rebalancing
event RTDRebalanced(uint256 previousRTD, uint256 targetRTD, uint256 newRTD);

// Reserve deposits
event PrimaryReserveDeposited(uint256 amount);
event BufferReserveDeposited(uint256 amount);
event ExcessReserveDeposited(uint256 amount);

// Reserve withdrawals
event ExcessReserveWithdrawn(uint256 amount);

// System updates
event ReserveTokenUpdated(address newReserveToken);
event AssuranceOracleUpdated(address assuranceOracle);
```

## 🎯 **Summary**

The AssurancePool Complete System provides:

1. **Multi-Token Deposits** - Accept any whitelisted token with automatic conversion
2. **Smart Withdrawals** - Always provide equivalent value using available tokens
3. **Price-Aware Rebalancing** - Automatically detect and compensate for price changes
4. **Reserve Management** - Optimal allocation between primary, buffer, and excess reserves
5. **Oracle Integration** - Real-time pricing from AssuranceOracle
6. **System Stability** - Maintains target RTD through price fluctuations

**Perfect for protocols that need robust multi-token reserve management with automatic price adaptation!** 🚀
