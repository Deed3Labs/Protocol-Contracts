# The Deed Protocol - Smart Contracts

This repository contains the smart contracts for **The Deed Protocol**, which facilitates decentralized (P2P) Real World Asset transactions via Smart Contracts. These contracts represent real world assets as Secured Digital Representations (SDRs), ensuring seamless integration with external validation services and enabling future enhancements.

> ⚠️ **BETA WARNING**: This protocol is currently in beta. Use at your own risk. The contracts have not been audited and may contain bugs or security vulnerabilities.

## Overview

The Deed Protocol uses legal engineering to merge technology with Real World Assets by tokenizing ownership, validation and administration. Each property deed or title is represented as a unique non-fungible token (NFT) on the blockchain, providing decentralized, secure, and transparent records of ownership.

Key components of the protocol include:
- **DeedNFT**: The core ERC721 NFT representing real-world assets with dynamic metadata support.
- **Validator**: Asset validation and verification system with multi-asset support.
- **ValidatorRegistry**: Registry for managing authorized validators and their capabilities.
- **FundManager**: Financial operations including payment processing and commission management.
- **MetadataRenderer**: Standardized metadata management with ERC-7496 dynamic traits.
- **ValidatorFactory**: Factory for deploying standardized validator instances.
- **Subdivide**: Asset subdivision into ERC1155 units for property division.
- **Fractionalize**: Fractional ownership via ERC20 tokens for REIT functionality.
- **FractionToken**: ERC20 tokens representing fractional asset shares.
- **FractionTokenFactory**: Factory for deploying fraction token contracts.
- **BurnerBondFactory**: Factory for creating token-specific bond collections.
- **BurnerBond**: ERC-1155 NFT bonds with discounted pricing and maturity dates.
- **BurnerBondDeposit**: Unified deposit contract for multi-token bond creation.
- **AssurancePool**: Multi-token reserve management for protocol liquidity.
- **AssuranceOracle**: Price oracle and token validation system.
- **TokenRegistry**: Centralized token whitelist and metadata registry.

## Project Structure

```
contracts/
├── core/              # Core protocol contracts
│   ├── interfaces/    # Contract interfaces
│   ├── factories/     # Factory contracts
│   │   ├── ValidatorFactory.sol
│   │   ├── FractionTokenFactory.sol
│   │   └── BurnerBondFactory.sol
│   ├── DeedNFT.sol    # Main ERC721 NFT contract
│   ├── Validator.sol  # Asset validation logic
│   ├── ValidatorRegistry.sol
│   ├── FundManager.sol
│   ├── MetadataRenderer.sol
│   └── FractionToken.sol
├── extensions/        # Extension contracts
│   ├── Fractionalize.sol
│   └── Subdivide.sol
├── peripherals/       # Peripheral contracts
│   ├── BurnerBond.sol
│   ├── BurnerBondDeposit.sol
│   ├── AssurancePool.sol
│   ├── AssuranceOracle.sol
│   └── TokenRegistry.sol
└── libraries/         # Shared libraries
```

## Asset Types
The protocol supports various types of real-world assets:
- **Land**: Real estate properties and land parcels
- **Vehicle**: Automotive and transportation assets
- **Estate**: Residential and commercial properties
- **Heavy Equipment**: Commercial, industrial and agricultural equipment

Each asset type has specific validation criteria and metadata structures to ensure accurate representation and compliance.

## Core Contracts

### 1. DeedNFT

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/DeedNFT.sol)

The `DeedNFT` contract is the core ERC721 token representing real world assets. It includes several important features:

- **On-Chain Metadata Storage:** Implements ERC-7496 for dynamic trait storage, allowing flexible and efficient on-chain metadata management.
- **Validation Integration:** Works in conjunction with validator contracts to ensure that deed data is authentic and correct.
- **Batch Minting:** Supports the minting of multiple deed tokens in a single transaction, reducing gas costs.
- **Upgradability:** Designed with future enhancements in mind using the UUPS (Universal Upgradeable Proxy Standard) pattern for seamless contract upgrades.
- **Royalty Enforcement:** Implements ERC721C for on-chain royalty enforcement with marketplace approval system.
- **FundManager Integration:** Seamless integration with FundManager for commission handling and fee distribution.

