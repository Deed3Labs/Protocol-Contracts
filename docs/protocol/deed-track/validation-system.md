# Validation

A T-Deed is minted unvalidated. A validator, which is a `Validator` contract operated by whoever
holds its `VALIDATOR_ROLE`, checks the deed's traits against the criteria for its asset type and
writes the result back to `DeedNFT`. What a validator reviews off-chain before it calls
`validateDeed` (title, survey, inspection and so on) is up to that validator. The contracts record
only the outcome.

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
| `mintAsset` | `isValidated = false`, `validator` = the validator chosen at mint |
| `Validator.validateDeed` passes or fails the criteria | `isValidated` = the result, `validator` = that `Validator` |
| `validateDeed` stops early (see below) | Nothing written; `ValidationError` emitted |
| Owner calls `updateMetadata` | `isValidated = false`, `validator` = zero address |
| Validator calls `updateMetadata` | Unchanged |
| `setTrait`, `removeTrait`, transfer | Unchanged. The validation traits are reserved (below) |

### Reserved traits

`isValidated`, `validator` and `beneficiary` are reserved. `setTrait` and `removeTrait` refuse them
for every caller, the deed's owner and `VALIDATOR_ROLE` alike, so validation changes only through
`updateValidationStatus` (an active validator writing its own address), `updateMetadata` (an owner's
edit resets it) and minting. `beneficiary` follows the deed on transfer. `assetType` can be set with
`setTrait` only by `VALIDATOR_ROLE`, and nobody can remove it. Because the `validator` trait can only
be written by a validator, `royaltyInfo` always names a validator, or no one, as the royalty receiver.

---

## What `validateDeed` checks

**`Validator.validateDeed(tokenId)` reads the deed from the validator's `primaryDeedNFT`.** The
caller needs `VALIDATOR_ROLE` on that `Validator`, and the primary `DeedNFT` must be on its
compatible list. Then, in order:

1. **Asset type.** The deed's `assetType` trait must be one this validator supports
   (`supportedAssetTypes`). Otherwise `ValidationError`, nothing written.
