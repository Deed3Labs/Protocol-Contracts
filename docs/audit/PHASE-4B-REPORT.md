# Phase 4b: the owner's decisions on the re-review

Branch `audit/phase-4b-decisions`, cut from `dev` with Phase 4 (#891) merged. The brief is `REREVIEW-DECISIONS.md`: every row marked "Phase 4b" (M-C, M-E, M-F, M-G, L-B, L-C, L-F, L-G, L-I and O-1), with the options set out in `REREVIEW.md` section 3. L-D and L-E are Phase 2d's.

Nothing was deployed, no key was used, and no live network was touched. ESADepositVault, ClearUSDUpgradeable and ClaimEscrow are not changed here; L-B only calls CLRUSD's existing `syncEncumbrance`.

## Summary

- All ten items are built, each with regression tests in `test/audit/rereview/Decisions.spec.ts` (25 tests).
- **Sizes:** every contract is within EIP-170 and EIP-3860 in the production build. RevolvingIssuer needed room, so `openLine` moved into RevolvingIssuerExtension (the existing module split), and TermIssuer's modules ask TermIssuer for the member's open principal rather than carrying the loop. Subdivide is untouched (still 2 bytes of headroom).
- **Storage:** append-only everywhere, each slot taken from a `__gap`, except DeedNFT, whose layout has no trailing gap and gains two slots at its end. None of the changed contracts is live on Base mainnet.
- **Admin powers:** M-E narrows one. Two new governed settings, both bounded: RevolvingIssuer's CLRUSD token (owner, set once) and DeedNFT's reassignment delay (Deed timelock, 1 to 30 days).
- **Conflicts and open questions:** none with the "Do NOT change" list or DECISIONS. Section 3 lists ten things these decisions do not settle, each left as it is.
- **Tests:** 1,011 passing, 0 failing (986 before, plus the 25 new tests).

## 1. What changed, per item

### M-C. Liquidation reaches only the current default episode

- **Option (a).** `RevolvingIssuerBase` appends `lineOpenedAt` (member → uint64), which `openLine` sets.
- `RevolvingIssuer.hasDefaultedOnCurrentLine(member)` is `defaultedAt != 0 && defaultedAt >= lineOpenedAt`. `lineOpenedAtOf(member)` reads the open time.
- `Liquidator.liquidate` and `liquidateShares` now require `inDefault` or `hasDefaultedOnCurrentLine` (`_requireCurrentDefault`), instead of `inDefault` or `hasDefaulted`.
- `defaultedAt` and `hasDefaulted` are unchanged and permanent, so the history stays for underwriting and the API.
- A line opened before this upgrade has `lineOpenedAt = 0`, so any default counts for it, as before.
- `MockMissedCycleIssuer` gains the view.

### M-E. Registering an issuer is a governance act

- **Option (a).** `NetworkRegistry.registerIssuer` and `deregisterIssuer` are `DEFAULT_ADMIN_ROLE` (the credit timelock after the handover), not `OPERATOR_ROLE`.
- `deploy/20` and `deploy/24` register with the deployer while it still holds admin. On a re-run after the handover, each prints the `registerIssuer` call to propose through the credit timelock.

### M-F. Deed freeze: a delayed reassignment and a two-party un-void

- **Options (b) and (c).** On a trust deed, `DeedNFT.reassignValidator` only records the request (`ValidatorReassignmentRequested`).
  - The holder completes it with `completeValidatorReassignment(tokenId)` after `validatorReassignDelay()`: 7 days by default, and settable by the Deed timelock between 1 and 30 days (`setValidatorReassignDelay`).
  - Until it completes, the old validator is still the deed's validator, so it may still void the deed. That removes the front-running race.
  - Neither step runs while the deed is Void (`NotActive`).
  - `pendingValidatorOf(tokenId)` reads a pending request.
  - Legacy (non-trust) deeds cannot be voided, so they still change validator at once.
- **Un-void.** `DeedTrustExtension.restoreFromVoid(tokenId, reasonURI, protectorConsent)` returns a Void deed, freezing or not, to Active.
  - The deed's validator (or a signer of it, not acting as the trustee, as for a freeze) calls it.
  - The effective protector consents with `RestoreConsent` (EIP-712, or a prior `approveTrustAction`). While the protector record is zero, that is the holder.
  - It emits `DeedRestored`. `restoreConsentDigest` returns the digest.
- **Burning a frozen deed stays allowed**, and its record is kept (brief item 1). Counsel to confirm.
- **Storage.** `DeedNFTBase` appends `_pendingValidator` and `_validatorReassignDelay` after `_membershipRegistry`.
- **Room.** The reassignment logic sits in DeedNFT itself (3,182 bytes of headroom left) and the un-void in DeedTrustExtension (939 left). DeedNFTMintExtension keeps its size (23,804 bytes), and Subdivide's code fingerprint is unchanged.

### M-G. The standby's own determination needs the protector's consent

- **Option (a).** `applyLicensingDetermination` gains a `bytes protectorConsent` argument (a change to the `IDeedTrust` ABI).
- On the standby's own call, the notice is always posted. The determination is acted on (promotion, or suspension if the standby is no longer eligible) only with the effective protector's consent:
  - `LicensingConsent(tokenId, standby, docHash, nonce)`, by signature or by prior approval;
  - the holder's consent while the protector record is zero.
- Without consent nothing else changes: no promotion and no suspension. So the standby cannot oust the trustee on its own word. `licensingConsentDigest` returns the digest.
- The protector's and the trustee's calls are unchanged; for them the argument is ignored.
- **This changes Addendum 2** (`specs/deed-trust-v5-addendum-2.md`). The drafting of Addendum 2 needs to say that the standby's determination promotes it only with the protector's (or, with no protector, the holder's) consent. `DEED-V5-INTERFACE.md` records the change.

### L-B. A Savings draw refreshes the CLRUSD lock, and fails closed

- **Option (a).** `RevolvingIssuerBase._draw` notes whether it drew on the Savings tier. If it did, it calls `ClearUSDUpgradeable.syncEncumbrance(member)` at the end.
- Every draw passes through `_draw`, so this covers a plain transfer and a card settlement alike.
- The call is not caught. If the encumbrance registry cannot be read, `syncEncumbrance` reverts and so does the draw.
- **The token.** It is set once by the owner with `setClrusdToken` (the credit timelock after the handover). The setter runs in the extension, and `clrusdTokenOf()` reads it.
  - While it is unset, nothing is called, which is how the existing tests and older deployments behave.
  - `deploy/20` sets it when CLRUSD is deployed and the deployer is still the owner. Otherwise it prints the proposal.
- RevolvingIssuer has 438 bytes of headroom after this phase (section 4).

### L-C. Card caps (documentation only)

- **Interim (c).** No code changed.
- The per-purchase cap (`cardTxCap`) and the daily cap across all members (`cardSpendCap`) are governed parameters. They are set only by `setCardCaps`, which needs `CREDIT_SETTINGS_ROLE`; after the handover, granting that role is a timelock proposal.
- Settlement is bounded by both caps, and by the authorization recorded for the reference.
- The per-member bound is the member's own line: an authorization must fit the member's headroom and, on Savings, the member's own `savingsDrawAllowance` (12.7). There is no per-member daily cap on chain (section 3, item 1).
- **Plan.**
  - Now: keep the caps, sized small.
  - Later, option (a): an attestation from the card network or processor at authorization, once the processor can sign.
  - This is still a counsel item under DFAL 10a, as Phase 1 flagged.
- `Decisions.spec` "L-C" confirms that only the settings role sets the caps and that settlement honours them.

### L-F. The Clear Cash term rule on the member's aggregate

- **Option (b).** In `_quote`, the large-loan minimum term (and with it the 13-cycle option, DECISIONS #4) applies when this plan plus the member's other open principal under the same product reaches the threshold.
  - The other open principal is carry excluded, and a re-split leaves the plan itself out.
  - `TermIssuer.openPrincipalOf(member, product, skip)` serves the sum. The modules read it from the issuer, because TermIssuerExtension had no room for the loop.
- **The same aggregation as the rate cap.** While governance has CFL aggregation off (`RateSchedule.cflAggregationOff`, DECISIONS #7), `openPrincipalOf` is zero, so the term rule is judged per plan, as the cap is then.
- The rate quoted for the plan is still judged on the plan alone, as `termChargeFor` charges it.
- Counsel to confirm.

### L-G. Most-expensive-first by the effective rate

- **Option (a).** Both issuers now answer `nextRepaymentRate`, and filter `absorbRepayment` bands, by what each position costs at the moment of repayment, after the caps.
  - The unit is monthly bps times `RATE_SCALE` (1e18).
  - The ledger's band walk (`StableCredit._settleRepayment`) is unchanged: it takes the dearest rate any issuer reports and offers that band to every issuer.
- **Revolving.** `RateSchedule.revolvingRatesOf` prices the tiers:
  - a tier on its own rate costs that rate;
  - a priced tier costs its list rate under the member's pricing state;
  - if the list carry on all priced tiers is over the member-level ceiling (with the CFL aggregate, as `capFor` takes it), the excess is trimmed from the last priced tier first, exactly as `_pendingCarry` trims accrual.
  - So a capped Boost tier can now cost less than Income, and Income is repaid first.
- **Term.** `RateSchedule.termRateOf` gives min(list, the cap on the plan, the cap on the aggregate), then the annual cap once the plan or the aggregate is large, less the merchant's subsidy.
  - That is the rate per 30-day cycle, which is how plans are charged (section 12.9). It is stated per month (× 365/360) so that it compares with a revolving rate.
  - Free plans cost 0. Plans priced from their own terms cost their rate per 30 days, also stated per month.
- **The "Do NOT change" rule.** "Most-expensive-first repayment" is kept: the order is still dearest first, with "dearest" now measured by what is charged. This is pending counsel on what "most expensive" means for a capped position.
- **Room.** The arithmetic sits in RateSchedule (14,028 bytes of headroom), so the issuers only pass their positions. `capMonthlyBps` now uses the same `_capRate` helper and returns the same values.

### L-I. Pledges need the member's signature

- **Option (a).** `CollateralRegistry.pledge(member, kind, amount, deadline, signature)` and `pledgeItem(member, kind, itemId, deadline, signature)` stay `OPERATOR_ROLE`, and now also need the member's EIP-712 signature.
  - Types: `Pledge(address member,bytes32 kind,uint256 amount,uint256 nonce,uint256 deadline)` and `PledgeItem(address member,bytes32 kind,uint256 itemId,uint256 nonce,uint256 deadline)`.
  - Domain: `Clear CollateralRegistry`, version `1`.
  - EIP-1271 is accepted (members use smart accounts).
- `pledgeNonces(member)` is appended from the gap, so a signature is used once. `pledgeDigest` returns the digest.
- `rollItem` (a bond collection moving an existing pledge to its replacement), `release` and the seizure records need no signature: none of them pledges anything new.
- **Callers updated:**
  - `scripts/redeploy_bonds.ts`: the signer signs its own pledge.
  - `scripts/sync_savings_collateral.ts`: it takes member signatures from `PLEDGE_SIGNATURES`, and otherwise prints what the member must sign.
  - Every test that pledges, through the new `test/helpers/pledge.ts`.
  - The API pledges too; see section 7.

### O-1. A priced tier keeps the last state's product

- **Option (b).** `RevolvingIssuerBase._pricingState(member)` is the state a member's priced tiers are priced under from the next touch. `_resnapshot` now uses it.
  - It is the attested state, unless that state lacks a product the member's last state priced their line on. Products count if they belong to the ceiling, or to any tier where the member has capacity or principal.
  - In that case the member keeps the last state's products until the new state's launch. The next touch after the launch moves them.
- The whole line moves together, because the member-level ceiling is one product in one state.
- Before this, a member re-attested to a state with no product accrued at the tier's own local rate with no ceiling.
- `openLine`'s state gate still reads the attested state.
- This ties to Phase 2's open question 1 (who may change a state attestation).

## 2. Existing tests changed, and why

| Test | Change | Why |
|---|---|---|
| `peripherals/NetworkRegistry.spec` (helper, zero-address, deregistration, "is admin gated") | Registers and deregisters as the admin. The gating test also shows that the operator is refused. | M-E. |
| Every test that pledges: `AssetBackedTier`, `AssetBackedDefault`, `BondCollateral`, `ClearUSDUpgradeable`, `CollateralRegistry`, `LimitCalculator`, `Liquidator`, `AuditPoC2`, compliance `Assurance`, `Dfal`, `ReserveUntouched`, `Revolving`, `Section12Liquidator` | `registry.pledge(m, k, a)` becomes `pledgeSigned(registry, m, k, a)` (the member signs, the operator submits). The outsider-gating test passes a valid member signature and is still refused. | L-I. Mechanical; no assertion changed. |
| `audit/deed/TrustV5Core.spec` "applyLicensingDetermination posts a notice and promotes the standby" | The standby's call carries the holder's `LicensingConsent` (the protector record is zero). The other calls pass `"0x"`. | M-G. |
| `audit/deed/DeedMetadata.spec` (D-7 reassignment) | After the request, v1 stays the validator; the test waits 7 days and completes the change. | M-F. |
| `audit/deed/fixture.ts` `signTrust` | Adds the `RestoreConsent` and `LicensingConsent` types. | M-F, M-G. |
| `audit/rereview/DeedInvariants.spec` | The determination call passes `"0x"`. A standby picked by the fuzz now only posts a notice. | M-G. |
| `audit/compliance/Term.spec` acceptance 7 | The $2,000 / 13-cycle refusal is checked before the $3,000 plan opens. With $3,000 of Clear Cash open, a $2,000 plan over 12 × 30 days now reverts `TermIssuerTermTooShort`. | L-F. |
| `audit/deep/CreditInvariants.spec` "(iv) deterministic path independence" | The scripted plan is 140 bps per 30 days, not 150. | L-G. A plan at 150 bps per 30 days really costs more than the Income tier's 150 bps a month, so the undirected repayments closed the plan before its own scripted payments (`TermIssuerPlanClosed`). The test is about path independence, which still holds within a few units. |

## 3. Conflicts and open questions

None of these conflicts with the "Do NOT change" list or with DECISIONS. Each is something these decisions do not settle, so it was left as it is and is listed here for the owner.

1. **L-C: "the per-member daily limit".** `REREVIEW.md` option (c) speaks of keeping "the per-member daily limit". There is no per-member daily card cap on chain: the daily cap is across all members. The per-member bounds are the member's headroom and their Savings allowance. Nothing was added, because L-C is documentation only. If a per-member daily cap is wanted, it is a small governed parameter in the extension.
2. **M-C: the card after re-onboarding.** `authorizeCardSpend` and `settleCardSpend` still refuse any member who has ever defaulted (`hasDefaulted`), so a re-onboarded member's new line works for transfers but not for the card. The decision keys only liquidation to the current episode. If the card should follow, the change is to read `hasDefaultedOnCurrentLine` there too.
3. **M-C: the order of operations after a default.** Opening a new line ends liquidation of the earlier default. Operations should liquidate (or settle) before re-onboarding. Doing it the other way round narrows the co-op's recovery; it never harms the member.
4. **M-F: option (c)'s "two signers to freeze".** This was not built. The decision row and the brief name only the two-party un-void, so a freeze is still one validator signer's call. It is now reversible by the validator and the protector together.
5. **M-F: legacy deeds and pending requests.** The delay applies to trust deeds only; legacy deeds cannot be voided. A pending request is completed by whoever holds the deed when it is due. A new request replaces it, and a transfer does not cancel it.
6. **L-B: which draws.** "After every Savings draw and card settlement" is read as every draw that touches the Savings tier, by transfer or by card settlement. A card settlement that draws nothing on Savings changes no lock and makes no call. While the CLRUSD token is unset, nothing is called.
7. **L-G: issuer-internal repayments.** `repayCardSpend` (fiat card repayment) and `reverseCardSpend` clear the revolving tiers through `_repay`, which still walks them in configured tier order (dearest configured rate first). The decision covers the ledger's band walk across issuers. If those paths should also follow the effective rate, `_repay` can use the same rates; RevolvingIssuerExtension has 2,228 bytes of room.
8. **L-G: comparing a plan with a tier.** A term plan's rate is charged per 30-day cycle, so it is stated per month (× 365/360) to compare with a revolving monthly rate. A plan and a tier at the same quoted bps therefore no longer tie: the plan is dearer, and it is repaid first. The alternative is to compare the quoted numbers as they are, a one-line change in `termRateOf`. Pending counsel, like the rest of L-G.
9. **L-G: band count.** Effective rates are finer-grained than configured ones, so a member can hold more distinct rates. The ledger still walks at most 16 bands (`MAX_WATERFALL_BANDS`). A member with more than 16 distinct positions could leave part of a large repayment unattributed. As before, this shows as visible ledger-versus-issuer drift; it is not hidden.
10. **O-1: the whole line moves together.** The rule is applied to the member's line as a whole, not tier by tier: the ceiling is one product in one state, and tiers priced in two states could not share it. A member keeps the old state's prices until every product their line uses has launched in the new state.

## 4. Sizes, storage and Slither

**Sizes.** Production build (revert strings stripped). EIP-170 caps runtime at 24,576 bytes and EIP-3860 caps creation code at 49,152. Every contract is within both. These are the closest, and every contract changed here:

| Contract | Runtime before (`dev`) | Runtime now | Headroom | Creation code |
|---|---|---|---|---|
| Subdivide (unchanged) | 24,574 | 24,574 | 2 | 24,711 |
| TermIssuerExtension | 23,815 | 24,181 | 395 | 24,318 |
| RevolvingIssuer | 23,507 | 24,138 | 438 | 24,870 |
| DeedNFTMintExtension (unchanged) | 23,804 | 23,804 | 772 | 23,941 |
| DeedTrustExtension | 23,012 | 23,637 | 939 | 23,774 |
| RevolvingIssuerExtension | 20,335 | 22,348 | 2,228 | 22,485 |
| TermIssuer | 21,567 | 22,308 | 2,268 | 22,991 |
| DeedNFT | 20,193 | 21,394 | 3,182 | 22,102 |
| Liquidator | 20,608 | 20,380 | 4,196 | 20,517 |
| RevolvingIssuerCycles | 19,393 | 19,683 | 4,893 | 19,737 |
| TermIssuerOrigination | 17,067 | 17,258 | 7,318 | 17,395 |
| CollateralRegistry | 11,752 | 13,503 | 11,073 | 13,640 |
| RateSchedule | 8,902 | 10,548 | 14,028 | 10,685 |
| NetworkRegistry | 6,844 | 6,844 | 17,732 | 6,981 |

The largest creation code is still BurnerBondFactory's, at 46,956 bytes (unchanged). The first build had RevolvingIssuer 321 bytes and TermIssuerExtension 256 bytes over the limit. Moving `openLine` into the extension, and the open-principal loop into TermIssuer, brought both back under.

**Storage.** solc storage layouts were compared slot by slot against `dev` (`git archive origin/dev`):

| Contract | Change | Ends at slot |
|---|---|---|
| RevolvingIssuer and both modules | `lineOpenedAt` at slot 293 and `clrusdToken` at 294; `__gap` 10 → 8 | 303, as before |
| CollateralRegistry | `pledgeNonces` at slot 261; `__gap` 41 → 40 | 302, as before |
| DeedNFT and both extensions | `_pendingValidator` (slot 515) and `_validatorReassignDelay` (516) appended after `_membershipRegistry`. DeedNFTBase keeps its Phase 1 layout, whose only gap is in the middle, so appending at the end is the append-only option. | 517 |
| TermIssuer and modules, Liquidator, NetworkRegistry, RateSchedule | unchanged | as before |

None of these is live on Base mainnet: only ClaimEscrow, ESADepositVault and the legacy ClearUSD are, and all three are untouched. DeedNFT exists only on Base Sepolia.

**Slither** (per contract, the FIX-PLAN section 6 way: via-IR, Medium and High only), on `dev` and on this branch:

| Contract | `dev` | this branch | New against `dev` |
|---|---|---|---|
| RevolvingIssuer | 33 | 38 | `reentrancy-balance` and `reentrancy-no-eth` on the `syncEncumbrance` call in `_draw`; `unused-return` (its return value); `uninitialized-state` for `lineOpenedAt` and `clrusdToken`; `uninitialized-local` for `savingsDrawn` and RateSchedule's accumulators |
| RevolvingIssuerExtension | 34 | 42 | the same, plus `openLine`'s existing `reentrancy-no-eth` and `uninitialized-local` findings, moved here from RevolvingIssuer |
| RevolvingIssuerCycles | 32 | 37 | the same base and RateSchedule items |
| TermIssuer / Extension / Origination | 47 / 32 / 21 | 49 / 34 / 23 | `uninitialized-local` for the RateSchedule accumulators |
| RateSchedule | 7 | 9 | `uninitialized-local` for `carry` and `unsecured` in `revolvingRatesOf` |
| CollateralRegistry, Liquidator, NetworkRegistry, DeedNFT, DeedTrustExtension | 1, 19, 0, 26, 9 | 1, 19, 0, 26, 9 | none (findings whose text names a moved function compare equal) |

**Triage of everything new.** None is a defect.

- **Reentrancy on `syncEncumbrance`.** The call goes to the CLRUSD token the owner set once. That token writes only its own storage and reads the registry, which reads this issuer through views. Nothing it reaches can call back into a state-changing issuer function.
  - The balance read before it (`_syncCreditPositions`) is used only to size the draw, before the call.
  - In `settleCardSpend` the authorization is deleted before the draw, so a second settlement of the same reference is impossible either way.
- **`unused-return`.** The lock value is CLRUSD's to record. The call is made for its side effect, and for its revert.
- **`uninitialized-state`.** The module-split false positive Phases 1 to 2c already triaged. `lineOpenedAt` is written in the extension's `openLine`, and `clrusdToken` in its `setClrusdToken`.
- **`uninitialized-local`.** Accumulators that start at zero, by intent.

## 5. Tests and checks

- **New:** `test/audit/rereview/Decisions.spec.ts`, 25 tests. M-C 2, M-E 1, M-F 5, M-G 3, L-B 4, L-C 1, L-F 3, L-G 2, L-I 3, O-1 1.
- **Full suite** (`KEEP_REVERT_STRINGS=true npx hardhat test --no-compile`, every fuzz at its default 300 steps): **1,011 passing, 0 failing**: 986 before (Phase 4's report) plus the 25 new tests.
  - The one full run gave 1,010 passing and one failure: the path-independence test in section 2, which was then changed.
  - Its spec (`CreditInvariants.spec.ts`, every seed at 300 steps) was then re-run on its own: 9 passing..
- **Generated files:**
  - fingerprints (`packages/command-types/src/chain/code.json`): regenerated from the production build; six contracts changed. `code-fingerprints.mjs --check` passes.
  - contract reference: three pages regenerated (CollateralRegistry, NetworkRegistry, RevolvingIssuer). `contract-reference.mjs --check` passes.
  - doc links: `check-doc-links.mjs` reports no broken links.
  - Like every forwarded function before it, `openLine` now shows as "Anyone" in RevolvingIssuer's reference page, because its access check runs in the extension. This is the generator's existing limitation.
- **`npx turbo run typecheck test --affected`:** 3 of 3 tasks passed (`@clear/command-types` typecheck, and `@clear/command` typecheck and tests), with `TURBO_SCM_BASE=origin/dev`.

## 6. Documentation changed

- `DEED-V5-INTERFACE.md`: the M-F and M-G functions, consent types, digests and errors, with the Addendum 2 change marked for the drafting.
- `UPGRADEABILITY.md`: the Phase 4b settings and who holds them.
- `docs/protocol/credit.md`: the effective-rate order, signed pledges, admin-only issuer registration and current-episode liquidation.
- `docs/protocol/savings.md`: the Savings-draw lock refresh, and signed pledges.
- `docs/protocol/bonds.md`: signed item pledges.

## 7. Apps and API follow-up

Nothing under `apps/` was changed here.

- **Pledges (L-I), action needed before this is deployed.** `apps/api/src/services/chain/savingsCollateralService.ts` pledges on the member's behalf with the operator key alone:
  - `syncCollateralKind` calls `pledge(member, kind, amount)` (line 252) for savings (`syncSavingsCollateral`, `syncSavingsCollateralFromBalance`) and pool shares (`syncPoolCollateral`);
  - `syncBondCollateral` calls `pledgeItem(member, BOND, id)` (line 419).
  - Both calls now need `deadline` and the member's signature over `Pledge` / `PledgeItem` at `pledgeNonces(member)`.
  - The automatic savings-pledge sync cannot run unattended any more. The member app has to collect a signature: at deposit, or once per top-up, from the member's smart account (EIP-1271).
  - The API then submits it with the operator key.
  - `release`, `releaseItem` and the registry reads are unchanged.
  - `scripts/sync_savings_collateral.ts` already takes collected signatures.
- **Card settlement (L-B).** A card settlement that draws on Savings now also calls CLRUSD. It costs a little more gas, and it reverts if the encumbrance registry is down. The settlement job should treat that revert as retryable.
- **Deed trust (M-F, M-G).** No app calls these yet; the generated ABIs follow the contracts.
  - Any future caller of `applyLicensingDetermination` passes the protector's consent (or `"0x"`).
  - A trust deed's change of validator is two calls, a week apart.
- **Repayment order (L-G).** Nothing in the apps reads `nextRepaymentRate`. Its unit is now monthly bps × 1e18.
- **Issuer registration (M-E).** Nothing in the apps registers issuers. After the handover, adding an issuer is a credit-timelock proposal (`deploy/20` and `deploy/24` print it).
