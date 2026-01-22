# BurnerBond System - Deployment Summary

## 🎯 What Was Created

A complete deployment infrastructure for the BurnerBond system on Base network (Sepolia testnet and mainnet).

## 📦 New Files Created

### Deployment Scripts (`deploy/`)

1. **`08_deploy_TokenRegistry.ts`** - Deploys and configures TokenRegistry
   - Registers default tokens (USDC, USDT, DAI, WETH)
   - Sets stablecoin flags
   - Configures fallback pricing

2. **`09_deploy_AssurancePool.ts`** - Deploys AssurancePool (upgradeable UUPS proxy)
   - Initializes with reserve token
   - Configures token addresses for withdrawal priority
   - Sets up primary/buffer/excess reserves

3. **`10_deploy_AssuranceOracle.ts`** - Deploys AssuranceOracle
   - Connects to TokenRegistry for whitelist
   - Integrates with Uniswap V3 for pricing
   - Configures fallback pricing mechanism
   - Sets target Reserve-to-Debt (RTD) ratio

4. **`11_deploy_BurnerBondFactory.ts`** - Deploys BurnerBondFactory
   - Automatically deploys unified BurnerBondDeposit
   - Creates initial USDC collection
   - Sets global parameters (discount, maturity, face value limits)

5. **`deploy_burner_bonds.ts`** - Comprehensive all-in-one deployment
   - Deploys all contracts in correct order
   - Configures all relationships
   - Creates initial collections
   - Provides detailed deployment summary

6. **`verify_deployments.ts`** - Verification script
   - Checks all contracts deployed
   - Verifies contract relationships
   - Validates configuration
   - Reports any issues

### Documentation (`deploy/`)

1. **`README.md`** - Complete deployment documentation overview
   - Architecture diagram
   - All available commands
   - Network configurations
   - Troubleshooting guide

2. **`QUICK_START.md`** - 5-minute quick start guide
   - One-command deployment
   - Testing instructions
   - Common issues and solutions

3. **`DEPLOYMENT_GUIDE.md`** - Comprehensive deployment guide
   - Detailed step-by-step instructions
   - Post-deployment configuration
   - Security considerations
   - Testing procedures

## 🚀 How to Deploy

### Quick Deployment (Recommended)

```bash
# Deploy everything to Base Sepolia
npm run deploy:burner-bonds:sepolia

# Verify deployment
npm run verify:deployments:sepolia
```

### Step-by-Step Deployment

```bash
# 1. TokenRegistry
npm run deploy:token-registry base-sepolia

# 2. AssurancePool
npm run deploy:assurance-pool base-sepolia

# 3. AssuranceOracle
npm run deploy:assurance-oracle base-sepolia

# 4. BurnerBondFactory (includes BurnerBondDeposit)
npm run deploy:burner-bond-factory base-sepolia

# 5. Verify everything
npm run verify:deployments:sepolia
```

## 📋 System Components

### Core Contracts

| Contract | Type | Purpose |
|----------|------|---------|
| **TokenRegistry** | Standard | Token whitelist, metadata, and fallback pricing |
| **AssurancePool** | Upgradeable (UUPS) | Multi-token reserve management (primary/buffer/excess) |
| **AssuranceOracle** | Standard | Price oracle using Uniswap V3 + fallback |
| **BurnerBondFactory** | Standard | Creates and manages bond collections |
| **BurnerBondDeposit** | Standard | Unified deposit contract for all collections |
| **BurnerBond** | Standard (ERC-1155) | Token-specific bond NFT collections |

### Contract Relationships

```
TokenRegistry
    ↓ (used by)
AssuranceOracle ←→ AssurancePool
    ↓ (used by)         ↓ (used by)
BurnerBondFactory ← ← ←
    ↓ (creates)
BurnerBondDeposit (unified)
    ↓ (calls)
BurnerBond Collections (USDC, WETH, etc.)
```

## 🌐 Network Support

