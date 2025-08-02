# Installation and Setup Guide

This guide provides comprehensive instructions for setting up The Deed Protocol, including local development, deployment, and configuration options.

## 🎯 Overview

The Deed Protocol consists of two main components:
- **Smart Contracts**: Solidity contracts deployed on blockchain networks
- **Frontend Application**: React-based web interface for user interactions

## 📋 Prerequisites

### System Requirements

- **Node.js**: Version 18.0.0 or higher
- **npm**: Version 8.0.0 or higher (or yarn)
- **Git**: Version 2.0.0 or higher
- **Hardhat**: For smart contract development and deployment

### Development Tools

- **Code Editor**: VS Code (recommended) or similar
- **Browser**: Chrome, Firefox, Safari, or Edge
- **Web3 Wallet**: MetaMask or compatible wallet

### Network Access

- **Ethereum RPC**: Access to Ethereum mainnet and testnets
- **Base RPC**: Access to Base mainnet and testnets
- **IPFS**: For decentralized document storage (optional)

## 🚀 Quick Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Deed3Labs/Protocol-Contracts.git
cd Protocol-Contracts
```

### 2. Install Dependencies

```bash
# Install root dependencies (smart contracts)
npm install

# Install frontend dependencies
cd app
npm install
```

### 3. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

### 4. Start Development

```bash
# Start frontend development server
cd app
npm run dev

# In another terminal, start local blockchain
npx hardhat node
```

## 🔧 Detailed Setup

### Smart Contract Setup

#### 1. Contract Compilation

```bash
# Compile all contracts
npx hardhat compile

# Check contract sizes
npm run check-contract-size
```

#### 2. Network Configuration

Edit `hardhat.config.ts` to configure networks:

```typescript
networks: {
  localhost: {
    url: "http://127.0.0.1:8545",
    chainId: 1337,
    accounts: [deployerPrivateKey],
  },
  sepolia: {
    url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
    chainId: 11155111,
    accounts: [deployerPrivateKey],
  },
  "base-sepolia": {
    url: `https://sepolia.base.org`,
    chainId: 84532,
    accounts: [deployerPrivateKey],
  },
}
```

#### 3. Deployment Scripts

```bash
# Deploy to local network
npx hardhat run deploy/deploy_all.ts --network localhost

# Deploy to testnet
npx hardhat run deploy/deploy_all.ts --network sepolia

# Deploy to mainnet
npx hardhat run deploy/deploy_all.ts --network ethereum
```

### Frontend Setup

#### 1. Configuration

Edit `app/src/config/networks.ts`:

```typescript
export const SUPPORTED_NETWORKS = [
  {
    chainId: 1,
    name: "Ethereum Mainnet",
    rpcUrl: "https://mainnet.infura.io/v3/YOUR_API_KEY",
    explorer: "https://etherscan.io",
    contracts: {
      DeedNFT: "0x...",
      Validator: "0x...",
      // ... other contracts
    }
  },
  // ... other networks
];
```

#### 2. Environment Variables

Create `app/.env`:

```env
# API Keys (optional - for production)
VITE_ALCHEMY_ETH_MAINNET=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
VITE_ALCHEMY_ETH_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
VITE_ALCHEMY_BASE_MAINNET=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY
VITE_ALCHEMY_BASE_SEPOLIA=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Infura API Keys (optional - for production)
VITE_INFURA_ETH_MAINNET=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
VITE_INFURA_ETH_SEPOLIA=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
```

#### 3. Development Server

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🏗️ Deployment Options

### Local Development

#### 1. Local Blockchain

```bash
# Start local Hardhat node
npx hardhat node

# Deploy contracts locally
npx hardhat run deploy/deploy_all.ts --network localhost

# Start frontend
cd app && npm run dev
```

#### 2. Local Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:core
npm run test:extensions
npm run test:integration

# Generate coverage report
npm run test:coverage
```

### Testnet Deployment

#### 1. Sepolia Testnet

```bash
# Set environment variables
export DEPLOYER_PRIVATE_KEY="your_private_key"
export INFURA_API_KEY="your_infura_key"

# Deploy contracts
npx hardhat run deploy/deploy_all.ts --network sepolia

# Verify contracts
npx hardhat verify --network sepolia DEPLOYED_CONTRACT_ADDRESS
```