### Royalty System

The protocol implements a comprehensive royalty system with the following features:

- **On-Chain Royalties:** Implements ERC2981 for standardized royalty payments
- **Marketplace Control:** 
  - Marketplace approval system for regulated trading
  - Transfer validation for secure asset movement
  - Wallet limits and transfer restrictions
- **Royalty Distribution:**
  - Validator-based royalty percentage (default 5%)
  - Commission system for platform fees
  - Automated royalty collection and distribution
- **Security Features:**
  - Royalty enforcement controls
  - Marketplace whitelisting
  - Transfer validation system

The royalty system works in conjunction with the `Validator` and `FundManager` contracts to ensure proper distribution of fees and royalties.

### 2. Validator

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/Validator.sol)

The `Validator` contract is responsible for verifying deed data and managing validation criteria. This contract works in tandem with the `ValidatorRegistry` to ensure that only authorized validators can validate deeds.

- **Service Fee Handling:** Manages service fees and token whitelisting for transactions.
- **Royalty Management:** Handles royalty fee percentages and receiver addresses.
- **Operating Agreement Management:** Manages operating agreements (legal wrapper) associated to each property, storing and retrieving them as needed.
- **Integration with the Registry:** Works alongside the ValidatorRegistry to ensure that only authorized validators perform deed validations.
- **Validation Criteria Management:** Offers flexibility to define specific validation criteria for different types of properties or regional requirements.
- **Multi-DeedNFT Support:** Supports multiple compatible DeedNFT contracts with primary contract designation.
- **FundManager Integration:** Seamless integration for fee management and distribution.
- **Asset Type Validation:** Implements specific validation rules for different asset types (Land, Vehicle, Estate, Commercial Equipment).

### 3. ValidatorRegistry

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/ValidatorRegistry.sol)

The `ValidatorRegistry` contract manages a list of authorized validators, ensuring that only trusted and approved validators can interact with the `DeedNFT` contract.

- **Validator Registration:** Allows new validators to be registered, as well as updates or removals of existing ones.
- **Centralized Validation Control:** Ensures that only trusted validators can interact with the DeedNFT contract, thereby maintaining the integrity of the validation process.
- **Governance and Administration:** Supports role-based permissions to manage who can add or remove validators, contributing to the overall security of the protocol.
- **FundManager Integration:** Manages validator roles and permissions for fee management.
- **Enhanced Status Tracking:** Improved tracking of validator operational status and capabilities.

### 4. FundManager

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/FundManager.sol)

The `FundManager` contract manages financial operations and fee distribution within the protocol:

- **Payment Processing:** Handles payment processing for validator services with automatic commission calculation.
- **Commission Management:** Manages platform commission fees with configurable percentages and fee receiver addresses.
- **Validator Fee Distribution:** Distributes validator fees and manages validator fee balances.
- **Token Management:** Supports whitelisted payment tokens and compatible DeedNFT contracts.
- **Role-Based Access Control:** Implements comprehensive role management for financial operations.
- **Multi-Token Support:** Supports various payment tokens for flexible fee collection.
- **Secure Operations:** Integrates with other core contracts to ensure secure financial transactions.
- **Fee Tracking:** Provides detailed fee tracking and balance management for validators.

### 5. MetadataRenderer

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/MetadataRenderer.sol)

The `MetadataRenderer` contract is responsible for generating and managing token metadata in a standardized format:

- **Dynamic Metadata Generation:** Generates rich, structured metadata for tokens
- **Asset Type Support:** Handles different asset types with specific metadata structures
- **Document Management:** Supports storing and retrieving property documents
- **Gallery Management:** Manages multiple images per token
- **Feature Tracking:** Maintains lists of features for each token
- **Custom Metadata:** Allows for custom metadata fields while maintaining standardization
- **Trait Management:** Handles dynamic trait updates and synchronization with DeedNFT
- **Enhanced Document Management:** Improved document type handling and organization

