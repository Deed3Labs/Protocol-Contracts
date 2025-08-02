# MetadataRenderer Contract Documentation

The MetadataRenderer contract is a sophisticated component of The Deed Protocol that handles dynamic metadata rendering, trait management, and asset information storage. This document provides comprehensive documentation of its functionality, architecture, and usage.

## 🎯 Overview

The MetadataRenderer contract serves as the central metadata management system for DeedNFTs, providing:

- **Dynamic Metadata Rendering**: On-chain metadata generation with trait parsing
- **Asset Information Storage**: Comprehensive asset data management
- **Document Management**: Asset document storage and retrieval
- **Gallery Support**: Multiple image support with gallery navigation
- **Condition Tracking**: Asset condition and legal information management

## 🏗️ Architecture

### Contract Structure

```solidity
contract MetadataRenderer is 
    Initializable, 
    OwnableUpgradeable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable, 
    IMetadataRenderer
```

### Key Components

#### 1. Storage Variables

```solidity
// Default images for each asset type and invalidated image
mapping(uint8 => string) public defaultImageURIs;

// Default background color for each asset type
mapping(uint8 => string) public defaultBackgroundColors;

// Mapping of token ID to its metadata
mapping(uint256 => TokenMetadata) private tokenMetadata;

// Mapping of token ID to its features
mapping(uint256 => TokenFeatures) private tokenFeatures;

// Mapping of token ID to its condition information
mapping(uint256 => AssetCondition) private assetConditions;

// Mapping of token ID to its legal information
mapping(uint256 => LegalInfo) private legalInfo;

// Reference to the DeedNFT contract
IDeedNFT public deedNFT;
```

#### 2. Data Structures

**TokenMetadata Structure**
```solidity
struct TokenMetadata {
    string name;                    // Token name (optional, generated if not set)
    string description;             // Token description
    string image;                   // Primary image URI
    string background_color;        // Background color for the token
    string animation_url;           // Animation URL for the token
    string external_link;           // External URL for the token
    string[] galleryImages;         // Array of additional image URIs
    Document[] documents;           // Array of document structs
    string customMetadata;          // Custom metadata for the token
}
```

**Document Structure**
```solidity
struct Document {
    string docType;                 // Type of document
    string documentURI;             // URI of the document
}
```

**AssetCondition Structure**
```solidity
struct AssetCondition {
    string generalCondition;        // General condition rating
    string lastInspectionDate;      // Date of last inspection
    string[] knownIssues;           // Array of known issues
    string[] improvements;          // Array of improvements
    string additionalNotes;         // Additional notes
}
```

**LegalInfo Structure**
```solidity
struct LegalInfo {
    string jurisdiction;            // Legal jurisdiction
    string registrationNumber;      // Official registration number
    string registrationDate;        // Date of registration
    string[] documents;             // Array of legal documents
    string[] restrictions;          // Array of legal restrictions
    string additionalInfo;          // Additional legal information
}
```

## 🔧 Core Functions

### 1. Metadata Rendering

#### `tokenURI(uint256 tokenId)`

The primary function that generates complete metadata JSON for a token.

**Functionality:**
- Combines stored metadata with dynamic traits from DeedNFT
- Generates human-readable names based on asset type and traits
- Handles different asset types (Land, Vehicle, Estate, Equipment)
- Produces marketplace-compatible JSON format

**Key Features:**
```solidity
function tokenURI(uint256 tokenId) external view returns (string memory) {
    // Validate token exists
    if (!_exists(tokenId)) revert Invalid();
    
    // Get asset type and validation status from DeedNFT
    uint8 assetType = 0;
    bool isValidated = true;
    
    // Generate name and image URI
    string memory name = _generateName(tokenId, assetType);
    string memory imageURI = _getImageURI(tokenId, assetType, isValidated);
    
    // Build complete JSON metadata
    // ... JSON construction logic
}
```

**Generated Metadata Structure:**
```json
{
  "name": "Generated Asset Name",
  "description": "Asset description",
  "image": "Primary image URI",
  "background_color": "Background color",
  "animation_url": "Animation URL",
  "external_link": "External link",
  "gallery_images": ["Image1", "Image2"],
  "documents": [
    {"docType": "Title Deed", "documentURI": "ipfs://..."}
  ],
  "features": ["Feature1", "Feature2"],
  "asset_condition": {
    "general_condition": "Excellent",
    "last_inspection_date": "2024-01-15",
    "known_issues": ["Issue1"],
    "improvements": ["Improvement1"],
    "additional_notes": "Notes"
  },
  "legal_info": {
    "jurisdiction": "New York",
    "registration_number": "PR-2024-001234",
    "registration_date": "2024-01-15",
    "documents": ["Document1"],
    "restrictions": ["Restriction1"],
    "additional_info": "Info"
  },
  "attributes": [
    {"trait_type": "Asset Type", "value": "Land"},
    {"trait_type": "Validation Status", "value": "Valid"}
  ]
}
```

