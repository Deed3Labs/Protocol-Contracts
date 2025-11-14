# Quick Start: Deploy BurnerBond System to Base Sepolia

This is a quick guide to get the BurnerBond system deployed and running on Base Sepolia testnet.

## Prerequisites Checklist

- [ ] Node.js v16+ installed
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file configured with `DEPLOYER_PRIVATE_KEY`
- [ ] Deployer wallet has testnet ETH on Base Sepolia

### Get Testnet ETH

1. Visit Base Sepolia faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
2. Or bridge from Sepolia: https://bridge.base.org/

## One-Command Deployment

Deploy the entire system with a single command:

```bash
npm run deploy:burner-bonds:sepolia
```

This will deploy:
1. ✅ TokenRegistry
2. ✅ AssurancePool (upgradeable)
3. ✅ AssuranceOracle
4. ✅ BurnerBondFactory + BurnerBondDeposit
5. ✅ USDC BurnerBond collection

Expected output:
```
═══════════════════════════════════════════════════════════
🚀 BurnerBond System Deployment
═══════════════════════════════════════════════════════════
...
✅ Deployment Complete!
```

## Verify Deployment

Check everything is working:

```bash
npx hardhat run deploy/verify_deployments.ts --network base-sepolia
```

This will verify:
- ✅ All contracts deployed
- ✅ Contract relationships configured
- ✅ Tokens whitelisted
- ✅ Parameters set correctly

## Test the System

### 1. Check Whitelisted Tokens

```bash
npx hardhat console --network base-sepolia
```

```javascript
const TokenRegistry = await ethers.getContractAt(
  "TokenRegistry",
  "YOUR_TOKEN_REGISTRY_ADDRESS"
);

const tokens = await TokenRegistry.getWhitelistedTokens();
console.log("Whitelisted tokens:", tokens);
```

### 2. Create a Test Bond

```javascript
const USDC = await ethers.getContractAt(
  "IERC20",
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" // USDC on Base Sepolia
);

const BurnerBondDeposit = await ethers.getContractAt(
  "BurnerBondDeposit",
  "YOUR_DEPOSIT_ADDRESS"
);

// Approve USDC
const amount = ethers.parseUnits("100", 6); // $100 worth
await USDC.approve(BurnerBondDeposit.address, amount);

// Create bond (1 year maturity, 25% discount)
const maturityDate = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
const tx = await BurnerBondDeposit.makeDeposit(
  USDC.address,
  ethers.parseUnits("100", 6),  // $100 face value
  maturityDate,
  2500  // 25% discount (25% = 2500 basis points)
);

const receipt = await tx.wait();
console.log("Bond created! Transaction:", receipt.hash);
```

## Deployed Contract Addresses

After deployment, find your addresses in:
```
deployments/base-sepolia/
├── TokenRegistry.json
├── AssurancePool.json
├── AssuranceOracle.json
├── BurnerBondFactory.json
├── BurnerBondDeposit.json
└── BurnerBond_USDC.json
```

## Update Frontend

Copy the deployed addresses to your frontend configuration:

```typescript
// src/contracts/config.ts
export const CONTRACTS = {
  tokenRegistry: "0x...",      // From TokenRegistry.json
  assurancePool: "0x...",      // From AssurancePool.json
  assuranceOracle: "0x...",    // From AssuranceOracle.json
  burnerBondFactory: "0x...",  // From BurnerBondFactory.json
  burnerBondDeposit: "0x...",  // From BurnerBondDeposit.json
};
```

Copy the ABIs from the JSON files for contract interaction.

## Verify Contracts on Basescan

After deployment, verify your contracts:

```bash
# TokenRegistry
npx hardhat verify --network base-sepolia TOKEN_REGISTRY_ADDRESS

# AssurancePool (proxy)
npx hardhat verify --network base-sepolia ASSURANCE_POOL_ADDRESS

# AssuranceOracle
npx hardhat verify --network base-sepolia ASSURANCE_ORACLE_ADDRESS \
  "ASSURANCE_POOL_ADDRESS" \
  "1000000000000000000" \
  "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" \
  "0x4200000000000000000000000000000000000006" \
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" \
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" \
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" \
  "TOKEN_REGISTRY_ADDRESS"

# BurnerBondFactory
npx hardhat verify --network base-sepolia BURNER_BOND_FACTORY_ADDRESS \
  "ASSURANCE_POOL_ADDRESS" \
  "ASSURANCE_ORACLE_ADDRESS" \
  "https://protocol.com/api/bonds"
```

## Common Issues

### "Insufficient funds" error
- Get more testnet ETH from faucet
- Each deployment costs ~0.1-0.5 ETH in gas

### "Token not whitelisted" error
- Ensure TokenRegistry deployed successfully
- Check token was registered (run verification script)
- Check oracle can see whitelist

### "Collection does not exist" error
- Normal for first deposit - collection auto-creates
- Or manually create: `factory.createCollection(tokenAddress, ...)`

### "Contract deployment failed"
- Check network connection
- Verify you're on Base Sepolia (chainId: 84532)
- Ensure sufficient gas

## Next Steps

1. ✅ Deploy to testnet (you're here!)
2. ⏭️ Test with small amounts
3. ⏭️ Integrate with frontend
4. ⏭️ Test user flows end-to-end
5. ⏭️ Audit contracts
6. ⏭️ Deploy to mainnet

## Need Help?

- 📖 Read full docs: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- 🐛 Check GitHub issues
- 💬 Ask in Discord

## Mainnet Deployment

⚠️ **Do NOT deploy to mainnet until:**
- [ ] Contracts are audited
- [ ] Thorough testnet testing completed
- [ ] Frontend integration tested
- [ ] Emergency procedures documented
- [ ] Multi-sig setup for admin functions

When ready for mainnet:
```bash
npm run deploy:burner-bonds:base
```

