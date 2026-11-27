# Deed trust agreement v5: the contract interface

This is the on-chain side of trust agreement v5, as built in Phase 3 (branch `audit/phase-3-deed-v5`). It covers
`specs/deed-trust-v5-brief.md`, `-addendum-1.md` and `-addendum-2.md`, and DECISIONS #8, #9, #10 and the
Addendum 1 decisions. The owner aligns the agreement's drafting notes to this file.

Sections:

1. Where things live
2. Reserved trait keys
3. Functions and events, by brief item
4. Deviations from the brief and addenda, with reasons

## 1. Where things live

| Contract | Role |
| --- | --- |
| `DeedNFT` (UUPS proxy) | The ERC-721. Its storage and inheritance are in `DeedNFTBase`. |
| `DeedNFTMintExtension` | Runs `mintAsset`, `mintTrustDeed`, `reserveId`, `computeDeedId`, `setTrait`, `removeTrait`, and (Phase 4c, for room) the `freezeConsentDigest` view. |
| `DeedTrustExtension` | Runs the rest of `IDeedTrust` and the transfer rules for every mint, transfer and burn. |
| `IDeedTrust` | The ABI of the trust surface. |
| `FunctionalContractRegistry` | The contracts a deed may be deposited into under any policy, plus the Coop agents. |
| `CoopTransferAgent` | The only route for a Coop-policy deed to change hands. |
| `ValidatorRegistry` | Validators, plus the licensed-trustee list (Addendum 2). |
| `Validator` | Adopts agreement and rider versions per asset type. |
| `TimelockController` | OpenZeppelin's, unmodified: the Deed timelock (7 days, Foundation Safe proposer). |

**How the extensions are reached:**

- DeedNFT reaches both extensions by `delegatecall`, so their code runs against the proxy's storage with the original caller.
- Both are passed to the implementation's constructor and pinned as immutables (`mintExtension()`, `trustExtension()`). Changing either is a DeedNFT upgrade, which sits behind the timelock.
- **Call the `IDeedTrust` functions on the DeedNFT address with the `IDeedTrust` ABI.** DeedNFT's `fallback` serves them. The deploy scripts save DeedNFT's ABI merged with `IDeedTrust`.

**Which deeds are trust deeds:**

- **Trust deed:** any deed with a non-zero `agreementHash`. Every Land (0) and Estate (2) deed is one, minted with `mintTrustDeed`.
- **Legacy deed:** Vehicle (1) and CommercialEquipment (3) keep `mintAsset` and the Phase 1 rules. The agreement does not apply to them, so they have no trustee.

## 2. Reserved trait keys (ERC-7496)

Keys are `keccak256(name)`. Values are abi-encoded as shown. Nobody can write a reserved trait through `setTrait` or `removeTrait`, on any deed.

| Trait | Encoding | Set by |
| --- | --- | --- |
| `agreementHash` | `bytes32` | mint; `electAgreementVersion` |
| `riderHashes` | `bytes32[]` | mint; `electAgreementVersion` |
| `trustee` | `address` | mint; `setTrustee`; standby promotion |
| `protector` | `address` (0 = the current holder) | mint; `setProtector` |
| `standbyTrustee` | `address` | `setStandbyTrustee`; cleared on promotion |
| `trusteeSuspended` | `bool` | `applyLicensingDetermination`; a transfer making the trustee the holder; cleared by `setTrustee` |
| `transferPolicy` | `uint8`: 0 Open, 1 Verified, 2 Coop | mint (fixed) |
| `status` | `uint8`: 0 Active, 1 Retired, 2 Void | mint; burn; `markVoid` |
| `programId` | `bytes32` | mint (with a program) |
| `programSponsor` | `address` | mint (with a program) |
| `titleAdministrator` | `address` | mint (with a program) |
| `programParams` | `(bytes32 paramsHash, uint16 rofrPeriodDays, uint16 completionWindowDays, bool versionConsentRequired)` | mint (with a program) |
| `mintParamsHash` | `bytes32` = `keccak256(abi.encode(TrustMintParams))` | mint |
| `isValidated`, `validator` | as before | validator paths only |
| `beneficiary` | no longer written (see item 5) | nobody |

