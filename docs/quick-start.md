# Quick Start Guide

Get up and running with The Deed Protocol in minutes! This guide will help you quickly understand the basics and start using the platform.

## ⚡ 5-Minute Setup

### 1. Connect Your Wallet (1 minute)

1. **Install a Web3 Wallet**
   - [MetaMask](https://metamask.io/) (Recommended)
   - [WalletConnect](https://walletconnect.com/)
   - Or use Reowns AppKit

2. **Connect to the Protocol**
   - Visit the Deed Protocol application
   - Click "Connect Wallet"
   - Approve the connection

3. **Select Network**
   - Choose Ethereum or Base (mainnet)
   - Or use Sepolia/Base Sepolia (testnet)

### 2. Explore the Interface (2 minutes)

**Main Sections:**
- **Dashboard**: View your assets and activity
- **Mint**: Create new DeedNFTs
- **Explore**: Browse existing assets
- **Validation**: Review assets (validators only)

**Key Features:**
- Asset management dashboard
- Document upload and storage
- Transfer and sale interface
- Validation tracking

### 3. Mint Your First Asset (2 minutes)

1. **Select Asset Type**
   - Land, Vehicle, Estate, or Equipment
   - Choose appropriate subcategory

2. **Enter Basic Information**
   - Asset name and description
   - Required metadata fields
   - Legal information

3. **Upload Documents**
   - Title deeds or registration
   - Surveys or inspection reports
   - Supporting documentation

4. **Submit for Minting**
   - Review all information
   - Confirm transaction
   - Wait for blockchain confirmation

## 🎯 Common Use Cases

### For Asset Owners

**Scenario**: You own a piece of land and want to tokenize it

1. **Prepare Documents**
   - Title deed
   - Property survey
   - Zoning certificate

2. **Mint DeedNFT**
   - Select "Land" asset type
   - Enter property details
   - Upload documents
   - Submit for validation

3. **Track Progress**
   - Monitor validation status
   - Respond to validator requests
   - Access validated asset

**Scenario**: You want to sell your vehicle as an NFT

1. **Gather Information**
   - Vehicle registration
   - VIN number
   - Condition report

2. **Create Vehicle NFT**
   - Select "Vehicle" asset type
   - Enter vehicle details
   - Upload registration documents

3. **List for Sale**
   - Set price and terms
   - Create listing
   - Manage inquiries

### For Validators

**Scenario**: You're a professional validator reviewing assets

1. **Access Validation Interface**
   - Connect wallet with VALIDATOR_ROLE
   - Navigate to Validation page
   - View pending validations

2. **Review Assets**
   - Examine metadata and documents
   - Verify against criteria
   - Check compliance

3. **Update Status**
   - Approve or reject validation
   - Add notes and reasoning
   - Issue validation certificate

## 🔧 Essential Commands

### Wallet Operations

```javascript
// Connect wallet
await connectWallet()

// Switch networks
await switchNetwork('ethereum')

// Check balance
const balance = await getBalance()
```

### Asset Operations

```javascript
// Mint new asset
await mintAsset(assetData, documents)

// Transfer asset
await transferAsset(tokenId, recipient)

// Update metadata
await updateMetadata(tokenId, newData)
```

### Validation Operations

```javascript
// Validate asset
await validateAsset(tokenId, isValid, notes)

// Update validation criteria
await updateCriteria(assetType, criteria)

// Check validation status
const status = await getValidationStatus(tokenId)
```

## 📋 Quick Reference

### Supported Asset Types

| Asset Type | Required Documents | Validation Time |
|------------|-------------------|-----------------|
| Land | Title deed, Survey, Zoning | 3-5 business days |
| Vehicle | Registration, VIN, Condition | 1-2 business days |
| Estate | Property deed, Inspection | 3-7 business days |
| Equipment | Registration, Maintenance | 2-4 business days |

### Network Information

| Network | Type | Gas Fees | Speed |
|---------|------|----------|-------|
| Ethereum | Mainnet | High | Medium |
| Base | Mainnet | Low | Fast |
| Sepolia | Testnet | Free | Fast |
| Base Sepolia | Testnet | Free | Fast |

### Common Gas Estimates

| Operation | Ethereum | Base |
|-----------|----------|------|
| Mint Asset | 0.01-0.05 ETH | 0.001-0.005 ETH |
| Transfer | 0.005-0.02 ETH | 0.0005-0.002 ETH |
| Update Metadata | 0.01-0.03 ETH | 0.001-0.003 ETH |

## ⚠️ Important Notes

### Before You Start

- **Test First**: Use testnet for learning
- **Documentation**: Keep all documents ready
- **Gas Fees**: Ensure sufficient balance
- **Network**: Choose appropriate network

### Common Mistakes to Avoid

- **Incomplete Information**: Fill all required fields
- **Poor Document Quality**: Upload clear, legible documents
- **Wrong Network**: Ensure you're on the correct network
- **Insufficient Gas**: Check gas fee estimates

### Security Best Practices

- **Wallet Security**: Use secure wallet practices
- **Document Privacy**: Be careful with sensitive information
- **Transaction Verification**: Double-check all transactions
- **Backup**: Keep copies of important documents

## 🆘 Getting Help

### Immediate Support

- **Documentation**: Check the full user guide
- **Community**: Join Discord or Telegram
- **Email**: dev@deed3.io
- **GitHub Issues**: Report bugs or request features

### Learning Resources

- **Tutorial Videos**: Step-by-step guides
- **Webinars**: Live educational sessions
- **Blog**: Latest updates and tips
- **Case Studies**: Real-world examples

## 🚀 Next Steps

### For Asset Owners

1. **Complete Your First Mint**
   - Follow the minting process
   - Track validation progress
   - Learn from the experience

2. **Explore Advanced Features**
   - Asset transfer and sale
   - Metadata updates
   - Document management

3. **Join the Community**
   - Participate in discussions
   - Share experiences
   - Learn from others

### For Validators

1. **Set Up Validation Workflow**
   - Configure validation criteria
   - Establish review processes
   - Create documentation standards

2. **Build Professional Network**
   - Connect with other validators
   - Share best practices
   - Develop expertise

3. **Contribute to Protocol**
   - Provide feedback
   - Suggest improvements
   - Help with documentation

### For Developers

1. **Explore Integration Options**
   - API documentation
   - Smart contract interfaces
   - Frontend components

2. **Build Applications**
   - Create custom interfaces
   - Develop specialized tools
   - Integrate with existing systems

3. **Contribute to Development**
   - Submit pull requests
   - Report issues
   - Share ideas

---

*This quick start guide is part of The Deed Protocol v0.2.0-beta. For comprehensive documentation, see the full user guide and technical documentation.* 