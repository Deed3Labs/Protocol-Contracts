# Validation

A T-Deed is minted unvalidated. Its validator, which is the `Validator` contract recorded on the deed
and operated by whoever holds its `VALIDATOR_ROLE`, checks the deed's traits against the criteria
for its asset type and writes the result back to `DeedNFT`. What a validator reviews off-chain
before it calls `validateDeed` (title, survey, inspection and so on) is up to that validator. The
contracts record only the outcome.

Source: [`Validator.sol`](../../../contracts/core/Validator.sol),
[`ValidatorRegistry.sol`](../../../contracts/core/ValidatorRegistry.sol). Every function, role and
event is in [`smart-contracts.md`](./smart-contracts.md#validator).

---

## Validation status

**A deed's status is two traits: `isValidated` (true or false) and `validator` (an address).**
`DeedNFT.getValidationStatus(tokenId)` returns both. There are no other states. A deed that failed
its check and one that has never been checked both read `isValidated = false`; the
`DeedValidated(tokenId, false)` event is what tells them apart.

| Event | Effect on the deed |
|---|---|
| `mintAsset` or `mintTrustDeed` | `isValidated = false`, `validator` = the validator chosen at mint |
| `Validator.validateDeed` passes or fails the criteria | `isValidated` = the result, `validator` unchanged |
| `validateDeed` rejects the deed early (see below) | `isValidated = false`; `ValidationError` and `DeedValidated(tokenId, false)` emitted |
| Holder calls `reassignValidator` (at once on a legacy deed, after the delay on a trust deed) | `isValidated = false`, `validator` = the new validator |
| Holder calls `updateMetadata` (legacy deeds only) | `isValidated = false`, `validator` kept |
| The deed's validator calls `updateMetadata` | Unchanged |
| Trustee's `correctDefinition` (trust deeds) | `isValidated = false` |
| `setTrait`, `removeTrait`, transfer, burn | Unchanged. The validation traits are reserved (below) |

**Only the deed's own validator writes its status.** `DeedNFT.updateValidationStatus` accepts the
write only from the `validator` recorded on the deed (or the default validator, if the deed names
none), which must also hold `VALIDATOR_ROLE` on `DeedNFT`, be active in the `ValidatorRegistry`, and
pass itself as `validatorAddress`. Any other active validator reverts `NotDeedValidator`. The write
is paused with `DeedNFT`.

**Changing validator is the holder's call.** `DeedNFT.reassignValidator(tokenId, newValidator)` names
another active validator (`ValidatorNotUsable` otherwise). On a legacy deed it applies at once. On a
trust deed it is recorded as pending and takes effect only when the holder calls
`completeValidatorReassignment` after `validatorReassignDelay()`: 7 days by default, settable by the
`DeedNFT` admin between 1 and 30 days. Until then the old validator is still the deed's validator.
Neither step runs while the deed is Void, a new request restarts the clock, and a transfer or burn
cancels a pending one. No admin path changes a deed's validator.

### Reserved traits

`isValidated`, `validator`, `beneficiary` and the trust traits (`agreementHash`, `riderHashes`,
`trustee`, `protector`, `standbyTrustee`, `trusteeSuspended`, `transferPolicy`, `status`,
`programId`, `programSponsor`, `titleAdministrator`, `programParams`, `mintParamsHash`) are reserved
on every deed. `setTrait` and `removeTrait` refuse them for every caller, the holder and the
validator alike, so validation changes only through the paths in the table above. `beneficiary` is
no longer written; `beneficialOwnerOf` answers who owns a deed.

The other locks on trait edits:

- **Who edits.** The holder, or the deed's own validator: the `Validator` contract recorded on the
  deed or one of its signers (a `VALIDATOR_ROLE` holder inside it), while it is active. Anyone else
  reverts `NotDeedEditor`. Trait edits are paused with `DeedNFT`.
- **`assetType`** can be set only by the deed's validator, and no one can remove it.
- **Vouched-for traits.** Once a deed is validated, the holder can no longer change or remove
  `definition`, `operatingAgreement`, `configuration` or any trait the validator's criteria require
  for the asset type (`Validator.isRequiredTrait`); it reverts `ValidatedTraitLocked`. The validator
  can.
- **The agreement.** The holder changes `operatingAgreement` only through `updateMetadata`
  (`AgreementViaUpdateMetadata`).
- **Trust deeds.** `definition`, `operatingAgreement` and `assetType` are locked for everyone, the
  validator included (`DefinitionLocked`), and `updateMetadata` reverts (`UseTrustPaths`). The
  agreement changes only by the holder's `electAgreementVersion`, the definition only by the
  trustee's `correctDefinition` with the protector's countersignature.

`royaltyInfo` names the deed's `validator`, or the default validator if the deed names none.

---

## What `validateDeed` checks

**`Validator.validateDeed(tokenId)` reads the deed from the validator's `primaryDeedNFT`.** The
caller needs `VALIDATOR_ROLE` on that `Validator`, and the primary `DeedNFT` must be on its
compatible list. Then, in order:

1. **Asset type.** The deed's `assetType` trait must be one this validator supports
   (`supportedAssetTypes`).
2. **Operating agreement**, if the criteria require one. The deed's `operatingAgreement` trait must
   be present and recognised (see [Operating agreements](#operating-agreements)).
3. **Definition**, if the criteria require one. The `definition` trait must be a non-empty string.
4. **Required traits.** If the criteria list none, the deed is marked valid. Otherwise every listed
   trait must be present on the deed as a non-empty string. The result, valid or not, is written
   with `DeedNFT.updateValidationStatus`.

A deed that fails step 1, 2 or 3 is rejected: the validator emits `ValidationError` with the reason,
records `false` with `updateValidationStatus`, and emits `DeedValidated(tokenId, false)`. So a
validator re-checking a deed whose agreement or traits have gone bad withdraws its earlier verdict.
Every write goes through `updateValidationStatus`, so `validateDeed` reverts on a deed that names a
different validator.

Required traits are looked up by `keccak256` of their name, as separate traits. The contract does
not parse `definition`: a value that appears only inside the definition string does not count.

---

## Validation criteria

**Each `Validator` keeps one set of criteria per asset type.** A criteria set is:

```solidity
struct ValidationCriteria {
    string[] requiredTraits;
    string additionalCriteria;      // stored, never checked
    bool requireOperatingAgreement;
    bool requireDefinition;
}
```

`setupValidationCriteria(assetTypeId)` loads a preset and marks the type supported. Each preset
requires an operating agreement and a definition:

| Asset type | Required traits |
|---|---|
| Land (0) | `country`, `state`, `county`, `parcelNumber`, `legalDescription` |
| Vehicle (1) | `make`, `model`, `year`, `vin` |
| Estate (2) | `country`, `state`, `county`, `parcelNumber`, `legalDescription` |
| Commercial Equipment (3) | `manufacturer`, `model`, `serialNumber`, `year` |

`setValidationCriteria(assetTypeId, requiredTraits, additionalCriteria, requireOperatingAgreement,
requireDefinition)` sets custom criteria instead. `setAssetTypeSupport(assetTypeId, supported)`
turns a type on or off without touching its criteria. All three need `CRITERIA_MANAGER_ROLE`.
`getValidationCriteria(assetTypeId)` reads them back, and `isRequiredTrait(assetTypeId, traitKey)`
answers for one key.

A supported asset type with no criteria validates every deed. The deploy scripts load the preset
for all four types.

Which trait keys each asset type uses, and how they relate to the metadata, is on the asset pages:
[land](./assets/land-assets.md), [vehicles](./assets/vehicle-assets.md),
[estates](./assets/estate-assets.md), [commercial equipment](./assets/commercial-equipment.md).

---

## Operating agreements

**Every deed carries an operating agreement URI, and validation can require it to be recognised.**
A legacy deed (Vehicle, Commercial Equipment) gets the validator's `defaultOperatingAgreementUri`
with the token id appended. A trust deed (Land, Estate) gets the URI under which its validator
adopted the deed's agreement hash.

Matching is exact. `validateDeed` accepts an agreement that:

- is a URI with a name registered for it (`registerOperatingAgreement`, `setOperatingAgreementName`
  or `adoptAgreementVersion`), or
- is exactly the default agreement URI, `baseUri`, or a URI passed to `registerOperatingAgreement`
  that still has its name, followed by the deed's token id in decimal. For a unit, the suffix is the
  parent deed's id.

So a legacy deed's agreement passes as minted, and a trust deed's passes because
`adoptAgreementVersion` names the URI. `removeOperatingAgreementName` un-names a URI and removes it
from the registered list, so it stops validating. All of these need `METADATA_ROLE`.

**Agreement versions for trust deeds.** `adoptAgreementVersion(assetTypeId, versionHash, uri, name)`
records that this validator accepts a trust agreement (or rider) version, by content hash, for Land
(0) or Estate (2) only (`AgreementOutsideAssetScope` for the others; `EmptyAgreementVersion` for an
empty argument). Only adopted hashes can be used in `mintTrustDeed` or `electAgreementVersion`.
`revokeAgreementVersion(assetTypeId, versionHash)` stops new mints and elections on a version; deeds
already on it keep it. `agreementVersionURI(assetTypeId, versionHash)` reads the adoption. A validator
cannot change any deed's agreement hash.

`updateMetadata` uses a stricter rule for a new agreement on a legacy deed: it must have a name in
the deed's validator exactly (`operatingAgreementName`). The public `validateOperatingAgreement`
view uses a third rule: a named URI, or the default URI followed only by decimal digits.

---

## Validating subdivision units

**`validateSubdivisionUnit(subdivideContract, deedId, unitId)` runs the same checks on a unit's own
traits** and writes the result with `Subdivide.updateUnitValidationStatus`, recording `false` on a
rejection as for a deed. `subdivideContract` must be on the validator's compatible list, and the
`Validator` needs `VALIDATOR_ROLE` on `Subdivide`. Only the unit's recorded validator, or the
validator set for its subdivision, can write its status (`NotUnitValidator`). A unit copies only
`assetType`, `operatingAgreement`, `definition` and `configuration` from its deed, so any other
required trait must be set on the unit. Details in [`subdivision.md`](./subdivision.md#validating-units).

---

## A validator's lifecycle

**A validator is a `Validator` contract that the registry has activated.** Setting one up:

1. **Deploy** a `Validator` behind a UUPS proxy with `initialize(baseUri, defaultOperatingAgreementUri)`.
   The deployer becomes its owner, holds `DEFAULT_ADMIN_ROLE`, `VALIDATOR_ROLE`, `METADATA_ROLE`,
   `CRITERIA_MANAGER_ROLE` and `FEE_MANAGER_ROLE`, and is the royalty receiver. The royalty rate
   starts at 500 basis points (5%). `ValidatorFactory.createValidator` does this step, sets the
   `FundManager` and the fees in step 4 in the same call, and hands every role and ownership to the
   caller. Registering it (step 6) stays with the registry owner.
2. **Point it at the deeds.** The owner calls `setDeedNFT(DeedNFT)`, which makes it the primary and
   compatible contract, and `addCompatibleDeedNFT(Subdivide)` for units. `setFundManager` if mint
   fees are charged.
3. **Set criteria** with `setupValidationCriteria` or `setValidationCriteria`,
   **register the operating agreement** with `registerOperatingAgreement`, and for Land and Estate
   **adopt the trust agreement version** and any riders with `adoptAgreementVersion`.
4. **Set fees.** `addWhitelistedToken`, `setServiceFee(token, fee)`, `setRoyaltyFeePercentage`
   (at most 500) and `setRoyaltyReceiver`. With a `FundManager` set on `DeedNFT`, a mint reverts
   unless the validator has a non-zero fee for the payment token, and unless the minter's
   `FundManager.setMaxFee` cap covers it.
5. **Name signers.** Each account given `VALIDATOR_ROLE` on the `Validator` can run `validateDeed`,
   edit and void the deeds that name this validator, and serve as a trustee.
6. **Register and activate.** The registry owner calls `registerValidator(validator, name,
   description, supportedAssetTypes)`, which registers it inactive, then
   `updateValidatorStatus(validator, true)`. Activation grants the `Validator` `VALIDATOR_ROLE` on
   `DeedNFT` and `FEE_MANAGER_ROLE` on the `FundManager`.
7. **For units**, a `Subdivide` admin calls `addValidator(Validator)`.

`DeedNFT` will mint against an active validator that implements `IValidator` and supports the asset
type; `mintAsset` also needs a default operating agreement, `mintTrustDeed` an adopted agreement
version. `setDefaultValidator` on `DeedNFT` chooses the one used when a mint names none.

**Deactivating.** `updateValidatorStatus(validator, false)` revokes its `VALIDATOR_ROLE` on
`DeedNFT`; mints against it and its validation writes then revert, and its signers stop being deed
editors and eligible trustees. `removeValidator` deletes the record and takes it off the per-asset-type
lists as well. Deeds it already validated keep their status; their holders can move them to another
validator with `reassignValidator`.

---

## Roles

| Role | On | Allows |
|---|---|---|
| `VALIDATOR_ROLE` | `Validator` | `validateDeed`, `validateSubdivisionUnit`. Its holders are the validator's signers: deed editors, void callers and eligible trustees for the deeds that name it |
| `CRITERIA_MANAGER_ROLE` | `Validator` | Criteria and supported asset types |
| `METADATA_ROLE` | `Validator` | Operating agreements and agreement versions |
| `FEE_MANAGER_ROLE` | `Validator` | Payment tokens, service fees, royalty rate and receiver, `withdrawServiceFees` |
| `DEFAULT_ADMIN_ROLE` | `Validator` | Granting every other role; `grantRole` is restricted to it |
| Owner | `Validator` | Upgrades, URIs, which `DeedNFT`s it serves, `FundManager`, `TokenRegistry` |
| Owner | `ValidatorRegistry` | Every registration, status change and licensed-trustee listing |
| `VALIDATOR_ROLE` | `DeedNFT` | `updateValidationStatus`, for deeds that name the caller. Granted to active validators by the registry. It is not an editing right |

`ADMIN_ROLE` is declared on `Validator` but granted to no one.

---

## Known limitations

- **Required traits must be strings.** `validateDeed` decodes each one as a string. A required trait
  stored as a number or boolean (`setTrait` `valueType` 2 or 3) can make the call revert.
- **`additionalCriteria` is stored and never checked.**
- **`validateDeed` reads only the validator's `primaryDeedNFT`.** A validator serving more than one
  `DeedNFT` validates deeds in the others only after `setPrimaryDeedNFT`.
