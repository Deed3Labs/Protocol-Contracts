# Commercial equipment

Commercial Equipment is asset type `3` (`DeedNFT.AssetType.CommercialEquipment`): machinery such as
an excavator, a tractor or a production line. A Commercial Equipment deed cannot be subdivided. It
can be [fractionalized](../fractionalization.md) like any deed.

What a validator reviews off-chain before validating a deed, such as a purchase agreement, service
records or an inspection, is up to that validator. The contracts do not check documents. They check
that the traits below are present, and record the validator's result.

---

## Trait keys

**These are the keys the contracts read.** Each is a separate trait on the deed, set with
`DeedNFT.setTrait` and a string value (`valueType` 1). Keys are case-sensitive and hashed with
`keccak256`, so `serialNumber` and `Serial Number` are different traits.

| Key | Required by the preset criteria | Used in the metadata name |
|---|---|---|
| `manufacturer` | Yes | Yes |
| `model` | Yes | Yes |
| `serialNumber` | Yes | Yes |
| `year` | Yes | No |
| `equipmentType` | No | Yes, when there is no serial number |

"Required by the preset criteria" means `Validator.setupValidationCriteria(3)`. A validator can set
different criteria with `setValidationCriteria`
([`validation-system.md`](../validation-system.md#validation-criteria)). The preset also requires
an operating agreement and a non-empty `definition`.

The renderer names an equipment deed `{manufacturer} {model} (S/N: {serialNumber})`, falling back
to `{equipmentType} - {manufacturer} {model}`, `{manufacturer} {model}` and then
`{manufacturer} Equipment` ([names](../metadata-renderer.md#names)).

```solidity
deedNFT.setTrait(tokenId, bytes("manufacturer"), bytes("Caterpillar"), 1);
deedNFT.setTrait(tokenId, bytes("model"), bytes("320"), 1);
deedNFT.setTrait(tokenId, bytes("serialNumber"), bytes("CAT0320XABC12345"), 1);
deedNFT.setTrait(tokenId, bytes("year"), bytes("2021"), 1); // a string, not a number
deedNFT.setTrait(tokenId, bytes("equipmentType"), bytes("Excavator"), 1);
```

Every deed also carries the seven traits set at mint: `assetType`, `isValidated`,
`operatingAgreement`, `definition`, `configuration`, `validator` and `beneficiary`.

---

## Other traits and records

**Any other string trait is stored and shown in `attributes`, but no contract reads it.** The
example metadata in
[`CommercialEquipmentMetadataTemplate.json`](../../../../test/templates/CommercialEquipmentMetadataTemplate.json)
suggests labels such as Category, Type, Dimensions, Weight, Power Source, Operating Hours, Purchase
Date, Warranty Expiration, Holding Entity, Location, Condition, Last Service Date and Maintenance
Schedule.

Supporting records are stored in the `MetadataRenderer`
([stored details](../metadata-renderer.md#stored-details)):

- **Documents**, one URI per type, with `manageTokenDocument`. The template uses
  `purchase_agreement`, `warranty`, `service_records`, `operating_manual`, `certification` and
  `inspection_reports`.
- **Legal information** with `setTokenLegalInfo`: jurisdiction, registration number and date,
  document references, restrictions such as a lien.
- **Condition** with `setAssetCondition`: a general rating, last inspection date, known issues and
  improvements. **Features** with `setTokenFeatures`.

---

## Known limitations

- **`year` must be a string.** `validateDeed` decodes it as one; stored as a number (`valueType` 2),
  it can make validation revert.
- **The example metadata has no `equipmentType`.** The renderer reads `equipmentType`; the template
  offers "Type" and "Category" instead, which are different keys.
- **Equipment shows as `Equipment` in `attributes`.** The template's `Asset Type` value is
  "Commercial Equipment"; the renderer writes `Equipment`.
- **The example metadata uses display labels, not trait keys.** `test/templates` lists
  "Manufacturer", "Model" and "Serial Number". The contracts read `manufacturer`, `model` and
  `serialNumber`; a trait set under the label is a different key and is not read.
