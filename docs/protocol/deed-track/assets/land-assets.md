# Land

Land is asset type `0` (`DeedNFT.AssetType.Land`): a parcel of land. A validated Land deed can be
[subdivided](../subdivision.md) into units.

What a validator reviews off-chain before validating a deed, such as the title, a survey or the
zoning, is up to that validator. The contracts do not check documents. They check that the traits
below are present, and record the validator's result.

---

## Trait keys

**These are the keys the contracts read.** Each is a separate trait on the deed, set with
`DeedNFT.setTrait` and a string value (`valueType` 1). Keys are case-sensitive and hashed with
`keccak256`, so `parcelNumber` and `Parcel Number` are different traits.

| Key | Required by the preset criteria | Used in the metadata name |
|---|---|---|
| `country` | Yes | Yes |
| `state` | Yes | Yes |
| `county` | Yes | No |
| `parcelNumber` | Yes | Yes, when there is no street address |
| `legalDescription` | Yes | No |
| `streetNumber` | No | Yes |
| `streetName` | No | Yes |
| `zipCode` | No | Yes |

"Required by the preset criteria" means `Validator.setupValidationCriteria(0)`. A validator can set
different criteria with `setValidationCriteria`
([`validation-system.md`](../validation-system.md#validation-criteria)). The preset also requires
an operating agreement and a non-empty `definition`.

The renderer names a Land deed `{streetNumber} {streetName}, {state} {zipCode}, {country} - Land`,
or `Parcel #{parcelNumber}, {state} {zipCode}, {country} - Land` without a street address
([names](../metadata-renderer.md#names)).

```solidity
deedNFT.setTrait(tokenId, bytes("country"), bytes("USA"), 1);
deedNFT.setTrait(tokenId, bytes("state"), bytes("California"), 1);
deedNFT.setTrait(tokenId, bytes("county"), bytes("Riverside"), 1);
deedNFT.setTrait(tokenId, bytes("parcelNumber"), bytes("123-456-789"), 1);
deedNFT.setTrait(tokenId, bytes("legalDescription"), bytes("Lot 5, Block 2, Tract 1234"), 1);
```

Every deed also carries the seven traits set at mint: `assetType`, `isValidated`,
`operatingAgreement`, `definition`, `configuration`, `validator` and `beneficiary`.

---

## Other traits and records

**Any other string trait is stored and shown in `attributes`, but no contract reads it.** The
example metadata in
[`LandMetaDataTemplate.json`](../../../../test/templates/LandMetaDataTemplate.json) suggests labels
such as City, Holding Entity, Latitude, Longitude, Acres, Parcel Use, Zoning, Zoning Code, Local
Appraisal Source and Local Appraised Value (USD).

Supporting records are stored in the `MetadataRenderer`
([stored details](../metadata-renderer.md#stored-details)):

- **Documents**, one URI per type, with `manageTokenDocument`. The template uses `survey`,
  `title_report` and `deed`.
- **Legal information** with `setTokenLegalInfo`: jurisdiction, registration number and date,
  document references, restrictions.
- **Condition** with `setAssetCondition`, and **features** with `setTokenFeatures`.

---

## Subdividing land

A validated Land deed can be split into units. Each unit copies `assetType`, `operatingAgreement`,
`definition` and `configuration`, but not the keys above. To validate a unit against the preset,
the collection admin sets `country`, `state`, `county`, `parcelNumber` and `legalDescription` on
the unit itself ([validating units](../subdivision.md#validating-units)).

---

## Known limitations

- **The example metadata uses display labels, not trait keys.** `test/templates` lists attributes
  such as "Parcel Number" and "Street Number". The contracts read `parcelNumber` and
  `streetNumber`; a trait set under the label is a different key and is not read.
- **The template has no `legalDescription` or `zipCode` attribute.** The preset requires
  `legalDescription`, and the renderer reads `zipCode`. The template carries the legal description
  only inside its off-chain `properties.legal.legal_description`.
- **The deed's owner can set `isValidated` directly** with `setTrait`; see
  [`validation-system.md`](../validation-system.md#known-limitations).
