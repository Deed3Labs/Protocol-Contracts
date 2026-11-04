# Vehicles

Vehicle is asset type `1` (`DeedNFT.AssetType.Vehicle`). A Vehicle deed cannot be subdivided. It
can be [fractionalized](../fractionalization.md) like any deed.

What a validator reviews off-chain before validating a deed, such as the title, the registration or
a VIN check, is up to that validator. The contracts do not check documents. They check that the
traits below are present, and record the validator's result.

---

## Trait keys

**These are the keys the contracts read.** Each is a separate trait on the deed, set with
`DeedNFT.setTrait` and a string value (`valueType` 1). Keys are case-sensitive and hashed with
`keccak256`, so `vin` and `VIN` are different traits.

| Key | Required by the preset criteria | Used in the metadata name |
|---|---|---|
| `make` | Yes | Yes |
| `model` | Yes | Yes |
| `year` | Yes | Yes |
| `vin` | Yes | No |

"Required by the preset criteria" means `Validator.setupValidationCriteria(1)`. A validator can set
different criteria with `setValidationCriteria`
([`validation-system.md`](../validation-system.md#validation-criteria)). The preset also requires
an operating agreement and a non-empty `definition`.

The renderer names a Vehicle deed `{year} {make} {model}`, falling back to `{make} {model}` and
then `{make} Vehicle` ([names](../metadata-renderer.md#names)).

```solidity
deedNFT.setTrait(tokenId, bytes("make"), bytes("Toyota"), 1);
deedNFT.setTrait(tokenId, bytes("model"), bytes("Camry"), 1);
deedNFT.setTrait(tokenId, bytes("year"), bytes("2020"), 1); // a string, not a number
deedNFT.setTrait(tokenId, bytes("vin"), bytes("4T1B11HK0LU000000"), 1);
```

Every deed also carries the seven traits set at mint: `assetType`, `isValidated`,
`operatingAgreement`, `definition`, `configuration`, `validator` and `beneficiary`.

---

## Other traits and records

**Any other string trait is stored and shown in `attributes`, but no contract reads it.** The
example metadata in
[`VehicleMetadataTemplate.json`](../../../../test/templates/VehicleMetadataTemplate.json) suggests
labels such as License Plate, Registration State, Color, Body Type, Fuel Type, Transmission,
Mileage, Engine Size, Title Number, Title State, Title Status, Registration Expiration, Holding
Entity, Condition and Last Service Date.

Supporting records are stored in the `MetadataRenderer`
([stored details](../metadata-renderer.md#stored-details)):

- **Documents**, one URI per type, with `manageTokenDocument`. The template uses `title`,
  `registration`, `service_records`, `owners_manual` and `warranty`.
- **Legal information** with `setTokenLegalInfo`: jurisdiction, registration number and date,
  document references, restrictions such as a lien.
- **Condition** with `setAssetCondition`: a general rating, last inspection date, known issues and
  improvements. **Features** with `setTokenFeatures`.

---

## Known limitations

- **`year` must be a string.** Both `validateDeed` and the renderer decode it as one. Stored as a
  number (`valueType` 2), it can make validation revert and the renderer fall back to the stored
  URI.
- **The example metadata uses display labels, not trait keys.** `test/templates` lists "Make",
  "Model", "Year" and "VIN". The contracts read `make`, `model`, `year` and `vin`; a trait set
  under the label is a different key and is not read.
