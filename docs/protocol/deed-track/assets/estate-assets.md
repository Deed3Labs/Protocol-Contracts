# Estates

Estate is asset type `2` (`DeedNFT.AssetType.Estate`): land together with the buildings on it, such
as a house or an apartment building. A validated Estate deed can be
[subdivided](../subdivision.md) into units. Estates use the same trait keys as
[Land](./land-assets.md).

What a validator reviews off-chain before validating a deed, such as the title, a survey or an
inspection, is up to that validator. The contracts do not check documents. They check that the
traits below are present, and record the validator's result.

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

"Required by the preset criteria" means `Validator.setupValidationCriteria(2)`, which is the same
preset as Land. A validator can set different criteria with `setValidationCriteria`
([`validation-system.md`](../validation-system.md#validation-criteria)). The preset also requires
an operating agreement and a non-empty `definition`.

The renderer names an Estate deed `{streetNumber} {streetName}, {state} {zipCode}, {country} - Estate`,
or `Parcel #{parcelNumber}, {state} {zipCode}, {country} - Estate` without a street address
([names](../metadata-renderer.md#names)). The example in [Land](./land-assets.md#trait-keys) shows
how to set the keys.

Every deed also carries the seven traits set at mint: `assetType`, `isValidated`,
`operatingAgreement`, `definition`, `configuration`, `validator` and `beneficiary`.

---

## Other traits and records

**Any other string trait is stored and shown in `attributes`, but no contract reads it.** The
example metadata in
[`EstateMetadataTemplate.json`](../../../../test/templates/EstateMetadataTemplate.json) suggests
labels such as City, Holding Entity, Property Type, Lot Size, Square Footage, Bedrooms, Bathrooms,
Year Built, Zoning, Zoning Code, Local Appraisal Source and Local Appraised Value (USD).

Supporting records are stored in the `MetadataRenderer`
([stored details](../metadata-renderer.md#stored-details)):

- **Documents**, one URI per type, with `manageTokenDocument`. The template uses `survey`,
  `title_report`, `deed`, `insurance_policy`, `home_inspection` and `floor_plan`.
- **Legal information** with `setTokenLegalInfo`: jurisdiction, registration number and date,
  document references, restrictions.
- **Condition** with `setAssetCondition`, and **features** with `setTokenFeatures`.

---

## Subdividing an estate

A validated Estate deed can be split into units, for example one per apartment. Each unit copies
`assetType`, `operatingAgreement`, `definition` and `configuration`, but not the keys above. To
validate a unit against the preset, the collection admin sets `country`, `state`, `county`,
`parcelNumber` and `legalDescription` on the unit itself
([validating units](../subdivision.md#validating-units)).

---

## Known limitations

- **Estates show as Land in `attributes`.** The renderer writes `Land` for an Estate's `Asset Type`
  attribute; the generated name ends in `- Estate` correctly.
- **The example metadata uses display labels, not trait keys.** `test/templates` lists attributes
  such as "Parcel Number" and "Street Number". The contracts read `parcelNumber` and
  `streetNumber`; a trait set under the label is a different key and is not read.
- **The template has no `legalDescription` or `zipCode` attribute.** The preset requires
  `legalDescription`, and the renderer reads `zipCode`. The template carries the legal description
  only inside its off-chain `properties.legal.legal_description`.