### 2. Trait Synchronization

#### `syncTraitUpdate(uint256 tokenId, bytes32 traitKey, bytes memory traitValue)`

Synchronizes metadata with DeedNFT trait updates.

**Functionality:**
- Only accepts calls from DeedNFT contract
- Handles different trait types (string, array, etc.)
- Updates stored metadata based on trait changes
- Emits sync events for tracking

**Usage:**
```solidity
// Called by DeedNFT when traits are updated
function syncTraitUpdate(
    uint256 tokenId, 
    bytes32 traitKey, 
    bytes memory traitValue
) external {
    require(msg.sender == address(deedNFT), "!auth");
    
    // Handle different trait types
    if (traitKey == TRAIT_GALLERY) {
        string[] memory gallery = abi.decode(traitValue, (string[]));
        _setTokenGallery(tokenId, gallery);
    } else {
        string memory strValue = abi.decode(traitValue, (string));
        // Update specific metadata fields
    }
    
    emit MetadataSynced(tokenId, traitKey, traitValue);
}
```

### 3. Asset Management

#### Feature Management
```solidity
function setTokenFeatures(uint256 tokenId, string[] memory features) external
function getTokenFeatures(uint256 tokenId) external view returns (string[] memory)
```

#### Condition Management
```solidity
function setAssetCondition(
    uint256 tokenId,
    string memory generalCondition,
    string memory lastInspectionDate,
    string[] memory knownIssues,
    string[] memory improvements,
    string memory additionalNotes
) external

function getAssetCondition(uint256 tokenId) external view returns (
    string memory generalCondition,
    string memory lastInspectionDate,
    string[] memory knownIssues,
    string[] memory improvements,
    string memory additionalNotes
)
```

#### Legal Information Management
```solidity
function setTokenLegalInfo(
    uint256 tokenId,
    string memory jurisdiction,
    string memory registrationNumber,
    string memory registrationDate,
    string[] memory documents,
    string[] memory restrictions,
    string memory additionalInfo
) external

function getTokenLegalInfo(uint256 tokenId) external view returns (
    string memory jurisdiction,
    string memory registrationNumber,
    string memory registrationDate,
    string[] memory documents,
    string[] memory restrictions,
    string memory additionalInfo
)
```

### 4. Document Management

#### Document Operations
```solidity
function manageTokenDocument(
    uint256 tokenId, 
    string memory docType, 
    string memory documentURI, 
    bool isRemove
) external

function getTokenDocument(uint256 tokenId, string memory docType) 
    external view returns (string memory)

function getTokenDocuments(uint256 tokenId) 
    external view returns (Document[] memory)
```

**Document Types:**
- Title Deeds
- Property Surveys
- Registration Certificates
- Insurance Policies
- Maintenance Records
- Safety Certifications

### 5. Gallery Management

#### Gallery Operations
```solidity
function setTokenGallery(uint256 tokenId, string[] memory imageUrls) external
function getTokenGallery(uint256 tokenId) external view returns (string[] memory)
```

**Features:**
- Multiple image support
- Gallery navigation
- Image validation
- Storage optimization

### 6. Animation and External Links

#### Animation Management
```solidity
function setTokenAnimationURL(uint256 tokenId, string memory animationURL) external
function getTokenAnimationURL(uint256 tokenId) external view returns (string memory)
```

#### External Link Management
```solidity
function setTokenExternalLink(uint256 tokenId, string memory externalLink) external
function getTokenExternalLink(uint256 tokenId) external view returns (string memory)
```

## 🎨 Name Generation

### `_generateName(uint256 tokenId, uint8 assetType)`

Generates human-readable names based on asset type and traits.

**Land/Estate Assets (Types 0 and 2):**
```solidity
// Primary format: "123 Main St, NY 10001, USA - Land"
// Fallback format: "Parcel #12345, NY 10001, USA - Land"
```

**Vehicle Assets (Type 1):**
```solidity
// Primary format: "2020 Tesla Model 3"
// Fallback format: "Tesla Model 3"
// Last resort: "Tesla Vehicle"
```

**Equipment Assets (Type 3):**
```solidity
// Primary format: "Caterpillar CAT 320 (S/N: CAT123456789)"
// Secondary format: "Excavator - Caterpillar CAT 320"
// Fallback format: "Caterpillar CAT 320"
// Last resort: "Caterpillar Equipment"
```

## 🖼️ Image Management

### `_getImageURI(uint256 tokenId, uint8 assetType, bool isValidated)`

Determines the appropriate image URI for a token.

**Priority Order:**
1. Custom token image (if set)
2. First gallery image (if available)
3. Default asset type image
4. Invalidated image (if not validated)

**Default Images:**
```solidity
defaultImageURIs[0] = "ipfs://Qm1"; // Land
defaultImageURIs[1] = "ipfs://Qm2"; // Vehicle
defaultImageURIs[2] = defaultImageURIs[0]; // Estate uses Land image
defaultImageURIs[3] = "ipfs://Qm3"; // Equipment
defaultImageURIs[255] = "ipfs://Qm"; // Invalidated image
```

