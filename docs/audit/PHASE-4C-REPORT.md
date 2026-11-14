# Phase 4c: the owner's decisions on Phase 4b's open questions

Branch `audit/phase-4c-open-questions`, cut from `dev` with Phases 1 to 4b merged. The brief is `PHASE-4B-OPEN-DECISIONS.md`, items 4, 5 and 9 only (the file records that scope). Items 1, 2, 3 and 7 are Phase 2e's, because they change the same RevolvingIssuer code. Items 6, 8 and 10 stay as built.

Nothing was deployed, no key was used, and no live network was touched. Nothing Phase 2d (#893) or Phase 2e touches is changed here: not ESADepositVault, ClearUSDUpgradeable, ClaimEscrow, the timelocks or RevolvingIssuer.

## Summary

- All three items are built, each with regression tests in `test/audit/rereview/OpenDecisions.spec.ts` (11 tests).
- **Item 4.** A freezing Void takes two distinct signers of the deed's validator. One proposes by consenting to `FreezeConsent` (EIP-712 signature, or a prior `approveTrustAction`), and a different one confirms by calling `markVoid`. This matches the two-party un-void: the same consent forms and the same nonce.
- **Item 5.** A transfer or burn of a trust deed cancels a pending `reassignValidator` request, so the new holder decides. Legacy deeds are unchanged.
- **Item 9.** After the 16th rate band, the ledger offers what is left to each issuer that still holds a position, dearest first, so a repayment is never left unattributed.
- **Sizes:** every contract is within EIP-170 and EIP-3860 in the production build. Subdivide is unchanged (2 bytes of headroom, same code). DeedTrustExtension is the tightest change, at __TE_HEAD__ bytes of headroom.
- **Storage:** no contract gains or moves a slot. The layouts of DeedNFT, both Deed extensions, StableCredit and ClearCredit are identical to `dev`'s.
- **Admin powers:** none added or widened. There is no new figure: the two-signer rule has no parameter, and the fallback has no bound of its own beyond the issuer count.
- **Conflicts:** none with the "Do NOT change" list, DECISIONS or earlier sections (section 3).
- **Tests:** __PASSING__ passing, 0 failing.

## 1. What changed, per item

### Item 4. Two signers to freeze a deed

- `markVoid` gains two arguments: `markVoid(tokenId, reasonCode, recordingRefHash, uri, address cosigner, bytes cosignerConsent)`. This changes the `IDeedTrust` ABI, as M-G did in Phase 4b. No app calls `markVoid`.
- **Below 128** (a void that leaves the token transferable), nothing changes. The two new arguments are ignored; callers pass `address(0)` and `0x`.
- **From 128** (a freezing void):
  - The caller must be a signer of the deed's validator and not the trustee, as before (`FreezeNeedsValidator`).
  - `cosigner` must also be a signer of the deed's validator, at the moment of confirmation. It must not be the caller, and it must not be the trustee, even when the trustee is also a validator signer (Addendum 1: the trustee never freezes). Otherwise the call reverts `FreezeNeedsSecondSigner(cosigner)`.
  - `cosigner` consents to `FreezeConsent(uint256 tokenId,uint8 reasonCode,bytes32 recordingRefHash,bytes32 uriHash,uint256 nonce)`, in the `DeedNFT Trust` domain. It does so by signature in `cosignerConsent` (EIP-1271 accepted), or by a prior `approveTrustAction(freezeConsentDigest(...))` with `cosignerConsent` empty. A missing or wrong consent reverts `ConsentMissing(cosigner)`.
  - The freeze moves the deed's nonce on, so a consent is used once. Restoring and re-freezing needs a new one.
  - It emits `DeedFreezeConfirmed(tokenId, proposer, confirmer)` before `DeedVoided`.
- **Which signer proposes.** Either may. The proposer is whoever consents (by signing, or by approving the digest on chain), and the confirmer is whoever calls. The signature form is one transaction, so it does not show the freeze coming before it lands; the approval form does. That matters little since Phase 4b: during a validator reassignment's delay the old validator's signers may still freeze.
- **Matching the un-void.** `restoreFromVoid` is the validator's call plus the protector's `RestoreConsent`, by signature or prior approval, bound to the nonce. The freeze is the same shape, with a second validator signer in the protector's place. So one signer can neither impose a freeze nor lift one alone.
- **Room.** `markVoid` stays in DeedTrustExtension, the existing module. The new `freezeConsentDigest` view sits in DeedNFTMintExtension, and DeedNFT's fallback routes its selector there. The first build, with the view in DeedTrustExtension, put that extension 323 bytes over the limit.
- **A validator with one signer** cannot freeze any more. It must add a second signer (its own `VALIDATOR_ROLE`) first. The validator contract's own address also counts as a signer, as `isValidatorSigner` has it.

### Item 5. A transfer cancels a pending validator change

- After the transfer rules pass, `DeedNFT._transferHook` deletes a pending `_pendingValidator` request and emits `ValidatorReassignmentCancelled(tokenId, validator)` (declared in DeedNFTBase, so it is in DeedNFT's ABI).
- This covers every transfer: to anyone, back to the address the deed last came from, and into a Functional Contract (Subdivide or Fractionalize take custody, and are the holder until they release it). A burn clears the request too, so `pendingValidatorOf` never shows one for a retired deed.
- The new holder decides: it may make its own request, which waits out a fresh delay. The old holder can no longer complete anything (`Not deed owner`), and the new holder cannot complete the old request (`NoReassignmentPending`).
- **Legacy deeds are unchanged.** They change validator at once, so they never have a pending request, and nothing is emitted. The only difference is one storage read per transfer.
- **Why DeedNFT and not DeedTrustExtension.** The reassignment logic of Phase 4b already lives in DeedNFT, which has the room (__DN_HEAD__ bytes left). In DeedTrustExtension it cost about 435 bytes that the freeze needed.

### Item 9. More than 16 distinct rates

- `StableCredit._settleRepayment` still walks at most `MAX_WATERFALL_BANDS` (16) bands, dearest first. If it stopped because it used all 16 and something is still unattributed, a fallback pass, `_settleBeyondBands`, runs:
  - it asks each issuer for its dearest remaining position (`nextRepaymentRate`) once;
  - it offers the rest to the issuer with the dearest remaining position first, with no band (`minRate` 0), then to the next, until it is all attributed or no issuer holds anything.
- The issuer takes it against all its positions, in its own repayment order:
  - RevolvingIssuer: tiers from the dearest configured one down, filtered by nothing (`minRate` 0);
  - TermIssuer: oldest plan first.
- So the remainder goes to the dearest remaining positions issuer by issuer. Within one issuer, past the 16th band, the order is that issuer's own (section 3).
- The pass costs at most one rate read and one offer per issuer. Its bound is the number of issuers, not of positions, so it adds no figure and no unbounded loop.
- A walk that ends early, because no issuer holds a position or a band absorbs nothing, behaves exactly as before. Anything still unattributed after the fallback means the issuers hold less than the ledger says is owed. As before, that drift stays visible and is not papered over.
- ClearCredit inherits the change.

## 2. Existing tests changed, and why

| Test | Change | Why |
|---|---|---|
| `audit/deed/fixture.ts` | `signTrust` gains the `FreezeConsent` type. New helpers: `addValidatorSigner`, `signFreeze`, and `freeze` (operator2 becomes the validator's second signer and signs; the deployer confirms). | Item 4. |
| `audit/deed/TrustV5Core.spec` "markVoid: validator or trustee; ..." | The freezing void goes through `freeze` (two signers). The non-freezing calls pass `address(0), "0x"`. | Item 4. Same assertions. |
| `audit/deed/TrustV5Core.spec` "neither trustee nor protector can transfer, burn or freeze" and the suspended-trustee test | The calls pass `address(0), "0x"`. | Item 4, ABI only. Same reverts. |
| `audit/rereview/Decisions.spec` M-F tests (front-running, un-void, prior approval) | The freezes go through `freeze`; the non-freezing void passes `address(0), "0x"`. | Item 4. Same assertions: the old validator's signers may still freeze during the delay. |
| `audit/rereview/DeedInvariants.spec` | operator2 is made the validator's second signer. A freezing step first tries the caller cosigning its own freeze, which must always fail (new invariant 8), then the other signer's consent. Transferable voids pass `address(0), "0x"`. | Item 4. The random sequence is unchanged (no extra draws). |

No test about items 5 or 9 needed to change: no existing test transferred a deed with a request pending, or held more than 16 distinct rates.

## 3. Conflicts and open questions

None of these conflicts with the "Do NOT change" list, DECISIONS or earlier sections. "Most-expensive-first repayment" is kept: the first 16 bands are exactly as before, and the fallback only places what used to be left unplaced. Each point below is something the decisions do not settle.

1. **Item 9: the order inside one issuer, past the 16th band.** The fallback picks issuers dearest first, and each issuer then applies its share in its own order. For TermIssuer that is oldest plan first, not dearest plan first; for RevolvingIssuer, dearest configured tier first. A strictly dearest-first order past 16 bands needs one more band per remaining rate, so a walk bounded by the number of positions, which is what the 16-band bound exists to avoid. If the owner wants it strict inside an issuer, the change is in the issuers' `_absorbRepayment` at `minRate` 0 (TermIssuer has 2,268 bytes of room; RevolvingIssuer is Phase 2e's).
2. **Item 4: a validator with a single signer.** Such a validator can no longer freeze until it adds a second signer. Every validator onboarded for trust deeds needs at least two signers. That is an onboarding step for operations, not code.
3. **Item 4: who counts as a "validator signer".** As for every validator act, `ValidatorRegistry.isValidatorSigner`: the validator contract itself, or an account holding `VALIDATOR_ROLE` on it. Two signer addresses held by one person are two signers on chain; that is the validator's governance to prevent.
4. **Item 5: deposits into a Functional Contract.** A deposit into Subdivide or Fractionalize cancels the request too, because the custody contract becomes the holder. The depositor makes a new request after the deed is released. The decision says "a transfer", and this is one.

## 4. Sizes, storage and Slither

**Sizes.** Production build (`npx hardhat compile`, revert strings stripped). EIP-170 caps runtime at 24,576 bytes and EIP-3860 caps creation code at 49,152.

__SIZES__

**Storage.** solc storage layouts of DeedNFT, DeedTrustExtension, DeedNFTMintExtension, StableCredit and ClearCredit were compared slot by slot with `dev` (`git archive origin/dev`): identical. No state variable was added. DeedNFT still ends at slot 517 with no trailing gap, as Phase 4b left it, and StableCredit's layout is untouched. None of these contracts is live on Base mainnet.

**Slither** (per contract, the FIX-PLAN section 6 way: via-IR, Medium and High only), on `dev` and on this branch:

__SLITHER__

## 5. Tests and checks

- **New:** `test/audit/rereview/OpenDecisions.spec.ts`, 11 tests: item 4 six, item 5 three, item 9 two.
  - The item 9 tests hold 18 distinct effective rates across two issuers: 16 plans dearer than the Income tier (151 to 166 bps per 30 days), the Income tier (150) and one cheaper plan (100). On `dev` the 16 bands clear the 16 plans and the rest of the payment is left unattributed. Here the Income tier, the dearest remaining position, takes it, and the issuers' `TierRepaid` and `PlanPaid` events add up to exactly the amount repaid.
- **Full suite** (`KEEP_REVERT_STRINGS=true npx hardhat test --no-compile`, every fuzz at its default 300 steps): __SUITE__
- **Generated files:** __GENERATED__
- **`npx turbo run typecheck test --affected`:** __TURBO__

## 6. Documentation changed

- `DEED-V5-INTERFACE.md`: the new `markVoid` arguments, `FreezeConsent`, `freezeConsentDigest`, `FreezeNeedsSecondSigner`, `DeedFreezeConfirmed`, and the transfer that cancels a pending reassignment (`ValidatorReassignmentCancelled`). Deviation 15 no longer says a Void is final (Phase 4b made it liftable).
- `docs/protocol/credit.md`: the fallback past the 16th band.

## 7. Apps and API follow-up

Nothing under `apps/` was changed, and nothing there calls `markVoid` or `reassignValidator`.

- **Freezing a deed** (item 4) is now two signers' act. A future validator console collects the second signer's `FreezeConsent` signature (or has it call `approveTrustAction`) and submits `markVoid` with it. A non-freezing void passes `address(0)` and `0x`.
- **Indexers** should read `ValidatorReassignmentCancelled` (item 5) to clear a pending reassignment, and `DeedFreezeConfirmed` (item 4) for who froze a deed.
- **Repayments** (item 9) need nothing: the ledger's behaviour changes only for members with more than 16 distinct rates.