### Base Sepolia (Testnet)
- Chain ID: 84532
- RPC: https://sepolia.base.org
- Explorer: https://base-sepolia.blockscout.com
- **Status**: ✅ Ready for deployment

### Base Mainnet (Production)
- Chain ID: 8453
- RPC: https://mainnet.base.org
- Explorer: https://basescan.org
- **Status**: ⚠️ Deploy after thorough testing

## 🔑 Key Features

### TokenRegistry
- ✅ Token whitelist management
- ✅ Stablecoin flagging
- ✅ Fallback pricing for oracle failure
- ✅ Multi-chain token address mapping
- ✅ Token metadata storage

### AssurancePool
- ✅ Multi-token support (USDC, USDT, DAI, WETH, etc.)
- ✅ Three-tier reserve system (primary/buffer/excess)
- ✅ Automatic RTD management
- ✅ Price-based rebalancing
- ✅ Upgradeable (UUPS proxy)

### AssuranceOracle
- ✅ Uniswap V3 price integration
- ✅ Multi-hop pricing (token → WETH → USDC)
- ✅ Automatic fallback to manual pricing
- ✅ Stablecoin price fixing ($1)
- ✅ TokenRegistry integration

### BurnerBondFactory
- ✅ Unified deposit contract for all tokens
- ✅ Automatic collection creation
- ✅ Global parameter management
- ✅ Discount curve system support
- ✅ Multiple maturity periods

### BurnerBond (Collections)
- ✅ ERC-1155 NFT standard
- ✅ ERC-7496 dynamic traits
- ✅ Discount curves (linear, bonding, logarithmic)
- ✅ Automatic redemption at maturity
- ✅ Batch operations

## 📊 Default Configuration

### Global Parameters (BurnerBondFactory)
- **Max Discount**: 50% (5000 basis points)
- **Min Discount**: 0% (0 basis points)
- **Max Maturity**: 30 years
- **Min Maturity**: 1 day
- **Min Face Value**: $100 USDC
- **Max Face Value**: $1M USDC

### Oracle Configuration
- **Target RTD**: 100% (1.0 ether)
- **Price Source**: Uniswap V3 primary, fallback secondary
- **Fee Tier**: 0.3% (3000 basis points)

### Default Whitelisted Tokens
- USDC (stablecoin, $1.00)
- USDT (stablecoin, $1.00)
- DAI (stablecoin, $1.00)
- WETH ($3000 fallback)

## 🛠️ NPM Scripts Added

```json
{
  "deploy:burner-bonds": "Deploy to any network",
  "deploy:burner-bonds:sepolia": "Deploy to Base Sepolia",
  "deploy:burner-bonds:base": "Deploy to Base mainnet",
  "deploy:token-registry": "Deploy TokenRegistry only",
  "deploy:assurance-pool": "Deploy AssurancePool only",
  "deploy:assurance-oracle": "Deploy AssuranceOracle only",
  "deploy:burner-bond-factory": "Deploy Factory only",
  "verify:deployments": "Verify deployments on any network",
  "verify:deployments:sepolia": "Verify on Base Sepolia"
}
```

## 📁 Output Structure

After deployment, files are saved to:

```
deployments/
└── base-sepolia/  (or base/ for mainnet)
    ├── TokenRegistry.json
    ├── AssurancePool.json
    ├── AssuranceOracle.json
    ├── BurnerBondFactory.json
    ├── BurnerBondDeposit.json
    └── BurnerBond_USDC.json
```

Each JSON contains:
- Contract address
- Full ABI
- Deployment block number

## ✅ Pre-Deployment Checklist

Before deploying to any network:

- [ ] Environment variables set (DEPLOYER_PRIVATE_KEY, etc.)
- [ ] Deployer wallet funded with ETH
- [ ] Network configuration verified in hardhat.config.ts
- [ ] Contracts compiled (`npm run compile`)
- [ ] Tests passing (`npm run test`)

## 🧪 Testing Deployment

After deployment:

1. **Run verification script**
   ```bash
   npm run verify:deployments:sepolia
   ```