**Locked keys on a trust deed:** `definition`, `operatingAgreement` and `assetType` are locked for everyone, the deed's validator included. `definition` changes only through `correctDefinition`, and `operatingAgreement` only through `electAgreementVersion`.

**Reading the record:** `trustRecordOf(tokenId)` returns the same data as a `TrustRecord` struct, plus `nonce` and `lastFrom`. All traits stay readable after a burn.

## 3. Functions and events, by brief item

**Signatures and consent.** Wherever a party must accept or consent, it can do so in either of two ways:

- **A signature.** An EIP-712 signature passed in the `bytes` argument. EIP-1271 contract wallets are accepted. The domain is `{name: "DeedNFT Trust", version: "5", chainId, verifyingContract: <DeedNFT proxy>}`. The types are:
  - `TrusteeAcceptance(uint256 tokenId,address trustee,uint256 nonce)`
  - `StandbyAcceptance(uint256 tokenId,address standby,uint256 nonce)`
  - `AgreementConsent(uint256 tokenId,bytes32 agreementHash,bytes32 ridersHash,uint256 nonce)`
  - `CorrectionConsent(uint256 tokenId,bytes32 definitionHash,bytes32 reasonHash,uint256 nonce)`
  - `RestoreConsent(uint256 tokenId,bytes32 reasonHash,uint256 nonce)` (Phase 4b, re-review M-F)
  - `LicensingConsent(uint256 tokenId,address standby,bytes32 docHash,uint256 nonce)` (Phase 4b, re-review M-G)
  - `FreezeConsent(uint256 tokenId,uint8 reasonCode,bytes32 recordingRefHash,bytes32 uriHash,uint256 nonce)` (Phase 4c: the second validator signer of a freeze)
- **A prior call, with an empty `bytes` argument.** The "second call" form: the party first calls `approveTrustAction(bytes32 digest)`. Each approval is used once.

`nonce` is the deed's `trustRecordOf(tokenId).nonce`. It is 0 for the mint acceptance, and every role change or consumed consent moves it. The digest views below return what to sign or approve:

- `trusteeAcceptanceDigest(tokenId, trustee)`
- `standbyAcceptanceDigest(tokenId, standby)`
- `agreementConsentDigest(tokenId, agreementHash, riderHashes)`
- `correctionConsentDigest(tokenId, newDefinition, reasonURI)`
- `restoreConsentDigest(tokenId, reasonURI)`
- `licensingConsentDigest(tokenId, standby, docHash)`
- `freezeConsentDigest(tokenId, reasonCode, recordingRefHash, uri)` (Phase 4c)

In these structs, `ridersHash = keccak256(abi.encodePacked(riderHashes))`, `definitionHash = keccak256(bytes(newDefinition))`, `reasonHash = keccak256(bytes(reasonURI))` and `uriHash = keccak256(bytes(uri))`.

### Item 1: burning keeps the record

- `burnAsset(uint256)` / `burnBatchAssets(uint256[])`: the holder only. Never pausable, under any policy or status.
- `event DeedRetired(uint256 indexed tokenId, address indexed holder, bytes32 definitionHash, bytes32 operatingAgreementHash, bytes32 configurationHash, bytes32 agreementHash, bytes32 ridersHash)`: emitted on every burn.
  - The three trait hashes are `keccak256` of the stored ERC-7496 values (the abi-encoded strings).
  - This form can never revert, so the holder can always burn.
- `isRetired(uint256) → bool`: permanent. `statusOf(uint256) → uint8`.
- `getTraitValue`, `getTraitValues` and `getTraitKeys` work after a burn.

### Item 2: Deed IDs are never reused

