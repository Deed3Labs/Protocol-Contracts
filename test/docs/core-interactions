# Core Contract Interactions Diagram

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│    Client   │         │ FundManager │         │   DeedNFT   │         │  Validator  │         │  Validator  │            ┌─────────────┐
│  (Frontend) │         │  (Contract)│          │  (Contract) │         │  (Contract) │         │  Registry   │            │  Metadata   │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘         └──────┬──────┘         └──────┬──────┘         │   Renderer  │
       │                       │                       │                       │                       │                └──────┬──────┘
       │                       │                       │                       │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │                       │                       │                       │                       │
       │  mintDeedNFT(...)     │                       │                       │                                               │
       │───────────────────────>                       │                       │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │  isValidatorRegistered()                      │                       │                       │
       │                       │───────────────────────────────────────────────>                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │<───────────────────────────────────────────────                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │  getServiceFee()      │                       │                       │                       │
       │                       │───────────────────────────────────>           │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │<───────────────────────────────────           │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │  mintAsset(...)       │                       │                       │                       │
       │                       │───────────────────────>                       │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │                       │  supportsAssetType()  │                       │                       │
       │                       │                       │───────────────────────>                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │                       │<───────────────────────                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │                       │  defaultOperatingAgreement()                  │                       │
       │                       │                       │───────────────────────>                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │                       │<───────────────────────                       │                       │
       │                       │                       │                       │                                               │
       │                       │                       │ _mint() & set traits   │                       │                       │
       │                       │                       │───────────┐           │                       │                       │
       │                       │                       │           │           │                       │                       │
       │                       │                       │<──────────┘           │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │                       │ tokenURI()            │                       │                       │
       │                       │                       │────────────────────────────────────────────────────────────────────────>
       │                       │                       │                       │                       │                       │
       │                       │                       │<────────────────────────────────────────────────────────────────────────
       │                       │                       │                       │                       │                       │
       │                       │                       │ Emit DeedNFTMinted    │                       │                       │
       │                       │                       │───────────┐           │                       │                       │
       │                       │                       │           │           │                       │                       │
       │                       │                       │<──────────┘           │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │  collectServiceFee()  │                       │                       │                       │
       │                       │───────────┐           │                       │                       │                       │
       │                       │           │           │                       │                       │                       │
       │                       │<──────────┘           │                       │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │  Emit ServiceFeeCollected                      │                       │                       │
       │                       │───────────┐           │                       │                       │                       │
       │                       │           │           │                       │                       │                       │
       │                       │<──────────┘           │                       │                       │                       │
       │                       │                       │                       │                       │                       │
       │                       │  Emit DeedMinted      │                       │                       │                       │
       │                       │───────────┐           │                       │                       │                       │
       │                       │           │           │                       │                       │                        │
       │                       │<──────────┘           │                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │  Return tokenId       │                       │                       │                       │                        │
       │<───────────────────────                       │                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │  validateDeed(deedId) │                       │                       │                       │                        │
       │─────────────────────────────────────────────────────────────────────>│                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │  getTraitValues(...)  │                       │                        │
       │                       │                       │<──────────────────────│                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │───────────────────────>                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │  Check validator registration                  │                        │
       │                       │                       │                       │───────────────────────>                       │
       │                       │                       │                       │                       │                        │
       │                       │                       │                       │<───────────────────────                       │
       │                       │                       │                       │                       │                        │
       │                       │                       │  validateDeed(true/false)                     │                        │
       │                       │                       │<──────────────────────│                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │  Emit TokenValidated  │                       │                        │
       │                       │                       │───────────┐           │                       │                        │
       │                       │                       │           │           │                       │                        │
       │                       │                       │<──────────┘           │                       │                        │
       │                       │                       │                       │                       │                        │
       │  Return success       │                       │                       │                       │                        │
       │<────────────────────────────────────────────────────────────────────────                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │  updateMetadata(...)  │                       │                       │                       │                        │
       │─────────────────────────────────────────────>│                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │  isOperatingAgreementRegistered()             │                        │
       │                       │                       │───────────────────────>                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │<───────────────────────                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │  Update metadata      │                       │                        │
       │                       │                       │───────────┐           │                       │                        │
       │                       │                       │           │           │                       │                        │
       │                       │                       │<──────────┘           │                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │  updateAssetDetails() │                       │                        │
       │                       │                       │────────────────────────────────────────────────────────────────────────>
       │                       │                       │                       │                       │                        │
       │                       │                       │<────────────────────────────────────────────────────────────────────────
       │                       │                       │                       │                       │                        │
       │                       │                       │  Reset validation if owner                    │                        │
       │                       │                       │───────────┐           │                       │                        │
       │                       │                       │           │           │                       │                        │
       │                       │                       │<──────────┘           │                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │                       │  Emit DeedNFTMetadataUpdated                  │                        │
       │                       │                       │───────────┐           │                       │                        │
       │                       │                       │           │           │                       │                        │
       │                       │                       │<──────────┘           │                       │                        │
       │                       │                       │                       │                       │                        │
       │  Return success       │                       │                       │                       │                        │
       │<─────────────────────────────────────────────│                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │  withdrawValidatorFees(validator, token)     │                       │                       │                        │
       │───────────────────────>                       │                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │  Check validator ownership                    │                       │                        │
       │                       │───────────────────────────────────────────────>                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │<───────────────────────────────────────────────                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │  Transfer fees        │                       │                       │                        │
       │                       │───────────┐           │                       │                       │                        │
       │                       │           │           │                       │                       │                        │
       │                       │<──────────┘           │                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │                       │  Emit ValidatorFeesWithdrawn                  │                       │                        │
       │                       │───────────┐           │                       │                       │                        │
       │                       │           │           │                       │                       │                        │
       │                       │<──────────┘           │                       │                       │                        │
       │                       │                       │                       │                       │                        │
       │  Return success       │                       │                       │                       │                        │
       │<───────────────────────                       │                       │                       │                        │
       │                       │                       │                       │                       │                        │