2. **Check token whitelist**
   ```bash
   npx hardhat console --network base-sepolia
   > const registry = await ethers.getContractAt("TokenRegistry", "ADDRESS")
   > await registry.getWhitelistedTokens()
   ```

3. **Test price queries**
   ```bash
   > const oracle = await ethers.getContractAt("AssuranceOracle", "ADDRESS")
   > await oracle.getTokenPriceInUSD("USDC_ADDRESS")
   ```

4. **Create test bond**
   ```bash
   > const deposit = await ethers.getContractAt("BurnerBondDeposit", "ADDRESS")
   > await deposit.makeDeposit(...)
   ```

## 🔒 Security Notes

### Before Mainnet
- ⚠️ Complete security audit required
- ⚠️ Set up multi-sig for all admin functions
- ⚠️ Test all user flows thoroughly
- ⚠️ Document emergency procedures
- ⚠️ Set up monitoring and alerts

### Admin Roles to Secure
- TokenRegistry owner (can whitelist tokens)
- AssurancePool admin (can set oracle)
- AssuranceOracle owner (can set RTD)
- BurnerBondFactory owner (can set parameters)

## 🎓 Next Steps

1. ✅ **Deploy to Base Sepolia**
   ```bash
   npm run deploy:burner-bonds:sepolia
   ```

2. ✅ **Verify Deployment**
   ```bash
   npm run verify:deployments:sepolia
   ```

3. ✅ **Test with Small Amounts**
   - Create test bonds
   - Test redemption
   - Verify pricing

4. ✅ **Integrate with Frontend**
   - Copy deployed addresses
   - Copy ABIs from deployment files
   - Update contract configuration

5. ✅ **End-to-End Testing**
   - Test all user flows
   - Test edge cases
   - Test error handling

6. ⏭️ **Audit** (before mainnet)
   - Security audit
   - Code review
   - Gas optimization

7. ⏭️ **Deploy to Mainnet**
   ```bash
   npm run deploy:burner-bonds:base
   ```

## 📚 Documentation References

- [Deploy README](./deploy/README.md) - Complete deployment documentation
- [Quick Start](./deploy/QUICK_START.md) - Get started in 5 minutes
- [Deployment Guide](./deploy/DEPLOYMENT_GUIDE.md) - Comprehensive guide
- [Token Registry Docs](./docs/token-registry.md) - TokenRegistry details
- [BurnerBond Docs](./docs/burner-bond-complete.md) - System architecture

## 💡 Tips

1. **Use testnet first** - Always deploy to Base Sepolia before mainnet
2. **Save deployment logs** - Keep terminal output for debugging
3. **Verify on explorer** - Confirm contracts on Basescan/Blockscout
4. **Test incrementally** - Test each contract after deployment
5. **Monitor gas costs** - Track deployment costs for mainnet planning

## 🐛 Troubleshooting

### Common Issues

**Deployment fails with "insufficient funds"**
- Solution: Get more testnet ETH from Base Sepolia faucet

**"Token not whitelisted" error**
- Solution: Ensure TokenRegistry deployed and tokens registered

**Verification script fails**
- Solution: Wait a few blocks after deployment, then retry

**Collection creation fails**
- Solution: Verify token is whitelisted in TokenRegistry first

See [DEPLOYMENT_GUIDE.md](./deploy/DEPLOYMENT_GUIDE.md) for more troubleshooting.

## 🎉 Summary

You now have:
- ✅ Complete deployment infrastructure
- ✅ One-command deployment script
- ✅ Verification scripts
- ✅ Comprehensive documentation
- ✅ NPM scripts for all operations
- ✅ Support for Base Sepolia and mainnet
- ✅ Multi-token support (USDC, USDT, DAI, WETH)
- ✅ Upgradeable AssurancePool
- ✅ Automatic collection creation
- ✅ Production-ready configuration

**Ready to deploy!** Start with: `npm run deploy:burner-bonds:sepolia`