### 6. ValidatorFactory

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/factories/ValidatorFactory.sol)

The `ValidatorFactory` contract provides a standardized way to deploy new validator instances:

- **Standardized Deployment:** Ensures consistent configuration of new validator instances
- **Configuration Management:** Handles initialization parameters and default settings
- **Role Assignment:** Automatically sets up required roles and permissions
- **Integration Setup:** Configures connections with other protocol contracts
- **Validation Criteria:** Sets up default validation rules for different asset types

## Interface Contracts

### 1. IDeedNFT

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/interfaces/IDeedNFT.sol)

Defines the interface for the core DeedNFT functionality, including trait management, validation, and asset operations.

### 2. IValidator

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/interfaces/IValidator.sol)

Defines the interface for validator functionality, outlining the functions that any validator contract must implement to interact with the protocol.

### 3. IValidatorRegistry

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/interfaces/IValidatorRegistry.sol)

Specifies the interface for the validator registry, ensuring that implementations provide necessary registry management functions.

### 4. IMetadataRenderer

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/interfaces/IMetadataRenderer.sol)

Defines the interface for metadata rendering functionality, including trait synchronization and metadata generation.

### 5. IFundManager

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/interfaces/IFundManager.sol)

Specifies the interface for fund management operations, including commission handling and fund distribution.

## Extension Contracts

### 1. Subdivide

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/blob/main/contracts/extensions/Subdivide.sol)

The `Subdivide` contract enables the creation of ERC1155 tokens representing subdivided units from a single DeedNFT:

- **Asset Subdivision:** Splits a single DeedNFT into multiple distinct ERC1155 units
- **Unit Management:** Individual unit creation, transfer, and validation
- **Dynamic Traits:** ERC-7496 implementation for unit-level trait management
- **Royalty Support:** ERC-2981 royalty standard for unit-level royalties
- **Validation Integration:** Unit-specific validation through the Validator contract
- **Metadata Management:** Separate metadata for each subdivided unit
- **Security Features:** Pausable functionality and role-based access control

### 2. Fractionalize

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/blob/main/contracts/extensions/Fractionalize.sol)

The `Fractionalize` contract enables the creation of ERC20 tokens representing fractional ownership of DeedNFTs or subdivision units:

- **Fractional Ownership:** Converts DeedNFTs or subdivision units into tradeable ERC20 shares
- **Asset Locking:** Securely locks the original asset while shares are active
- **Share Management:** Mint, burn, and transfer fractional shares
- **Approval System:** Requires approval for asset unlocking
- **Factory Integration:** Integrates with FractionTokenFactory for token deployment
- **Security Features:** Pausable functionality and role-based access control
- **Multi-Asset Support:** Supports both DeedNFTs and subdivision units

### 3. FractionToken

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/blob/main/contracts/core/FractionToken.sol)

The `FractionToken` contract represents ERC20 tokens for fractional asset ownership:

- **ERC20 Standard:** Full ERC20 compliance for fractional shares
- **Transfer Restrictions:** Configurable transfer limits and restrictions
- **Burnable Tokens:** Optional burn functionality for share redemption
- **Factory Deployed:** Created through FractionTokenFactory
- **Security Features:** Role-based access control and pausable functionality

### 4. FractionTokenFactory

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/blob/main/contracts/core/factories/FractionTokenFactory.sol)

The `FractionTokenFactory` contract deploys and manages FractionToken instances:

- **Token Deployment:** Creates new FractionToken contracts
- **Configuration Management:** Sets up token parameters and restrictions
- **Factory Pattern:** Standardized deployment of fraction tokens
- **Integration:** Works with Fractionalize contract for token creation

## Proxy Contracts

A critical part of the Deed Protocol is its upgradability via proxy contracts. The proxy enables contract upgrades without changing the contract address, ensuring the continuity of data and assets.

## Features

