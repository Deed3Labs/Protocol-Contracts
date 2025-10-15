# Asset Subdivision System

The Deed Protocol's subdivision system enables DeedNFT owners to break down their assets into smaller, tradeable units using ERC1155 tokens. This document explains the subdivision functionality, workflows, and technical implementation.

## 🎯 Overview

The subdivision system allows asset owners to:

- **Create Subdivisions**: Break down large assets (Land, Estate) into smaller units
- **Manage Units**: Mint, transfer, and burn individual subdivision units
- **Validate Units**: Individual validation for each subdivision unit
- **Trait Management**: ERC-7496 dynamic trait support for units
- **Royalty Support**: ERC-2981 royalty implementation for units

## 🏗️ Technical Architecture

### Core Components

#### 1. Subdivide Contract (`Subdivide.sol`)

The main contract that handles subdivision operations:

- **ERC1155 Implementation**: Multi-token standard for subdivision units
- **Subdivision Management**: Create and manage asset subdivisions
- **Unit Validation**: Individual validation for subdivision units
- **Trait Management**: ERC-7496 dynamic trait support
- **Role-Based Access**: Collection admin and validator roles
- **Royalty Support**: ERC-2981 royalty implementation

#### 2. Supported Asset Types

Only specific asset types can be subdivided:

- **Land (0)**: Can be subdivided into smaller land parcels
- **Estate (2)**: Can be subdivided into units or rooms
- **Vehicle (1)**: Cannot be subdivided (atomic asset)
- **Commercial Equipment (3)**: Cannot be subdivided (atomic asset)

#### 3. Subdivision Data Structure

```solidity
struct SubdivisionInfo {
    string name;                    // Name of the subdivision
    string description;             // Description of the subdivision
    string symbol;                 // Trading symbol for units
    string collectionUri;          // Base URI for metadata
    uint256 totalUnits;            // Total number of units authorized
    uint256 activeUnits;           // Currently minted units
    bool isActive;                 // Operational status
    bool burnable;                 // Whether units can be burned
    address collectionAdmin;       // Admin of the subdivision
    address subdivisionValidator;  // Custom validator (optional)
    mapping(uint256 => string) unitMetadata; // Custom metadata per unit
}
```

## 📋 Subdivision Workflow

### 1. Subdivision Creation

1. **Prerequisites**
   - DeedNFT must be validated
   - Asset type must support subdivision (Land or Estate)
   - Caller must be DeedNFT owner

2. **Creation Process**
   ```solidity
   function createSubdivision(
       uint256 deedId,
       string memory name,
       string memory description,
       string memory symbol,
       string memory collectionUri,
       uint256 totalUnits,
       bool burnable
   ) external
   ```

3. **Configuration**
   - Set subdivision name and description
   - Define trading symbol
   - Set collection metadata URI
   - Specify total number of units
   - Configure burning permissions

### 2. Unit Management

#### Minting Units

```solidity
// Mint single unit
function mintUnit(uint256 deedId, uint256 unitId, address to) external

// Batch mint multiple units
function batchMintUnits(
    uint256 deedId,
    uint256[] calldata unitIds,
    address[] calldata recipients
) external
```

#### Unit Operations

```solidity
// Burn unit (if burnable)
function burnUnit(uint256 deedId, uint256 unitId) external

// Deactivate subdivision
function deactivateSubdivision(uint256 deedId) external
```

### 3. Unit Validation

#### Validation Process

1. **Validator Assignment**
   - Subdivision can have custom validator
   - Falls back to parent DeedNFT validator
   - Validator must be active in ValidatorRegistry

2. **Unit Validation**
   ```solidity
   function updateUnitValidationStatus(
       uint256 deedId,
       uint256 unitId,
       bool isValid,
       address validatorAddress
   ) external onlyRole(VALIDATOR_ROLE)
   ```

3. **Validation Criteria**
   - Units inherit validation criteria from parent DeedNFT
   - Custom validation rules can be applied
   - Individual unit traits are validated

### 4. Trait Management

#### ERC-7496 Dynamic Traits

The subdivision system implements ERC-7496 for dynamic trait management:

```solidity
// Set unit trait
function setUnitTrait(
    uint256 deedId,
    uint256 unitId,
    bytes32 traitKey,
    bytes memory traitValue
) external onlyCollectionAdmin(deedId)

// Get unit trait
function getUnitTraitValue(
    uint256 deedId,
    uint256 unitId,
    bytes32 traitKey
) external view returns (bytes memory)

// Flexible trait setting
function setUnitTraitFlexible(
    uint256 deedId,
    uint256 unitId,
    bytes memory traitKey,
    bytes memory traitValue,
    uint8 valueType
) external onlyCollectionAdmin(deedId)
```

#### Supported Trait Types

- **String Traits**: Text-based properties
- **Numeric Traits**: Integer values
- **Boolean Traits**: True/false values
- **Bytes Traits**: Raw data

### 5. Metadata Management

#### Unit Metadata

```solidity
// Set custom metadata for unit
function setUnitMetadata(
    uint256 deedId,
    uint256 unitId,
    string calldata metadata
) external onlyCollectionAdmin(deedId)

// Get unit metadata
function getUnitMetadata(uint256 deedId, uint256 unitId) external view returns (string memory)
```

#### Token URI Generation

```solidity
function uri(uint256 tokenId) public view returns (string memory) {
    // Custom unit metadata takes precedence
    // Falls back to collection URI + unit ID
}
```

## 🔧 Technical Implementation

### Token ID Generation

Subdivision units use a combined token ID:

```solidity
function _generateTokenId(uint256 deedId, uint256 unitId) internal pure returns (uint256) {
    return (deedId << 128) | unitId;
}
```