- **`computeDeedId(uint8 assetType, bytes32 definitionHash, bytes32 parcelRef, address reserver, uint256 salt, bytes32 agreementHash, bytes32[] riderHashes) → (uint256 deedId, bytes32 identityHash)`**
  - `identityHash = keccak256(abi.encode(assetType, definitionHash, parcelRef, reserver, salt))`.
  - `deedId = 127 bits of keccak256(abi.encode(agreementHash, ridersHash, identityHash))`, with bit 127 set.
- **`reserveId(uint8 assetType, bytes32 definitionHash, bytes32 parcelRef, uint256 salt, bytes32 agreementHash, bytes32[] riderHashes) → uint256 deedId`**
  - The caller is the reserver. Land and Estate only.
  - Reverts `DeedIdUnavailable` if the ID was ever minted or is already reserved.
  - `event DeedIdReserved(uint256 indexed deedId, address indexed reserver, bytes32 agreementHash, bytes32 ridersHash, bytes32 identityHash)`.
- `reservationOf(uint256) → Reservation{reserver, agreementHash, identityHash}`.
- **`mintTrustDeed(TrustMintParams p, bytes trusteeAcceptance) → uint256 tokenId`**
  - `MINTER_ROLE` only, and pausable. The reserver in the ID is `p.owner`.
  - Reverts if the ID was ever minted, or is reserved by anyone other than `p.owner`.
  - `event TrustDeedMinted(uint256 indexed tokenId, address indexed owner, bytes32 agreementHash, bytes32 ridersHash, bytes32 identityHash, bytes32 mintParamsHash)`.
  - `DeedNFTMinted` is emitted as before.
- **`mintAsset(...)`:** unchanged ABI. It reverts `TrustDeedRequired` for Land and Estate.
- **No reuse on any path:** an ID minted on any path, or reserved, can never be minted again.

```
struct TrustMintParams { address owner; uint8 assetType; string definition; bytes32 parcelRef; uint256 salt;
  bytes32 agreementHash; bytes32[] riderHashes; string configuration; string uri; address validator; address token;
  address trustee; address protector; uint8 transferPolicy; Program program; }
struct Program { bytes32 programId; address sponsor; address titleAdministrator; bytes32 paramsHash;
  uint16 rofrPeriodDays; uint16 completionWindowDays; bool versionConsentRequired; }
```

### Item 3: who edits metadata

- **Validator powers:** only the deed's own validator, or a signer of it, holds them (Phase 1, D-2). On a trust deed those powers exclude `definition`, `operatingAgreement` and `assetType`.
- **`correctDefinition(uint256 tokenId, string newDefinition, string reasonURI, bytes protectorConsent)`**
  - Called by the unsuspended trustee.
  - Needs the protector's consent, or the holder's while the protector record is zero.
  - Resets `isValidated`.
  - `event MetadataCorrected(uint256 indexed tokenId, bytes32 indexed field, bytes32 oldHash, bytes32 newHash, string reasonURI)`. `field` is `keccak256("definition")`, and the hashes are `keccak256` of the stored values.
- `updateMetadata` reverts `UseTrustPaths` on a trust deed.

### Item 4: the agreement is pinned by hash; the holder elects

- **`Validator.adoptAgreementVersion(uint256 assetTypeId, bytes32 versionHash, string uri, string name)`**
  - Callable by `METADATA_ROLE`.
  - Land and Estate only: anything else reverts `AgreementOutsideAssetScope`.
  - The URI is also registered by name, so `validateDeed` accepts it.
  - `event AgreementVersionAdopted(uint256 indexed assetTypeId, bytes32 indexed versionHash, string uri)`.
- **`Validator.revokeAgreementVersion(uint256 assetTypeId, bytes32 versionHash)`**
  - Stops new mints and elections on that version.
  - Never touches a deed already on it.
  - `event AgreementVersionRevoked(...)`.