2. **Operating agreement**, if the criteria require one. The deed's `operatingAgreement` trait must
   be present and recognised (see [Operating agreements](#operating-agreements)). Otherwise
   `ValidationError`, nothing written.
3. **Definition**, if the criteria require one. The `definition` trait must be a non-empty string.
   Otherwise `ValidationError`, nothing written.
4. **Required traits.** If the criteria list none, the deed is marked valid. Otherwise every listed
   trait must be present on the deed as a non-empty string. The result, valid or not, is written
   with `DeedNFT.updateValidationStatus`.

Required traits are looked up by `keccak256` of their name, as separate traits. The contract does
not parse `definition`: a value that appears only inside the definition string does not count.

`DeedNFT.updateValidationStatus` accepts the write only from an address that holds `VALIDATOR_ROLE`
on `DeedNFT`, is active in the `ValidatorRegistry`, and passes itself as `validatorAddress`.

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
`getValidationCriteria(assetTypeId)` reads them back.

A supported asset type with no criteria validates every deed. The deploy script turns on all four
types without criteria, so until a criteria manager sets them, every deed passes.

Which trait keys each asset type uses, and how they relate to the metadata, is on the asset pages:
[land](./assets/land-assets.md), [vehicles](./assets/vehicle-assets.md),
[estates](./assets/estate-assets.md), [commercial equipment](./assets/commercial-equipment.md).

---

## Operating agreements

**Every deed carries an operating agreement URI, and validation can require it to be recognised.**
At mint the agreement is the validator's `defaultOperatingAgreementUri` with the token id appended.

`validateDeed` accepts an agreement that:

- has a name registered for it exactly (`registerOperatingAgreement` or `setOperatingAgreementName`),
- contains the validator's `baseUri`, or
- contains any URI passed to `registerOperatingAgreement`.

So a newly minted deed's agreement passes only if the default URI contains `baseUri` or has been
registered with `registerOperatingAgreement`. Both registration functions need `METADATA_ROLE`.

`updateMetadata` uses a stricter rule for a new agreement: it must have a name in the deed's
validator exactly (`operatingAgreementName`). The public `validateOperatingAgreement` view uses a
third rule: registered exactly, or containing the default URI.

---

## Validating subdivision units

**`validateSubdivisionUnit(subdivideContract, deedId, unitId)` runs the same checks on a unit's own
traits** and writes the result with `Subdivide.updateUnitValidationStatus`. `subdivideContract` must
be on the validator's compatible list, and the `Validator` needs `VALIDATOR_ROLE` on `Subdivide`.
A unit copies only `assetType`, `operatingAgreement`, `definition` and `configuration` from its
deed, so any other required trait must be set on the unit. Details in
[`subdivision.md`](./subdivision.md#validating-units).

---

## A validator's lifecycle

**A validator is a `Validator` contract that the registry has activated.** Setting one up:

1. **Deploy** a `Validator` behind a UUPS proxy with `initialize(baseUri, defaultOperatingAgreementUri)`.
   The deployer becomes its owner, holds `DEFAULT_ADMIN_ROLE`, `VALIDATOR_ROLE`, `METADATA_ROLE`,
   `CRITERIA_MANAGER_ROLE` and `FEE_MANAGER_ROLE`, and is the royalty receiver. The royalty rate
   starts at 500 basis points (5%).
2. **Point it at the deeds.** The owner calls `setDeedNFT(DeedNFT)`, which makes it the primary and
   compatible contract, and `addCompatibleDeedNFT(Subdivide)` for units. `setFundManager` if mint
   fees are charged.
3. **Set criteria** with `setupValidationCriteria` or `setValidationCriteria`, and
   **register the operating agreement** with `registerOperatingAgreement`.
4. **Set fees.** `addWhitelistedToken`, `setServiceFee(token, fee)`, `setRoyaltyFeePercentage`
   (at most 500) and `setRoyaltyReceiver`. With a `FundManager` set on `DeedNFT`, a mint reverts
   unless the validator has a non-zero fee for the payment token.
5. **Register and activate.** The registry owner calls `registerValidator(validator, name,
   description, supportedAssetTypes)`, which registers it inactive, then
   `updateValidatorStatus(validator, true)`. Activation grants the `Validator` `VALIDATOR_ROLE` on
   `DeedNFT` and `FEE_MANAGER_ROLE` on the `FundManager`.
6. **For units**, a `Subdivide` admin calls `addValidator(Validator)`.

`DeedNFT` will mint against an active validator that implements `IValidator`, supports the asset
type and has a default operating agreement. `setDefaultValidator` on `DeedNFT` chooses the one used
when a mint names none.

**Deactivating.** `updateValidatorStatus(validator, false)` revokes its `VALIDATOR_ROLE` on
`DeedNFT`; mints against it and its validation writes then revert. `removeValidator` deletes the
record as well. Deeds it already validated keep their status.

`ValidatorFactory` was written to deploy and register a validator in one call, but its
`createValidator` always reverts; see [Known limitations](#known-limitations).

---

## Roles

| Role | On | Allows |
|---|---|---|
| `VALIDATOR_ROLE` | `Validator` | `validateDeed`, `validateSubdivisionUnit` |
| `CRITERIA_MANAGER_ROLE` | `Validator` | Criteria and supported asset types |
| `METADATA_ROLE` | `Validator` | Operating agreements |
| `FEE_MANAGER_ROLE` | `Validator` | Payment tokens, service fees, royalty rate and receiver, `withdrawServiceFees` |
| `DEFAULT_ADMIN_ROLE` | `Validator` | Granting every other role; `grantRole` is restricted to it |
| Owner | `Validator` | Upgrades, URIs, which `DeedNFT`s it serves, `FundManager`, `TokenRegistry` |
| Owner | `ValidatorRegistry` | Every registration and status change |
| `VALIDATOR_ROLE` | `DeedNFT` | `updateValidationStatus`, plus `setTrait` (including `assetType`, but not the reserved traits) and `updateMetadata` on any deed. Granted to active validators by the registry |

`ADMIN_ROLE` is declared on `Validator` but granted to no one.

---

## Known limitations

- **`validateDeed` does not check which validator the deed names.** Any active validator can
  validate any deed in its primary `DeedNFT`, and becomes the deed's `validator`.
- **Required traits must be strings.** `validateDeed` decodes each one as a string. A required trait
  stored as a number or boolean (`setTrait` `valueType` 2 or 3) can make the call revert.
- **`additionalCriteria` is stored and never checked.**
- **`ValidatorFactory.createValidator` reverts.** It deploys `new Validator()` and calls `initialize`
  on it, but `Validator`'s constructor disables initializers. Past that, it would also need to own
  the `ValidatorRegistry` to register the new validator. It is not deployed and has no tests.
- **No tests cover unit validation**, because no tests cover `Subdivide`.
