# Deed track security audit: findings

Scope: `protocol-contracts` @ `dev` 7eb5976 (solc 0.8.29 viaIR, OZ 4.9.6). DeedNFT, Validator, ValidatorRegistry, MetadataRenderer, FundManager, FractionToken, Subdivide, Fractionalize, FractionTokenFactory, ValidatorFactory, their interfaces, StringUtils and JSONUtils, and the deploy wiring (`deploy_all.ts`, `03`–`06`). All paths below are under `contracts/` unless they say otherwise.

PoCs are in `test/audit/deed/`. Each test passes while its bug exists. The fixture (`fixture.ts`) wires the contracts the way `deploy_all.ts` does, then adds real criteria, a registered agreement, Fractionalize as an approved marketplace, and Subdivide as compatible with the Validator.

Several of these issues already appear in `docs/protocol/deed-track` under "Known limitations" or in the behaviour tables. Those findings are marked **(documented)**. They keep their severity because the trust agreement will depend on them.

## Summary

| ID | Sev | Title | Location |
|---|---|---|---|
| D-1 | High | Holder rewrites a validated deed's legal description, definition and operating agreement, and it stays validated | core/DeedNFT.sol:652-664, 685-736 |
| D-2 | High | Global `VALIDATOR_ROLE` (deployer EOA, renderer) edits any deed's traits and assetType with no validation reset. The registry does not manage it | core/DeedNFT.sol:140, 238-243, 316, 551-606 |
| D-3 | High | Subdivide collection admin forges unit validation, validator/royalty receiver, beneficiary and parentDeed | extensions/Subdivide.sol:702-720, 843-899, 974-997 |
| D-4 | High | A non-burnable fraction locks the deed in Fractionalize forever once any share is minted (documented) | extensions/Fractionalize.sol:252-271, 633-642; core/FractionToken.sol:145-146 |
| D-5 | High | Any 1-share holder locks a burnable fraction's deed forever via `FractionToken.burn` (documented) | core/FractionToken.sol:131-138; extensions/Fractionalize.sol:263 |
| D-6 | Medium | Unescaped trait names in the renderer let an unvalidated deed's tokenURI show "Valid", the validated image and any name | core/MetadataRenderer.sol:323, 341; core/DeedNFT.sol:733-735 |
| D-7 | Medium | Any active validator overwrites another validator's deed: flips it invalid and takes the royalties (documented) | core/DeedNFT.sol:521-537; core/Validator.sol:367-440 |
| D-8 | Medium | Burned ids can be re-minted and inherit the old renderer record and the old live subdivision; the 9-digit id space can permanently brick sequential minting | core/DeedNFT.sol:362-374, 437-448, 479-492 |
| D-9 | Medium | Subdivide never takes custody: the parent stays transferable and burnable while units are outstanding (documented) | extensions/Subdivide.sol:327-369, 523-545, 615-625 |
| D-10 | Medium | Subdivision collection admin is not tied to deed ownership (documented) | extensions/Subdivide.sol:365, 1082-1097 |
| D-11 | Medium | Holder (and renderer owner) erase recorded restrictions and documents in MetadataRenderer | core/MetadataRenderer.sol:139-146, 536-635 |
| D-12 | Medium | Any holder grows the global `_allTraitKeys`, which permanently raises the cost of every deed's burn and tokenURI | core/DeedNFT.sol:617-645, 487-489, 772-793 |
| D-13 | Medium | Single-key admin and upgrade powers over deed custody and metadata (no timelock or multisig) | see §6 below |
| D-14 | Low | Operating agreements pass by substring, and removing a name does not de-register an agreement | core/Validator.sol:624-645, 258-265 |
| D-15 | Low | An owner's `updateMetadata` writes validator=0: royaltyInfo reverts and every later `updateMetadata` reverts | core/DeedNFT.sol:568-576, 602-605, 938-940 |
| D-16 | Low | Validator fee manager can raise the mint fee under a standing approval; mintAsset has no max fee | core/DeedNFT.sol:424-431; core/Validator.sol:743-746 |
| D-17 | Low | Pause semantics: burn blocked, but transfers and setTrait are not; Subdivide pause and marketplace list are not enforced | core/DeedNFT.sol:482, 685; extensions/Subdivide.sol:1157-1190 |
| D-18 | Low | `approve(address(0))` reverts under enforcement; ICreatorToken is advertised but the transfer validator is never called | core/DeedNFT.sol:1000-1005, 1035-1080, 894 |
| D-19 | Low | `beneficiary` is overwritten with custody contracts (Fractionalize, escrow) | core/DeedNFT.sol:1079; extensions/Subdivide.sol:1186 |
| D-20 | Low | MetadataRenderer and FundManager implementations can be initialized by anyone | core/MetadataRenderer.sol:152; core/FundManager.sol:73 |
| D-21 | Low | Subdivision units cannot be fractionalized (documented) | extensions/Fractionalize.sol:159 |
| D-22 | Info | `ValidatorFactory.createValidator` always reverts; deploy scripts 03 and 04 are broken; deploy_all leaves gaps | factories/ValidatorFactory.sol:114-117; deploy/* |
| D-23 | Info | Miscellaneous | various |

---

## Findings

### D-1 High: holder rewrites validated legal data without losing validation
**What happens.** `setTrait` and `removeTrait` (DeedNFT.sol:685-736, 652-664) let the owner write or delete any trait except `isValidated`, `validator` and `beneficiary`. That includes `legalDescription`, `parcelNumber`, `definition` and `operatingAgreement`. Neither function resets `isValidated`. Only `updateMetadata` resets it (602-605). `setTrait` also skips the registered-agreement check that `updateMetadata` enforces (584-589).
**Impact.** After validation, a holder can swap the legal description or parcel, or point `operatingAgreement` at any document. On-chain the deed still reads validated by the validator. Buyers, lenders and the trust can be misled about which property the token represents. `validation-system.md` describes this as intended ("setTrait … Unchanged"), and that is incompatible with title integrity.
**Proof.** `D-01 holder rewrites legalDescription, definition and operatingAgreement of a VALIDATED deed`.
**Fix.** Make every trait in the asset type's `requiredTraits`, plus `definition` and `operatingAgreement`, validator-only after validation. Alternatively, reset `isValidated` and `validator` on any owner write or remove of those keys. Route operating-agreement changes through the registered-name check.

### D-2 High: global VALIDATOR_ROLE is a deed-wide write key outside the registry
**What happens.** `_checkValidatorOrOwner` (238-243) accepts any `VALIDATOR_ROLE` holder for any token. `initialize` grants the role to the deployer EOA (140), and `setMetadataRenderer` grants it to the renderer (316). Neither is a registered validator, so the registry's role sync never revokes them. A role holder can call `updateMetadata`, `setTrait` (including `assetType`) and `removeTrait` on every deed, and validation is not reset for role holders (602).
**Impact.** One key (the deployer by default), or the renderer contract after a renderer upgrade by its owner, can rewrite every deed's definition, legal description and asset type, and each deed stays "validated".
**Proof.** `D-02 a non-registry VALIDATOR_ROLE holder (deployer EOA from initialize) rewrites any holder's deed`.
**Fix.** Split the role in two. A trait-editor role should be scoped per deed: only the deed's recorded `validator` may edit, and edits are logged. Do not grant the role in `initialize`. Give the renderer a narrow role that only writes `customMetadata` and `gallery`.

### D-3 High: Subdivide collection admin forges unit validation and royalty receiver
**What happens.** `setUnitTrait` and `setUnitTraitFlexible` (702-720, 843-899) accept any key, including `isValidated`, `validator`, `beneficiary` and `parentDeed`. `royaltyInfo` (974-997) pays whatever contract the `validator` trait names.
**Impact.** The admin marks units validated without any validator. It can name an unregistered contract as the unit's validator and royalty receiver, and rewrite the beneficiary and the parent link. Combined with D-10, this power stays with the original creator after the deed is sold.
**Proof.** `S-01 collection admin self-validates a unit and points its royalty receiver at its own contract`.
**Fix.** Reserve the same keys DeedNFT reserves, plus `parentDeed`. Accept `validator` and `isValidated` only through `updateUnitValidationStatus`. Check `isValidatorActive` in `royaltyInfo`, or fall back to the parent.

### D-4 High: a non-burnable fraction can never be unlocked (documented)
**What happens.** `unlockAsset` calls `_burnAllShares`, which calls `FractionToken.burnFrom`. That function requires `burnable` (FractionToken.sol:146), and `burnable` is immutable in practice because the factory holds the admin role. The approvals path is dead because `adminApprovals` is never set (Fractionalize.sol:725).
**Impact.** After any share of a `burnable=false` fraction is minted, the deed stays in Fractionalize permanently, even for a holder of 100% of the shares.
**Proof.** `F-01 non-burnable fraction: once any share is minted the deed can never be unlocked`.
**Fix.** Burn through a Fractionalize-only path that ignores `burnable`, or transfer the shares to Fractionalize and burn them there. Reject `burnable=false` at creation until this is fixed.

### D-5 High: one holder bricks a burnable fraction (documented)
**What happens.** `FractionToken.burn` (131-138) lowers `totalSupply` but not `Fractionalize.activeShares`. Unlock requires `balance == activeShares` (Fractionalize.sol:263). Once `activeShares == totalShares`, nobody can mint to close the gap.
**Impact.** Any holder of a single share can burn it and lock the deed permanently, which is a cheap griefing or extortion vector.
**Proof.** `F-02 burnable fraction: any holder burning 1 share via FractionToken.burn locks the deed forever`.
**Fix.** Remove the public `burn`, or have unlock compare against `token.totalSupply()`. Track supply only in the token.

### D-6 Medium: JSON injection through trait names spoofs validation in tokenURI
**What happens.** The renderer escapes trait values but not trait names (MetadataRenderer.sol:323, 341). A holder controls the name of any new key by passing it as a string to `setTrait` (DeedNFT.sol:733-735). A name containing `"` can close the attributes array and append top-level `image`, `name` and `attributes` keys. Most JSON parsers keep the last duplicate.
**Impact.** The tokenURI of an unvalidated deed renders "Validation Status: Valid", the validated image, and any name or description. Marketplace and wallet users see a validated property. On-chain `getValidationStatus` is still correct.
**Proof.** `D-05 trait NAME is not JSON-escaped`.
**Fix.** Apply `_escapeJSON(traitName)`. Restrict owner-created keys to `[A-Za-z0-9_]`.

### D-7 Medium: any active validator overrides another's deed (documented)
**What happens.** `updateValidationStatus` (521-537) only checks that the caller is an active validator. `validateDeed` (Validator.sol:367-440) does not check the deed's recorded validator.
**Impact.** Validator B can mark A's validated deeds invalid. That blocks subdivision, which requires `isValidated`. It also re-points `royaltyInfo` to B.
**Proof.** `D-03 any active validator overwrites another validator's deed`.
**Fix.** Allow writes only from the deed's current `validator`, or through an explicit admin reassignment.

### D-8 Medium: id reuse and 9-digit ids
**What happens.** A salted id is `keccak(...) % 1e9` (362-374), checked only against current existence (443). `burnAsset` clears DeedNFT traits only. The renderer's legal info, documents and condition, and any Subdivide subdivision keyed by the id, survive. A salted id can also land on a future sequential id. When `nexttokenId` reaches it, `_mint` reverts and the `++` rolls back, so unsalted minting is bricked permanently (no setter).
**Impact.** A re-minted id, which can stand for a different property, carries the old recorded documents and a live subdivision with outstanding units. The new owner can mint more units without re-validation. Birthday collisions start around 37k salted mints.
**Proof.** `D-09 a burned salted id is re-minted; it inherits the old renderer legal record and the old live subdivision`. The sequential bricking is shown by code reading.
**Fix.** Keep `mapping(uint256=>bool) everMinted` and refuse reuse. Use a full 256-bit or namespaced id space for salted ids, separate from sequential ids. Clear renderer state on burn through a hook. Block burn while a subdivision is active.

### D-9 Medium: Subdivide takes no custody of the parent (documented)
**What happens.** `createSubdivision` and `mintUnit` (327-369, 523-545) only check `ownerOf`. DeedNFT has no subdivision awareness in transfer or burn.
**Impact.** A deed is sold with units outstanding, or burned. Units then claim land under a parent that no longer exists, and `deactivateSubdivision` reverts forever. Each new owner can mint more units without re-validation.
**Proof.** `S-03 units minted while the parent stays transferable and burnable`.
**Fix.** Escrow the parent in Subdivide for the life of the subdivision, or block parent transfer and burn while `activeUnits > 0`.

### D-10 Medium: collection admin survives the deed sale (documented)
**What happens.** `collectionAdmin = msg.sender` at creation (365) and never follows `ownerOf`.
**Impact.** The seller keeps D-3's powers and can set `burnable=false`, so the buyer can never deactivate the subdivision.
**Proof.** `S-02 creator keeps collection-admin powers over the units after selling the parent deed`.
**Fix.** Derive admin rights from `deedNFT.ownerOf(deedId)` (with D-9's escrow, from the escrowing owner).

### D-11 Medium: holder edits recorded legal info and documents
**What happens.** `onlyOwnerOrValidator` (139-146) lets the deed holder, any DeedNFT `VALIDATOR_ROLE` holder and the renderer `owner()` replace `legalInfo` (restrictions, documents, registration number) and remove documents (536-635). Nothing ties these fields to validation.
**Impact.** The holder can delete a recorded encumbrance, such as a deed of trust, or the recorded deed URI before a sale. The token still shows as validated.
**Proof.** `D-06 holder deletes recorded restrictions/documents in MetadataRenderer`.
**Fix.** Make `legalInfo` and documents validator-only. Version them instead of overwriting.

### D-12 Medium: unbounded global trait-key array
**What happens.** Every new key from any holder is pushed to `_allTraitKeys` (630-632), and keys are never removed. `burnAsset` (487-489) and `getTraitKeys` (772-793, called by tokenURI) loop over the whole array for every token.
**Impact.** Each key added by anyone permanently adds about 5k gas to every deed's burn and a scan to every tokenURI. The PoC measured burn going from 336k to 1.09M gas after 150 keys. At large N, burn and rendering exceed the block or eth_call gas limit. The attacker's cost is quadratic but cheap on an L2.
**Proof.** `D-08 any holder grows the GLOBAL _allTraitKeys array`.
**Fix.** Use a per-token key set (`EnumerableSet.Bytes32Set` per tokenId), or allow-list trait keys.

### D-13 Medium: single-key admin and upgrade control (code reading)
**What happens / impact.** See check item 6. One `DEFAULT_ADMIN_ROLE` key can do all of the following: upgrade DeedNFT and Subdivide; give itself `VALIDATOR_ROLE` and rewrite any deed; swap the registry for a fake one that marks any address active; swap the renderer. The Fractionalize admin can upgrade and move every deed it holds in custody. The FractionTokenFactory owner can upgrade the factory, which is `DEFAULT_ADMIN` of every FractionToken. It can then grant itself `MINTER_ROLE`, mint `activeShares` to itself and call `unlockAsset` on any burnable fraction. The renderer owner can upgrade the renderer, which holds DeedNFT `VALIDATOR_ROLE`. `deploy_all` leaves every one of these roles with the deployer EOA.
**Fix.** Put the roles behind a multisig with a timelock. Separate the upgrade role from operational roles. Revoke the deployer. Make FractionToken admin a no-op role or renounce it after initialization.

### D-14 Low: substring agreement matching
**What happens.** `_validateOperatingAgreement` (624-645) uses `contains`, not exact or prefix match. `removeOperatingAgreementName` (258-265) never prunes `registeredAgreementURIs`.
**Impact.** `https://evil/forged.pdf?x=<registered URI>` validates, and so does an agreement whose name was removed.
**Proof.** `D-04 validateDeed accepts any operatingAgreement that merely CONTAINS a registered URI or baseUri`.
**Fix.** Use an exact match, or a prefix match followed only by a decimal tokenId. Provide de-registration.

### D-15 Low: owner `updateMetadata` bricks royalties and further edits
**What happens.** It writes `validator = abi.encode(address(0))` (604). Later calls decode address(0) and revert (574-576), and so does `royaltyInfo` (940). That includes calls by validators.
**Impact.** Marketplaces calling `royaltyInfo` revert, and the metadata cannot be fixed until the deed is re-validated.
**Proof.** `D-07 owner updateMetadata writes validator=address(0)`.
**Fix.** Keep the recorded validator and only clear `isValidated`. Fall back to `defaultValidator` when the trait is zero.

### D-16 Low: mint fee has no bound
**What happens.** `mintAsset` reads `getServiceFee` at execution (427), and FundManager pulls it from the minter.
**Impact.** A validator fee manager can front-run the mint and drain the minter's standing allowance.
**Proof.** `D-13 validator FEE_MANAGER can raise the mint fee`.
**Fix.** Add a `maxFee` parameter.

### D-17 Low: pause semantics
`burnAsset` and `burnBatchAssets` are `whenNotPaused` (482, 500), so an owner cannot exit during a pause. `setTrait`, `removeTrait`, `updateValidationStatus` and transfers ignore pause. In Subdivide, pause does not stop transfers, burns or admin edits. Its stored marketplace list is never enforced (1157-1190). **Proof.** `D-10 burnAsset is whenNotPaused; transfers and setTrait are not` and `S-04 … any operator can be approved and move units; pause does not stop transfers`. **Fix.** Decide the policy explicitly. Pause metadata writes too. Enforce or remove Subdivide's marketplace settings.

### D-18 Low: royalty enforcement edge cases
`approve(address(0))` reverts with "!mkt" (1001), so an owner cannot clear a per-token approval. `supportsInterface` advertises ICreatorToken (894), and `getTransferValidationFunction` returns a selector, but `_transferValidator` is never called. **Proof.** `D-12 stored ERC721-C transfer validator is never consulted`. **Fix.** Exempt `to == address(0)`. Call the validator or stop advertising ICreatorToken.

### D-19 Low: `beneficiary` follows custody
`_beforeTokenTransfer` writes the recipient on every transfer (1079). When the deed sits in Fractionalize or an escrow marketplace, `beneficiary` names that contract. **Proof.** `D-11 transfer overwrites beneficiary`. **Fix.** Do not use this trait as the legal beneficiary. If one is needed, keep it as a separately governed field.

### D-20 Low: uninitialized implementations
MetadataRenderer and FundManager have no constructor calling `_disableInitializers`. OZ 4.9's `onlyProxy` stops implementation takeover. **Proof.** `D-15 … can be initialized by anyone`. **Fix.** Add the constructor.

### D-21 Low: unit fractionalization reverts (documented)
Fractionalize does not implement `onERC1155Received`. **Proof.** `F-03`. **Fix.** Implement the receiver, or remove the path.

### D-22 Info: factory and deploy scripts
- `ValidatorFactory.createValidator` calls `initialize` on `new Validator()`, whose constructor disables initializers, so it reverts (114-117). It also never hands the validator's roles or ownership to the caller. Proof: `D-14`.
- `deploy/03` calls the nonexistent `DeedNFT.ADMIN_ROLE()` (line 43). `deploy/04` passes 4 initializer args and calls the nonexistent `OPERATOR_ROLE`/`setDeedNFT` (40-66).
- `deploy_all` never approves Fractionalize as a marketplace, so `createFraction` reverts "!mkt". It never wires FundManager into DeedNFT, never adds Subdivide to the Validator's compatible list, and turns on all four asset types with no criteria, so every deed passes `validateDeed`. It leaves every role with the deployer.

### D-23 Info
- The FundManager initializer allows 100% commission, while the setter caps it at 10% (84 vs 112).
- Fee-on-transfer tokens would leave FundManager insolvent (259-262).
- ValidatorRegistry `removeValidator` does not prune `assetTypeValidators`, and `REGISTRY_ADMIN_ROLE` is unused.
- Validator `ADMIN_ROLE` is unused, and `_authorizeUpgrade` has a redundant require.
- The renderer defaults `isValidated = true` when the trait is missing (MetadataRenderer.sol:187).
- `setTokenCustomMetadata` double-encodes (417 → `valueType` 1 on already-encoded bytes).
- The `gallery` trait (`string[]`) breaks attribute decoding.
- `IDeedNFT.getAssetType` is not implemented by DeedNFT, so Subdivide's `assetType` writes revert.
- The DeedNFT storage layout matches `.openzeppelin/base-sepolia.json` (checked; no collision).

---

## Current-behaviour check for trust agreement v5

1. **burnAsset deletes traits and emits only tokenId: CONFIRMED, with additions.** DeedNFT.sol:479-492. It deletes every key in the global `_allTraitKeys` (487-489) and emits `DeedNFTBurned(tokenId)` (491) plus ERC721 `Transfer(owner,0,id)`. No `TraitUpdated` events are emitted, and the renderer is not synced. The ERC721URIStorage URI is cleared. It does **not** clear MetadataRenderer legal info, documents, condition or features, or a Subdivide subdivision (D-8). Only the owner can burn (`onlyDeedOwner`, 481), not an approved operator, and not while paused.
2. **9-digit ids that only check current existence: CONFIRMED.** `% 1000000000` at 373. `require(!_exists(tokenId))` at 443 is the only check, so burned salted ids can be re-minted (PoC D-09). The sequential path never reuses ids (`nexttokenId++`, 446-447), but a salted id can occupy a burned or future sequential id. The future case permanently bricks unsalted minting.
3. **Global VALIDATOR_ROLE, so any validator edits any deed, and holders can rewrite `definition`: CONFIRMED, with a correction.** `_checkValidatorOrOwner` uses the global role (238-243).
   - The role holders are registry-activated Validator contracts (ValidatorRegistry.sol:174-188), the deployer EOA (initialize, 140), the renderer (316) and anyone the admin adds (345-348).
   - Validator contracts have no code path to `setTrait` or `updateMetadata`. In practice, any active Validator can overwrite `isValidated` and `validator` on any deed (521-537; D-7). Any EOA or contract holding the role, the deployer by default, can edit any deed's definition, traits and assetType (D-2).
   - Holders rewrite `definition` via `updateMetadata` (551-606), which resets validation and sets validator to 0. They can also use `setTrait` or `removeTrait`, which **do not** reset validation (D-1).
4. **operatingAgreement = validator base URI + tokenId, and the validator can change that base URI: PARTLY CORRECT.**
   - At mint, the trait is `IValidator.defaultOperatingAgreement()` + tokenId (DeedNFT.sol:420, 458). That value is `defaultOperatingAgreementUri` (Validator.sol:234-237), not `baseUri`.
   - The Validator owner can change it with `setDefaultOperatingAgreement` (225-228). That affects **future mints only**, because each deed stores the full string.
   - `baseUri` (`setBaseUri`, 208-211) is separate. It, and every URI ever passed to `registerOperatingAgreement`, decides which agreements `validateDeed` accepts by substring (624-645; D-14).
   - An existing deed's agreement can be rewritten by the holder with `setTrait` (no check, no reset), by a `VALIDATOR_ROLE` holder, or by the holder with `updateMetadata` (exact registered name required, resets validation).
5. **_beforeTokenTransfer overwrites `beneficiary` with the recipient: CONFIRMED.** DeedNFT.sol:1079 runs on every non-mint, non-burn transfer, including into Fractionalize or escrow (PoC D-11). Subdivide does the same at 1186. Holders cannot set it (reserved, 671-673). At mint it is set to the minted owner (467).
6. **burnAsset is whenNotPaused; DeedNFT and Subdivide are UUPS upgradeable by one admin role: CONFIRMED.**
   - `burnAsset` 482 and `burnBatchAssets` 500 are `whenNotPaused`.
   - DeedNFT `_authorizeUpgrade` is `onlyRole(DEFAULT_ADMIN_ROLE)` (193-199), and Subdivide's is the same (309-313). There is no timelock, multisig or two-step in code. The deployer holds the role (139; Subdivide 254).
   - **No admin function transfers a deed directly.** Admin paths that can move a deed or change its metadata:
     - (a) a DeedNFT/Subdivide upgrade, which can do anything;
     - (b) `addValidator(self)` (345), then `updateMetadata`, `setTrait` or `removeTrait` on any deed;
     - (c) `setValidatorRegistry(fake)` (291), after which the fake registry can grant `VALIDATOR_ROLE` and report any caller active for `updateValidationStatus`;
     - (d) `setMetadataRenderer(evil)` (303), which controls tokenURI and receives `VALIDATOR_ROLE`;
     - (e) `setTraitName` (811), which relabels traits globally and is unescaped in JSON (D-6);
     - (f) the deployer's existing `VALIDATOR_ROLE` (140);
     - (g) a Fractionalize upgrade (`DEFAULT_ADMIN_ROLE`, 678), which can transfer every deed in custody;
     - (h) the FractionTokenFactory owner, whose upgrade can mint FractionTokens and unlock burnable fractions;
     - (i) the MetadataRenderer owner, who can edit any token's legal info and documents (139-146) and whose upgrade can make the renderer use its `VALIDATOR_ROLE`;
     - (j) the Validator owner and `METADATA_ROLE`, who control agreement acceptance.

     Approved marketplaces need the owner's approval, so the admin cannot use them to move deeds.
7. **Subdivide mints units while the parent stays transferable and burnable: CONFIRMED.** `createSubdivision` takes no custody (327-369). `mintUnit` and `batchMintUnits` check only `ownerOf` (523-545, 569-593). DeedNFT transfer and burn do not check subdivisions. After the parent is burned, units remain and the subdivision can never be deactivated (PoC S-03). Units can be minted without re-checking the parent's validation.
8. **_beforeTokenTransfer never calls the stored ERC721-C `_transferValidator` and only checks approved marketplaces ("!mkt"): CONFIRMED.** `_transferValidator` is read only by its getter and setter (1035-1047). The only gate is `_enforceRoyalties && _msgSender() != from && !_approvedMarketplaces[_msgSender()]`, which reverts with "!mkt" (1077), plus the same check in `approve` and `setApprovalForAll` (1000-1017). Owner-initiated transfers are unrestricted. Subdivide stores the same settings but enforces nothing (D-17).

---

## PoC files and results

Run with `npx hardhat test test/audit/deed/<file>.spec.ts --no-compile`. All 22 tests pass.

| File | Tests | Result |
|---|---|---|
| test/audit/deed/fixture.ts | shared deploy fixture | n/a |
| test/audit/deed/DeedMetadata.spec.ts | D-01 … D-08 (findings D-1, D-2, D-7, D-14, D-6, D-11, D-15, D-12) | 8 passing |
| test/audit/deed/DeedLifecycle.spec.ts | D-09 … D-15 (findings D-8, D-17, D-19, D-18, D-16, D-22, D-20) | 7 passing |
| test/audit/deed/SubdivideFractionalize.spec.ts | S-01 … S-04, F-01 … F-03 (findings D-3, D-10, D-9, D-17, D-4, D-5, D-21) | 7 passing |

The test labels (D-01, S-01, F-01 …) are spec-file labels. The table above maps them to the finding IDs. D-13 and the sequential-mint bricking in D-8 are shown by code reading.
