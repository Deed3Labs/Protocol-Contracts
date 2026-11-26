# Deed track contracts

Each Deed track contract: what it is for, what it stores, its public functions and who may call
them, its events, and how it upgrades. The lifecycle that ties them together is in
[`protocol-overview.md`](./protocol-overview.md). These pages describe the contracts on `dev`, which
is also what runs on Base Sepolia since deploy 30 (see the note at the top of the overview). Deployed
addresses are in the root [`README.md`](../../../README.md#deployed-addresses) (**Deployed
addresses**); who holds each role is in [Governance](../../governance/README.md).

| Contract | Source | Standard | Upgrade |
|---|---|---|---|
| `DeedNFT` | `contracts/core/DeedNFT.sol`, `DeedNFTBase.sol` | ERC-721, ERC-7496, ERC-2981 | UUPS, `DEFAULT_ADMIN_ROLE` |
| `DeedNFTMintExtension`, `DeedTrustExtension`, `DeedRolesExtension` | `contracts/core/DeedNFTMintExtension.sol`, `DeedTrustExtension.sol`, `DeedRolesExtension.sol`, `DeedTrustCommon.sol` | — | Not upgradeable on their own: pinned as immutables in the `DeedNFT` implementation, so replacing one is a `DeedNFT` upgrade |
| `Validator` | `contracts/core/Validator.sol` | ERC-165 (`IValidator`) | UUPS, owner |
| `ValidatorRegistry` | `contracts/core/ValidatorRegistry.sol` | — | UUPS, owner |
| `FundManager` | `contracts/core/FundManager.sol` | — | UUPS, `DEFAULT_ADMIN_ROLE` |
| `MetadataRenderer` | `contracts/core/MetadataRenderer.sol` | ERC-4906 events | UUPS, owner |
| `Subdivide` | `contracts/extensions/Subdivide.sol` | ERC-1155, ERC-7496, ERC-2981 | UUPS, `DEFAULT_ADMIN_ROLE` |
| `Fractionalize` | `contracts/extensions/Fractionalize.sol` | ERC-1155 receiver | UUPS, `DEFAULT_ADMIN_ROLE` |
| `FractionToken` | `contracts/core/FractionToken.sol` | ERC-20 | Clone; no one holds its admin roles, so it never upgrades |
| `FractionTokenFactory` | `contracts/core/factories/FractionTokenFactory.sol` | — | UUPS, owner |
| `FunctionalContractRegistry` | `contracts/core/FunctionalContractRegistry.sol` | — | Not upgradeable |
| `CoopTransferAgent` | `contracts/extensions/CoopTransferAgent.sol` | ERC-721 receiver | Not upgradeable, no admin |
| `RedemptionAgent` | `contracts/extensions/RedemptionAgent.sol` | ERC-721 receiver | Not upgradeable, no admin |
| `ValidatorFactory` | `contracts/core/factories/ValidatorFactory.sol` | — | UUPS, owner. Not deployed |

Their interfaces are in `contracts/core/interfaces/`: `IDeedNFT`, `IDeedTrust`, `IDeedCustody`,
`IFunctionalContractRegistry`, `IValidator`, `IValidatorRegistry`, `IFundManager`,
`IMetadataRenderer`, `ISubdivide`, `IFractionalize`, `IFractionTokenFactory`. `DeedNFT` does not
declare that it implements `IDeedNFT`, and the two differ: `IDeedNFT` declares functions `DeedNFT`
does not have, such as `getAssetType` and `canSubdivide`. The contracts that call `DeedNFT` use only
functions it has.