- **High 128 bits**: DeedNFT ID
- **Low 128 bits**: Unit ID within subdivision

### Access Control

#### Roles

```solidity
ADMIN_ROLE           // Administrative functions
VALIDATOR_ROLE       // Unit validation
```

#### Collection Admin

- **Collection Admin**: DeedNFT owner becomes subdivision admin
- **Admin Rights**: Manage subdivision settings, mint units, set traits
- **Transfer Rights**: Can transfer admin rights to another address

### Royalty Management

#### ERC-2981 Implementation

```solidity
function royaltyInfo(uint256 tokenId, uint256 salePrice) 
    external view returns (address receiver, uint256 royaltyAmount)
```

- **Validator Royalties**: Units inherit royalty settings from validator
- **Parent Fallback**: Falls back to parent DeedNFT royalties
- **Configurable**: Royalty settings can be updated per subdivision

### Security Features

#### Marketplace Integration

```solidity
// Approve marketplaces
function setApprovedMarketplace(address marketplace, bool approved) external

// Royalty enforcement
function setRoyaltyEnforcement(bool enforced) external
```

#### Transfer Validation

```solidity
// Transfer validator
function setTransferValidator(address validator) external
function getTransferValidator() external view returns (address)
```

## 🎨 User Experience

### For Asset Owners

1. **Create Subdivision**
   - Navigate to asset management
   - Select "Create Subdivision"
   - Configure subdivision settings
   - Deploy subdivision contract

2. **Manage Units**
   - Mint units to specific addresses
   - Set custom metadata for units
   - Configure unit traits
   - Transfer units to buyers

3. **Monitor Subdivision**
   - View subdivision statistics
   - Track unit validation status
   - Manage collection settings
   - Handle admin operations

### For Unit Holders

1. **Receive Units**
   - Units are minted to specified addresses
   - Units appear in wallet as ERC1155 tokens
   - Custom metadata and traits are attached

2. **Transfer Units**
   - Standard ERC1155 transfer functions
   - Royalty enforcement on transfers
   - Marketplace integration support

3. **Burn Units**
   - Burn units if subdivision allows burning
   - Reduces total active units count
   - Permanent token destruction

### For Validators

1. **Validate Units**
   - Access validation interface
   - Review unit traits and metadata
   - Apply validation criteria
   - Update validation status

2. **Manage Validation**
   - Set custom validation rules
   - Monitor validation progress
   - Handle validation disputes

## 🔒 Security Considerations

### Access Control

- **Role-Based Permissions**: Different roles for different operations
- **Collection Admin Rights**: Restricted to DeedNFT owner
- **Validator Permissions**: Only registered validators can validate

### Data Integrity

- **Immutable Records**: Validation records cannot be altered
- **Trait Validation**: Unit traits are validated against criteria
- **Metadata Verification**: Custom metadata is verified

### Privacy Protection

- **Selective Disclosure**: Control what information is shared
- **Trait Privacy**: Sensitive traits can be encrypted
- **Metadata Control**: Custom metadata URIs for privacy

## 📊 Performance Metrics

### Gas Optimization

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| Create Subdivision | ~200,000 gas | One-time setup cost |
| Mint Unit | ~120,000 gas | Per unit minting |
| Transfer Unit | ~45,000 gas | Standard ERC1155 transfer |
| Set Trait | ~80,000 gas | Per trait update |
| Validate Unit | ~100,000 gas | Per unit validation |

### Storage Efficiency

- **Optimized Data Structures**: Efficient storage patterns
- **Batch Operations**: Reduced gas costs for multiple operations
- **Lazy Loading**: On-demand data loading
- **Compression**: Data compression where applicable

## 🔄 Integration Points

### With DeedNFT

- **Ownership Verification**: Subdivision requires DeedNFT ownership
- **Trait Inheritance**: Units inherit traits from parent DeedNFT
- **Validation Integration**: Uses same validation system

### With Validator

- **Unit Validation**: Individual validation for each unit
- **Criteria Application**: Validation criteria applied per unit
- **Status Updates**: Validation status tracked per unit

### With Fractionalize

- **Asset Fractionalization**: Subdivision units can be fractionalized
- **Share Creation**: Units can be converted to ERC-20 shares
- **Liquidity Provision**: Enables trading of subdivision units

## 🚀 Best Practices

### For Asset Owners

1. **Plan Subdivision**: Carefully plan unit structure before creation
2. **Set Clear Rules**: Define unit management rules clearly
3. **Monitor Validation**: Track validation progress for all units
4. **Manage Metadata**: Keep unit metadata up to date

### For Validators

1. **Consistent Validation**: Apply validation criteria consistently
2. **Document Decisions**: Provide clear reasoning for validation decisions
3. **Monitor Performance**: Track validation metrics and performance
4. **Handle Disputes**: Establish clear dispute resolution procedures

### For Developers

1. **Interface Compliance**: Implement all required interface functions
2. **Error Handling**: Provide clear error messages and handling
3. **Gas Optimization**: Optimize gas usage for common operations
4. **Testing**: Comprehensive testing of all functionality

## 🔄 Future Enhancements

### Planned Features

- **Automated Validation**: AI-powered unit validation
- **Multi-Validator Consensus**: Multiple validators for high-value units
- **Real-time Monitoring**: Live tracking of subdivision operations
- **Mobile Support**: Mobile app for subdivision management

### Integration Opportunities

- **Marketplace Integration**: Direct integration with trading platforms
- **Legal Services**: Integration with legal document verification
- **Insurance Providers**: Automated insurance verification
- **Government Databases**: Integration with official registries

---

*This documentation is part of The Deed Protocol v0.2.0-beta. For questions about subdivision functionality, please contact the development team.*
