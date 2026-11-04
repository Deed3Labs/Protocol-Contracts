# Deed track contracts

Each Deed track contract: what it is for, what it stores, its public functions and who may call
them, its events, and how it upgrades. The lifecycle that ties them together is in
[`protocol-overview.md`](./protocol-overview.md). Deployed addresses are in the root
[`README.md`](../../../README.md#deployed-addresses) (**Deployed addresses**); who holds each role is
in [Governance](../../governance/README.md).

| Contract | Source | Standard | Upgrade |
|---|---|---|---|
| `DeedNFT` | `contracts/core/DeedNFT.sol` | ERC-721, ERC-7496, ERC-2981 | UUPS, `DEFAULT_ADMIN_ROLE` |
| `Validator` | `contracts/core/Validator.sol` | ERC-165 (`IValidator`) | UUPS, owner |
| `ValidatorRegistry` | `contracts/core/ValidatorRegistry.sol` | — | UUPS, owner |
| `FundManager` | `contracts/core/FundManager.sol` | — | UUPS, `DEFAULT_ADMIN_ROLE` |
| `MetadataRenderer` | `contracts/core/MetadataRenderer.sol` | ERC-4906 events | UUPS, owner |
| `Subdivide` | `contracts/extensions/Subdivide.sol` | ERC-1155, ERC-7496, ERC-2981 | UUPS, `DEFAULT_ADMIN_ROLE` |
| `Fractionalize` | `contracts/extensions/Fractionalize.sol` | — | UUPS, `DEFAULT_ADMIN_ROLE` |
| `FractionToken` | `contracts/core/FractionToken.sol` | ERC-20 | Clone; not upgradeable in practice |
| `FractionTokenFactory` | `contracts/core/factories/FractionTokenFactory.sol` | — | UUPS, owner |
| `ValidatorFactory` | `contracts/core/factories/ValidatorFactory.sol` | — | UUPS, owner. Not deployed |

Their interfaces are in `contracts/core/interfaces/`: `IDeedNFT`, `IValidator`, `IValidatorRegistry`,
`IFundManager`, `IMetadataRenderer`, `ISubdivide`, `IFractionalize`, `IFractionTokenFactory`.
`DeedNFT` does not declare that it implements `IDeedNFT`, and the two differ — see
[`Subdivide`](#subdivide).

Every contract's `initialize` grants all of its roles, or its ownership, to the deployer.

---

## `DeedNFT`

**The T-Deed: one ERC-721 token per real-world asset, described by traits.** Imports Limit Break's
`ICreatorToken` for the royalty-enforcement interface, and reports ERC-7496 (`0xaf332f3e`) in
`supportsInterface`.

State: `nexttokenId` (from 1), the default validator, the validator registry, `metadataRenderer`,
`fundManager`, the trait store (`tokenId → key → bytes`) and trait names, the approved-marketplace
list and the royalty-enforcement flag. `totalSupply` is a running count of live tokens.

| Function | Who | What it does |
|---|---|---|
| `mintAsset(owner, assetType, uri, definition, configuration, validatorAddress, token, salt)` | `MINTER_ROLE`, not paused | Mints a deed. Steps in [the overview](./protocol-overview.md#1-mint) |
| `generateUniqueTokenId(owner, assetType, definition, salt)` | Anyone (pure) | The id `mintAsset` uses when `salt` is non-zero: a hash mod 10⁹ |
| `burnAsset(tokenId)`, `burnBatchAssets(tokenIds)` | Deed owner, not paused | Burns and clears the token's traits |
| `updateValidationStatus(tokenId, isValid, validatorAddress)` | `VALIDATOR_ROLE`, active in the registry, `validatorAddress == msg.sender` | Writes `isValidated` and `validator` |
| `updateMetadata(tokenId, uri, operatingAgreement, definition, configuration)` | Deed owner or `VALIDATOR_ROLE`, not paused | Rewrites those traits. The agreement must have a name in the deed's validator (`operatingAgreementName`). From a non-validator, also resets validation |
| `setTrait(tokenId, traitKey, traitValue, valueType)` | Deed owner or `VALIDATOR_ROLE` | Sets any trait. A 32-byte key is used as is, anything else is hashed and its name recorded. `valueType` 0 raw bytes, 1 string, 2 number, 3 boolean |
| `removeTrait(tokenId, traitName)` | Deed owner or `VALIDATOR_ROLE` | Deletes a trait |
| `getTraitValue`, `getTraitValues`, `getTraitKeys`, `getTraitName`, `getTraitMetadataURI` | Anyone | ERC-7496 reads |
| `getValidationStatus(tokenId)` | Anyone | `(isValidated, validator)` |
| `tokenURI(tokenId)` | Anyone | The renderer's output, or the stored URI if the renderer is unset, reverts or returns empty |
| `royaltyInfo(tokenId, salePrice)` | Anyone | Receiver is the deed's validator contract; amount is its `getRoyaltyFeePercentage` in basis points. Reverts while the deed names no validator, as after an owner's `updateMetadata` |
| `addMinter`, `removeMinter` | `DEFAULT_ADMIN_ROLE` | `MINTER_ROLE` |
| `addValidator`, `removeValidator` | `DEFAULT_ADMIN_ROLE` or the validator registry | `VALIDATOR_ROLE` |
| `setDefaultValidator` | `DEFAULT_ADMIN_ROLE` | Must be registered in the registry |
| `setValidatorRegistry`, `setFundManager`, `setContractURI`, `setTraitName` | `DEFAULT_ADMIN_ROLE` | Configuration |
| `setMetadataRenderer(renderer)` | `DEFAULT_ADMIN_ROLE` | Moves `VALIDATOR_ROLE` from the old renderer to the new one |
| `setApprovedMarketplace`, `setRoyaltyEnforcement`, `setToDefaultSecurityPolicy` | `DEFAULT_ADMIN_ROLE` | The marketplace list; enforcement on or off; enforcement on |
| `setTransferValidator`, `getTransferValidator`, `getTransferValidationFunction` | Admin / anyone | `ICreatorToken` plumbing. The stored address is not consulted by any transfer |
| `pause`, `unpause` | `DEFAULT_ADMIN_ROLE` | Stops minting, burning and `updateMetadata`; not transfers or `setTrait` |

**Royalty enforcement.** While on, `approve` and `setApprovalForAll` revert with `"!mkt"` for an
operator not on the marketplace list, and `_beforeTokenTransfer` reverts a transfer whose sender is
neither the owner nor an approved marketplace. Every transfer also rewrites `beneficiary`.

Events: `DeedNFTMinted`, `DeedNFTBurned`, `DeedValidated`, `TraitUpdated`, `MetadataRendererUpdated`,
`ContractURIUpdated`, `MarketplaceApproved`, `RoyaltyEnforcementChanged`, `TransferValidatorUpdated`.

---

## `Validator`

**Checks deeds and units against per-asset-type criteria, and sets what a deed costs to mint and
pays in royalties.** One `Validator` serves one primary `DeedNFT` plus a list of compatible contracts
(which must include `Subdivide` for unit validation). It is both `Ownable` and `AccessControl`.

State: `baseUri`, `defaultOperatingAgreementUri`, `primaryDeedNFT` and `compatibleDeedNFTs`,
`supportedAssetTypes`, `validationCriteria` per asset type (`requiredTraits`, `additionalCriteria`,
`requireOperatingAgreement`, `requireDefinition`), named operating agreements, the payment-token
whitelist and `serviceFee` per token, `royaltyFeePercentage` (default 500 bps) and `royaltyReceiver`,
`fundManager`, `tokenRegistry`.

| Function | Who | What it does |
|---|---|---|
| `validateDeed(tokenId)` | `VALIDATOR_ROLE` | Checks the deed in `primaryDeedNFT` and calls `updateValidationStatus`. Detail in [`validation-system.md`](./validation-system.md) |
| `validateSubdivisionUnit(subdivideContract, deedId, unitId)` | `VALIDATOR_ROLE` | The same check against a unit's traits; writes `Subdivide.updateUnitValidationStatus`. `subdivideContract` must be compatible |
| `setAssetTypeSupport(assetTypeId, supported)` | `CRITERIA_MANAGER_ROLE` | Which asset types this validator accepts |
| `setValidationCriteria(assetTypeId, requiredTraits, additionalCriteria, requireOperatingAgreement, requireDefinition)` | `CRITERIA_MANAGER_ROLE` | Custom criteria. `additionalCriteria` is stored but nothing checks it |
| `setupValidationCriteria(assetTypeId)` | `CRITERIA_MANAGER_ROLE` | Presets, and marks the type supported: Land and Estate need `country`, `state`, `county`, `parcelNumber`, `legalDescription`; Vehicle `make`, `model`, `year`, `vin`; Commercial Equipment `manufacturer`, `model`, `serialNumber`, `year`. All four require an agreement and a definition |
| `registerOperatingAgreement(uri, name)` | `METADATA_ROLE` | Names an agreement and adds it to the prefix list `validateDeed` matches against |
| `setOperatingAgreementName`, `removeOperatingAgreementName` | `METADATA_ROLE` | Names or un-names an agreement, without the prefix list |
| `addWhitelistedToken`, `removeWhitelistedToken`, `setServiceFee(token, fee)` | `FEE_MANAGER_ROLE` | What a mint costs, per payment token |
| `setRoyaltyFeePercentage(bps)` | `FEE_MANAGER_ROLE` | At most 500 |
| `setRoyaltyReceiver(receiver)` | `FEE_MANAGER_ROLE` | Where service fees and royalties are paid |
| `withdrawServiceFees(token)` | `FEE_MANAGER_ROLE` | Calls `FundManager.withdrawValidatorFees`, which pays the royalty receiver |
| `withdrawRoyalties(token)` | Royalty receiver or the `FundManager` | Pays out the contract's whole balance of `token`: the `FundManager` commission to its fee receiver, the rest to the royalty receiver |
| `setBaseUri`, `setDefaultOperatingAgreement`, `setFundManager`, `setTokenRegistry` | Owner | Configuration |
| `setDeedNFT`, `setPrimaryDeedNFT`, `addCompatibleDeedNFT`, `removeCompatibleDeedNFT` | Owner | Which contracts this validator serves. The primary cannot be removed |
| `grantRole(role, account)` | `DEFAULT_ADMIN_ROLE` | Overridden so only the default admin grants any role |
| `supportsAssetType`, `defaultOperatingAgreement`, `operatingAgreementName`, `validateOperatingAgreement`, `getValidationCriteria`, `getServiceFee`, `isTokenWhitelisted`, `getRoyaltyFeePercentage`, `getRoyaltyReceiver`, `getRoyaltyBalance`, `isCompatibleDeedNFT`, `getBaseUri` | Anyone | Reads. `isTokenWhitelisted` is true for the local list or the `TokenRegistry` |

**Recognising an operating agreement.** `validateDeed` accepts an agreement that is registered
exactly, contains `baseUri`, or contains any URI passed to `registerOperatingAgreement`. A new
deed's agreement is the default URI with its token id appended, so it passes only if the default URI
contains `baseUri` or has been registered. The public `validateOperatingAgreement` uses a different
rule — registered exactly, or containing the default URI.

`ADMIN_ROLE` is declared and checked by `FundManager.withdrawValidatorFees`, but `initialize` grants
it to no one.

Events: `DeedValidated`, `ValidationError`, `ValidationCriteriaUpdated`, `OperatingAgreementRegistered`,
`DeedNFTUpdated`, `PrimaryDeedNFTUpdated`, `CompatibleDeedNFTUpdated`, `RoyaltyWithdrawn`.

---

## `ValidatorRegistry`

**The list of validators, and the switch that turns each one on.** A validator is registered
inactive; activating it is what lets `DeedNFT` mint against it and lets it write validation.

State: `validators` (`isActive`, `supportedAssetTypes`, `name`, `description`), `assetTypeValidators`
(asset type → validator addresses), the address list, `fundManager`, `deedNFT`.

| Function | Who | What it does |
|---|---|---|
| `registerValidator(validator, name, description, supportedAssetTypes)` | Owner | Registers inactive, and refreshes `FundManager` roles |
| `updateValidatorStatus(validator, isActive)` | Owner | Activates or deactivates. Syncs `VALIDATOR_ROLE` on `DeedNFT` for every registered validator, and `FEE_MANAGER_ROLE` on the `FundManager` |
| `removeValidator(validator)` | Owner | Deletes the record and revokes its `DeedNFT` role. Its entries in `assetTypeValidators` stay |
| `updateValidatorName(validator, newName)` | Owner | Renames |
| `getValidatorAssetTypes(validator)` | Owner | Not a view: re-reads `supportsAssetType(0…3)` from the validator and stores the result |
| `setDeedNFT`, `setFundManager` | Owner | The contracts it keeps roles in sync on |
| `isValidatorRegistered`, `isValidatorActive`, `getValidatorName`, `getSupportedAssetTypes`, `getActiveValidators`, `validators`, `assetTypeValidators` | Anyone | Reads |

Every function that changes state is `onlyOwner`. `REGISTRY_ADMIN_ROLE` is granted to the deployer
and checked by none of them.

Events: `ValidatorRegistered` (also emitted on rename, and on removal with an empty name),
`ValidatorStatusUpdated`, `ValidatorAssetTypesUpdated`, `DeedNFTUpdated`.

---

## `FundManager`

**Takes the service fee at mint and keeps each validator's share until it is withdrawn.**

State: `compatibleDeedNFTs`, `validatorRegistry`, the commission in basis points, `feeReceiver`,
per-validator per-token balances, the list of validators it has given `FEE_MANAGER_ROLE`, a token
list, `tokenRegistry`.

| Function | Who | What it does |
|---|---|---|
| `processPayment(payer, validatorAddress, token, serviceFee)` | A compatible `DeedNFT` | The token must be whitelisted by the validator or the `TokenRegistry`, and the fee must equal the validator's `getServiceFee`. Pulls the fee from `payer`, sends the commission to `feeReceiver`, credits the rest to the validator |
| `withdrawValidatorFees(validatorContract, token)` | `ADMIN_ROLE` or `FEE_MANAGER_ROLE` on that validator, or `FEE_MANAGER_ROLE` here | Pays the validator's balance to its royalty receiver |
| `withdrawRoyaltyCommission(validatorContract, token)` | `ADMIN_ROLE` or `FEE_MANAGER_ROLE` | Calls `Validator.withdrawRoyalties` |
| `updateValidatorRoles()` | `ADMIN_ROLE` or the registry | Revokes `FEE_MANAGER_ROLE` from validators it granted it to, then grants it to every active one |
| `setCommissionPercentage(bps)` | `ADMIN_ROLE` | At most 1,000 (10%). `initialize` accepts up to 10,000 |
| `setFeeReceiver`, `setValidatorRegistry`, `setTokenRegistry` | `ADMIN_ROLE` | Configuration |
| `addCompatibleDeedNFT`, `removeCompatibleDeedNFT` | `ADMIN_ROLE` | Which `DeedNFT`s may call `processPayment` |
| `addWhitelistedToken`, `removeWhitelistedToken` | `ADMIN_ROLE` | A token list `processPayment` does not read |
| `getValidatorFeeBalance`, `getCommissionPercentage`, `commissionPercentage`, `feeReceiver`, `isCompatibleDeedNFT`, `getCompatibleDeedNFTs`, `getWhitelistedTokens`, `formatFee` | Anyone | Reads |

`MINTER_ROLE` is granted to the deployer and checked by nothing.

Events: `ServiceFeeCollected`, `ValidatorFeesWithdrawn`, `CommissionPercentageUpdated`,
`FeeReceiverUpdated`, `ValidatorRegistryUpdated`, `CompatibleDeedNFTUpdated`.

---

## `MetadataRenderer`

**Builds the JSON `DeedNFT.tokenURI` returns.** It combines the deed's traits with what it stores
itself, keyed by token id for its one `deedNFT`. An unvalidated deed shows the invalidated image
(`defaultImageURIs[255]`). The output format is in [`metadata-renderer.md`](./metadata-renderer.md).

State: default image and background colour per asset type; per token, the stored metadata
(name, description, image, colours, animation URL, external link, gallery, documents, custom
metadata), features, condition and legal information.

| Function | Who | What it does |
|---|---|---|
| `tokenURI(tokenId)`, `contractURI()` | Anyone | The metadata JSON |
| `syncTraitUpdate(tokenId, traitKey, traitValue)` | The `deedNFT` only | Mirrors `name`, `description`, `image`, `background_color`, `animation_url`, `gallery` and `customMetadata` traits into storage |
| `setTokenFeatures`, `setAssetCondition`, `setTokenLegalInfo`, `manageTokenDocument`, `setTokenAnimationURL`, `setTokenExternalLink` | Renderer owner, a `DeedNFT` `VALIDATOR_ROLE` holder, or the deed's owner | Per-token details |
| `setTokenCustomMetadata(tokenId, metadata)` | Same | Stores it and writes it to `DeedNFT` as the `customMetadata` trait |
| `setTokenGallery`, `setDeedNFT` | `DEFAULT_ADMIN_ROLE` | Gallery; which `DeedNFT` it renders |
| `setAssetTypeImageURI`, `setAssetTypeBackgroundColor`, `setInvalidatedImageURI` | Owner | Defaults |
| `getTokenFeatures`, `getAssetCondition`, `getTokenLegalInfo`, `getTokenDocument`, `getTokenDocuments`, `getTokenGallery`, `getTokenAnimationURL`, `getTokenExternalLink` | Anyone | Reads |

Events: `MetadataUpdate`, `MetadataSynced`.

---

## `Subdivide`

**Splits a validated Land or Estate deed into ERC-1155 units, each its own token with a supply of
one.** The unit's token id is `(deedId << 128) | unitId`. The deed stays with its owner.

State: `subdivisions` per deed (`name`, `description`, `symbol`, `collectionUri`, `totalUnits`,
`activeUnits`, `isActive`, `burnable`, `collectionAdmin`, `subdivisionValidator`, per-unit metadata),
unit traits, unit owners, `deedNFT`, `validatorRegistry`. `defaultValidator` is set to zero at
`initialize` and has no setter, so a unit's validator is the subdivision's, or else the deed's.

| Function | Who | What it does |
|---|---|---|
| `createSubdivision(deedId, name, description, symbol, collectionUri, totalUnits, burnable)` | The deed's owner, not paused | The deed must be validated and Land (0) or Estate (2), with no active subdivision. Caller becomes collection admin |
| `mintUnit(deedId, unitId, to)`, `batchMintUnits(deedId, unitIds, recipients)` | The deed's current owner, not paused | Mints units below `totalUnits`; a zero recipient means the deed's owner. Copies `assetType`, `operatingAgreement`, `definition`, `configuration` and the validator from the deed |
| `burnUnit(deedId, unitId)` | The unit's holder | Only while `burnable` |
| `deactivateSubdivision(deedId)` | The deed's current owner | Only once every unit is burned |
| `updateUnitValidationStatus(deedId, unitId, isValid, validatorAddress)` | `VALIDATOR_ROLE`, active in the registry | Writes `isValidated` and `validator` on the unit |
| `setUnitMetadata`, `setBurnable`, `setSubdivisionValidator`, `transferCollectionAdmin` | Collection admin | Per-unit URI, burnability, a validator for all units (must be active), handing the role on |
| `setUnitTrait`, `setUnitTraitFlexible`, `removeUnitTrait` | Collection admin | Unit traits. Setting `assetType` reverts — see below |
| `addValidator`, `removeValidator`, `setUnitTraitName` | `ADMIN_ROLE` | `VALIDATOR_ROLE`; trait names |
| `setApprovedMarketplace`, `setRoyaltyEnforcement`, `setToDefaultSecurityPolicy`, `setTransferValidator` | `ADMIN_ROLE` | Stored; no approval or transfer path reads them |
| `pause`, `unpause` | `ADMIN_ROLE` | Stops creating subdivisions and minting units |
| `uri(tokenId)` | Anyone | The unit's own metadata, else `collectionUri/unitId` |
| `royaltyInfo(tokenId, salePrice)` | Anyone | The unit's validator at its rate, else the parent deed's `royaltyInfo` |
| `subdivisions`, `subdivisionExists`, `unitExists`, `ownerOf`, `getUnitAssetType`, `isUnitValidated`, `getUnitValidationStatus`, `getSubdivisionValidator`, `supportsSubdivision`, `getUnitTraitValue`, `getUnitTraitValues`, `getUnitTraitKeys`, `getUnitTraitName`, `getUnitMetadata`, `getUnitTraitMetadataURI` | Anyone | Reads. Most revert once the subdivision is inactive |

**The deed is not locked.** Its owner can still transfer or burn it. Minting units follows the deed's
current owner; the collection admin stays whoever created the subdivision until it is handed on.

**`DeedNFT` has no `getAssetType`.** `IDeedNFT` declares it and `Subdivide` calls it, so
`setUnitTrait` or `setUnitTraitFlexible` on the `assetType` key reverts, as does `getUnitAssetType`
for a unit with no `assetType` trait of its own.

Events: `SubdivisionCreated`, `UnitMinted`, `UnitBurned`, `UnitValidated`, `UnitTraitUpdated`,
`UnitMetadataUpdated`, `BurnableStatusChanged`, `SubdivisionValidatorUpdated`,
`SubdivisionDeactivated`, `CollectionAdminTransferred`, `MarketplaceApproved`,
`RoyaltyEnforcementChanged`.

---

## `Fractionalize`

**Holds a deed and issues ERC-20 shares against it.** Each fraction has an id from `nextFractionId`
(from 1) and its own `FractionToken`.

State per fraction: name, description, symbol, `collectionUri`, `totalShares`, `activeShares`,
`maxSharesPerWallet` (set to `totalShares`), `requiredApprovalPercentage`, `isActive`, `burnable`,
the asset type and original token id, `collectionAdmin`, `tokenAddress`.

| Function | Who | What it does |
|---|---|---|
| `createFraction(params)` | The asset's owner, not paused | `params` is `FractionCreationParams`: `assetType` (`DeedNFT` or `SubdivisionNFT`), `originalTokenId`, `name`, `description`, `symbol`, `collectionUri`, `totalShares`, `burnable`, `approvalPercentage` (51–100). Takes the asset and has the factory create the token. Does not check validation |
| `mintShares(fractionId, amount, to)`, `batchMintShares(params)` | Collection admin, not paused | Mints up to `totalShares`; a zero recipient means the caller |
| `burnShares(fractionId, amount)` | A holder, not paused | Only while `burnable` |
| `unlockAsset(params)` | See below, not paused | Ends the fraction and sends the asset to `params.to` |
| `pause`, `unpause` | `ADMIN_ROLE` | Stops all of the above |
| `getFractionBasicInfo`, `getFractionExtendedInfo`, `getFractionOwnershipInfo`, `getFractionToken`, `getApprovals`, `canReceiveShares`, `getVotingPower` | Anyone | Reads |
| `validateAsset`, `validateDeedNFTAsset`, `validateSubdivisionAsset`, `getAssetInformation`, `getDeedNFTAssetDetails`, `getDeedNFTAssetTrait`, `getDeedNFTAssetTraitKeys`, `getSubdivisionAssetDetails`, `getSubdivisionAssetTrait`, `getSubdivisionAssetTraitKeys` | Anyone | Reads about the locked asset |

**Who can unlock.** With no shares minted, only the collection admin. With shares minted, the caller
must hold every minted share (`getVotingPower == activeShares`); those shares are burned first. The
`checkApprovals` route compares the caller's `adminApprovals` against `requiredApprovalPercentage`,
but no function sets approvals, so it never passes.

**What blocks an unlock or a lock:**

- Burning shares needs `burnable`. A non-burnable fraction cannot be unlocked once any share is
  minted.
- Shares burned with `FractionToken.burn` directly do not reduce `activeShares`, after which no one
  can hold "every minted share". Burn through `burnShares`.
- `createFraction` moves a deed with `transferFrom`, sent by `Fractionalize`. While `DeedNFT`
  enforces royalties, `Fractionalize` must be on its `setApprovedMarketplace` list for both the
  owner's `approve` and the transfer to succeed.
- A subdivision unit is moved with `safeTransferFrom`, which requires the receiver to implement
  `onERC1155Received`. `Fractionalize` does not, so fractionalizing a unit reverts.

Events: `FractionCreated`, `AssetLocked`, `SharesMinted`, `SharesBurned`, `AssetUnlocked`.

---

## `FractionToken`

**The ERC-20 share token for one fraction.** Records `fractionalizeContract` and `fractionId`.

| Function | Who | What it does |
|---|---|---|
| `mint(to, amount)` | `MINTER_ROLE` (`Fractionalize`), not paused | Respects `maxSharesPerWallet` |
| `burnFrom(from, amount)` | `MINTER_ROLE`, not paused | Only while `burnable` |
| `burn(amount)` | Any holder, not paused | Only while `burnable` |
| `transfer`, `transferFrom` | Holders | Revert if the recipient would exceed `maxSharesPerWallet` (0 means no cap) |
| `setMaxSharesPerWallet`, `setBurnable`, `pause`, `unpause` | `ADMIN_ROLE` | See below |
| `getVotingPower(account)`, `canReceive(account, amount)` | Anyone | Balance; whether a transfer would fit the cap |

**Each token is an EIP-1167 clone initialized by the factory, so the factory holds its admin roles —
and the factory has no function that uses them.** The admin setters, pause and upgrade cannot be
reached. A clone has no ERC-1967 implementation slot, so UUPS's `onlyProxy` check would refuse an
upgrade anyway.

Events: `MaxSharesPerWalletUpdated`, `BurnableStatusUpdated`.

---

## `FractionTokenFactory`

**Clones the `FractionToken` implementation for each fraction.** `initialize` deploys the
implementation with `new FractionToken()`.

| Function | Who | What it does |
|---|---|---|
| `createFractionToken(fractionId, name, symbol, maxSharesPerWallet, burnable)` | `fractionalizeContract` only | Clones, initializes with `Fractionalize` as minter, records it. One token per fraction id |
| `updateImplementation(newImplementation)` | Owner | For clones made afterwards; existing ones are unchanged |
| `updateFractionalizeContract(newContract)` | Owner | Which contract may create tokens |
| `getTokenByFractionId`, `isToken`, `getAllCreatedTokens`, `getCreatedTokenCount`, `fractionTokenImplementation` | Anyone | Reads |

Events: `FractionTokenCreated`, `ImplementationUpdated`.

---

## `ValidatorFactory`

**Meant to deploy a configured `Validator` and register it in one call.** It has no deploy script, is
not in `deployments/`, and has no tests.

`createValidator(name, description, supportedAssetTypes, royaltyFeePercentage, serviceFee, baseUri,
operatingAgreementUri)` is open to anyone. It deploys `new Validator()` and calls `initialize` on it
directly, but `Validator`'s constructor calls `_disableInitializers()`, so that call reverts. Even
past that, `ValidatorRegistry.registerValidator` is `onlyOwner`, so the factory would have to own the
registry. Its owner-only setters are `addDefaultWhitelistedToken`, `removeDefaultWhitelistedToken`,
`updateValidatorRegistry` and `updateFundManager`. Events: `ValidatorCreated`,
`TokenWhitelisted`, `TokenRemovedFromWhitelist`.

---

## Deployment and wiring

**`deploy/deploy_all.ts` deploys and wires `ValidatorRegistry`, `MetadataRenderer`, `Validator`,
`DeedNFT`, `FundManager` and `Subdivide`; `deploy/06_deploy_Fractionalize.ts` adds
`FractionTokenFactory` and `Fractionalize`.** All are UUPS proxies. The numbered scripts `00`–`04`
call roles and functions the current contracts do not have — `OPERATOR_ROLE`, `ADMIN_ROLE` on
`DeedNFT` and `MetadataRenderer`, `setAssetTypeSupported`, `FundManager.setDeedNFT`, and
initializer arguments that no longer match — so `deploy_all.ts` is the one that runs against them.
`05` matches the current `Subdivide`.

What `deploy_all.ts` wires:

1. `ValidatorRegistry.setDeedNFT`, `Validator.setDeedNFT`, `MetadataRenderer.setDeedNFT` and
   `DeedNFT.setMetadataRenderer`, plus the renderer's default images.
2. `ValidatorRegistry.setFundManager`, then `registerValidator` and `updateValidatorStatus(true)` for
   the default validator — which grants it `VALIDATOR_ROLE` on `DeedNFT` and `FEE_MANAGER_ROLE` on the
   `FundManager`.
3. `Validator.setAssetTypeSupport` for all four types (no criteria) and `Validator.setFundManager`.
4. `Subdivide` `ADMIN_ROLE` to the deployer and `VALIDATOR_ROLE` to the validator.

What it leaves for an admin:

- `DeedNFT.setFundManager` — until then minting charges no fee. Once it is set,
  `FundManager.addCompatibleDeedNFT(DeedNFT)` must be too, or every mint reverts in
  `processPayment`.
- `Validator.setupValidationCriteria` or `setValidationCriteria` — until then every supported deed
  validates.
- `Validator.registerOperatingAgreement` for the default agreement.
- `Validator.addCompatibleDeedNFT(Subdivide)` — until then `validateSubdivisionUnit` reverts.
- `DeedNFT.setApprovedMarketplace(Fractionalize, true)` — until then `createFraction` reverts while
  royalties are enforced.

Whether these were done on Base Sepolia is not recorded in the repository. The `Validator` and
`FundManager` ABIs saved in `deployments/base-sepolia/` predate `setTokenRegistry`. Upgrades use
`deploy/upgrade/`; the steps are in [Operators](../../operators/deploying-contracts.md).
