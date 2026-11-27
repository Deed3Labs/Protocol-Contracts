# Metadata renderer

`MetadataRenderer` builds the JSON that `DeedNFT.tokenURI` returns. It combines the deed's on-chain
traits with details it stores itself: features, condition, legal information, documents, a gallery,
an animation URL and an external link. It serves one `DeedNFT`, set with `setDeedNFT`.

Source: [`MetadataRenderer.sol`](../../../contracts/core/MetadataRenderer.sol). Tests:
[`MetadataRenderer.spec.ts`](../../../test/core/MetadataRenderer.spec.ts) and
[`DeedMetadata.spec.ts`](../../../test/audit/deed/DeedMetadata.spec.ts). The function and role
summary is in [`smart-contracts.md`](./smart-contracts.md#metadatarenderer).

The renderer holds no role on `DeedNFT` and writes no trait there. What it stores, it keeps.

---

## How `tokenURI` is served

**`DeedNFT.tokenURI` asks the renderer first.** If the renderer is set and returns a non-empty
string, that is the token URI. If it is unset, reverts or returns empty, `DeedNFT` returns the URI
stored for the token at mint or by `updateMetadata`.

The renderer returns `data:application/json;base64,` followed by the encoded JSON.

---

## The JSON

```json
{
  "name": "123 Main St, California 90210, USA - Land",
  "description": "<the deed's definition trait>",
  "image": "ipfs://...",
  "background_color": "",
  "animation_url": "",
  "external_link": "",
  "configuration": "<the deed's configuration trait>",
  "gallery_images": ["ipfs://..."],
  "documents": [{ "docType": "survey", "documentURI": "ipfs://..." }],
  "features": ["..."],
  "asset_condition": {
    "general_condition": "Good",
    "last_inspection_date": "2025-01-15",
    "known_issues": [],
    "improvements": [],
    "additional_notes": ""
  },
  "legal_info": {
    "jurisdiction": "California",
    "registration_number": "...",
    "registration_date": "...",
    "documents": [],
    "restrictions": [],
    "additional_info": ""
  },
  "attributes": [
    { "trait_type": "Asset Type", "value": "Land" },
    { "trait_type": "Validation Status", "value": "Invalid" }
  ]
}
```

| Field | Source | Present |
|---|---|---|
| `name` | Generated from traits; see [Names](#names) | Always |
| `description` | The deed's `definition` trait | Always |
| `image` | See [Images](#images) | Always |
| `background_color`, `animation_url`, `external_link` | Stored per token | Always, possibly empty |
| `configuration` | The deed's `configuration` trait | When non-empty |
| `gallery_images` | Stored gallery | When non-empty |
| `documents` | Stored documents | When any |
| `features` | `setTokenFeatures` | When any |
| `asset_condition` | `setAssetCondition` | When `general_condition` is set |
| `legal_info` | `setTokenLegalInfo` | When `jurisdiction` is set |
| `attributes` | The deed's traits with a value, except those listed below | Always |

**Attributes.** The renderer lists the deed's trait keys with `getTraitKeys` and skips:

- `definition` and `configuration`, which have their own fields;
- `gallery`, a `string[]`;
- `riderHashes`, a `bytes32[]`;
- any value that is neither a single 32-byte word nor an ABI-encoded string.

So the trust traits, and numbers and booleans set with `setTrait`, cannot make `attributes` revert.
Each attribute's `trait_type`
is the trait's name in `DeedNFT` (`getTraitName`), JSON-escaped like the value. The six mint traits
have display names (`Asset Type`, `Validation Status`, `Operating Agreement`, `Definition`,
`Configuration`, `Validator`), and `setTrustRegistries` names the trust traits (`Trustee`,
`Protector`, `Transfer Policy`, `Status`, …). A trait set with a string key through `setTrait` is
named after the key itself, such as `streetNumber`, unless an admin renames it with `setTraitName`.
Values are rendered as follows:

- `assetType`: `Land`, `Vehicle`, `Equipment`, or `Land` for an Estate.
- `isValidated`: `Valid` or `Invalid`. A deed with no `isValidated` trait is treated as invalid.
- `validator`, `beneficiary`: a hex address, or left out when zero.
- Any other 32-byte value, such as a number, a boolean, an address or a hash: its value in hex.
- Every other trait: decoded as a string.

The stored `name`, `description` and `customMetadata` are kept but not written to the JSON, and the
per-asset-type default background colours are not used.

---

## Names

**`name` is built from the deed's traits, by asset type.** Trait values are read as strings.

| Asset type | Format, first match wins | Traits read |
|---|---|---|
| Land, Estate | `{streetNumber} {streetName}, {state} {zipCode}, {country} - Land` (or `- Estate`) | `streetNumber`, `streetName`, `state`, `zipCode`, `country` |
| | `Parcel #{parcelNumber}, {state} {zipCode}, {country} - Land` (or `- Estate`) | `parcelNumber`, then as above |
| Vehicle | `{year} {make} {model}` | `year`, `make`, `model` |
| | `{make} {model}`, then `{make} Vehicle` | |
| Commercial Equipment | `{manufacturer} {model} (S/N: {serialNumber})` | `manufacturer`, `model`, `serialNumber` |
| | `{equipmentType} - {manufacturer} {model}` | `equipmentType` |
| | `{manufacturer} {model}`, then `{manufacturer} Equipment` | |
| Any | `{Land, Vehicle, Estate or Equipment} #{tokenId}` | None |

For Land and Estate, the location part is built only when `state` is set; `zipCode` and `country`
are added after it when present.

---

## Images

**An unvalidated deed always shows the invalidated image.** Otherwise the first of these that is
set:

1. The stored `image`, mirrored from the deed's `image` trait.
2. The first gallery image.
3. The default image for the asset type.

Defaults live in `defaultImageURIs`: one per asset type, and key 255 for the invalidated image. The
owner sets them with `setAssetTypeImageURI` and `setInvalidatedImageURI`; `deploy_all.ts` sets all
of them, with Estate using the Land image.

---

## Trait mirroring

**When a trait changes in `DeedNFT`, it calls `syncTraitUpdate` on the renderer.** Only the
`DeedNFT` may call it. The renderer copies these traits into its own storage:

| Trait | Stored as |
|---|---|
| `image`, `background_color`, `animation_url` | The matching metadata field, used in the JSON |
| `name`, `description` | The matching metadata field, not used in the JSON |
| `gallery` | The gallery, decoded as `string[]` |
| `customMetadata` | Custom metadata, not used in the JSON |

Removing a `gallery` or `customMetadata` trait clears the stored copy. If a sync call reverts,
`DeedNFT` ignores the failure and keeps the trait. The trust traits are written without a sync.
Event: `MetadataSynced`.

---

## Stored details

**Recorded legal information and documents are the deed's validator's to write. Display details
are open to the holder too.** "The deed's validator" means the `Validator` recorded on the deed or
one of its signers, while it is active (`DeedNFT.isDeedValidator`).

| Function | Who | Stores |
|---|---|---|
| `setTokenLegalInfo(tokenId, jurisdiction, registrationNumber, registrationDate, documents, restrictions, additionalInfo)` | The deed's validator | Legal information. `jurisdiction` must not be empty. Emits `LegalRecordUpdated` with a hash of the record and the editor |
| `manageTokenDocument(tokenId, docType, documentURI, isRemove)` | The deed's validator | One document per `docType`. Adding an existing type replaces its URI; `isRemove` deletes it. Emits `DocumentRecordUpdated` with the editor |
| `setTokenFeatures(tokenId, features)` | Renderer owner, the deed's validator, or the deed's holder | A list of features, replacing the old one |
| `setAssetCondition(tokenId, generalCondition, lastInspectionDate, knownIssues, improvements, additionalNotes)` | Same | Condition. `generalCondition` must not be empty |
| `setTokenAnimationURL(tokenId, url)`, `setTokenExternalLink(tokenId, url)` | Same | Those fields |
| `setTokenCustomMetadata(tokenId, metadata)` | Same | Custom metadata, kept in the renderer only |

Each legal or document change bumps `legalRecordVersion(tokenId)`, and the event carries the new
version, so the history can be rebuilt from events though storage holds only the latest.

`setTokenGallery(tokenId, imageUrls)` needs `DEFAULT_ADMIN_ROLE` on the renderer. It drops empty
entries and keeps the list in the renderer only.

Reads, open to anyone: `getTokenFeatures`, `getAssetCondition`, `getTokenLegalInfo`,
`getTokenDocument(tokenId, docType)`, `getTokenDocuments`, `getTokenGallery`,
`getTokenAnimationURL`, `getTokenExternalLink`. `contractURI` returns `DeedNFT.contractURI`.

Writes emit `MetadataUpdate(tokenId)` (ERC-4906). Errors: `Unauthorized`, `Invalid` (a bad
argument, or no `DeedNFT` set), `Empty`.

---

## Roles

| Role | Allows |
|---|---|
| Owner | Upgrades; default images and background colours |
| `DEFAULT_ADMIN_ROLE` | `setDeedNFT`, `setTokenGallery` |
| The deed's validator or one of its signers | Legal information and documents for that deed, and the display details |
| Deed holder, or renderer owner | The display details for that deed |

A `VALIDATOR_ROLE` on `DeedNFT` gives no rights here. `DeedNFT.setMetadataRenderer` grants the
renderer nothing, and revokes `VALIDATOR_ROLE` from a previous renderer that older builds granted it.

---

## Known limitations

- **Estates render as Land in `attributes`.** The `Asset Type` attribute for an Estate reads `Land`.
  The generated name uses `- Estate` correctly.
- **Non-string name traits can break the JSON.** The traits read for the name (see [Names](#names))
  are decoded as strings. One stored as a number or boolean (`setTrait` `valueType` 2 or 3), such as
  a numeric `year`, makes the renderer revert; `DeedNFT.tokenURI` then returns the stored URI
  instead. In `attributes` such a value only shows as hex. Store descriptive traits as strings
  (`valueType` 1).
- **Field names differ from common marketplace metadata.** The renderer writes `external_link` and
  `gallery_images`; the example metadata in `test/templates` uses `external_url` and `gallery`.
- **A burned deed has no `tokenURI`.** The renderer checks `ownerOf`, which reverts for a burned
  token, and so does the stored-URI fallback. The deed's traits stay readable in `DeedNFT`, and the
  renderer's stored details for that token id stay as they were.
