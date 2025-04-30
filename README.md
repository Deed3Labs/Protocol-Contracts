# The Deed Protocol - Smart Contracts

This repository contains the smart contracts for **The Deed Protocol**, which facilitates decentralized Real World Asset transactions via Smart Contracts. These contracts represent real world assets as ERC721 tokens, ensuring seamless integration with external validation services and enabling future enhancements.

## Overview

The Deed Protocol uses legal engineering to merge technology with Real World Assets by tokenizing ownership, validation and administration. Each property deed or title is represented as a unique non-fungible token (NFT) on the blockchain, providing decentralized, secure, and transparent records of ownership.

Key components of the protocol include:
- **DeedNFT**: The core NFT representing property deeds.
- **Validator**: A smart contract that verifies the integrity and authenticity of deed data.
- **ValidatorRegistry**: A registry for managing and tracking validators responsible for validating deeds.
- **FundManager**: A smart contract for managing, distributing and maintaining security over transaction funds.
- **MetadataRenderer**: A contract for standardized metadata handling with optimized trait management.
- **Extension Contracts**: Additional functionality for REIT-style fractional ownership and property subdivision.

## Project Structure

```
contracts/
├── core/              # Core protocol contracts
│   ├── interfaces/    # Contract interfaces
│   ├── DeedNFT.sol    # Main NFT contract
│   ├── Validator.sol  # Deed Validation logic
│   ├── ValidatorRegistry.sol
│   ├── FundManager.sol
│   └── MetadataRenderer.sol
├── extensions/        # Extension contracts
│   ├── Fractionalize.sol
│   └── Subdivide.sol
└── libraries/         # Shared libraries
```

## Asset Types
The protocol supports various types of real-world assets:
- **Land**: Real estate properties and land parcels
- **Vehicle**: Automotive and transportation assets
- **Estate**: Residential and commercial properties
- **Commercial Equipment**: Business and industrial equipment

Each asset type has specific validation criteria and metadata structures to ensure accurate representation and compliance.

## Core Contracts

### 1. DeedNFT

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/DeedNFT.sol)

The `DeedNFT` contract is the core ERC721 token representing real world assets. It includes several important features:

- **Custom Metadata:** Each deed is linked to metadata stored on decentralized platforms (e.g., IPFS), which can include detailed property information.
- **Validation Integration:** Works in conjunction with validator contracts to ensure that deed data is authentic and correct.
- **Batch Minting:** Supports the minting of multiple deed tokens in a single transaction, reducing gas costs.
- **Upgradability:** Designed with future enhancements in mind using the UUPS (Universal Upgradeable Proxy Standard) pattern for seamless contract upgrades.
- **Royalty Enforcement:** Implements ERC721C for on-chain royalty enforcement with marketplace approval system.

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

The `Validator` contract is responsible for verifying deed data and generating the appropriate metadata URI. This contract works in tandem with the `ValidatorRegistry` to ensure that only authorized validators can validate deeds.

- **Token Metadata Generation:** Produces token URIs that expose property details, ensuring that the NFT metadata accurately reflects the underlying property data.
- **Operating Agreement Management:** Manages operating agreements (legal wrapper) associated to each property, storing and retrieving them as needed.
- **Customizable Validation:** Offers flexibility to define specific validation criteria for different types of properties or regional requirements.
- **Integration with the Registry:** Works alongside the ValidatorRegistry to ensure that only authorized validators perform deed validations.

### 3. ValidatorRegistry

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/ValidatorRegistry.sol)

The `ValidatorRegistry` contract manages a list of authorized validators, ensuring that only trusted and approved validators can interact with the `DeedNFT` contract.

- **Validator Registration:** Allows new validators to be registered, as well as updates or removals of existing ones.
- **Centralized Validation Control:** Ensures that only trusted validators can interact with the DeedNFT contract, thereby maintaining the integrity of the validation process.
- **Governance and Administration:** Supports role-based permissions to manage who can add or remove validators, contributing to the overall security of the protocol.

### 4. FundManager

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/FundManager.sol)

The `FundManager` contract is dedicated to managing funds associated with property transactions and transfers within the protocol:

- **Transaction Fee Management:** Handles the collection and processing of fees or service charges related to deed transfers and validations.
- **Funds Allocation and Distribution:** Implements mechanisms to distribute collected funds among various stakeholders (such as validators, platform operators, or other designated parties) based on predetermined rules.
- **Secure Financial Operations:** Integrates with other core contracts (like DeedNFT and Validator) to ensure that all financial operations are carried out securely and transparently.
- **Efficient Fund Handling:** Designed to facilitate both deposit and withdrawal operations, ensuring smooth financial transactions within the ecosystem.

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

### 1. Fractionalize

[View Contract on GitHub](https://github.com/Deed3Labs/DeedNFT-Contracts/blob/contract-changes/src/Fractionalize.sol)

The `Fractionalize` contract enables the creation of ERC1155 tokens representing fractional ownership of DeedNFTs, primarily designed for REIT (Real Estate Investment Trust) functionality:

- **REIT Share Creation:** Converts DeedNFT tokens into tradeable ERC1155 shares, enabling REIT-like investment structures
- **Asset Locking:** Securely locks the original DeedNFT while shares are active
- **Transfer Restrictions:** Implements wallet limits and transfer restrictions for regulatory compliance
- **Approval System:** Requires approval for unlocking original assets
- **Security Features:** Includes pausable functionality and role-based access control
- **Dividend Distribution:** Supports automated dividend distribution to share holders
- **Regulatory Compliance:** Built-in features to support REIT regulatory requirements

### 2. Subdivide

[View Contract on GitHub](https://github.com/Deed3Labs/DeedNFT-Contracts/blob/contract-changes/src/Subdivide.sol)

The `Subdivide` contract is designed for creating distinct units, parcels, or timeshares from a single DeedNFT:

- **Unit Creation:** Splits a single DeedNFT into multiple distinct units or parcels
- **Timeshare Support:** Enables creation of time-based ownership rights
- **Unit-Specific Metadata:** Maintains separate metadata for each subdivided unit
- **Independent Transfer:** Allows individual units to be transferred independently
- **Unit Validation:** Supports separate validation for each subdivided unit
- **Usage Rights:** Manages specific usage rights and restrictions per unit
- **Common Area Management:** Handles shared spaces and common area rights

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