```

## Contract Roles and Relationships

### DeedNFT Contract
- Core NFT contract implementing ERC-721 standard for asset representation
- Maintains metadata and trait information about assets
- Handles asset minting, validation status, and burning
- Interacts with Validators for asset validation
- Uses MetadataRenderer for token URI generation

### Validator Contract
- Validates asset information according to asset-specific criteria
- Maintains operating agreement registry
- Determines validation fees and supported asset types
- Can be specialized for specific asset classes
- Validates operating agreements and asset-specific data

### ValidatorRegistry Contract
- Maintains registry of validator contracts
- Stores information about validators (supported asset types, ownership)
- Provides validator lookup by asset type
- Verifies validator registration and capabilities

### FundManager Contract
- Handles financial operations for the system
- Collects and distributes validation fees
- Integrates with DeedNFT for minting operations
- Manages commission percentages for service fees
- Allows withdrawal of validator fees

### MetadataRenderer Contract
- Generates tokenURI responses with full metadata
- Stores additional metadata like gallery images and features
- Manages document storage related to assets
- Provides standardized metadata output

## Key System Flows

1. **Asset Minting Flow**:
   - Client requests mint through FundManager
   - FundManager verifies validator and collects fees
   - DeedNFT creates token with metadata
   - Validator provides default operating agreement
   - MetadataRenderer generates tokenURI

2. **Validation Flow**:
   - Validator evaluates asset against criteria
   - DeedNFT provides trait information
   - Validation status updated in DeedNFT
   - Events emitted for client notification

3. **Metadata Update Flow**:
   - Client requests metadata update
   - DeedNFT verifies operating agreement
   - Updates token URI and traits
   - Resets validation status if owner made changes
   - MetadataRenderer updates asset details

4. **Fee Management Flow**:
   - FundManager collects service fees during minting
   - Commission split between protocol and validators
   - Owners/validators can withdraw accumulated fees
   - ValidatorRegistry verifies ownership for withdrawals 