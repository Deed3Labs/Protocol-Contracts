# Phase 3 report: Deed trust agreement v5 (+ Addendum 2)

Branch `audit/phase-3-deed-v5`, cut from `audit/phase-1` (PR #883, not yet merged into `dev`), so this branch is stacked on it. Nothing was deployed, no key was used, and no live network was touched. The only scripts run were the deploy scripts, once, on Hardhat's in-process network.

The final interface, the reserved trait keys and every deviation are in **`DEED-V5-INTERFACE.md`**. The owner aligns the agreement's drafting notes to that file.

Abbreviations used below:

- **TC**: `test/audit/deed/TrustV5Core.spec.ts`.
- **TT**: `test/audit/deed/TrustV5Transfers.spec.ts`.
- **DL / DM / DD**: the Phase 1 deed specs `DeedLifecycle`, `DeedMetadata` and `DeedDeployAndMisc`.

## How it is built

**The size problem.** DeedNFT had 30 bytes of EIP-170 headroom and Subdivide 12, so nothing in v5 could go into DeedNFT as it stood. DeedNFT now follows the TermIssuer split, with three parts:

- **`DeedNFTBase`**: the Phase 1 storage, unchanged and in the same order, plus the appended trust state.
- **`DeedNFT`**: the ERC-721 surface, the views and the legacy forwarding stubs.
- **Two extensions**, reached by `delegatecall`:
  - `DeedNFTMintExtension`: mints, Deed ID reservation and trait edits.
  - `DeedTrustExtension`: the trust surface and the transfer rules for every mint, transfer and burn.

**How the extensions are pinned.** Both are immutables of the implementation. They are passed as constructor arguments rather than created in the constructor, because DeedNFT plus both extensions is about 68 KiB of init code and EIP-3860 caps it at 48 KiB. The constructor checks each extension's kind, so they cannot be swapped.

**Who runs what:**

- DeedNFT's `fallback` serves `IDeedTrust`.
- The transfer hook's entry point is refused from outside (`HookOnly`).
- `setTrait` and `removeTrait` keep their ABI on DeedNFT through stubs.

**New contracts:**

- `FunctionalContractRegistry` (DECISIONS #8).
- `CoopTransferAgent`.
- `IDeedTrust`, `IDeedCustody` and `IFunctionalContractRegistry`.
- A one-line import that makes Hardhat build OpenZeppelin's `TimelockController`. It is used as-is, with no timelock code of our own.

## 1. Requirements

| Item | What changed | Files | Regression test |
| --- | --- | --- | --- |
| Brief 1, burn record | A burn keeps every trait readable, sets `status` = Retired and emits `DeedRetired` with the definition, agreement and configuration hashes and the holder. `isRetired` is permanent. | DeedNFT, DeedTrustExtension | TC "burn leaves the traits readable…" |
| Brief 2, IDs | Trust Deed ID = hash(agreementHash, ridersHash, identityHash), with the reserver bound into the identity. An ID ever minted or reserved can never be minted again. `reserveId` binds the reserver, agreement and identity. `mintParamsHash` is a trait and an event. | DeedNFTMintExtension | TC "the ID commits to…", "mintParamsHash…"; DL "D-8…" |
| Brief 3, metadata | On a trust deed nobody, the validator included, edits `definition`, `operatingAgreement` or `assetType`. `updateMetadata` reverts. `correctDefinition` needs the trustee to propose and the protector to countersign, and emits `MetadataCorrected` (DECISIONS A1 #3). | DeedNFT, both extensions | TC "nobody, the validator included…", "a definition correction needs…", "a program sponsor…can never…" |
| Brief 4, agreement | The `agreementHash` and `riderHashes` traits. The validator adopts versions per asset type, Land and Estate only. The holder elects, with the protector's consent when one is recorded and `versionConsentRequired` is set. No admin, validator or trustee path changes the hashes. | Validator, DeedTrustExtension | TC "traits hold agreementHash…", "with a protector recorded…" |
| Brief 4 / A1 #4, scope | Land and Estate only. `mintAsset` refuses them (`TrustDeedRequired`), `mintTrustDeed` and `reserveId` refuse the other types, and the Validator refuses to adopt for other types. | DeedNFTMintExtension, Validator | TC "the agreement covers Land and Estate only" |
| Brief 5, beneficial owner | The `beneficiary` trait is no longer written. `beneficialOwnerOf` resolves through registered Functional Contracts. IDeedCustody is implemented in Subdivide, Fractionalize (new `fractionOfDeed`) and CoopTransferAgent. | DeedTrustExtension, Subdivide, Fractionalize, CoopTransferAgent | DL "D-19 / v5 item 5…"; TT "items 5 and 7…" |
| Brief 6, admin limits | Burn and the trust-role functions are never pausable. Admin powers go to the Deed TimelockController: OZ, 7 days, Foundation Safe as proposer and executor. The handover refuses a non-timelock admin on live networks. No admin path to holder, definition, agreement, riders, trustee or protector. | deploy_all, deed_admin_handover, DeedTimelockImport | TT "item 6: pause never blocks…", "item 6: upgrade and pause sit behind…" |
| Brief 7, Subdivide lock | Unchanged from Phase 1 (D-9), now covered by v5 tests. | | TT "items 5 and 7…"; DL "D-8…" |
| A1, trustee at mint | The trustee must be eligible, accepted (EIP-712/1271 signature or a prior `approveTrustAction`) and not the owner or protector. With a program, the protector is the sponsor and the trustee defaults to the title administrator. | DeedNFTMintExtension, ValidatorRegistry | TC "mint requires an eligible trustee…", "program: protector is the sponsor…" |
| A1, setTrustee / protector | `setTrustee` is the protector's (the holder's while the record is zero) and needs acceptance. `setProtector` lets the protector name a successor. Trustee and protector never coincide. | DeedTrustExtension | TC "setTrustee: only the protector…", "setProtector…" |
| A1, no token power | Trustee and protector cannot transfer, burn or freeze the token. | | TC "neither trustee nor protector can transfer, burn or freeze" |
| A1 / D A1 #6, transfer to trustee | Reverts `TransferToTrustee`. Into a Functional Contract that is the trustee, it suspends the trustee instead (`TrusteeSuspended`). | DeedTrustExtension, MockDeedCustody | TC "a transfer to the current trustee reverts…" |
| A2, licensed trustees | A licensed-trustee list in ValidatorRegistry, granted only by its owner. Eligible = a signer of an active validator or licensed, never a validator contract. | ValidatorRegistry | TC "licensed trustees that are not validators…" |
| A2, standby | `setStandbyTrustee`: protector only, eligible, pre-accepted. | DeedTrustExtension | TC "setStandbyTrustee…" |
| A2, determination | `applyLicensingDetermination` posts a notice, then promotes the standby or suspends the trustee. A suspended trustee loses `markVoid` and corrections. | DeedTrustExtension | TC "applyLicensingDetermination…", "without a standby…" |
| A2, no trustee fee | `Program` has no fee field. Funds go only to validator contracts, which can never be trustees. | IDeedTrust, ValidatorRegistry | TC "program parameters carry no trustee-fee field…" |
| Brief 9, Verified | The recipient needs a membership record that is not revoked or suspended (DECISIONS #9). | DeedTrustExtension | TT "Verified…" |
| Brief 9 (a)–(c) | Burn always. A return to the last sender always, except into a removed Functional Contract. Deposits into active Functional Contracts always. Removal blocks new deposits only (DECISIONS #8). | DeedTrustExtension, FunctionalContractRegistry | TT "Verified…", "(c) deposits into an active…" |
| Brief 9, Open | Today's behaviour. | | TT "Open keeps today's behaviour" |
| Brief 9, Coop | Direct transfers revert. `CoopTransferAgent` runs the sponsor's right of first refusal (default 30 days) and a completion window (default 90 days); exercise, waive, complete, withdraw and recover. | CoopTransferAgent | TT "direct transfers revert…", "the program sponsor may exercise…", "the seller can withdraw…" |
| Brief 10, notices | `postNotice` is open to anyone. `NoticePosted` carries the trustee and effective protector (DECISIONS A1 #5). | DeedTrustExtension | TC "postNotice is open to anyone…" |
| Brief 10, void | `markVoid` by the validator or the unsuspended trustee. Codes below 128 stay transferable; codes from 128 freeze, validator only, never the trustee. Burn is always allowed. | DeedTrustExtension | TC "markVoid…" |
| Brief 11, Fabrica | `SEAPORT_CONDUIT` (optional) is approved as a marketplace in deploy_all. | deploy_all | n/a: deploy configuration only |
| Plumbing | The hook cannot be called from outside, the extensions are kind-checked, and the trust registries can be set only once. | DeedNFT | TC "the transfer hook cannot be called from outside…" |

## 2. Existing tests changed, and why

**Test helpers:**

- **New `test/helpers/deed.ts`.** DeedNFT now takes its two extensions as constructor arguments, and every test deploys it through `deployDeedNFT`.
  - The DeedNFT, FundManager, MetadataRenderer, Validator and ValidatorRegistry specs changed only in that one call.
- **`test/audit/deed/fixture.ts`** adds the v5 setup:
  - a FunctionalContractRegistry with Subdivide and Fractionalize;
  - a MembershipRegistry;
  - an adopted agreement version for Land and Estate;
  - two licensed trustees.
- **Mint helpers:**
  - `mintValidatedLand` now mints a trust deed, with a fresh salt per call.
  - `mintValidatedVehicle` is new and mints a legacy deed.

**Land and Estate tests moved to Vehicle deeds.** Every Land and Estate deed is now a trust deed, and its definition and agreement are locked. So tests that exercised the Phase 1 legacy-metadata rules on Land now run them on Vehicle deeds, where those rules are unchanged:

- **DM:**
  - D-1 uses Vehicle traits.
  - D-14, D-15 and D-6 move to Vehicle deeds.
  - D-12 moves too. Its key counts drop by one because the `beneficiary` trait is gone.
- **DD:** D-22, the D-23 fee-on-transfer test and the D-23 re-validation test.
- **DL:** D-16.
- **Core specs:** `DeedNFT.spec`, `FundManager.spec` and `Validator.spec` mint Vehicles where they minted Land. Asset-type expectations moved from 0 to 1.
- **`MetadataRenderer.spec`:** mints as Vehicle, then sets `assetType` through the deed's validator, which it already did.

**Tests rewritten for v5:**

- **DL D-8:** now uses trust IDs from `computeDeedId`. It also checks the legacy salted IDs, and that a burned trust ID reverts `DeedIdUnavailable`. Phase 1 checked for "Token ID already exists"; the custom error replaces it.
- **DL D-19:** rewritten as the v5 item 5 test. The `beneficiary` trait is gone, so the test asserts that `beneficialOwnerOf` returns the depositor while the deed is in custody.

**Renderer fix:** `MetadataRenderer` no longer reverts `tokenURI` on the non-string trust traits. Single-word values show as hex; `riderHashes` and `programParams` are skipped. This was needed for the D-23 renderer test.

## 3. Deviations and section 7 defaults used

**Section 7 default used.** `IDeedCustody.beneficialOwnerOf` scope: only contracts that can hold a deed, which are Subdivide, Fractionalize and the new CoopTransferAgent. The credit contracts never hold deeds.

**Brief instructions followed:**

- **Timelock:** OpenZeppelin `TimelockController` as-is. The minimum delay is 7 days and the Foundation Safe is proposer and executor.
- **Trustee-only route:** a licensed-trustee list inside ValidatorRegistry, rather than a separate allowlist.
  - It is granted by the registry owner, the same key that already registers and activates validators, so the grant is no wider than the existing validator admin.
  - DeedNFT already reads that registry.
  - A separate contract would add an admin and a setter.

**Deviations:** all 24 are in `DEED-V5-INTERFACE.md` section 4. The ones that most affect the agreement:

- **The ID is 127 bits of the hash, not 256.** Subdivide packs `(deedId << 128) | unitId`, so a full 256-bit ID would collide units.
- **The whole `definition` is locked**, not just `definition.claim`, because the chain cannot parse JSON. A correction resets validation.
- **Corrections follow DECISIONS A1 #3** (the trustee proposes, the protector countersigns), not brief item 3.
- **`versionConsentRequired` is a program field**, not read from `configuration`, which is free text.
- **`beneficiary` is dropped, not renamed.**
- **Two separation rules were added.** The protector can never be the trustee or standby, and the trustee never the protector. Without them, one person could both propose and countersign a correction.
- **"Holder" is literal `ownerOf`.** While a deed sits in a Functional Contract, holder actions wait until it leaves.
- **Coop design.** The program sponsor holds the right of first refusal, the seller confirms completion, and the seller may withdraw before completion.
- **Void reason codes are a fixed table in code.** Codes from 128 up freeze the deed, are usable only by the validator and never by the trustee. There is no un-void.
- **Standby only after mint.** The standby is set with `setStandbyTrustee`, not at mint.
- **Leaving a Functional Contract follows the recipient's policy**, except a return to the depositor.

## 4. Conflicts (rule 3)

**Brief vs Addendum 1, on who can freeze a deed.** Brief item 10 asks for a per-reason-code toggle that can freeze a void deed. Addendum 1 says the trustee can never freeze the token.

- I took the more conservative reading. Freezing codes need the deed's validator, and are refused when the validator signer is also the trustee.
- The table is fixed in code, so no admin can change which codes freeze.

**New admin powers (rule 2):**

- **Added, set-once:** `setTrustRegistries` is a one-shot setter for the FC registry and the MembershipRegistry. Changing either afterwards takes an upgrade, which is already a timelocked power. Flagged below.
- **Kept, not widened:** `DeedNFT.setValidatorRegistry` was kept. It is timelocked, but a malicious registry could make anyone a "validator signer" for void and freeze. Flagged below.

**Do-NOT-change list:** untouched. No credit, money-peripheral or app file was changed.

## 5. Open questions for the owner

1. **Holder actions while a deed is in custody.** Should elections, and the protector role while its record is zero, follow `beneficialOwnerOf` instead of `ownerOf`?
   - Today a depositor must withdraw from a Functional Contract first.
   - Subdivide custody can last years.
2. **Can a void be undone?** For example, by the validator plus the protector after an erroneous void. Today Void is final.
3. **Are the void reason codes right?** Is "from 128, frozen; validator only" the right table, and should the validator alone be able to freeze, or the validator plus the protector?
4. **`DeedNFT.setValidatorRegistry`:** keep it behind the timelock, or remove it?
   - A swapped registry could create validator signers that void or freeze deeds.
   - It cannot touch the holder, definition, agreement, riders, trustee or protector.
5. **`setTrustRegistries` (set-once, admin):** acceptable as one-time configuration, or should the registries become immutables of the implementation, so that only an upgrade sets them?
6. **Validator royalty receivers.** A Validator's `royaltyReceiver` is chosen by its fee manager and could be a trustee's wallet. Should the Validator refuse an eligible-trustee address there?
7. **Coop sales:**
   - Should the buyer have to pass Verified-style membership?
   - Should the seller lose the right to withdraw once the sponsor exercises?
   - Should anyone but the seller be able to complete?
8. **Leaving a Functional Contract.** Today a Coop or Verified deed leaving Fractionalize or Subdivide must go to the depositor or to a qualifying recipient. Is that the intended effect on fraction buyers and on collection-admin transfers?
9. **Program changes after mint.** The program traits are fixed at mint. Should the sponsor be able to update `paramsHash`?
10. **Pending members.** PENDING membership records pass the Verified policy. Confirm.
11. **App ABI.** `deploy/99_generateTsAbis.ts` and the app read DeedNFT's artifact ABI, which lacks the `IDeedTrust` functions. Merge it there (app track).

## 6. Numbers

**Tests:**

- **Before**, on `audit/phase-1`: 856 passing.
- **After:** **888 passing, 0 failing** (856 + 32 new v5 tests), full suite including the 300-step invariant file.
- **Deed audit and v5 specs:** 61 passing.
  - 29 Phase 1 deed tests, adapted as section 2 describes.
  - 32 new v5 tests: 22 in TrustV5Core and 10 in TrustV5Transfers.
- **Fuzz:** none. The invariant suite covers credit only; extending it to the Deed track is Phase 4's.
- **Build:** all runs compile with `KEEP_REVERT_STRINGS=true`.

**Deploy dry run:** `deploy/deploy_all.ts` ran once on Hardhat's in-process network. It deployed:

- the Deed timelock;
- DeedNFT and its two extensions;
- the FC registry with three entries;
- the Coop agent.

It adopted the agreement and handed everything over, and the handover check passed. The deployment output was deleted.

**Bytecode sizes.** From a production build (`npx hardhat compile --force`, revert strings stripped). EIP-170 caps runtime code at 24,576 bytes and EIP-3860 caps init code at 49,152.

| Contract | Runtime | Headroom | Init code |
| --- | --- | --- | --- |
| DeedNFT | 20,193 | 4,383 | 20,901 |
| DeedNFTMintExtension | 23,804 | 772 | 23,941 |
| DeedTrustExtension | 23,012 | 1,564 | 23,149 |
| Subdivide | 24,574 | 2 | 24,711 |
| MetadataRenderer | 24,493 | 83 | 24,630 |
| Validator | 21,668 | 2,908 | 21,805 |
| Fractionalize | 17,465 | 7,111 | 17,602 |
| ValidatorRegistry | 10,813 | 13,763 | 10,950 |
| CoopTransferAgent | 4,444 | 20,132 | 4,632 |
| FunctionalContractRegistry | 2,676 | 21,900 | 3,418 |

Subdivide went from 24,564 to 24,574. Its `onlyCollectionAdmin` check moved out of line, and `beneficialOwnerOf` was added. Its 2-byte headroom means any further Subdivide change needs a split.

**Slither.** Run per contract (FIX-PLAN section 6 command, plus a `solady/` remapping for Validator). Informational, optimization and low findings were excluded, and the results were compared with the same run on `audit/phase-1`. **No new real High or Medium findings.**

- **Unchanged from Phase 1:** Subdivide 1, Fractionalize 7, Validator 0, ValidatorRegistry 1 (the pre-existing `removeValidator` reentrancy-no-eth), and MetadataRenderer 4 (the pre-existing `encodePacked` in `_generateName`).
- **DeedNFT** went from 8 findings to 26, plus the extensions: 9 in each. The new entries are all artefacts or by design:
  - **`controlled-delegatecall`** in `_transferHook`: a false positive. The selector is constant and the target immutable.
  - **`incorrect-return`** in `fallback` and `_forward`: by design, the same as TermIssuer's forwarding.
  - **`uninitialized-state`** on base variables: an artefact of the split. Each half is analysed alone, and the proxy's storage is shared.
  - **`uninitialized-local`** for `setTrait.value`: a false positive. Every branch assigns or reverts.
  - **`reentrancy-no-eth`** in `correctDefinition`: the renderer-sync callout, the same pattern as Phase 1's `updateMetadata`. The renderer is admin-set and calls nothing back.
- **CoopTransferAgent and FunctionalContractRegistry:** 0 each.

**Storage layout.** Compared with `audit/phase-1` using `solc` storage layouts. **Every Phase 1 variable is at the same slot, offset and size.**

- **DeedNFT:** appended `_trust`, `_reservations`, `_trustApprovals`, `_fcRegistry` and `_membershipRegistry` at slots 510–514.
- **Fractionalize:** appended `fractionOfDeed` at slot 306.
- **Validator:** appended `agreementVersionURI` at slot 416.
- **ValidatorRegistry:** `isLicensedTrustee` takes the first gap slot (306), and the gap shrinks from 50 to 49.
- **Subdivide, MetadataRenderer:** unchanged.

No Deed contract is live on Base mainnet.

**Base Sepolia.** Deeds there predate v5, so their Land and Estate deeds are legacy deeds without a trust record. A fresh deployment is cleanest, as Phase 1 also recommended.

**CI note:** no app files were touched, so `turbo typecheck` for the apps was not needed.