- `Validator.agreementVersionURI(uint256 assetTypeId, bytes32 versionHash) → string`: empty means not adopted.
- **`electAgreementVersion(uint256 tokenId, bytes32 agreementHash, bytes32[] riderHashes, bytes protectorConsent)`**
  - The holder only.
  - Every hash, the agreement and each rider, must be adopted by the deed's validator for its asset type.
  - The protector must also consent when `versionConsentRequired` is set and a protector is recorded.
  - Sets `operatingAgreement` to the adopted URI.
  - `event AgreementVersionElected(uint256 indexed tokenId, bytes32 previousAgreementHash, bytes32 agreementHash, bytes32 ridersHash)`.

### Item 5: the holder is not the beneficial owner

- `beneficialOwnerOf(uint256 tokenId) → address`, on DeedNFT. It returns the holder, unless the holder is a registered Functional Contract. In that case it returns whoever that contract holds the deed for, which it learns through `IDeedCustody`.
- `IDeedCustody.beneficialOwnerOf(uint256) → address` is implemented by:
  - `Subdivide`: the collection admin while a subdivision is active.
  - `Fractionalize`: the depositor, the fraction's collection admin, while the fraction is active. The fraction is found through the new `fractionOfDeed(uint256)`.
  - `CoopTransferAgent`: the seller while the deed is listed.

### Item 6: admin powers

- **Burning:** never pausable. Pause blocks only minting, trait edits and validation.
- **No pause on trust roles:** trust-role changes, elections, notices and voids are never pausable.
- **Admin role:** `DEFAULT_ADMIN_ROLE` covers upgrade, pause and settings. `deploy/deed_admin_handover.ts` hands it to the Deed `TimelockController`.
  - The handover refuses an admin that is not a timelock with at least a 7-day delay when `requireTimelockDelay` is set. `deploy_all` sets it on every live network.
- **No admin path** changes a deed's holder, definition, agreement, riders, trustee or protector.
- **Setup:** `setTrustRegistries(address functionalContractRegistry, address membershipRegistry)`.
  - Admin only, and each address can be set once.
  - Setting it also names the reserved traits.
  - `event TrustRegistriesSet(address, address)`.

### Item 7: Subdivide holds the parent

Unchanged from Phase 1 (D-9):

- `createSubdivision` takes custody of the parent.
- While units are outstanding, the parent can be neither burned nor withdrawn.
- `deactivateSubdivision` returns it.

### Items 8 and 9 under Addendum 1: trustee and protector

These replace brief item 8, which Addendum 1 superseded.

- **At mint:**
  - The trustee is `p.trustee`, or the program's `titleAdministrator`.
  - It must be eligible, must not be the owner or the protector, and must accept.
  - With a program, the protector is the program sponsor.
- **`setTrustee(uint256 tokenId, address newTrustee, bytes acceptance)`**
  - The protector only, or the holder while the protector record is zero.
  - The new trustee must be eligible, must not be the holder or the protector, and must accept.
  - Clears a suspension.
  - `event TrusteeChanged(uint256 indexed tokenId, address indexed previousTrustee, address indexed newTrustee)`.
- **`setProtector(uint256 tokenId, address newProtector)`**
  - The effective protector only.
  - Zero hands the role back to the holder.
  - Never the trustee or the standby.
  - `event ProtectorChanged(uint256 indexed tokenId, address indexed previousProtector, address indexed newProtector)`.
- `protectorOf(uint256) → address`: the effective protector.
- **Transfers to the trustee:** a transfer to the current trustee reverts `TransferToTrustee`. The exception is an active Functional Contract: the transfer then sets `trusteeSuspended` and emits `event TrusteeSuspended(uint256 indexed tokenId, address indexed trustee)`.
- **Eligibility:** `ValidatorRegistry.isEligibleTrustee(address) → bool` is true for:
  - a `VALIDATOR_ROLE` signer of an active validator, or
  - a licensed trustee.
  - It is never true for a validator contract.

### Addendum 2: trustee licensing