#### 2. Base Sepolia Testnet

```bash
# Deploy to Base Sepolia
npx hardhat run deploy/deploy_all.ts --network base-sepolia

# Verify contracts
npx hardhat verify --network base-sepolia DEPLOYED_CONTRACT_ADDRESS
```

### Mainnet Deployment

#### 1. Ethereum Mainnet

```bash
# Deploy to Ethereum mainnet
npx hardhat run deploy/deploy_all.ts --network ethereum

# Verify contracts
npx hardhat verify --network ethereum DEPLOYED_CONTRACT_ADDRESS
```

#### 2. Base Mainnet

```bash
# Deploy to Base mainnet
npx hardhat run deploy/deploy_all.ts --network base

# Verify contracts
npx hardhat verify --network base DEPLOYED_CONTRACT_ADDRESS
```

## 🌐 Frontend Deployment

### Static Hosting

#### 1. Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to Vercel
cd app
vercel --prod
```

#### 2. Netlify Deployment

```bash
# Build the application
npm run build

# Deploy to Netlify
netlify deploy --prod --dir=dist
```

#### 3. GitHub Pages

```bash
# Build the application
npm run build

# Deploy to GitHub Pages
npm run deploy:gh-pages
```

### Docker Deployment

#### 1. Create Dockerfile

```dockerfile
# Dockerfile for frontend
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

#### 2. Build and Run

```bash
# Build Docker image
docker build -t deed-protocol-frontend .

# Run container
docker run -p 3000:3000 deed-protocol-frontend
```

## 🔧 Configuration

### Smart Contract Configuration

#### 1. Contract Parameters

Edit deployment scripts in `deploy/`:

```typescript
// DeedNFT configuration
const deedNFTConfig = {
  name: "DeedNFT",
  symbol: "DEED",
  baseURI: "https://api.deed3.io/metadata/",
  royaltyPercentage: 500, // 5%
  maxSupply: 10000,
};
```

#### 2. Validator Configuration

```typescript
// Validator configuration
const validatorConfig = {
  baseUri: "https://api.deed3.io/validator/",
  defaultOperatingAgreementUri: "https://api.deed3.io/agreements/default",
  royaltyFeePercentage: 500, // 5%
};
```

### Frontend Configuration

#### 1. Network Configuration

Edit `app/src/config/networks.ts`:

```typescript
export const NETWORK_CONFIG = {
  ethereum: {
    chainId: 1,
    name: "Ethereum",
    rpcUrl: process.env.VITE_ALCHEMY_ETH_MAINNET,
    contracts: {
      DeedNFT: "0x...",
      Validator: "0x...",
    },
  },
  // ... other networks
};
```

#### 2. Feature Flags

```typescript
export const FEATURE_FLAGS = {
  ENABLE_VALIDATION: true,
  ENABLE_TRANSFER: true,
  ENABLE_ADMIN_PANEL: true,
  ENABLE_FAUCET: process.env.NODE_ENV === 'development',
};
```

## 🔒 Security Configuration

### Environment Variables

#### 1. Required Variables

```env
# Deployment
DEPLOYER_PRIVATE_KEY=your_private_key
DEPLOYER_ACCOUNT=your_wallet_address

# API Keys
ALCHEMY_API_KEY=your_alchemy_key
INFURA_API_KEY=your_infura_key
ETHERSCAN_API_KEY=your_etherscan_key

# Security
JWT_SECRET=your_jwt_secret
ENCRYPTION_KEY=your_encryption_key
```

#### 2. Optional Variables

```env
# Monitoring
SENTRY_DSN=your_sentry_dsn
ANALYTICS_ID=your_analytics_id

# External Services
IPFS_GATEWAY=https://ipfs.io/ipfs/
STORAGE_BUCKET=your_storage_bucket
```

### Access Control

#### 1. Role Configuration

```typescript
// Define roles
const ROLES = {
  VALIDATOR_ROLE: "0x...",
  ADMIN_ROLE: "0x...",
  METADATA_ROLE: "0x...",
};

// Grant roles
await contract.grantRole(ROLES.VALIDATOR_ROLE, validatorAddress);
await contract.grantRole(ROLES.ADMIN_ROLE, adminAddress);
```