### Core Protocol Architecture
- **Modular Design:** Each component (NFT, validation, registry, fund management) is encapsulated in its own contract for clarity and maintainability
- **Upgradable System:** Built with UUPS proxy pattern for seamless contract upgrades while maintaining data continuity
- **Emergency Controls:** Integrated pausable functionality for rapid response to system-critical issues
- **Role-Based Access:** Comprehensive permission system with distinct roles (VALIDATOR_ROLE, DEFAULT_ADMIN_ROLE, etc.)

### Asset Management & Security
- **On-Chain Royalties:** ERC721C implementation for enforced royalty payments
- **Trading Controls:** 
  - Marketplace approval system for regulated trading
  - Transfer validation system for secure asset movement
  - Wallet limits and transfer restrictions
- **Fund Security:**
  - Reentrancy protection for financial operations
  - Commission controls and fee management
  - Secure fund distribution mechanisms

### Metadata & Documentation Standards
- **Standard Compliance:**
  - ERC-7496 for dynamic trait support
- **Document Management:**
  - Operating agreement storage and validation
  - Property document management
  - Gallery system for multiple images per token
- **Asset-Specific Metadata:**
  - Type-specific metadata structures
  - Custom metadata field support
  - Feature tracking per token

### Validation & Verification System
- **Multi-Validator Architecture:**
  - Support for multiple validators
  - Validator capability verification
  - Interface compliance checks
- **Validation Features:**
  - Asset type-specific validation criteria
  - Operating agreement validation
  - Confidence scoring system
- **Regional Compliance:**
  - Support for various regional requirements
  - Flexible validation methods
  - Property type-specific validation

### Asset Division & Fractionalization
- **REIT Functionality:**
  - ERC1155-based fractional ownership
  - Automated dividend distribution
  - Regulatory compliance features
- **Property Subdivision:**
  - Unit-based subdivision support
  - Timeshare creation capabilities
  - Common area management
- **Security Measures:**
  - Asset locking mechanisms
  - Approval-based unlocking
  - Unit-specific validation
  - Independent transfer capabilities

### Compliance & Regulatory Features
- **REIT Operations:**
  - Built-in regulatory compliance
  - Transfer restrictions
  - Wallet limits
- **Documentation:**
  - Operating agreement management
  - Legal wrapper support
  - Asset type-specific compliance
- **Security Standards:**
  - Role-based access control
  - Emergency stop functionality
  - Secure fund management

## Installation and Setup

### Prerequisites

- Node.js v16+
- TypeScript
- Hardhat
- Solidity ^0.8.20
- A wallet provider such as MetaMask for deployments on live networks

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your-org/Protocol-Contracts
   cd Protocol-Contracts
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Compile the contracts:**

   ```bash
   npx hardhat compile
   ```

4. **Run tests:**

   ```bash
   npx hardhat test
   ```

## Development

This project uses TypeScript and Hardhat for development. The main configuration files are:

- `hardhat.config.ts`: Main Hardhat configuration
- `tsconfig.json`: TypeScript configuration
- `package.json`: Project dependencies and scripts

### Available Scripts

- `npx hardhat compile`: Compile the contracts
- `npx hardhat test`: Run the test suite
- `npx hardhat run scripts/deploy-all.ts`: Deploy all contracts
- `npx hardhat run scripts/verify.ts`: Verify contracts on Etherscan

### Testing

The project includes a comprehensive test suite covering all core functionality:

```bash
npx hardhat test
```

Tests are located in the `test/` directory and cover:
- Core contract functionality
- Extension contracts
- Integration tests
- Security tests

## Security Considerations
The protocol implements several security measures to protect assets and ensure compliance:
- Role-based access control for all critical operations
- Pausable functionality for emergency situations
- Reentrancy protection for financial operations
- Marketplace approval system for controlled trading
- Transfer validation and restrictions
- Secure fund management with commission controls
- Validator verification and capability checks
- Operating agreement validation
- Asset type-specific security measures

## License

The contracts in this repository are licensed under the **AGPL-3.0**. For more details, please refer to the [LICENSE](LICENSE) file.
