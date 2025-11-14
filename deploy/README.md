# BurnerBond System Deployment

Complete deployment scripts and guides for the BurnerBond system on Base network.

## 📁 Files Overview

### Deployment Scripts

| Script | Description | Usage |
|--------|-------------|-------|
| `deploy_burner_bonds.ts` | **Complete system deployment** - Deploys all contracts in correct order | `npm run deploy:burner-bonds:sepolia` |
| `07_deploy_TokenRegistry.ts` | Deploy TokenRegistry only | `npm run deploy:token-registry base-sepolia` |
| `08_deploy_AssurancePool.ts` | Deploy AssurancePool (upgradeable) | `npm run deploy:assurance-pool base-sepolia` |
| `09_deploy_AssuranceOracle.ts` | Deploy AssuranceOracle | `npm run deploy:assurance-oracle base-sepolia` |
| `10_deploy_BurnerBondFactory.ts` | Deploy Factory + Deposit | `npm run deploy:burner-bond-factory base-sepolia` |
| `verify_deployments.ts` | Verify all deployments | `npm run verify:deployments:sepolia` |

### Documentation

| Document | Description |
|----------|-------------|
| `QUICK_START.md` | Get started quickly with one-command deployment |
| `DEPLOYMENT_GUIDE.md` | Comprehensive deployment guide with all details |
| `README.md` | This file - overview and quick reference |

### Helper Files

| File | Description |
|------|-------------|
| `helpers.ts` | Deployment helper functions for saving/loading deployments |

## 🚀 Quick Start

### Deploy Everything at Once

```bash
# Base Sepolia testnet
npm run deploy:burner-bonds:sepolia

# Base mainnet (production)
npm run deploy:burner-bonds:base
```

### Verify Deployment

```bash
npm run verify:deployments:sepolia
```

## 📋 Available NPM Scripts

```bash
# Complete deployment
npm run deploy:burner-bonds:sepolia        # Deploy to Base Sepolia
npm run deploy:burner-bonds:base           # Deploy to Base mainnet
npm run deploy:burner-bonds <network>      # Deploy to custom network

# Individual contracts
npm run deploy:token-registry <network>
npm run deploy:assurance-pool <network>
npm run deploy:assurance-oracle <network>
npm run deploy:burner-bond-factory <network>

# Verification
npm run verify:deployments:sepolia         # Verify on Base Sepolia
npm run verify:deployments <network>       # Verify on custom network
```

## 🏗️ System Architecture

```
┌─────────────────┐
│  TokenRegistry  │ ← Token whitelist, metadata, fallback prices
└────────┬────────┘
         │
         ↓
┌─────────────────┐     ┌──────────────────┐
│ AssuranceOracle │ ←→  │  AssurancePool   │
└────────┬────────┘     └────────┬─────────┘
         │                       │
         │                       │ Manages reserves
         ↓                       ↓
┌──────────────────────────────────────┐
│       BurnerBondFactory              │
│  ┌────────────────────────────────┐  │
│  │   BurnerBondDeposit (unified)  │  │
│  └────────────────────────────────┘  │
│                                      │
│  Creates ↓                           │
│  ┌──────────────┐  ┌──────────────┐ │
│  │ BurnerBond   │  │ BurnerBond   │ │
│  │ (USDC)       │  │ (WETH)       │ │
│  └──────────────┘  └──────────────┘ │
└──────────────────────────────────────┘
```

## 📊 Deployment Order

The contracts must be deployed in this specific order:

1. **TokenRegistry** - No dependencies
2. **AssurancePool** - No dependencies (upgradeable)
3. **AssuranceOracle** - Requires: AssurancePool, TokenRegistry
4. **BurnerBondFactory** - Requires: AssurancePool, AssuranceOracle
   - Automatically deploys: BurnerBondDeposit
5. **BurnerBond Collections** - Created via Factory as needed

## 🔍 Verification Checklist

After deployment, verify:

- [ ] All contracts deployed successfully
- [ ] AssurancePool has AssuranceOracle set
- [ ] AssuranceOracle has TokenRegistry reference
- [ ] BurnerBondFactory has correct pool and oracle
- [ ] Tokens are whitelisted in TokenRegistry
- [ ] At least one collection created
- [ ] All contract relationships verified

Run: `npm run verify:deployments:sepolia`

## 🌐 Network Configuration

### Base Sepolia (Testnet)

- Chain ID: `84532`
- RPC: `https://sepolia.base.org`
- Explorer: https://base-sepolia.blockscout.com
- Faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet

**Key Addresses:**
```typescript
USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
WETH: "0x4200000000000000000000000000000000000006"
Uniswap V3 Factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"
```

### Base Mainnet (Production)

- Chain ID: `8453`
- RPC: `https://mainnet.base.org`
- Explorer: https://basescan.org

**Key Addresses:**
```typescript
USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
USDT: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"
WETH: "0x4200000000000000000000000000000000000006"
Uniswap V3 Factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"
```