- **`ValidatorRegistry.setLicensedTrustee(address account, bool licensed, bytes32 licenseRef)`**
  - Callable only by the owner, the same key that registers and activates validators.
  - `isLicensedTrustee(address) → bool`.
  - `event LicensedTrusteeUpdated(address indexed account, bool licensed, bytes32 licenseRef)`.
  - Reverts `ValidatorCannotBeTrustee` for a registered validator contract.
- **`setStandbyTrustee(uint256 tokenId, address standby, bytes acceptance)`**
  - The effective protector only.
  - The standby must be eligible, must not be the holder, trustee or protector, and must accept.
  - Zero clears it.
  - `event StandbyTrusteeChanged(uint256 indexed tokenId, address indexed previousStandby, address indexed newStandby)`.
- **`applyLicensingDetermination(uint256 tokenId, bytes32 docHash, string uri, bytes protectorConsent)`**
  - Callable by the effective protector, the trustee or the standby.
  - Emits `NoticePosted`.
  - Then promotes the standby, if it is set, still eligible and not the holder or protector: `event StandbyPromoted(...)` and `TrusteeChanged`.
  - Otherwise it suspends the trustee: `TrusteeSuspended`.
  - A suspended trustee cannot `markVoid` or `correctDefinition`.
  - **Phase 4b (re-review M-G), a change to Addendum 2.** On the standby's own call, the determination is acted on only with the effective protector's consent (`LicensingConsent`, by signature or a prior approval; the holder's while the protector record is zero). Without it, the notice is posted and nothing else changes: no promotion and no suspension. `protectorConsent` is ignored on the protector's and the trustee's calls, which are unchanged. The Addendum 2 drafting needs this change.
- **No trustee fee:**
  - `Program` has no trustee-fee field.
  - The only payment paths, the mint fee through FundManager and `royaltyInfo`, pay the validator contract, which can never be a trustee.

### Item 9: transfer policy

The rules are enforced in the transfer hook (`DeedTrustExtension`).

**Always allowed, under every policy:**

- (a) a burn by the holder;
- (b) a return to `lastFromOf(tokenId)`, except into a removed Functional Contract;
- (c) a transfer into an active Functional Contract.

**Policies:**

- **Open:** as before. Third-party operators must be on the approved-marketplace list.
- **Verified:** the recipient needs a `MembershipRegistry` record whose status is not NONE, SUSPENDED or REVOKED (DECISIONS #9). Expiry does not matter.
- **Coop:** only a registered Coop agent can send the deed on. Direct transfers revert `TransferPolicyBlocked(2)`.

**`FunctionalContractRegistry`:**

- `register(address fc, uint8 kinds)`: `REGISTRAR_ROLE`, which is the timelock. `KIND_CUSTODY = 1`, `KIND_COOP_AGENT = 2`.
- `remove(address fc)`: `REMOVER_ROLE`, the Foundation Safe, takes effect at once.
- `kindOf(address) → (uint8 kinds, bool active)` and `isActive(address) → bool`.
- Events: `FunctionalContractRegistered(address indexed, uint8)` and `FunctionalContractRemoved(address indexed)`.

**`CoopTransferAgent(deedNFT)`:**

- **Listing.** The holder calls `DeedNFT.safeTransferFrom(holder, agent, tokenId, abi.encode(buyer, termsHash))`. This emits `Listed(tokenId, seller, buyer, termsHash, rofrEndsAt, completeBy)`.
- **Sponsor's right of first refusal.** The program sponsor has two options within `rofrPeriodDays` (default 30):
  - `exercise(tokenId, designee)`, which emits `RofrExercised`;
  - `waive(tokenId)`, which emits `RofrWaived`.
- **Completion.** The seller calls `complete(tokenId)` once the window has closed or the sponsor has acted, and within `completionWindowDays` (default 90). It emits `Completed`.
- **Withdrawal and recovery:**
  - `withdraw(tokenId)` by the seller, any time before completion, emits `Withdrawn`.
  - `recover(tokenId)` returns an unlisted deposit to where it came from and emits `Recovered`.
- **Views:** `listingOf(tokenId)`, `beneficialOwnerOf(tokenId)`.
- **Errors:** `NotDeedNFT`, `NotCoopDeed`, `InvalidBuyer`, `NotListed`, `NotSeller`, `NotSponsor`, `WindowClosed`, `WindowOpen`, `CompletionLapsed`, `StillListed`.

### Item 10: status and notices

- **`postNotice(uint256 tokenId, bytes32 docHash, string uri)`**
  - Anyone may call it, for any deed ever minted.
  - `event NoticePosted(uint256 indexed tokenId, address indexed sender, bytes32 docHash, string uri, address trustee, address protector)`.
  - `trustee` and `protector` are as of the posting, and `protector` is the effective protector.
- **`markVoid(uint256 tokenId, uint8 reasonCode, bytes32 recordingRefHash, string uri, address cosigner, bytes cosignerConsent)`**
  - Callable by the deed's validator, or a signer of it, or the unsuspended trustee. Trust deeds only.
  - `event DeedVoided(uint256 indexed tokenId, uint8 reasonCode, bytes32 recordingRefHash, string uri, bool transferable)`.
  - Reason codes below `128` leave the token transferable. Codes from `128` up freeze it, which blocks every transfer but burning. Only the validator may use them, and never while acting as the trustee.
  - **Phase 4c (two signers to freeze).** A freezing code takes two distinct signers of the deed's validator, as lifting a Void takes two parties. `cosigner` proposes the freeze by consenting to `FreezeConsent`, by signature in `cosignerConsent` or by a prior `approveTrustAction(freezeConsentDigest(...))` with `cosignerConsent` empty. The caller, a different signer, confirms it.
    - Neither may be the trustee, and the cosigner must still be a signer of the deed's validator when the freeze is confirmed. Otherwise the call reverts `FreezeNeedsSecondSigner(cosigner)`; a missing or wrong consent reverts `ConsentMissing(cosigner)`.
    - The consent names the reason code, the recording reference, the URI and the deed's nonce, and the freeze moves the nonce on, so it is used once.
    - A freeze also emits `DeedFreezeConfirmed(uint256 indexed tokenId, address indexed proposer, address indexed confirmer)`.
    - Below `128`, `cosigner` and `cosignerConsent` are ignored (pass `address(0)` and `0x`).
    - This changes the `IDeedTrust` ABI: `markVoid` gains the two arguments.
  - **Phase 4b (re-review M-F).** A Void is no longer permanent. `restoreFromVoid(uint256 tokenId, string reasonURI, bytes protectorConsent)` lifts it, freezing or not: the deed's validator (or a signer of it, not acting as the trustee) calls, and the effective protector consents (`RestoreConsent`). It emits `DeedRestored(uint256 indexed tokenId, address indexed validator, string reasonURI)` and reverts `NotVoid` on a deed that is not Void. Burning a frozen deed stays allowed; its record is kept (brief item 1).
  - **Phase 4b (re-review M-F).** On a trust deed, `DeedNFT.reassignValidator(tokenId, newValidator)` only records the request (`ValidatorReassignmentRequested(tokenId, newValidator, effectiveAt)`). The holder completes it with `completeValidatorReassignment(tokenId)` once `validatorReassignDelay()` has passed (default 7 days; the Deed timelock may set 1 to 30 days with `setValidatorReassignDelay`), which emits `ValidatorReassigned`. Until then the old validator is still the deed's validator and may still void it. Neither step runs while the deed is Void (`NotActive`). `pendingValidatorOf(tokenId)` reads a pending request. Legacy (non-trust) deeds change validator at once, as before.
  - **Phase 4c.** A transfer of a trust deed (to anyone, into a Functional Contract or back to where it came from) cancels a pending request, and so does a burn: DeedNFT emits `ValidatorReassignmentCancelled(uint256 indexed tokenId, address indexed validator)`. The new holder decides, with a request of its own and a fresh delay. Legacy deeds never have a pending request, so they are unchanged.
  - The suggested reason codes:
    - `1`: tax sale
    - `2`: foreclosure
    - `3`: condemnation
    - `4`: other, proceeds-bearing
    - `128`: court-ordered void, no proceeds
    - `129`: fraudulent or erroneous mint

### Item 11: cross-listing with Fabrica

- `deploy_all` approves `SEAPORT_CONDUIT` as a marketplace when it is set.
- The trait keys `operatingAgreement`, `definition` and `configuration` are unchanged.

### Errors (`IDeedTrust`)

`TrustDeedRequired`, `NotTrustDeed`, `AssetTypeOutsideAgreement`, `AgreementNotAdopted(bytes32)`, `DeedIdUnavailable(uint256)`,
`TrusteeNotEligible(address)`, `RoleConflict`, `ConsentMissing(address)`, `NotProtector`, `NotHolder`, `NotTrustParty`,
`InvalidTransferPolicy`, `ProgramRequired`, `ProtectorNotSponsor`, `TransferToTrustee`,
`TransferPolicyBlocked(uint8)`, `DeedFrozen`, `NotActive`, `FreezeNeedsValidator`, `DefinitionLocked`, `UseTrustPaths`,
`UnknownDeed`, `RegistryAlreadySet`, `NotVoid` (Phase 4b), `FreezeNeedsSecondSigner(address)` (Phase 4c).

DeedNFT itself adds `HookOnly` and `ExtensionMismatch`, and since Phase 4b `ReassignmentNotDue(uint64)`, `NoReassignmentPending` and `ReassignDelayOutOfRange(uint64)`.

## 4. Deviations from the brief and addenda, with reasons

### IDs

1. **The ID is 127 bits of the hash, not the full uint256.** Deed IDs live in [2^127, 2^128), because Subdivide packs `(deedId << 128) | unitId`, so a full 256-bit ID would collide units. Reuse is still impossible: `_everMinted` and reservations reject any ID ever used. The 2^63 birthday bound is far beyond any real deed count.
2. **ID inputs follow DECISIONS Addendum 1 item 2, not Addendum 1's "agreementHash plus a hash of all mint-time parameters".** The ID commits to the agreement, the riders and an identity hash; everything else goes into `mintParamsHash`. "County/APN" is `parcelRef`, a bytes32 the minter supplies (a hash of the county and APN), because the chain cannot parse the legal description. The reserver in a minted ID is always `p.owner`, the grantor.

### Metadata and the agreement

3. **The whole `definition` is locked, not just `definition.claim`.** The contract cannot parse JSON, so on a trust deed `definition` is locked as a whole and replaced as a whole by `correctDefinition`. A correction resets validation, so the deed's validator re-vouches.
4. **Corrections follow DECISIONS Addendum 1 item 3, not brief item 3.** The trustee proposes and the protector countersigns. Brief item 3's "assigned validator or the Trust Protector" is superseded. The deed's validator has no correction power on a trust deed.
5. **`versionConsentRequired` is not read from `configuration`.** `configuration` is free text. The flag is a program field instead, and defaults to true without a program (Addendum 1). Consent is needed only when a protector is recorded: while the record is zero, the holder is the protector and is also the one electing.
6. **`operatingAgreement` is the adopted URI.** On a trust deed it is the URI the validator adopted for the hash, not the validator base URI plus the token ID, so the validator's base URI no longer changes what a deed shows. Riders must be adopted too.

### Holder and protector

7. **Item 5: the `beneficiary` trait is dropped rather than renamed.** It is no longer written, and stays reserved so nobody can fake it. `beneficialOwnerOf` replaces it. IDeedCustody is implemented by Subdivide, Fractionalize and CoopTransferAgent: section 7's default excludes the credit contracts, which never hold deeds.
8. **`setProtector` comes from brief item 8.** Addendum 1 supersedes item 8 but defines no way to change the protector, so `setProtector` keeps the brief's rule: the current, effective protector names its successor.
   - Two separation rules were added. The protector can never be the trustee or the standby, and the trustee never the protector. Without them, one person could both propose and countersign a correction. It also enforces "a program sponsor can never change it alone".
9. **"Holder" means the token holder (`ownerOf`).** While a deed sits in a Functional Contract, the contract is the holder. Holder-only actions wait until the deed leaves it: elections, and the protector role while its record is zero. See open questions.

### Transfer policy

10. **The policy is enforced in the hook, not through ERC721-C.** Item 9 says to wire the policy into the stored ERC721-C `_transferValidator`, but Phase 1 (D-18) removed that surface. The approved-marketplace list still applies to third-party operators under every policy.
11. **Exception (b) does not apply to a removed Functional Contract.** DECISIONS #8 says removal blocks new deposits, and a return into one would be a new deposit.
12. **Coop agent design.** The brief does not specify one, so:
    - The program sponsor holds the right of first refusal, so a Coop deed needs a program.
    - The seller confirms closing, since the agent moves no money.
    - The seller may withdraw before completion.
    - The buyer need not be a member.
13. **Verified policy reading of DECISIONS #9.** SUSPENDED is read as "fraud-flagged". PENDING and EXPIRED records pass.
14. **Leaving a Functional Contract follows the recipient's policy.** The only exception is a return to the depositor. Two consequences:
    - A Coop or Verified deed in Fractionalize can be unlocked only to the depositor, or to a qualifying recipient.
    - A Subdivide collection admin transfer under a non-Open policy needs the new admin to qualify, or the admin to be passed back, before deactivation.

### Status and voids

15. **Void reason codes are a fixed table in code.** Item 10 asks for a per-reason-code toggle. The table is fixed (below 128 transferable, from 128 up frozen) rather than admin-configurable, because a configurable table would be a new admin power to freeze deeds. Freezing codes are validator-only and never usable by the trustee, because Addendum 1 says the trustee can never freeze. Since Phase 4c a freeze takes two distinct signers of the deed's validator.
    - Since Phase 4b a Void can be lifted (`restoreFromVoid`, the validator with the protector's consent); before that it was final.
    - Only trust deeds can be voided. Retired applies to every burned deed.
16. **`NoticePosted.protector` is the effective protector** (the holder while the record is zero), because that is who receives notices.

### Addendum 2 details

17. **Standby only after mint.** The standby is set with `setStandbyTrustee`, not at mint.
18. **Promotion checks the standby again.** It re-checks eligibility, and that the standby is not the holder or protector. Otherwise the trustee is suspended.
19. **The trustee-only route is a licensed-trustee list inside ValidatorRegistry, not a separate allowlist.**
    - It is granted by the registry owner, the same key that registers and activates validators, so no new admin exists.
    - DeedNFT already reads that registry, so it needs no new pointer.
    - A separate contract would add a deployment, an admin and a setter.
20. **The fee schedule cannot be checked on chain.** `feeSchedule` lives only inside the off-chain `paramsHash` document, so the contract cannot verify that it contains no trustee fee. The on-chain `Program` struct has no fee field at all.

### Code layout

21. **Extensions as constructor arguments.** DeedNFT takes its extensions as constructor arguments rather than creating them, because EIP-3860 caps init code at 48 KiB and DeedNFT plus both extensions is about 68 KiB. The constructor checks each extension's kind.
22. **Calling the trust surface needs the `IDeedTrust` ABI.** The trust functions are served from DeedNFT's fallback, so they are not in the `DeedNFT` artifact ABI.
    - The deploy scripts save a merged ABI.
    - `deploy/99_generateTsAbis.ts` and the app are not touched in this phase.
23. **Legacy assets keep `mintAsset`.** Vehicle and CommercialEquipment have no trustee, since the agreement does not apply to them.
24. **Program parameters are stored partly on chain.** The values a contract reads are fields. The rest live in the `paramsHash` document, and no URI is stored: the hash is the content hash.
