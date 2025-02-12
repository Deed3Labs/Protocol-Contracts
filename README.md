# The Deed Protocol - Smart Contracts

This repository contains the smart contracts for **The Deed Protocol**, which facilitates decentralized Real World Asset transactions via Smart Contracts. These contracts represent real world assets as ERC721 tokens, ensuring seamless integration with external validation services and enabling future enhancements.

## Overview

The Deed Protocol uses legal engineering to merge technology with Real World Assets by tokenizing ownership, valaditation and administration. Each property deed or title is represented as a unique non-fungible token (NFT) on the blockchain, providing decentralized, secure, and transparent records of ownership.

Key components of the protocol include:
- **DeedNFT**: The core NFT representing property deeds.
- **Validator**: A smart contract that verifies the integrity and authenticity of deed data.
- **ValidatorRegistry**: A registry for managing and tracking validators responsible for validating deeds.
- **FundManager**: A smart contract for managaging, distributing and maintaing securtiy over transactinon funds.

## Core Contracts

### 1. DeedNFT

[View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/DeedNFT.sol)

The `DeedNFT` contract is the core ERC721 token representing real world assets. It includes several important features:

- **Custom Metadata:** Each deed is linked to metadata stored on decentralized platforms (e.g., IPFS), which can include detailed property information.
- **Validation Integration:** Works in conjunction with validator contracts to ensure that deed data is authentic and correct.
- **Batch Minting:** Supports the minting of multiple deed tokens in a single transaction, reducing gas costs.
- **Upgradability:** Designed with future enhancements in mind using the UUPS (Universal Upgradeable Proxy Standard) pattern for seamless contract upgrades.

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

### 5. Interface Contracts

- **IValidator**  
  [View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/IValidator.sol)  
  Defines the interface for validator functionality, outlining the functions that any validator contract must implement to interact with the protocol.

- **IValidatorRegistry**  
  [View Contract on GitHub](https://github.com/Deed3Labs/Protocol-Contracts/tree/main/src/core/IValidatorRegistry.sol)  
  Specifies the interface for the validator registry, ensuring that implementations provide necessary registry management functions.

### 6. **Proxy Contracts**
A critical part of the Deed Protocol is its upgradability via a proxy contracts. The proxy enables contract upgrades without changing the contract address, ensuring the continuity of data and assets.

## Features

- **Modular Contract Design:** Each component of the protocol (NFT, validation, registry, and fund management) is encapsulated in its own contract for clarity and maintainability.
- **Role-Based Access Control:** Critical functions are protected using role-based permissions, ensuring that only authorized parties (e.g., those with VALIDATOR_ROLE or DEFAULT_ADMIN_ROLE) can perform sensitive actions.
- **Pausable Operations:** Emergency stop functionality is integrated into the protocol, allowing for a quick response in case of system-critical issues.
- **Flexible Validator Integration:** Multiple validators can be registered and used, accommodating various property types, validation methods, or regional requirements.

## Installation and Setup

### Prerequisites

- Node.js v16+
- Hardhat
- Solidity ^0.8.20
- A wallet provider such as MetaMask for deployments on live networks

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Deed3Labs/DeedNFT-Contracts
   cd DeedNFT-Contracts
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

## Usage

### Deploying Contracts

Deploy the contracts locally or to a testnet using Hardhat. Make sure to configure your network settings in `hardhat.config.js`.

```bash
npx hardhat run scripts/deploy.js --network <network-name>
```

### Interacting with Deployed Contracts

After deployment, you can interact with the contracts using the provided interfaces:
- **DeedNFT:** For NFT minting, metadata retrieval, and property data management.
- **IValidator and IValidatorRegistry:** To interface with validation logic and manage validator registrations.
- **FundManager:** For handling funds related to transactions and fee distribution.

## Testing

Run the test suite to ensure that all contracts operate as expected:

```bash
npx hardhat test
```

Tests cover core functionalities such as minting, validator registration, deed validation, and fund management.

## License

The contracts in this repository are licensed under the **AGPL-3.0**. For more details, please refer to the [LICENSE](LICENSE) file.
