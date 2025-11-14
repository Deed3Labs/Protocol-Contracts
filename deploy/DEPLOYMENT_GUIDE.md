# BurnerBond System Deployment Guide

This guide walks through deploying the complete BurnerBond system to Base Sepolia or Base Mainnet.

## Prerequisites

1. **Environment Setup**
   ```bash
   # Copy .env.example to .env and fill in:
   DEPLOYER_PRIVATE_KEY=your_private_key
   ALCHEMY_API_KEY=your_alchemy_key  # Optional, has default
   ```

2. **Sufficient ETH Balance**
   - Base Sepolia: Get testnet ETH from faucet
   - Base Mainnet: Have sufficient ETH for gas fees

## System Architecture

The BurnerBond system consists of:

1. **TokenRegistry** - Manages whitelisted tokens, metadata, and fallback pricing
2. **AssurancePool** - Manages reserves (primary, buffer, excess) for the protocol
3. **AssuranceOracle** - Provides pricing via Uniswap V3 and token validation
4. **BurnerBondFactory** - Creates token-specific bond collections
5. **BurnerBondDeposit** - Unified deposit contract for all collections
6. **BurnerBond** - Individual ERC-1155 collections per token (created by factory)

## Deployment Options

### Option 1: Full System Deployment (Recommended)

Deploy everything at once using the comprehensive script:

```bash
# For Base Sepolia
npx hardhat run deploy/deploy_burner_bonds.ts --network base-sepolia

# For Base Mainnet
npx hardhat run deploy/deploy_burner_bonds.ts --network base
```

This script will:
- Deploy all contracts in the correct order
- Configure initial settings
- Register default tokens (USDC, USDT, DAI, WETH)
- Create initial bond collections
- Save all deployment information

### Option 2: Individual Contract Deployment

Deploy contracts one at a time for more control:

```bash
# 1. Deploy TokenRegistry
npx hardhat run deploy/07_deploy_TokenRegistry.ts --network base-sepolia

# 2. Deploy AssurancePool (upgradeable)
npx hardhat run deploy/08_deploy_AssurancePool.ts --network base-sepolia

# 3. Deploy AssuranceOracle (requires AssurancePool and TokenRegistry)
npx hardhat run deploy/09_deploy_AssuranceOracle.ts --network base-sepolia

# 4. Deploy BurnerBondFactory (requires AssurancePool and AssuranceOracle)
npx hardhat run deploy/10_deploy_BurnerBondFactory.ts --network base-sepolia
```

## Post-Deployment Configuration

### 1. Verify Contracts

```bash
# Verify on Basescan
npx hardhat verify --network base-sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### 2. Register Additional Tokens

Use the TokenRegistry contract to add more tokens:

```typescript
// Connect to TokenRegistry
const tokenRegistry = await ethers.getContractAt("TokenRegistry", TOKEN_REGISTRY_ADDRESS);

// Register a new token
await tokenRegistry.registerToken(
  tokenAddress,      // Token address on this chain
  chainId,           // Chain ID
  tokenAddress,      // Token address on specified chain
  fallbackPrice      // Fallback price in 18 decimals (e.g., parseEther("1"))
);

// Set stablecoin flag if applicable
await tokenRegistry.setStablecoin(tokenAddress, true);

// Set token metadata
await tokenRegistry.setTokenMetadata(tokenAddress, "SYMBOL", "Token Name", decimals);
```

### 3. Create Bond Collections

Create collections for additional tokens:

```typescript
const factory = await ethers.getContractAt("BurnerBondFactory", FACTORY_ADDRESS);

await factory.createCollection(
  tokenAddress,
  "SYMBOL",
  "Token Name",
  "https://your-metadata-uri.com/api/bonds"
);
```

### 4. Update Frontend

Update your frontend with the deployed contract addresses from `deployments/base-sepolia/`:
- TokenRegistry.json
- AssurancePool.json
- AssuranceOracle.json
- BurnerBondFactory.json
- BurnerBondDeposit.json
- BurnerBond_USDC.json (and other collections)

## Testing Deployment

### 1. Test Token Whitelist

```typescript
const oracle = await ethers.getContractAt("AssuranceOracle", ORACLE_ADDRESS);
const isWhitelisted = await oracle.isTokenWhitelisted(USDC_ADDRESS);
console.log("USDC whitelisted:", isWhitelisted);
```

### 2. Test Price Queries

```typescript
const price = await oracle.getTokenPriceInUSD(USDC_ADDRESS);
const source = await oracle.getPriceSource(USDC_ADDRESS);
console.log(`Price: $${ethers.formatEther(price)} (source: ${source})`);
```

### 3. Test Bond Creation

```typescript
const deposit = await ethers.getContractAt("BurnerBondDeposit", DEPOSIT_ADDRESS);

// Approve tokens
const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);
await usdc.approve(DEPOSIT_ADDRESS, amount);

// Create bond
const maturityDate = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60); // 1 year
const bondId = await deposit.makeDeposit(
  USDC_ADDRESS,
  ethers.parseUnits("1000", 6),  // $1000 face value
  maturityDate,
  2500  // 25% discount (in basis points)
);
```

## Important Addresses

### Base Sepolia
- Uniswap V3 Factory: `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`
- WETH: `0x4200000000000000000000000000000000000006`
- USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

### Base Mainnet
- Uniswap V3 Factory: `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`
- WETH: `0x4200000000000000000000000000000000000006`
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- USDT: `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb`

## Global Parameters

The BurnerBondFactory manages global parameters for all collections:

- **Max Discount**: 50% (5000 basis points)
- **Min Discount**: 0% (0 basis points)
- **Max Maturity**: 30 years
- **Min Maturity**: 1 day
- **Min Face Value**: $100 USDC
- **Max Face Value**: $1M USDC

These can be updated via factory owner functions.

## Troubleshooting

### "Token not whitelisted" error
- Ensure token is registered in TokenRegistry
- Check oracle can see the whitelist via `isTokenWhitelisted()`

### "Collection does not exist" error
- Collections are created automatically on first deposit
- Or manually create via `factory.createCollection()`

### Price queries failing
- Check Uniswap V3 pool exists for the token
- Fallback prices should be set in TokenRegistry
- Verify oracle is properly configured

### AssurancePool permission errors
- Ensure AssuranceOracle is set in AssurancePool
- Check proper roles are granted for pool operations

## Security Considerations

1. **Owner Keys**: Keep deployer private keys secure
2. **Upgrade Rights**: AssurancePool is upgradeable - protect upgrade authority
3. **Oracle Trust**: AssuranceOracle owner can set fallback prices
4. **Factory Control**: Factory owner controls global parameters
5. **Token Whitelisting**: Only whitelist trusted, audited tokens

## Gas Optimization

For production deployments:
1. Use appropriate gas limits based on network congestion
2. Consider batching operations where possible
3. Factory creates deposit contract - this is expensive but one-time
4. Collection creation is user-paid and automatic

## Monitoring

After deployment, monitor:
1. Reserve levels in AssurancePool
2. Bond creation and redemption activity
3. Price accuracy from oracle
4. Token whitelist status
5. Collection activity per token

## Support

For issues or questions:
- Check contract events for error details
- Review deployment logs
- Consult contract documentation in `/docs`