#### 2. Multi-Signature Setup

```typescript
// Multi-signature wallet configuration
const MULTISIG_CONFIG = {
  owners: [owner1, owner2, owner3],
  threshold: 2,
  delay: 86400, // 24 hours
};
```

## 📊 Monitoring and Analytics

### Contract Monitoring

#### 1. Event Tracking

```typescript
// Monitor important events
contract.on("Transfer", (from, to, tokenId) => {
  console.log(`Token ${tokenId} transferred from ${from} to ${to}`);
});

contract.on("ValidationUpdated", (tokenId, isValid, validator) => {
  console.log(`Token ${tokenId} validation updated by ${validator}`);
});
```

#### 2. Health Checks

```typescript
// Contract health check
async function checkContractHealth() {
  const isPaused = await contract.paused();
  const totalSupply = await contract.totalSupply();
  const validatorCount = await validatorRegistry.getValidatorCount();
  
  return {
    isPaused,
    totalSupply: totalSupply.toString(),
    validatorCount: validatorCount.toString(),
  };
}
```

### Frontend Monitoring

#### 1. Error Tracking

```typescript
// Error boundary setup
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: process.env.VITE_SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

#### 2. Performance Monitoring

```typescript
// Performance metrics
const performanceMetrics = {
  pageLoadTime: performance.now(),
  transactionTime: 0,
  validationTime: 0,
};
```

## 🧪 Testing

### Contract Testing

```bash
# Run all tests
npm test

# Run specific test files
npm test test/core/DeedNFT.spec.ts
npm test test/core/Validator.spec.ts

# Run with gas reporting
REPORT_GAS=true npm test

# Run with coverage
npm run test:coverage
```

### Frontend Testing

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e
```

### Load Testing

```bash
# Contract load testing
npm run test:load

# Frontend load testing
npm run test:frontend-load
```

## 🔄 Maintenance

### Regular Tasks

#### 1. Contract Maintenance

```bash
# Check contract sizes
npm run check-contract-size

# Update dependencies
npm update

# Security audit
npm audit
```

#### 2. Frontend Maintenance

```bash
# Update dependencies
npm update

# Security audit
npm audit

# Build optimization
npm run build:analyze
```

### Backup and Recovery

#### 1. Contract Backup

```bash
# Export contract addresses
npx hardhat run scripts/export-contract.ts --network mainnet

# Backup deployment artifacts
cp -r deployments/ ./backup/
```

#### 2. Frontend Backup

```bash
# Backup configuration
cp app/src/config/networks.ts ./backup/

# Backup environment variables
cp app/.env ./backup/
```

## 🆘 Troubleshooting

### Common Issues

#### 1. Contract Deployment Failures

**Problem**: Gas limit exceeded
**Solution**: Increase gas limit in deployment script

**Problem**: Network connection issues
**Solution**: Check RPC endpoint and network configuration

#### 2. Frontend Issues

**Problem**: Build failures
**Solution**: Check Node.js version and dependencies

**Problem**: Runtime errors
**Solution**: Check environment variables and configuration

#### 3. Network Issues

**Problem**: Wrong network connected
**Solution**: Switch to correct network in wallet

**Problem**: RPC endpoint down
**Solution**: Use alternative RPC endpoint

### Debug Commands

```bash
# Check contract deployment
npx hardhat run scripts/check_owner.ts --network mainnet

# Debug contract interactions
npx hardhat run scripts/debug-metadata.ts --network mainnet

# Check network status
npx hardhat run scripts/check-network.ts --network mainnet
```

## 📞 Support

### Getting Help

- **Documentation**: Check the full documentation
- **GitHub Issues**: Report bugs or request features
- **Discord**: Join community discussions
- **Email**: dev@deed3.io

### Contributing

- **Fork Repository**: Create your own fork
- **Create Branch**: Make changes in feature branch
- **Submit PR**: Create pull request with description
- **Code Review**: Address review comments

---

*This installation guide is part of The Deed Protocol v0.2.0-beta. For additional support, please contact the development team.* 