Every contract's `initialize` grants all of its roles, or its ownership, to the deployer.
`deploy/deed_admin_handover.ts` moves them to the Deed admin; see
[Deployment and wiring](#deployment-and-wiring).

---

## `DeedNFT`

**The T-Deed: one ERC-721 token per real-world asset, described by traits.** Reports ERC-2981 and
ERC-7496 (`0xaf332f3e`) in `supportsInterface`. `DeedNFT` is split across three pieces of code that
share one storage layout (`DeedNFTBase`). Its constructor takes the addresses of
`DeedNFTMintExtension` and `DeedTrustExtension`, checks each identifies itself as the right kind
(`ExtensionMismatch` otherwise), and pins them as the immutables `mintExtension` and
`trustExtension`. `mintAsset`, `setTrait` and `removeTrait` keep their ABI on `DeedNFT` and forward to
the mint extension. Every other `IDeedTrust` function reaches the extensions through `fallback`:
`mintTrustDeed`, `reserveId`, `computeDeedId` and `freezeConsentDigest` go to the mint extension,
everything else to the trust extension. Both run by `delegatecall` against `DeedNFT`'s storage. The
transfer hook's entry point is refused from outside (`HookOnly`).

State: `nexttokenId` (from 1), the default validator, the validator registry, `metadataRenderer`,
`fundManager`, the trait store (`tokenId → key → bytes`) with a per-token key set and trait names,
the approved-marketplace list and the royalty-enforcement flag, `_everMinted` (every id ever minted,
kept after burn), and for trust deeds the trust records, id reservations, consent approvals, the two
trust registries, pending validator reassignments and the reassignment delay. `totalSupply` is a
running count of live tokens.

| Function | Who | What it does |
|---|---|---|
| `mintAsset(owner, assetType, uri, definition, configuration, validatorAddress, token, salt)` | `MINTER_ROLE`, not paused | Mints a Vehicle or Commercial Equipment deed. Land and Estate revert `TrustDeedRequired`. Steps in [the overview](./protocol-overview.md#1-mint) |
| `mintTrustDeed(params, trusteeAcceptance)` | `MINTER_ROLE`, not paused | Mints a Land or Estate deed into trust. See [Trust functions](#trust-functions) |
| `generateUniqueTokenId(owner, assetType, definition, salt)` | Anyone (pure) | The id `mintAsset` uses when `salt` is non-zero: 127 bits of a hash with bit 127 set, in [2¹²⁷, 2¹²⁸) |
| `wasEverMinted(tokenId)` | Anyone | Whether the id was ever minted. Such an id, burned or not, is never minted again (`DeedIdUnavailable`) |
| `burnAsset(tokenId)`, `burnBatchAssets(tokenIds)` | Deed owner, never paused | Burns. Traits stay readable, status becomes Retired, `DeedRetired` is emitted |
| `updateValidationStatus(tokenId, isValid, validatorAddress)` | `VALIDATOR_ROLE`, active in the registry, `validatorAddress == msg.sender`, not paused | Writes `isValidated` and `validator`. The caller must be the deed's recorded validator (`NotDeedValidator`) |
| `reassignValidator(tokenId, newValidator)` | Deed owner, not paused | Moves the deed to another active validator (`ValidatorNotUsable` otherwise) and resets validation. On a trust deed it only records the request (`ValidatorReassignmentRequested`), not while Void |
| `completeValidatorReassignment(tokenId)` | Deed owner, not paused | Completes a trust deed's request once `validatorReassignDelay` has passed (`ReassignmentNotDue`, `NoReassignmentPending`). The new validator must still be active and the deed not Void. A transfer or burn cancels a pending request (`ValidatorReassignmentCancelled`) |
| `pendingValidatorOf(tokenId)`, `validatorReassignDelay()` | Anyone | The pending request; the delay, 7 days unless set |
| `setValidatorReassignDelay(delay)` | `DEFAULT_ADMIN_ROLE` | Between 1 and 30 days (`ReassignDelayOutOfRange`). Applies to later requests |
| `updateMetadata(tokenId, uri, operatingAgreement, definition, configuration)` | Deed owner, or the deed's validator or one of its signers; not paused | Rewrites those traits. The agreement must have a name in the deed's validator (`operatingAgreementName`). From the owner, also sets `isValidated` to false; the `validator` record stays. Reverts on trust deeds (`UseTrustPaths`) |
| `setTrait(tokenId, traitKey, traitValue, valueType)` | Deed owner, or the deed's validator or one of its signers (`NotDeedEditor`); not paused | Sets a trait. A 32-byte key is used as is, anything else is hashed and its name recorded. `valueType` 0 raw bytes, 1 string, 2 number, 3 boolean. Locks below |
| `removeTrait(tokenId, traitName)` | Same | Deletes a trait. Same locks, and `assetType` can never be removed |
| `getTraitValue`, `getTraitValues`, `getTraitKeys`, `getTraitName`, `getTraitMetadataURI` | Anyone | ERC-7496 reads. They work on burned deeds too. `getTraitKeys` lists this token's keys that hold a value |
| `getValidationStatus(tokenId)` | Anyone | `(isValidated, validator)` |
| `isDeedValidator(tokenId, account)` | Anyone | Whether `account` is the deed's validator or one of its signers (used by `MetadataRenderer`) |
| `tokenURI(tokenId)` | Anyone | The renderer's output, or the stored URI if the renderer is unset, reverts or returns empty |
| `royaltyInfo(tokenId, salePrice)` | Anyone | Receiver is the deed's validator contract, or the default validator if the deed names none; amount is its `getRoyaltyFeePercentage` in basis points |
| `addMinter`, `removeMinter` | `DEFAULT_ADMIN_ROLE` | `MINTER_ROLE` |
| `addValidator`, `removeValidator` | `DEFAULT_ADMIN_ROLE` or the validator registry | `VALIDATOR_ROLE` |
| `setDefaultValidator` | `DEFAULT_ADMIN_ROLE` | Must be registered in the registry |
| `setValidatorRegistry`, `setFundManager`, `setContractURI`, `setTraitName` | `DEFAULT_ADMIN_ROLE` | Configuration |
| `setMetadataRenderer(renderer)` | `DEFAULT_ADMIN_ROLE` | Sets the renderer and grants it nothing. Revokes `VALIDATOR_ROLE` from the old renderer, which older builds granted |
| `setTrustRegistries(functionalContractRegistry, membershipRegistry)` | `DEFAULT_ADMIN_ROLE` | Sets each once (`RegistryAlreadySet` after); zero leaves one as it is. Also names the trust traits |
| `setApprovedMarketplace`, `setRoyaltyEnforcement`, `setToDefaultSecurityPolicy`, `isApprovedMarketplace`, `isRoyaltyEnforced` | `DEFAULT_ADMIN_ROLE` / anyone | The marketplace list; enforcement on or off; enforcement on; reads |
| `pause`, `unpause` | `DEFAULT_ADMIN_ROLE` | Stops minting, trait edits, `updateMetadata`, `updateValidationStatus` and validator reassignment. Not burns, transfers or trust calls |

**Who may edit a deed.** The holder, or the deed's own validator: the `Validator` contract recorded
on the deed (the default validator if none is recorded) or a `VALIDATOR_ROLE` holder inside it, while
that validator is active (`ValidatorRegistry.isValidatorSigner`). No global key edits deeds;
`initialize` grants the deployer no `VALIDATOR_ROLE`.

**Trait locks.** `setTrait` and `removeTrait` refuse, for every caller (`"Reserved trait"`),
`isValidated`, `validator`, `beneficiary` and the trust traits (`agreementHash`, `riderHashes`,
`trustee`, `protector`, `standbyTrustee`, `trusteeSuspended`, `transferPolicy`, `status`,
`programId`, `programSponsor`, `titleAdministrator`, `programParams`, `mintParamsHash`), on every
deed. Then:

- On a trust deed, `definition`, `operatingAgreement` and `assetType` are locked for everyone, the
  validator included (`DefinitionLocked`).
- Only the deed's validator sets `assetType`.
- From the holder, once the deed is validated, the traits the validator vouched for are locked
  (`ValidatedTraitLocked`): `definition`, `operatingAgreement`, `configuration`, and every trait
  the validator's criteria require for the asset type (`Validator.isRequiredTrait`).
- The holder changes `operatingAgreement` only through `updateMetadata`
  (`AgreementViaUpdateMetadata`).

**Royalty enforcement.** While on, `approve` reverts with `"!mkt"` for an operator not on the
marketplace list (approving zero always works), as does `setApprovalForAll(operator, true)`. The
transfer hook reverts a transfer whose sender is neither the owner nor an approved marketplace. A
trust deed then also has to pass the [trust transfer rules](./protocol-overview.md#trust-transfer-rules).
`ICreatorToken` is not implemented or advertised; `setTransferValidator`, `getTransferValidator` and
`TransferValidatorUpdated` are gone.

**Burning.** `burnAsset` is never paused. The id stays in `_everMinted` and is never minted again,
the traits stay readable, `statusOf` returns 1 (Retired), and `DeedRetired` records the holder and
the hashes of the definition, operating agreement and configuration, plus the agreement and riders
hashes for a trust deed.

Events: `DeedNFTMinted`, `DeedNFTBurned`, `DeedValidated`, `TraitUpdated`, `MetadataRendererUpdated`,
`ContractURIUpdated`, `MarketplaceApproved`, `RoyaltyEnforcementChanged`,
`ValidatorReassignmentRequested`, `ValidatorReassigned`, `ValidatorReassignmentCancelled`,
`ValidatorReassignDelayUpdated`, and the `IDeedTrust` events below.

Errors: `NotDeedEditor`, `NotDeedValidator`, `ValidatedTraitLocked`, `AgreementViaUpdateMetadata`,
`ValidatorNotUsable`, `HookOnly`, `ExtensionMismatch`, `ReassignmentNotDue`,
`NoReassignmentPending`, `ReassignDelayOutOfRange`, and the `IDeedTrust` errors.

### Trust functions

**Called on the `DeedNFT` address with the `IDeedTrust` ABI.** The rules, roles and transfer policies
are in [Trust deeds](./protocol-overview.md#trust-deeds-land-and-estate).

| Function | Who | What it does |
|---|---|---|
| `mintTrustDeed(params, trusteeAcceptance)` | `MINTER_ROLE`, not paused | Land or Estate only (`AssetTypeOutsideAgreement`). Adopted agreement and riders (`AgreementNotAdopted`), an eligible trustee (`TrusteeNotEligible`) that is neither the owner nor the protector (`RoleConflict`) and accepts (`ConsentMissing`), a transfer policy of 0–2 (`InvalidTransferPolicy`), a program for Coop (`ProgramRequired`). Charges the fee like `mintAsset`. Event: `TrustDeedMinted` |
| `computeDeedId(assetType, definitionHash, parcelRef, reserver, salt, agreementHash, riderHashes)` | Anyone (pure) | The trust deed's id and identity hash |
| `reserveId(assetType, definitionHash, parcelRef, salt, agreementHash, riderHashes)` | Anyone, as reserver | Reserves that id for a mint to the caller (`DeedIdUnavailable` if taken). Event: `DeedIdReserved` |
| `setTrustee(tokenId, newTrustee, acceptance)` | Protector (`NotProtector`) | New eligible trustee, not the holder or protector, accepting. Event: `TrusteeChanged` |
| `setProtector(tokenId, newProtector)` | Protector | Not the trustee or standby (`RoleConflict`). Event: `ProtectorChanged` |
| `setStandbyTrustee(tokenId, standby, acceptance)` | Protector | Event: `StandbyTrusteeChanged` |
| `applyLicensingDetermination(tokenId, docHash, uri, protectorConsent)` | Protector, trustee or standby (`NotTrustParty`) | Events: `NoticePosted`, then `StandbyPromoted` and `TrusteeChanged`, or `TrusteeSuspended` |
| `electAgreementVersion(tokenId, agreementHash, riderHashes, protectorConsent)` | Holder (`NotHolder`) | Writes `agreementHash`, `riderHashes` and the adopted URI as `operatingAgreement`. Event: `AgreementVersionElected` |
| `correctDefinition(tokenId, newDefinition, reasonURI, protectorConsent)` | Trustee, not suspended (`NotTrustParty`) | Needs the protector's consent; sets `isValidated` to false. Event: `MetadataCorrected` |
| `markVoid(tokenId, reasonCode, recordingRefHash, uri, cosigner, cosignerConsent)` | The deed's validator or a signer of it, or the unsuspended trustee | Active deeds only (`NotActive`). A code of 128 or more needs a validator signer other than the trustee (`FreezeNeedsValidator`) and a second one as `cosigner` (`FreezeNeedsSecondSigner`). Events: `DeedVoided`, and `DeedFreezeConfirmed` for a freeze |
| `restoreFromVoid(tokenId, reasonURI, protectorConsent)` | The deed's validator or a signer of it, not the trustee | Void deeds only (`NotVoid`). Event: `DeedRestored` |
| `postNotice(tokenId, docHash, uri)` | Anyone | Any deed ever minted (`UnknownDeed`). Event: `NoticePosted` |
| `approveTrustAction(digest)` | Anyone | Event: `TrustActionApproved` |
| `trusteeAcceptanceDigest`, `standbyAcceptanceDigest`, `agreementConsentDigest`, `correctionConsentDigest`, `restoreConsentDigest`, `licensingConsentDigest`, `freezeConsentDigest` | Anyone | The EIP-712 digests to sign or approve |
| `trustRecordOf`, `isTrustDeed`, `isRetired`, `statusOf`, `protectorOf`, `lastFromOf`, `reservationOf`, `beneficialOwnerOf`, `trustRegistries` | Anyone | Reads |

The calls that act on an existing deed revert `NotTrustDeed` on a deed that is not in trust and
`UnknownDeed` on one that does not exist. None of them is paused.

---

## `Validator`

**Checks deeds and units against per-asset-type criteria, sets what a deed costs to mint and pays in
royalties, and adopts the trust agreement versions Land and Estate deeds may use.** One `Validator`
serves one primary `DeedNFT` plus a list of compatible contracts (which must include `Subdivide` for
unit validation). It is both `Ownable` and `AccessControl`.

State: `baseUri`, `defaultOperatingAgreementUri`, `primaryDeedNFT` and `compatibleDeedNFTs`,
`supportedAssetTypes`, `validationCriteria` per asset type (`requiredTraits`, `additionalCriteria`,
`requireOperatingAgreement`, `requireDefinition`), named operating agreements and the list of
registered agreement URIs, `agreementVersionURI` (asset type → version hash → URI), the payment-token
whitelist and `serviceFee` per token, `royaltyFeePercentage` (default 500 bps) and
`royaltyReceiver`, `fundManager`, `tokenRegistry`.

| Function | Who | What it does |
|---|---|---|
| `validateDeed(tokenId)` | `VALIDATOR_ROLE` | Checks the deed in `primaryDeedNFT` and calls `updateValidationStatus`, which succeeds only for deeds that name this validator. A failed check records `false`. Detail in [`validation-system.md`](./validation-system.md) |
| `validateSubdivisionUnit(subdivideContract, deedId, unitId)` | `VALIDATOR_ROLE` | The same check against a unit's traits; writes `Subdivide.updateUnitValidationStatus`. `subdivideContract` must be compatible |
| `setAssetTypeSupport(assetTypeId, supported)` | `CRITERIA_MANAGER_ROLE` | Which asset types this validator accepts |
| `setValidationCriteria(assetTypeId, requiredTraits, additionalCriteria, requireOperatingAgreement, requireDefinition)` | `CRITERIA_MANAGER_ROLE` | Custom criteria. `additionalCriteria` is stored but nothing checks it |
| `setupValidationCriteria(assetTypeId)` | `CRITERIA_MANAGER_ROLE` | Presets, and marks the type supported: Land and Estate need `country`, `state`, `county`, `parcelNumber`, `legalDescription`; Vehicle `make`, `model`, `year`, `vin`; Commercial Equipment `manufacturer`, `model`, `serialNumber`, `year`. All four require an agreement and a definition |
| `isRequiredTrait(assetTypeId, traitKey)` | Anyone | Whether the key is one of the criteria's required traits. `DeedNFT` uses it to lock vouched-for traits |
| `registerOperatingAgreement(uri, name)` | `METADATA_ROLE` | Names an agreement and adds it to the list of bases `validateDeed` accepts with a token id appended |
| `setOperatingAgreementName(uri, name)` | `METADATA_ROLE` | Names an agreement, without adding it to that list |
| `removeOperatingAgreementName(uri)` | `METADATA_ROLE` | Un-names it and removes it from that list, so it stops validating |
| `adoptAgreementVersion(assetTypeId, versionHash, uri, name)` | `METADATA_ROLE` | Land (0) and Estate (2) only (`AgreementOutsideAssetScope`); no empty argument (`EmptyAgreementVersion`). Lets deeds mint with or elect that hash, and names the URI. Event: `AgreementVersionAdopted` |
| `revokeAgreementVersion(assetTypeId, versionHash)` | `METADATA_ROLE` | Stops new mints and elections on it; deeds already on it keep it. Event: `AgreementVersionRevoked` |
| `addWhitelistedToken`, `removeWhitelistedToken`, `setServiceFee(token, fee)` | `FEE_MANAGER_ROLE` | What a mint costs, per payment token |
| `setRoyaltyFeePercentage(bps)` | `FEE_MANAGER_ROLE` | At most 500 |
| `setRoyaltyReceiver(receiver)` | `FEE_MANAGER_ROLE` | Where service fees and royalties are paid |
| `withdrawServiceFees(token)` | `FEE_MANAGER_ROLE` | Calls `FundManager.withdrawValidatorFees`, which pays the royalty receiver |
| `withdrawRoyalties(token)` | Royalty receiver or the `FundManager` | Pays out the contract's whole balance of `token`: the `FundManager` commission to its fee receiver, the rest to the royalty receiver |
| `setBaseUri`, `setDefaultOperatingAgreement`, `setFundManager`, `setTokenRegistry` | Owner | Configuration |
| `setDeedNFT`, `setPrimaryDeedNFT`, `addCompatibleDeedNFT`, `removeCompatibleDeedNFT` | Owner | Which contracts this validator serves. The primary cannot be removed |
| `grantRole(role, account)` | `DEFAULT_ADMIN_ROLE` | Overridden so only the default admin grants any role |
| `supportsAssetType`, `defaultOperatingAgreement`, `operatingAgreementName`, `validateOperatingAgreement`, `getValidationCriteria`, `agreementVersionURI`, `getServiceFee`, `isTokenWhitelisted`, `getRoyaltyFeePercentage`, `getRoyaltyReceiver`, `getRoyaltyBalance`, `isCompatibleDeedNFT`, `getBaseUri` | Anyone | Reads. `isTokenWhitelisted` is true for the local list or the `TokenRegistry` |

**Recognising an operating agreement.** Matching is exact. `validateDeed` accepts an agreement that
is a named URI, or exactly the default agreement URI, `baseUri` or a still-named registered URI
followed by the deed's token id in decimal. A legacy deed's agreement is the default URI with its id
appended, so it passes. A trust deed's agreement is the adopted URI itself, which
`adoptAgreementVersion` names, so it passes too. The public `validateOperatingAgreement` accepts a
named URI, or the default URI followed only by decimal digits.

`ADMIN_ROLE` is declared and checked by `FundManager.withdrawValidatorFees`, but `initialize` grants
it to no one.

Events: `DeedValidated`, `ValidationError`, `ValidationCriteriaUpdated`, `OperatingAgreementRegistered`,
`AgreementVersionAdopted`, `AgreementVersionRevoked`, `DeedNFTUpdated`, `PrimaryDeedNFTUpdated`,
`CompatibleDeedNFTUpdated`, `RoyaltyWithdrawn`.

---

## `ValidatorRegistry`

**The list of validators, the switch that turns each one on, and the list of licensed trustees.** A
validator is registered inactive; activating it is what lets `DeedNFT` mint against it, lets it write
validation, and makes its signers editors of its deeds and eligible trustees.

State: `validators` (`isActive`, `supportedAssetTypes`, `name`, `description`), `assetTypeValidators`
(asset type → validator addresses), the address list, `isLicensedTrustee`, `fundManager`, `deedNFT`.

| Function | Who | What it does |
|---|---|---|
| `registerValidator(validator, name, description, supportedAssetTypes)` | Owner | Registers inactive, and refreshes `FundManager` roles |
| `updateValidatorStatus(validator, isActive)` | Owner | Activates or deactivates. Syncs `VALIDATOR_ROLE` on `DeedNFT` for that validator only, and `FEE_MANAGER_ROLE` on the `FundManager` |
| `removeValidator(validator)` | Owner | Removes it from the address list and from each `assetTypeValidators` list, revokes its `DeedNFT` role and deletes the record |
| `updateValidatorName(validator, newName)` | Owner | Renames |
| `getValidatorAssetTypes(validator)` | Owner | Not a view: re-reads `supportsAssetType(0…3)` from the validator and stores the result |
| `setLicensedTrustee(account, licensed, licenseRef)` | Owner | Lists or delists a trust company or nonprofit trustee. Never a registered validator or zero (`ValidatorCannotBeTrustee`). Listing gives no power over any token. Event: `LicensedTrusteeUpdated` |
| `setDeedNFT`, `setFundManager` | Owner | The contracts it keeps roles in sync on |
| `isValidatorSigner(validator, account)` | Anyone | True when the validator is active and `account` is the validator contract or holds `VALIDATOR_ROLE` inside it |
| `isEligibleTrustee(account)` | Anyone | True for a listed licensed trustee, or a `VALIDATOR_ROLE` holder in any active validator. Never zero or a registered validator contract |
| `isValidatorRegistered`, `isValidatorActive`, `getValidatorName`, `getSupportedAssetTypes`, `getActiveValidators`, `validators`, `assetTypeValidators`, `isLicensedTrustee` | Anyone | Reads |

Every function that changes state is `onlyOwner`. `REGISTRY_ADMIN_ROLE` is granted to the deployer
and checked by none of them.

Events: `ValidatorRegistered` (also emitted on rename, and on removal with an empty name),
`ValidatorStatusUpdated`, `ValidatorAssetTypesUpdated`, `DeedNFTUpdated`, `LicensedTrusteeUpdated`.

---

## `FundManager`

**Takes the service fee at mint and keeps each validator's share until it is withdrawn.**

State: `compatibleDeedNFTs`, `validatorRegistry`, the commission in basis points, `feeReceiver`,
per-validator per-token balances, `maxFeeOf` (payer → token → cap), the list of validators it has
given `FEE_MANAGER_ROLE`, a token list, `tokenRegistry`.

| Function | Who | What it does |
|---|---|---|
| `setMaxFee(token, maxFee)` | Anyone, for itself | The most the caller will pay as one service fee in `token`. Zero, the default, refuses every fee. Event: `MaxFeeSet` |
| `processPayment(payer, validatorAddress, token, serviceFee)` | A compatible `DeedNFT` | The token must be whitelisted by the validator or the `TokenRegistry`, the fee must equal the validator's `getServiceFee`, and it must not exceed the payer's cap (`FeeAboveMax`). Pulls the fee from `payer`, refuses a fee-on-transfer token (less arrived than was sent), sends the commission to `feeReceiver` and credits the rest to the validator |
| `withdrawValidatorFees(validatorContract, token)` | `ADMIN_ROLE` or `FEE_MANAGER_ROLE` on that validator, or `FEE_MANAGER_ROLE` here | Pays the validator's balance to its royalty receiver |
| `withdrawRoyaltyCommission(validatorContract, token)` | `ADMIN_ROLE` or `FEE_MANAGER_ROLE` | Calls `Validator.withdrawRoyalties` |
| `updateValidatorRoles()` | `ADMIN_ROLE` or the registry | Revokes `FEE_MANAGER_ROLE` from validators it granted it to, then grants it to every active one |
| `setCommissionPercentage(bps)` | `ADMIN_ROLE` | At most 1,000 (10%). `initialize` has the same cap |
| `setFeeReceiver`, `setValidatorRegistry`, `setTokenRegistry` | `ADMIN_ROLE` | Configuration |
| `addCompatibleDeedNFT`, `removeCompatibleDeedNFT` | `ADMIN_ROLE` | Which `DeedNFT`s may call `processPayment` |
| `addWhitelistedToken`, `removeWhitelistedToken` | `ADMIN_ROLE` | A token list `processPayment` does not read |
| `getValidatorFeeBalance`, `getCommissionPercentage`, `commissionPercentage`, `feeReceiver`, `maxFeeOf`, `isCompatibleDeedNFT`, `getCompatibleDeedNFTs`, `getWhitelistedTokens`, `formatFee` | Anyone | Reads |

The payer is whoever calls the mint (the `MINTER_ROLE` holder), so with a `FundManager` set on
`DeedNFT` a mint reverts `FeeAboveMax` until that account has called `setMaxFee` for the token.
`MINTER_ROLE` is granted to the deployer and checked by nothing.

Events: `ServiceFeeCollected`, `ValidatorFeesWithdrawn`, `CommissionPercentageUpdated`,
`FeeReceiverUpdated`, `ValidatorRegistryUpdated`, `CompatibleDeedNFTUpdated`, `MaxFeeSet`.

---

## `MetadataRenderer`

**Builds the JSON `DeedNFT.tokenURI` returns.** It combines the deed's traits with what it stores
itself, keyed by token id for its one `deedNFT`. An unvalidated deed shows the invalidated image
(`defaultImageURIs[255]`). The output format is in [`metadata-renderer.md`](./metadata-renderer.md).

State: default image and background colour per asset type; per token, the stored metadata
(name, description, image, colours, animation URL, external link, gallery, documents, custom
metadata), features, condition, legal information and `legalRecordVersion`.

| Function | Who | What it does |
|---|---|---|
| `tokenURI(tokenId)`, `contractURI()` | Anyone | The metadata JSON |
| `syncTraitUpdate(tokenId, traitKey, traitValue)` | The `deedNFT` only | Mirrors `name`, `description`, `image`, `background_color`, `animation_url`, `gallery` and `customMetadata` traits into storage |
| `setTokenLegalInfo`, `manageTokenDocument` | The deed's validator or one of its signers (`DeedNFT.isDeedValidator`) | Recorded legal information and documents. Each change bumps `legalRecordVersion` and emits `LegalRecordUpdated` or `DocumentRecordUpdated` with the editor |
| `setTokenFeatures`, `setAssetCondition`, `setTokenAnimationURL`, `setTokenExternalLink`, `setTokenCustomMetadata` | Renderer owner, the deed's validator or one of its signers, or the deed's holder | Display details. Custom metadata stays in the renderer |
| `setTokenGallery`, `setDeedNFT` | `DEFAULT_ADMIN_ROLE` | Gallery, kept in the renderer; which `DeedNFT` it renders |
| `setAssetTypeImageURI`, `setAssetTypeBackgroundColor`, `setInvalidatedImageURI` | Owner | Defaults |
| `getTokenFeatures`, `getAssetCondition`, `getTokenLegalInfo`, `getTokenDocument`, `getTokenDocuments`, `getTokenGallery`, `getTokenAnimationURL`, `getTokenExternalLink`, `legalRecordVersion` | Anyone | Reads |

The renderer holds no role on `DeedNFT` and writes no trait there.

Events: `MetadataUpdate`, `MetadataSynced`, `LegalRecordUpdated`, `DocumentRecordUpdated`.

---

## `Subdivide`

**Holds a validated Land or Estate deed and splits it into ERC-1155 units, each its own token with a
supply of one.** The unit's token id is `(deedId << 128) | unitId`.

State: `subdivisions` per deed (`name`, `description`, `symbol`, `collectionUri`, `totalUnits`,
`activeUnits`, `isActive`, `burnable`, `collectionAdmin`, `subdivisionValidator`, per-unit metadata),
unit traits, unit owners, the approved-marketplace list and royalty-enforcement flag, `deedNFT`,
`validatorRegistry`. `defaultValidator` is set to zero at `initialize` and has no setter, so a unit's
validator is the subdivision's, or else the deed's.

| Function | Who | What it does |
|---|---|---|
| `createSubdivision(deedId, name, description, symbol, collectionUri, totalUnits, burnable)` | The deed's holder, not paused | The deed must be validated and Land (0) or Estate (2), with no active subdivision, and `totalUnits` must fit in 128 bits (`IdOutOfRange`). Takes custody of the deed with `transferFrom`. Caller becomes collection admin |
| `mintUnit(deedId, unitId, to)`, `batchMintUnits(deedId, unitIds, recipients)` | Collection admin, not paused | Mints units below `totalUnits`; a zero recipient means the collection admin. Copies `assetType`, `operatingAgreement`, `definition`, `configuration` and the validator from the deed |
| `burnUnit(deedId, unitId)` | The unit's holder, never paused | Only while `burnable` |
| `deactivateSubdivision(deedId)` | Collection admin, never paused | Only once every unit is burned. Returns the deed to the caller |
| `updateUnitValidationStatus(deedId, unitId, isValid, validatorAddress)` | `VALIDATOR_ROLE`, active in the registry, not paused | Writes `isValidated` and `validator` on the unit. The caller must be the unit's recorded validator or the subdivision's validator (`NotUnitValidator`) |
| `setUnitMetadata`, `setBurnable`, `setSubdivisionValidator`, `transferCollectionAdmin` | Collection admin, not paused | Per-unit URI, burnability, a validator for the subdivision's units (must be active), handing the role on |
| `setUnitTrait`, `setUnitTraitFlexible`, `removeUnitTrait` | Collection admin, not paused | Unit traits. `isValidated`, `validator`, `beneficiary` and `parentDeed` are refused (`ReservedUnitTrait`), and so is removing `assetType`. Setting `assetType` accepts only Land or Estate. Editing a validated unit sets it back to unvalidated |
| `addValidator`, `removeValidator`, `setUnitTraitName` | `ADMIN_ROLE` | `VALIDATOR_ROLE`; trait names |
| `setApprovedMarketplace`, `setRoyaltyEnforcement`, `setToDefaultSecurityPolicy` | `ADMIN_ROLE` | The marketplace list operator transfers are checked against |
| `pause`, `unpause` | `ADMIN_ROLE` | Stops creating subdivisions, minting units, unit validation and every collection-admin edit. Not transfers, burns or deactivation |
| `uri(tokenId)` | Anyone | The unit's own metadata, else `collectionUri/unitId` |
| `royaltyInfo(tokenId, salePrice)` | Anyone | The unit's validator at its rate if that validator is active, else the parent deed's `royaltyInfo` |
| `beneficialOwnerOf(deedId)` | Anyone | The collection admin while the subdivision is active, else zero (`IDeedCustody`) |
| `subdivisions`, `subdivisionExists`, `unitExists`, `ownerOf`, `getUnitAssetType`, `isUnitValidated`, `getUnitValidationStatus`, `getSubdivisionValidator`, `supportsSubdivision`, `getUnitTraitValue`, `getUnitTraitValues`, `getUnitTraitKeys`, `getUnitTraitName`, `getUnitMetadata`, `getUnitTraitMetadataURI` | Anyone | Reads. Most revert once the subdivision is inactive. `getUnitAssetType` reads the unit's own `assetType` trait |

**The deed is held for the life of the subdivision.** `createSubdivision` needs the holder's approval
of `Subdivide`, and `Subdivide` on `DeedNFT`'s approved-marketplace list. A Verified or Coop trust
deed can go in only because `Subdivide` is a registered Functional Contract. While `Subdivide` holds
the deed it cannot be sold or burned; the collection admin is its beneficial owner, and
`transferCollectionAdmin` hands that on. For a subdivision created before custody existed, where
the holder still has the deed, the admin rights follow the deed's holder.

**Unit transfers.** While royalties are enforced, which they are from `initialize`, an operator
transfer of a unit reverts (`"!mkt"`) unless the operator is an approved marketplace. The holder's
own transfers and burns are never blocked. A transfer rewrites the unit's `beneficiary` trait, except
a transfer into an approved marketplace (such as `Fractionalize`), which keeps the depositor.

Events: `SubdivisionCreated`, `UnitMinted`, `UnitBurned`, `UnitValidated`, `UnitTraitUpdated`,
`UnitMetadataUpdated`, `BurnableStatusChanged`, `SubdivisionValidatorUpdated`,
`SubdivisionDeactivated`, `CollectionAdminTransferred`, `MarketplaceApproved`,
`RoyaltyEnforcementChanged`.

---

## `Fractionalize`

**Holds a deed or a subdivision unit and issues ERC-20 shares against it.** Each fraction has an id
from `nextFractionId` (from 1) and its own `FractionToken`.

State per fraction: name, description, symbol, `collectionUri`, `totalShares`, `activeShares`,
`maxSharesPerWallet` (set to `totalShares`), `requiredApprovalPercentage`, `isActive`, `burnable`,
the asset type and original token id, `collectionAdmin`, `tokenAddress`. `fractionOfDeed` maps a
locked deed to its fraction.

| Function | Who | What it does |
|---|---|---|
| `createFraction(params)` | The asset's holder, not paused | `params` is `FractionCreationParams`: `assetType` (`DeedNFT` or `SubdivisionNFT`), `originalTokenId`, `name`, `description`, `symbol`, `collectionUri`, `totalShares`, `burnable`, `approvalPercentage` (51–100). Takes the asset and has the factory create the token. Does not check validation |
| `mintShares(fractionId, amount, to)`, `batchMintShares(params)` | Collection admin, not paused | Mints up to `totalShares`; a zero recipient means the caller |
| `burnShares(fractionId, amount)` | A holder, not paused | Only while `burnable` |
| `unlockAsset(params)` | See below, not paused | Ends the fraction and sends the asset to `params.to` |
| `onERC1155Received` | `Subdivide`, for a transfer `Fractionalize` itself started | Accepts a unit pulled in by `createFraction`; anything else reverts. `onERC1155BatchReceived` always reverts |
| `beneficialOwnerOf(tokenId)` | Anyone | The collection admin of the active fraction holding the deed, else zero (`IDeedCustody`) |
| `pause`, `unpause` | `ADMIN_ROLE` | Stops all of the above |
| `getFractionBasicInfo`, `getFractionExtendedInfo`, `getFractionOwnershipInfo`, `getFractionToken`, `getApprovals`, `canReceiveShares`, `getVotingPower` | Anyone | Reads |
| `validateAsset`, `validateDeedNFTAsset`, `validateSubdivisionAsset`, `getAssetInformation`, `getDeedNFTAssetDetails`, `getDeedNFTAssetTrait`, `getDeedNFTAssetTraitKeys`, `getSubdivisionAssetDetails`, `getSubdivisionAssetTrait`, `getSubdivisionAssetTraitKeys` | Anyone | Reads about the locked asset |

**Who can unlock.** `unlockAsset` compares against the share token's `totalSupply`. With none
outstanding, only the collection admin. Otherwise the caller must hold the whole supply
(`getVotingPower == totalSupply`); those shares are burned with `FractionToken.burnForRedemption`,
which ignores `burnable` and the token's pause, so a non-burnable fraction can still be unlocked. The
`checkApprovals` route compares the caller's `adminApprovals` against `requiredApprovalPercentage`,
but no function sets approvals, so it never passes.

**Moving the asset in.** A deed moves with `DeedNFT.transferFrom`, sent by `Fractionalize`, so the
holder approves it first, and `Fractionalize` must be on `DeedNFT`'s approved-marketplace list for
both steps while royalties are enforced. A Verified or Coop trust deed can go in only because
`Fractionalize` is a registered Functional Contract. A unit moves with `safeTransferFrom` on
`Subdivide`: the holder approves `Fractionalize` there, and `Fractionalize` must be on `Subdivide`'s
marketplace list. A deed with an active subdivision cannot be fractionalized, because `Subdivide`
holds it (`"Not asset owner"`).

Events: `FractionCreated`, `AssetLocked`, `SharesMinted`, `SharesBurned`, `AssetUnlocked`.

---

## `FractionToken`

**The ERC-20 share token for one fraction.** Records `fractionalizeContract` and `fractionId`.

| Function | Who | What it does |
|---|---|---|
| `mint(to, amount)` | `MINTER_ROLE` (`Fractionalize`), not paused | Respects `maxSharesPerWallet` |
| `burnFrom(from, amount)` | `MINTER_ROLE`, not paused | Only while `burnable` |
| `burnForRedemption(from, amount)` | `MINTER_ROLE` | Used by `unlockAsset`. Ignores `burnable` and pause |
| `burn(amount)` | Any holder, not paused | Only while `burnable` |
| `transfer`, `transferFrom` | Holders | Revert if the recipient would exceed `maxSharesPerWallet` (0 means no cap) |
| `setMaxSharesPerWallet`, `setBurnable`, `pause`, `unpause` | `ADMIN_ROLE` | No one holds it; see below |
| `getVotingPower(account)`, `canReceive(account, amount)` | Anyone | Balance; whether a transfer would fit the cap |

**Each token is an EIP-1167 clone initialized by the factory, and the factory renounces
`ADMIN_ROLE` and `DEFAULT_ADMIN_ROLE` on it in the same call.** After that only `Fractionalize`
(`MINTER_ROLE`) acts on the token. No one can pause it, change its cap or `burnable` flag, grant
roles or upgrade it.

Events: `MaxSharesPerWalletUpdated`, `BurnableStatusUpdated`.

---

## `FractionTokenFactory`

**Clones the `FractionToken` implementation for each fraction.** `initialize` deploys the
implementation with `new FractionToken()`.

| Function | Who | What it does |
|---|---|---|
| `createFractionToken(fractionId, name, symbol, maxSharesPerWallet, burnable)` | `fractionalizeContract` only | Clones, initializes with `Fractionalize` as minter, renounces its own admin roles on the clone, records it. One token per fraction id |
| `updateImplementation(newImplementation)` | Owner | For clones made afterwards; existing ones are unchanged |
| `updateFractionalizeContract(newContract)` | Owner | Which contract may create tokens |
| `getTokenByFractionId`, `isToken`, `getAllCreatedTokens`, `getCreatedTokenCount`, `fractionTokenImplementation` | Anyone | Reads |

Events: `FractionTokenCreated`, `ImplementationUpdated`.

---

## `FunctionalContractRegistry`

**The contracts a trust deed may be deposited into under any transfer policy.** Not upgradeable;
moving `DeedNFT` to a new registry takes a `DeedNFT` upgrade, since `setTrustRegistries` sets it
once. Each entry has `kinds`: `KIND_CUSTODY` (1), a contract that holds deeds for a depositor and
implements `IDeedCustody.beneficialOwnerOf`, and `KIND_COOP_AGENT` (2), a `CoopTransferAgent`.

| Function | Who | What it does |
|---|---|---|
| `register(fc, kinds)` | `REGISTRAR_ROLE` | Adds or re-activates a contract (`NotAContract`, `InvalidKinds`). Event: `FunctionalContractRegistered` |
| `remove(fc)` | `REMOVER_ROLE` | Stops new deposits at once (`NotRegistered`). A deed it already holds can still leave it, and is still attributed to its depositor. Event: `FunctionalContractRemoved` |
| `kindOf(fc)`, `isActive(fc)` | Anyone | Reads |

The constructor gives the `admin` argument `DEFAULT_ADMIN_ROLE`, `REGISTRAR_ROLE` and
`REMOVER_ROLE`, and the `remover` argument `REMOVER_ROLE`.

---

## `CoopTransferAgent`

**The only route by which a Coop-policy trust deed changes hands.** It serves one `DeedNFT`, set in
its constructor, holds no funds and has no admin.

| Function | Who | What it does |
|---|---|---|
| `onERC721Received` | `DeedNFT` | The holder lists a Coop trust deed with `safeTransferFrom(holder, agent, tokenId, abi.encode(buyer, termsHash))` (`NotCoopDeed`, `InvalidBuyer`). Opens the right-of-first-refusal window (the deed's `rofrPeriodDays`, 30 by default) and the completion window after it (`completionWindowDays`, 90 by default). Event: `Listed` |
| `exercise(tokenId, designee)` | The deed's program sponsor (`NotSponsor`), within the window | Takes the sale for the sponsor or a designee at the listed terms. Event: `RofrExercised` |
| `waive(tokenId)` | The program sponsor, within the window | Ends the window early. Event: `RofrWaived` |
| `complete(tokenId)` | The seller (`NotSeller`) | After the window or a decision (`WindowOpen`), before the completion deadline (`CompletionLapsed`): sends the deed to the buyer or designee. Event: `Completed` |
| `withdraw(tokenId)` | The seller | Takes the deed back at any time before completion. Event: `Withdrawn` |
| `recover(tokenId)` | Anyone | Returns a deed sent without a listing to where it came from (`StillListed` if listed). Event: `Recovered` |
| `beneficialOwnerOf(tokenId)`, `listingOf(tokenId)` | Anyone | The seller; the listing |

The price settles off chain or through other contracts. `deploy_all.ts` registers the agent with
both kinds, so `DeedNFT` lets deeds into it and lets it send them on.

---

## `RedemptionAgent`

**Holds a home's trust deed while its member pays toward it, and hands it to them when their Housing
Allowance reaches the price.** It serves one `DeedNFT` and one `HousingAllowanceRecord`, both set in
its constructor, holds no funds and has no admin. It is registered as custody and Coop agent, like
the `CoopTransferAgent`, and it is the record's deed contract: the only caller that may mark a home
redeemed.

| Function | Who | What it does |
|---|---|---|
| `onERC721Received` | `DeedNFT` | The program sponsor deposits a Coop trust deed with `safeTransferFrom(sponsor, agent, homeId, abi.encode(member))`. The sender must be the deed's program sponsor (`NotSponsor`) and the member must hold the live record for that home (`NotOccupant`). Event: `Deposited` |
| `redeemHome(homeId)` | Anyone | Asks the record to mark the home redeemed, which it refuses until the member's Housing Allowance has reached the price, then sends the deed to that member. Event: `Redeemed` |
| `release(homeId)` | The depositor (`NotDepositor`) | Takes the deed back once the member's record is no longer live on the home (`StillLive`). Event: `Released` |
| `beneficialOwnerOf(tokenId)`, `holdOf(homeId)` | Anyone | The depositor; the hold |

Redemption is the sponsor's own transfer, so it has no first-refusal window. A member's later sale
goes through the `CoopTransferAgent` as usual.

---

## `ValidatorFactory`

**Deploys a configured `Validator` and hands it to the caller.** It has no deploy script and is not
in `deployments/`.

`createValidator(name, description, supportedAssetTypes, royaltyFeePercentage, serviceFee, baseUri,
operatingAgreementUri)` is open to anyone. It deploys an `ERC1967Proxy` for `validatorImplementation`
and initializes it in the same call, sets the royalty rate (a whole percentage, at most 5), whitelists
every default token with `serviceFee`, sets the `FundManager` and makes the caller the royalty
receiver. It then grants the caller every `Validator` role and ownership and renounces its own.
Registering and activating the new validator stays with the `ValidatorRegistry` owner. Events:
`ValidatorCreated`, `ValidatorCreatedFor`.

Its owner-only setters are `setValidatorImplementation`, `addDefaultWhitelistedToken`,
`removeDefaultWhitelistedToken`, `updateValidatorRegistry` and `updateFundManager`. Other events:
`TokenWhitelisted`, `TokenRemovedFromWhitelist`, `ValidatorImplementationUpdated`.

---

## Deployment and wiring

**`deploy/deploy_all.ts` deploys and wires the whole Deed track, then hands every admin power to the
Deed admin.** All the upgradeable contracts are UUPS proxies. The numbered scripts `02`–`06` deploy
the same contracts one at a time (after `00` and `01` for the registry and the renderer) with most of
the same wiring: criteria for all four asset types and the registered agreement (`02`), the two
extensions and `DeedNFT` (`03`), `FundManager` made compatible with `DeedNFT` (`04`), `Subdivide` and
`Fractionalize` approved as marketplaces (`05`, `06`). They leave out the `FunctionalContractRegistry`,
the `CoopTransferAgent`, the Deed timelock, `setTrustRegistries`, the agreement version, the
renderer's default images, `Validator.setFundManager`, the mint fee and the handover.

What `deploy_all.ts` does, in order:

1. **Deed admin.** On a live network it needs `DEED_ADMIN` (an existing Deed timelock) or
   `FOUNDATION_SAFE`. With only the Safe, it deploys an OpenZeppelin `TimelockController` with the
   Safe as proposer and executor and a minimum delay of `DEED_TIMELOCK_DELAY`, never below 7 days.
2. `ValidatorRegistry`, `MetadataRenderer`, `Validator` (`initialize` with `DEED_AGREEMENT_URI` as the
   default agreement), then `DeedNFTMintExtension` and `DeedTrustExtension`, then `DeedNFT` with the
   two extensions as constructor arguments.
3. `ValidatorRegistry.setDeedNFT`, `Validator.setDeedNFT`, `MetadataRenderer.setDeedNFT`,
   `DeedNFT.setMetadataRenderer`, and the renderer's default images.
4. `FundManager` (5% commission), `ValidatorRegistry.setFundManager`,
   `FundManager.addCompatibleDeedNFT(DeedNFT)`, `Validator.setFundManager`.
5. `Validator.setupValidationCriteria` for all four asset types, and
   `registerOperatingAgreement(DEED_AGREEMENT_URI, "Deed Trust Agreement")`.
6. If `DEED_AGREEMENT_V5_HASH` and `DEED_AGREEMENT_V5_URI` are set, `adoptAgreementVersion` for Land
   and Estate.
7. `registerValidator` and `updateValidatorStatus(true)` for the default validator, which grants it
   `VALIDATOR_ROLE` on `DeedNFT` and `FEE_MANAGER_ROLE` on the `FundManager`.
8. If `DEED_FEE_TOKEN` and `DEED_SERVICE_FEE` are set, the validator whitelists the token and sets
   the fee, and `DeedNFT.setFundManager`. Without them mints charge no fee.
9. `Subdivide`, with `VALIDATOR_ROLE` to the validator, `Validator.addCompatibleDeedNFT(Subdivide)`
   and `DeedNFT.setApprovedMarketplace(Subdivide, true)`.
10. `FractionTokenFactory` and `Fractionalize`, `updateFractionalizeContract`, and `Fractionalize`
    approved as a marketplace on both `DeedNFT` and `Subdivide`.
11. `FunctionalContractRegistry` and `CoopTransferAgent`; `Subdivide` and `Fractionalize` registered
    as custody, the agent as custody and Coop agent; `DeedNFT.setTrustRegistries` with the registry
    and `MEMBERSHIP_REGISTRY` (zero if unset, settable once later). `SEAPORT_CONDUIT`, if set, is
    approved as a marketplace.
12. **Handover** (`deploy/deed_admin_handover.ts`). Every admin, upgrade and settings role and every
    ownership goes to the Deed admin, the fee receivers and royalty receiver too; `MINTER_ROLE` goes
    to `DEED_MINTER` and the default `Validator`'s `VALIDATOR_ROLE` to `DEED_VALIDATOR_SIGNER` (both
    default to the admin); the Safe gets `REMOVER_ROLE` on the registry. The deployer renounces
    everything, and the script checks it holds nothing afterwards. On a live network it refuses an
    admin that is not a timelock with at least a 7-day delay.

### Upgrading an existing deployment: deploy 30

**`deploy/30_deploy_DeedV5.ts` brings a Deed track that predates v5 up to it, keeping the `DeedNFT`
proxy and its address.** Without `DEED_V5=1` it only validates the upgrade. With it, run by the
`DeedNFT` admin:

1. Deploys `DeedNFTMintExtension`, `DeedTrustExtension` and `DeedRolesExtension` and upgrades
   `DeedNFT` in place. Deeds minted before the upgrade have no trust record and stay legacy deeds.
2. Deploys fresh `ValidatorRegistry`, `MetadataRenderer`, `Validator`, `FundManager`, `Subdivide`,
   `FractionTokenFactory` and `Fractionalize` proxies with the same wiring as `deploy_all.ts` steps
   3–5, 7, 9 and 10, and points `DeedNFT` at them (`setValidatorRegistry`, `setMetadataRenderer`,
   `setDefaultValidator`). The old ones stay deployed for the legacy deeds that name them, but lose
   every power over `DeedNFT`: the old validator's `VALIDATOR_ROLE` and the old `Subdivide`'s and
   `Fractionalize`'s marketplace approvals. Their records are kept as `<Name>Legacy`.
3. Deploys the `FunctionalContractRegistry`, `CoopTransferAgent` and `RedemptionAgent`, registers the
   new `Subdivide` and `Fractionalize` as custody and both agents as custody and Coop agent, calls
   `DeedNFT.setTrustRegistries` once, and names the `RedemptionAgent` the `HousingAllowanceRecord`'s
   deed contract.

### Trust deed setup

A trust deed mints only when three things are in place:

- **An adopted agreement version.** `scripts/adopt_trust_agreement.ts` calls
  `Validator.adoptAgreementVersion` for Land and Estate with `DEED_AGREEMENT_V5_HASH` (the
  agreement's content hash, or `DEED_AGREEMENT_FILE` to hash a file) and `DEED_AGREEMENT_V5_URI`.
  It prints the calls unless `EXECUTE=1`, and prints them to propose once the Deed timelock holds the
  roles.
- **An eligible trustee.** `ValidatorRegistry.isEligibleTrustee` accepts a signer (a `VALIDATOR_ROLE`
  holder) of an active validator, or a licensed trustee the registry owner has listed with
  `setLicensedTrustee` (the same script, `DEED_LICENSED_TRUSTEES`). A validator contract is never
  eligible. The trustee signs a `TrusteeAcceptance`, which `mintTrustDeed` checks.
- **A program**, for Coop deeds: its sponsor becomes the protector and its title administrator is the
  default trustee.

What is left for later:

- The trust agreement version, if the `DEED_AGREEMENT_V5_*` variables were not set:
  `Validator.adoptAgreementVersion` for Land and Estate. Until then `mintTrustDeed` reverts
  `AgreementNotAdopted`.
- The `MembershipRegistry`, if `MEMBERSHIP_REGISTRY` was not set: `setTrustRegistries(0, registry)`.
  Until then no recipient meets the Verified policy.
- The mint fee, if not configured: the validator's token and fee, then `DeedNFT.setFundManager`.
  After that the minter must call `FundManager.setMaxFee` before it can mint.
- Each payer's `setMaxFee`, and any further validators, licensed trustees or Functional Contracts.

Upgrades use `deploy/upgrade/`; the steps are in [Operators](../../operators/deploying-contracts.md).