## 📦 Deployment Output

Deployments are saved to: `deployments/<network>/`

Example structure:
```
deployments/
├── base-sepolia/
│   ├── TokenRegistry.json
│   ├── AssurancePool.json
│   ├── AssuranceOracle.json
│   ├── BurnerBondFactory.json
│   ├── BurnerBondDeposit.json
│   └── BurnerBond_USDC.json
└── base/
    └── ... (mainnet deployments)
```

Each JSON file contains:
- Contract address
- ABI
- Block number

## 🛠️ Manual Operations

### Create a New Bond Collection

```bash
npx hardhat console --network base-sepolia
```

```javascript
const factory = await ethers.getContractAt(
  "BurnerBondFactory",
  "YOUR_FACTORY_ADDRESS"
);

const tx = await factory.createCollection(
  "TOKEN_ADDRESS",
  "SYMBOL",
  "Token Name",
  "https://your-metadata-uri.com/api/bonds"
);

await tx.wait();
console.log("Collection created!");
```

### Register a New Token

```javascript
const registry = await ethers.getContractAt(
  "TokenRegistry",
  "YOUR_REGISTRY_ADDRESS"
);

// Set metadata
await registry.setTokenMetadata(
  "TOKEN_ADDRESS",
  "SYMBOL",
  "Token Name",
  18  // decimals
);

// Register with fallback price
await registry.registerToken(
  "TOKEN_ADDRESS",
  84532,  // chain ID
  "TOKEN_ADDRESS",
  ethers.parseEther("100")  // $100 fallback price
);
```

### Update Global Parameters

```javascript
const factory = await ethers.getContractAt(
  "BurnerBondFactory",
  "YOUR_FACTORY_ADDRESS"
);

// Update discount and maturity parameters
await factory.updateGlobalParameters(
  5000,  // maxDiscount: 50% (in basis points)
  0,     // minDiscount: 0%
  30 * 365 * 24 * 60 * 60  // maxMaturity: 30 years (in seconds)
);
```

## 🔐 Security Considerations

### Before Mainnet Deployment

- [ ] Complete security audit
- [ ] Set up multi-sig for admin operations
- [ ] Test all user flows on testnet
- [ ] Document emergency procedures
- [ ] Set up monitoring and alerts
- [ ] Prepare incident response plan
- [ ] Review and test upgrade procedures (for upgradeable contracts)

### Admin Access Control

These roles need careful management:

| Contract | Admin Functions | Recommendation |
|----------|----------------|----------------|
| TokenRegistry | Register/remove tokens, set prices | Multi-sig |
| AssurancePool | Set oracle, manage reserves | Multi-sig |
| AssuranceOracle | Set target RTD, update prices | Multi-sig |
| BurnerBondFactory | Global parameters, create collections | Multi-sig |

## 📚 Additional Resources

- [Quick Start Guide](./QUICK_START.md) - Get started in 5 minutes
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Complete deployment documentation
- [Smart Contract Docs](../docs/architecture/smart-contracts.md) - Architecture overview
- [Token Registry Docs](../docs/token-registry.md) - TokenRegistry details
- [BurnerBond Docs](../docs/burner-bond-complete.md) - BurnerBond system details

## 🐛 Troubleshooting

### Common Issues

**"Transaction reverted" during deployment**
- Check you have sufficient ETH for gas
- Verify network is accessible
- Ensure dependencies are deployed first

**"Token not whitelisted" error**
- Deploy TokenRegistry first
- Register token using `registerToken()`
- Verify with `isTokenWhitelisted()`

**Verification fails on Basescan**
- Ensure contract is fully confirmed (wait a few blocks)
- Use correct constructor arguments
- Check compiler settings match deployment

**Collection creation fails**
- Ensure token is whitelisted first
- Check AssuranceOracle is properly configured
- Verify factory has correct oracle reference

### Getting Help

1. Check deployment logs for error details
2. Run verification script: `npm run verify:deployments:sepolia`
3. Review contract events on block explorer
4. Check GitHub issues for similar problems

## 📝 Development

### Run Tests Before Deployment

```bash
npm run test
npm run test:coverage
npm run test:gas
```

### Compile Contracts

```bash
npm run compile
```

### Local Testing

```bash
# Start local node
npx hardhat node

# Deploy to local
npm run deploy:burner-bonds localhost
```

## 🎯 Best Practices

1. **Always deploy to testnet first**
2. **Verify all contracts on block explorer**
3. **Test with small amounts initially**
4. **Use multi-sig for production**
5. **Monitor gas costs during deployment**
6. **Save deployment logs and addresses**
7. **Document any custom configurations**
8. **Test upgrade procedures (for upgradeable contracts)**

---

**Need Help?** 
- 📖 Read the full [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- 🚀 Follow the [Quick Start](./QUICK_START.md)
- 🐛 Check GitHub Issues