## 🔒 Access Control

### Role-Based Permissions

```solidity
modifier onlyOwnerOrValidator(uint256 tokenId) {
    if (!(msg.sender == owner() || 
        (address(deedNFT) != address(0) && deedNFT.hasRole(VALIDATOR_ROLE, msg.sender)) ||
        (address(deedNFT) != address(0) && deedNFT.ownerOf(tokenId) == msg.sender))) {
        revert Unauthorized();
    }
    _;
}
```

**Permission Levels:**
- **Owner**: Full access to all functions
- **Validator**: Can update metadata for any token
- **Token Owner**: Can update metadata for their own tokens

## 🔧 Configuration

### Contract Setup

#### Initialization
```solidity
function initialize() public initializer {
    __Ownable_init();
    __AccessControl_init();
    __UUPSUpgradeable_init();
    
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    
    // Set default images
    defaultImageURIs[255] = "ipfs://Qm"; // Invalidated
    defaultImageURIs[0] = "ipfs://Qm1"; // Land
    defaultImageURIs[1] = "ipfs://Qm2"; // Vehicle
    defaultImageURIs[2] = defaultImageURIs[0]; // Estate
    defaultImageURIs[3] = "ipfs://Qm3"; // Equipment
}
```

#### DeedNFT Integration
```solidity
function setDeedNFT(address _deedNFT) external onlyRole(DEFAULT_ADMIN_ROLE)
```

#### Asset Type Configuration
```solidity
function setAssetTypeImageURI(uint8 assetType, string memory imageURI) external onlyOwner
function setAssetTypeBackgroundColor(uint8 assetType, string memory backgroundColor) external onlyOwner
function setInvalidatedImageURI(string memory imageURI) external onlyOwner
```

## 📊 Performance Optimization

### Gas Optimization

**Efficient Storage:**
- Optimized data structures
- Minimal storage overhead
- Efficient array operations

**Batch Operations:**
- Batch metadata updates
- Efficient trait synchronization
- Optimized JSON generation

### Memory Management

**String Handling:**
- Efficient string concatenation
- Optimized JSON escaping
- Memory-efficient encoding

**Array Operations:**
- Efficient array manipulation
- Minimal memory allocation
- Optimized iteration

## 🔄 Integration Patterns

### With DeedNFT Contract

**Trait Synchronization:**
```solidity
// DeedNFT calls MetadataRenderer when traits are updated
deedNFT.setTrait(tokenId, traitKey, traitValue, traitType);
// MetadataRenderer.syncTraitUpdate() is called automatically
```

**Metadata Retrieval:**
```solidity
// Frontend calls MetadataRenderer for complete metadata
string memory metadata = metadataRenderer.tokenURI(tokenId);
```

### With Frontend Applications

**Metadata Display:**
```typescript
// Frontend fetches and displays metadata
const metadata = await metadataRenderer.tokenURI(tokenId);
const parsedMetadata = JSON.parse(metadata);
```

**Document Management:**
```typescript
// Frontend manages documents
await metadataRenderer.manageTokenDocument(
    tokenId, 
    "Title Deed", 
    "ipfs://Qm...", 
    false
);
```

## 🚨 Error Handling

### Error Types

```solidity
error Unauthorized();    // Access denied
error Invalid();         // Invalid parameters
error Empty();           // Empty required fields
error Exists();          // Item already exists
```

### Error Recovery

**Validation:**
- Parameter validation
- Access control verification
- State consistency checks

**Recovery:**
- Graceful error handling
- User-friendly error messages
- Fallback mechanisms

## 📈 Monitoring and Events

### Event Tracking

```solidity
event MetadataUpdate(uint256 indexed tokenId);
event MetadataSynced(uint256 indexed tokenId, bytes32 indexed traitKey, bytes value);
```

### Monitoring Metrics

**Performance Metrics:**
- Metadata generation time
- Gas usage per operation
- Storage efficiency
- Error rates

**Usage Metrics:**
- Documents uploaded
- Gallery images added
- Condition updates
- Legal information updates

## 🔧 Development Guidelines

### Best Practices

1. **Gas Optimization**
   - Minimize storage operations
   - Use efficient data structures
   - Optimize function calls

2. **Security**
   - Validate all inputs
   - Check access permissions
   - Handle edge cases

3. **Maintainability**
   - Clear function documentation
   - Consistent naming conventions
   - Modular design

### Testing Strategy

**Unit Tests:**
- Individual function testing
- Edge case validation
- Error condition testing

**Integration Tests:**
- DeedNFT integration
- Frontend integration
- End-to-end workflows

**Performance Tests:**
- Gas usage optimization
- Memory efficiency
- Scalability testing

---

*This documentation is part of The Deed Protocol v0.2.0-beta. For questions about the MetadataRenderer contract, please contact the development team.* 