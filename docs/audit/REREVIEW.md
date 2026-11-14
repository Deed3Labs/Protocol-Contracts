# Phase 4: independent re-review and rehearsal

Branch `audit/phase-4-rereview`, cut from `dev` at `8bd2f75`, which has every contract phase merged: #883 (Phase 1), #886 (Phase 2), #885 (Phase 3), #888 (Phase 2b) and #889 (Phase 2c). The plan is `FIX-PLAN.md` section 4, "Phase 4".

Nothing was deployed, no key was used, and no live network was touched.

## Summary

- **Step 1.** All 125 tests under `test/audit/` (the original attack proofs, flipped, plus the phases' acceptance tests) pass against the merged code. Every original attack still fails. Eight PoCs no longer prove everything their finding covered; they are listed in section 1.
- **Step 2.** A blind reviewer, who saw only the diff `7eb5976..dev` and the original finding reports, found 3 High, 7 Medium, 9 Low and 5 Info items. Its report is kept unchanged as `rereview/BLIND-REVIEW.md`. Every item was checked here:
  - **Fixed, each with a regression test:** H-A, H-B, H-C, M-A, M-B, M-D, L-A and L-H. Seven of them were first reproduced against `dev`.
  - **Decisions for the owner:** M-C, M-E, M-F, M-G, L-B, L-C, L-D, L-E, L-F, L-G and L-I, plus one observation of this session's (O-1). Each has options and a recommendation in section 3.
- **Step 3.** The invariant fuzz now covers Phase 2's accrual (with 2b's levelled schedule, the member ceiling and CFL aggregation) and the Deed track. Phase 2c's compartments were already covered by `Assurance.spec.ts`.
- **Step 4.** Slither, run per changed contract, reports nothing new beyond rounding and false positives, all triaged in section 5.
- **Step 5.** The fork rehearsal was **not run**, because `BASE_SEPOLIA_RPC_URL` is not set in this environment.
- **Recommendation:** get an external human audit before mainnet member credit, scoped as in section 7.

## 1. Step 1: the original attacks against the merged code

`KEEP_REVERT_STRINGS=true npx hardhat test test/audit/*.spec.ts test/audit/deed/*.spec.ts test/audit/deep/*.spec.ts --no-compile` gave **125 passing, 0 failing** on `dev` (fuzz at 60 steps). Every original proof is present in flipped form, asserting that the attack now fails. The exceptions are X-9, X-15, X-16 and M-8/X-17, which were rewritten when Phase 2c retired the pool and oracle they attacked (see the table below). The rest of the 125 are the phases' own regression tests.

The deep invariant fuzz (`CreditInvariants.spec.ts`) behaves as Phase 1 described it:
- (i-b), every claim backed, holds in every seed;
- (ii) moves only as "refund up", the residual carry a refund leaves by design;
- (i), supply equal to obligations, cannot hold by design.

**PoCs that no longer prove everything they should:**

| Test | What it no longer shows | Now covered by |
|---|---|---|
| `deep/HotKeys` "H-4 (fixed)…" (four tests) | They exercise the role split, signatures and daily caps, but not `closePlanForRefund` with a merchant other than the plan's, nor an operator re-split. Both were still H-4 holes. | `rereview/BlindReview` H-A, H-B |
| `deep/DeepPoC` "X-1 (fixed)…" | It refunds against the plan's honest merchant. The X-1 fix created an obligation on whatever address the caller named. | `rereview/BlindReview` H-A |
| `deep/HotKeys` "M-2 (fixed)…" | It proves settlement stays within the authorization and the caps. The same settler key records the authorization (L-C). | Decision L-C |
| `deep/PeripheralRegressions` "M-3…" (CLRUSD) | It proves the last-known lock holds during an outage. It does not cover a holder whose record is stale, because they drew after their last CLRUSD move (L-B). | Decision L-B |
| `deep/PeripheralRegressions` X-9/X-15/X-16 and M-8/X-17 (pool) | The audited contracts (the old AssurancePool and AssuranceOracle) are retired in Phase 2c. The tests show that the new pool cannot have the class of bug, not that the original attack fails. | Accepted (Phase 2c report) |
| `deep/CreditInvariants` seed 5 | Its title still said "(ii) breaks on draw". The C-1 overdraw has been refused since Phase 1 (`RevolvingIssuerDrawUnplaced`), so the title is corrected. | Renamed |
| `deep/CreditInvariants` (all seeds) | It runs the issuers without a RateSchedule (legacy pricing), so none of Phase 2's accrual is exercised. | `rereview/AccrualInvariants` |
| `deep/CreditInvariants` (all seeds) | Only drift (i) on draws, plans, warps and materialisation is asserted. The other breaks are logged, not asserted. | Unchanged; Phase 1's justification stands |

## 2. Step 2: every blind-review finding

"Reproduced" means a test showed the behaviour on `dev` at `8bd2f75` before the fix.

| ID | Verdict | What was done | Regression test (`test/audit/rereview/BlindReview.spec.ts` unless noted) |
|---|---|---|---|
| H-A | **Confirmed, reproduced.** A paid $1,000 plan, refunded with a stranger named as merchant, gave the member $1,000 cash and put $1,000 of debt on the stranger, and the merchant kept its $975. On an unpaid plan, the member's $1,000 obligation moved to the stranger. | **Fixed.** `openPlan` records the payout beside the merchant (in `PlanPricing`, in the slot `accruedAt` already used, so no storage moves). `closePlanForRefund` reverts `TermIssuerRefundTermsMismatch` unless `merchant` is the plan's own. Both legs come from the recorded payout, in proportion to the refund. The caller's `payout` argument stays in the ABI so the refund service keeps working, and is ignored. Plans opened before this upgrade (Base Sepolia only) revert `TermIssuerRefundTermsUnknown`. | "H-A: …" (3 tests); `TermIssuer.spec` "takes the legs from the plan, not the caller" |
| H-B | **Confirmed, reproduced.** An operator's `setSplit(0, 1)` on a current In-12 plan put $1,110.43 in arrears one cycle later, and a stranger's `declareDefault` then suspended the member. | **Fixed.** An unsigned re-split by anyone other than the member must keep at least the installments left, and must not raise the installment (`TermIssuerResplitShortens`). The existing rule still refuses it at a higher cost without the member's signature. Arrears already owed are carried as before; none are added. The member's own re-splits are unchanged. | "H-B: …" (3 tests); `TermIssuer.spec` "spreads the rest over the new term…" |
| H-C | **Confirmed, reproduced** (`missedInRow` = 1 at the first cycle for a member current on a term plan who never drew the line). | **Fixed** (see the note below). `RevolvingIssuerBase.inCompliance` is now `totalPrincipalOf(member) == 0`: the revolving tiers, with their materialised carry. Before, it read the whole ledger balance, which includes term-plan principal. | "H-C: …" (2 tests) |
| M-A | **Confirmed, reproduced.** The same signer re-paused right after a lapse, and again after unpausing. The window had no ceiling (the blind review set 100 years). | **Fixed in the pause logic only** (Phase 2d reworks vault and CLRUSD governance and the pilot cap):<br>- `setPauseWindow` refuses anything above 72 hours, on CLRUSD and the vault;<br>- unpausing ends a pause rather than deleting its record;<br>- the signer of the last pause cannot start a new one on the same account, the security pause or the vault until 30 days after it ended (`REPAUSE_COOLDOWN`);<br>- any other signer may pause at once, and a second signer's renewal is unchanged.<br>No storage was added; the vault's layout is unchanged. | "M-A: …" (4 tests) |
| M-B | **Confirmed, reproduced.** `setPricing` with balances open panicked 0x32; a member re-attested to NY before NY's products launched panicked 0x11. Either bricks every repayment. | **Fixed.**<br>- Each member records which accumulator every snapshot was taken from (`snapBasis`, one slot from the gap).<br>- If a tier's basis has changed since its snapshot, nothing is charged for that interval and the next touch re-snapshots. If the ceiling applies but has no snapshot, unsecured carry for that interval is zero. Both errors are in the member's favour.<br>- Accumulator differences saturate at zero.<br>- `setPricing` and `TermIssuer.setRateSchedule` cannot point at a different schedule or ceiling product once one is set. A schedule change is an in-place RateSchedule upgrade behind the timelock. | "M-B: …" (3 tests); `AccrualInvariants` (state move and product launch mid-run) |
| M-C | **Confirmed by reading** (not run): `hasDefaulted` is never cleared, `openLine` does not refuse a past default, and `liquidate` accepts `hasDefaulted`. | Decision (section 3) | — |
| M-D | **Confirmed, reproduced.** $3,000 of Clear Cash under a 20% annual cap accrued $608.33 in 365 days. | **Fixed.**<br>- New `RateSchedule.termChargeFor` scales the list rate and the graduated cap by 365/360 (section 12.9: the monthly rate per 30-day cycle, unchanged), then bounds the result by `annualCapBps` a year whenever the plan or the member's aggregate is at or above the large-loan threshold.<br>- The quoted rate for a large loan is clamped to `annualCapBps × 30 / 365` per cycle, so the schedule and the disclosure stay under the cap too. That is 164 bps, not 166, at 20%. | "M-D: …" (2 tests); `AccrualInvariants` (b) |
| M-E | **Confirmed by reading.** `NetworkRegistry.registerIssuer` is `OPERATOR_ROLE`. | Decision (section 3) | — |
| M-F | **Partly confirmed.** The holder can front-run a freezing `markVoid` with `reassignValidator`. That a frozen deed can be burned, and that a void cannot be undone, are Phase 3 design (its open questions 2 and 3). | Decision (section 3) | — |
| M-G | **Confirmed, and it is what Addendum 2 says:** the standby may call `applyLicensingDetermination` and is promoted on its own word. | Decision (section 3) | — |
| L-A | **Confirmed, reproduced** (panic 0x11 on the second Savings card settlement with an unlimited allowance). | **Fixed.** The allowance is added saturating; an unlimited allowance narrows nothing. | "L-A: …" |
| L-B | **Confirmed by reading.** This is Phase 1's open question 4. | Decision (section 3) | — |
| L-C | **Known.** This is Phase 1's section 7 default, flagged for counsel then. | Decision (section 3) | — |
| L-D | **Known.** This is Phase 1's open question 5. ClaimEscrow is live on mainnet. | Decision (section 3) | — |
| L-E | **Confirmed.** The cap counts receivers attested CA (DECISIONS #6). | Left to Phase 2d, which reworks the pilot cap. Section 3 | — |
| L-F | **Confirmed.** The spec's "one open Clear Cash plan" is optional. The legal cap already aggregates under DECISIONS #7, but the 365-day term rule does not. | Decision (section 3) | — |
| L-G | **Confirmed by reading.** Repayment order uses the configured tier or plan rate, not the effective (capped) rate. | Decision (section 3) | — |
| L-H | **Confirmed by reading.** `settleRealized` (`OPERATOR_ROLE`) could apply any of the Liquidator's pooled USDC to any member. | **Fixed.** Queued share proceeds are recorded per member at their value when queued (`realizedPendingOf`, one slot from the gap). `settleRealized` applies at most that, and reverts when nothing is queued for the member. | "L-H: …"; `AssetBackedDefault.spec` "settles the remainder…" |
| L-I | **Confirmed by reading.** The operator pledges without the member's signature. | Decision (section 3) | — |
| I-1 | Correct, and only on Base Sepolia. A fresh credit deployment on mainnet is already the plan (Phase 1 open question 8). | Noted. The M-B change makes a legacy schedule-priced tier charge nothing for one interval rather than 56 years. | — |
| I-2 | Correct. Subdivide is untouched here (still 24,574). | Noted | — |
| I-3 | Correct. This is Phase 2c's open question 1. | Noted | — |
| I-4 | Correct. It is cosmetic. | Noted | — |
| I-5 | **By design.** A removed coop agent can release only deeds it already holds (DECISIONS #8: removal never traps a deed). It can take no new deposits. | None | — |

**Note on H-C.** The brief asked for this one to be implemented only if there was no real ambiguity. There is none for the case found: TermIssuer already treats a plan on schedule as compliant and defaults a plan through its own schedule, so judging it again on the revolving line double-counted it. One edge remains:
- **Residual carry.** This is carry a refund leaves owed on no position (`TermIssuer.residualCarryOf`). It no longer makes the revolving line miss a cycle. It is still collected by `collectForMember` and payable through `payResidualCarry`, but nothing defaults on it.
- If the owner wants residual carry to count toward the rebalance, the change is `totalPrincipalOf(member) + term.residualCarryOf(member) == 0`.

**Existing tests changed:**
- `TermIssuer.spec` "spreads the rest over the new term…": an operator 12 → 6 re-split with 9 installments left now reverts. The test uses 12, then checks arrears of $75 a cycle.
- `TermIssuer.spec` "refuses legs that do not add up": now "takes the legs from the plan, not the caller".
- `AssetBackedDefault.spec` "settles the remainder once the co-op collects": exactly the queued value is applied, and the carry accrued since stays owed.
- `CreditInvariants.spec` seed 5: retitled.

Nothing else in the suite needed changing.

## 3. Decisions for the owner

Each item has options, a recommendation and its effect. Nothing here was changed.

**M-C. `hasDefaulted` is permanent, and liquidation is permissionless.**
- **Problem.** A member who defaulted, settled and was re-onboarded can have a later Savings draw liquidated by anyone, while current.
- **Options:**
  - (a) key liquidation to the current default episode: `defaultedAt[member] >= lineOpenedAt[member]` (needs a stored open time);
  - (b) clear `defaultedAt` when a new line opens;
  - (c) refuse `openLine` for a member who ever defaulted.
- **Recommendation: (a).** It keeps the history for underwriting and the API, and limits enforcement to the default that triggered it. (b) loses the record, and (c) closes re-onboarding, which section 12's reinstatement implies.

**M-E. NetworkRegistry's operator can register an issuer.**
- **Problem.** A registered issuer passes `onlyCreditIssuer` on the ledger, with every ledger power that brings.
- **Options:**
  - (a) move `registerIssuer` and `deregisterIssuer` to `DEFAULT_ADMIN_ROLE`, which the credit timelock holds after the handover;
  - (b) keep it with the operator and add a 7-day pending period before a registration takes effect;
  - (c) leave it.
- **Recommendation: (a).** It narrows a power, and adding an issuer is a governance act. Deploy scripts `20` and `24` register issuers with the deployer's key before the handover, which also holds `DEFAULT_ADMIN_ROLE` at that point, so a fresh deploy only needs the role check changed.

**M-F. Deed freeze.**
- **Problem.**
  - The holder can see a validator's freezing `markVoid` in the mempool and move the deed to a friendly validator first.
  - A frozen deed can still be burned (Phase 3: burn always allowed).
  - A freeze is one validator signer's call and cannot be undone.
- **Options:**
  - (a) once the validator posts a notice, block `reassignValidator` until that validator voids the deed or a review window passes;
  - (b) make `reassignValidator` take effect after a delay, during which the old validator may still void;
  - (c) require two signers to freeze, and add a two-party un-void (validator plus protector).
- **Recommendation: (b) plus (c).** A short delay (for example 7 days) on reassignment removes the race without a new role. The two-party un-void answers Phase 3's open question 2. Whether burn stays allowed on a frozen deed is a trust-agreement question for counsel. Recommendation: keep it, because a burned trust deed keeps its record (brief item 1).

**M-G. Standby self-promotion.**
- **Problem.** Addendum 2 lets the standby call `applyLicensingDetermination` and become trustee on its own word, with any `docHash`.
- **Options:**
  - (a) the standby may post the determination, but promotion needs the protector's consent (EIP-712, as with corrections), or the holder's while the protector record is zero;
  - (b) promotion waits a notice period (for example 14 days) in which the protector or the current trustee may object;
  - (c) keep Addendum 2 as written.
- **Recommendation: (a)** for the standby's own call. The protector's and trustee's calls stay as they are. This is a change to Addendum 2, so the drafting notes need it too.

**L-B. CLRUSD lock during an encumbrance outage.**
- **Problem.** The last-known lock is stale for a holder who drew after their last CLRUSD move.
- **Options:**
  - (a) the revolving issuer calls `ClearUSDUpgradeable.syncEncumbrance(member)` after every Savings draw and card settlement (it reverts, and so fails closed, if the registry is down);
  - (b) the API calls it after each draw;
  - (c) accept the gap.
- **Recommendation: (a).** It is on chain and needs no extra trust. It costs one external call per Savings draw and needs the issuer to know CLRUSD's address. RevolvingIssuer has about 900 bytes of headroom.

**L-C. The card settler records the authorization it later settles.**
- **Options:**
  - (a) an attestation from the card network (or the processor's signing key) at authorization;
  - (b) the member's signature per authorization (impractical at a card terminal);
  - (c) keep the caps and the per-member daily limit as they are.
- **Recommendation: (a)**, once the processor can sign. Until then, (c), with the caps sized small. This is still for counsel under DFAL 10a, as Phase 1 flagged.

**L-D. `ClaimEscrow.claimToPayoutTreasury`.**
- **Problem.** The settler can sweep an open escrow to the payout treasury without the claim key.
- **Options:**
  - (a) require the sender's or claim key's signature;
  - (b) allow it only after expiry (that is a refund);
  - (c) keep it.
- **Recommendation: (b).** ClaimEscrow is live, so this is a storage-safe logic upgrade. Do it in Phase 2d's vault and send work, not here.

**L-E. DFAL pilot cap.** It counts only receivers attested CA, so a CA member can mint to an unattested receiver.
- **Recommendation:** count by depositor and receiver (either attested CA counts), and require attestation before a member mint (DECISIONS #6's preferred mitigation). This is left to Phase 2d, which reworks the pilot cap.

**L-F. Clear Cash loan-splitting.** Two $2,400 plans each avoid the 365-day minimum term.
- **Options:**
  - (a) one open CASH plan per member (the spec's optional rule);
  - (b) judge the large-loan term rule on the member's aggregate CASH principal;
  - (c) leave it, since DECISIONS #7 already aggregates the rate cap.
- **Recommendation: (b)**, so the term follows the same aggregation the cap does. Counsel to confirm.

**L-G. Repayment order.** Most-expensive-first uses the configured rate, not the effective one after caps.
- **Options:**
  - (a) order by the effective monthly rate at the moment of repayment;
  - (b) keep the configured rate.
- **Recommendation: (a)**, pending counsel on what "most expensive" means for a capped position. It touches the ledger's band walk across both issuers, so it needs its own change and tests. It is listed here rather than fixed.

**L-I. Operator pledges.** `CollateralRegistry.pledge` and `pledgeItem` are `OPERATOR_ROLE` with no member consent. Under 12.5's excess lock, an operator-pledged Earn asset becomes encumbered.
- **Options:**
  - (a) pledges need the member's EIP-712 signature (the operator submits);
  - (b) the member pledges directly;
  - (c) keep it.
- **Recommendation: (a)**, the same shape as plan terms.

**O-1 (found while writing the accrual fuzz). An unsecured tier in a state with no product.**
- **Problem.** If a member is re-attested to a state where the tier's product does not exist, the tier accrues at its own configured local rate, with no member ceiling. Before the M-B fix that path panicked; now it charges the local rate. `openLine` is state-gated, but re-attestation is not.
- **Options:**
  - (a) a priced tier accrues nothing while its state has no product;
  - (b) it keeps the last state's product until the new state's launches;
  - (c) keep the local rate.
- **Recommendation: (b).** The member stays on the terms they had. This ties to Phase 2's open question 1, on who may change a state attestation.

## 4. Step 3: invariant fuzz extended

| Spec | Covers | Invariants checked after every step |
|---|---|---|
| `test/audit/rereview/AccrualInvariants.spec.ts` (seeds 41–43) | A RevolvingIssuer with INCOME and BOOST priced from a RateSchedule and a REVOLVING ceiling product, and a TermIssuer with PARTNER and CASH products. CFL aggregation is on across both. Random draws, repayments, signed plans (small and large, all splits), payments, member and operator re-splits, refunds, keeper cycle judgements, and mid-run governance (a member moved to NY, NY's products launched later). | (a) For revolving, per interval: unsecured carry ≤ the graduated, or from $2,500 the annual, cap on that principal, and ≤ its share of the cap on the aggregate; each tier ≤ its list rate. (b) For each term plan: ≤ list per 30 days, ≤ the graduated cap per 30 days and its aggregate share, ≤ `annualCapBps` once large (M-D). (c) Free plans never accrue. (d) No call panics (the M-B class). (e) An operator re-split never shortens a plan, raises its installment or adds arrears (H-B). (f) A cycle judged with nothing owed on the line is never a miss (H-C). (g) The ledger equals the issuers' principal for members no refund or default has touched. A refund never raises another member's debt (H-A). |
| `test/audit/rereview/DeedInvariants.spec.ts` (seeds 71–72) | Trust deeds (Land and Estate), with and without a protector. Random mints, holder transfers (including to the trustee), theft attempts by strangers, the trustee, the protector and the validator signer, burns and re-mint attempts, transferable and freezing voids, edits to the locked traits, Subdivide deposits and releases, trustee, protector and standby changes, licensing determinations and notices. | (1) The holder is exactly what an off-chain model says. (2) A burned deed stays Retired and keeps its definition, and its ID never mints again. (3) Definition and agreementHash never change. (4) The trustee is never the holder or the protector, and the standby never the protector. (5) A frozen deed never moves. (6) `beneficialOwnerOf` is the holder, or the depositor while in Subdivide. (7) No transfer to the current trustee succeeds. |
| `test/audit/compliance/Assurance.spec.ts` (Phase 2c, unchanged) | Acceptance 32 and 33 fuzz. | `sum(compartments) == USDC held == totalAccounted` after every pool call; money leaves only to the loss-reserve and disbursement addresses; every compartment unchanged under random calls to every money-path contract. Already covers 2c's "sum == assets" and "no path in or out", so nothing was added. |

**Results:**
- At 60 steps during development, every seed held, with no breaks.
- At the default 300 steps, in the full suite, every seed of both new specs held with no break:
  - the accrual fuzz measured 900 revolving intervals and 617–716 plan intervals per seed, over 9–12 plans each;
  - the Deed fuzz minted 44–49 deeds, burned 23–29 and attempted 34 thefts per seed.
- The original `CreditInvariants` seeds at 300 steps show only Phase 1's justified drift: (i-b) empty in every seed, and (ii) only "refund up" (with seed 2's "repayment down" as that residual is paid).
- **A finding about the suite, fixed.** The accrual fuzz moves the chain's clock by decades, and Hardhat runs every test file on one chain. On the first full run, three BurnerBond tests that ran later failed `BondVaultMaturityOutOfRange`, because the clock was past 2106. Both new fuzz specs now snapshot the chain before each seed and revert after it.
- The accrual fuzz measured every interval it ran: about 180 revolving and 90–140 plan intervals per seed at 60 steps.

## 5. Step 4: Slither

Run per contract the FIX-PLAN section 6 way: solc 0.8.29, via-IR, Medium and High only. For CLRUSD, the Chainlink token's versioned OpenZeppelin imports are remapped (`@openzeppelin/contracts@5.0.2/`, `@4.8.3/`). The runs covered every contract changed here, on this branch, on `dev` and on `7eb5976`.

| Contract | `7eb5976` | `dev` | this branch | New against `dev` |
|---|---|---|---|---|
| ClearUSDUpgradeable | 0 | 0 | 0 | none |
| ESADepositVault | 1 | 1 | 1 | none (the audited `arbitrary-send-erc20` on the signed deposit) |
| Liquidator | 8 | 19 | 19 | none |
| RateSchedule | — | 6 | 7 | `divide-before-multiply` in `termChargeFor` |
| RevolvingIssuer (and its Extension and Cycles, which share the base) | 19 | 31 | 33 | `termChargeFor`; `uninitialized-local` `basis` in `_resnapshot` |
| TermIssuer (and its Extension and Origination) | 19 | 44 | 48 | `termChargeFor`; `divide-before-multiply` ×2 in `closePlanForRefund`; `tautology` in `_resplit` |

**Triage of everything new against `dev`.** None is a defect.
- **`divide-before-multiply` in `termChargeFor`.** The list carry is rounded down to whole units, then scaled by 365/360. The loss is under 2 units per touch, always in the member's favour. The old code (`TermIssuerBase`) did the same.
- **`divide-before-multiply` in `closePlanForRefund`.** The merchant's share of the refund is `recordedPayout × refundable / principal`, and is then split across the reversal and cash legs. Rounding down puts the remainder on the co-op, never on the merchant. This is the same rule the refund service used and Phase 1 documented.
- **`uninitialized-local` `basis`.** It is an accumulator that starts at zero, by intent.
- **`tautology` (`installments < 0`) in `_resplit`.** A false positive. The source is `plan.installments > dueNow && installments < plan.installments - dueNow`, and Slither's IR loses the guard.

Everything `dev` has beyond `7eb5976` was triaged by Phases 1–2c (the module-split `uninitialized-state`, the forwarding `controlled-delegatecall`, `reentrancy-no-eth` on ledger calls, and the hardened `reentrancy-balance` in the Liquidator). Those counts are unchanged here.

## 6. Step 5: fork rehearsal

**Skipped.** `BASE_SEPOLIA_RPC_URL` is not set in this environment, so no fork was run. The rehearsal is still worth doing before any Base Sepolia upgrade, read-only, against `FORK_RPC_URL`.

If it runs, it should cover:
- the ESADepositVault upgrade;
- the I-1 hazard on the existing RevolvingIssuer and TermIssuer proxies.

The recommendation is still a fresh credit deployment.

## 7. Sizes, storage and whether to get an external audit

**Sizes.** Production build (`npx hardhat compile --force`, revert strings stripped). EIP-170 caps runtime at 24,576 bytes and EIP-3860 caps creation code at 49,152.

Every contract is within both limits. The closest, and every contract changed here:

| Contract | Runtime | Headroom | Creation code | Runtime in the Phase 2b/2c reports |
|---|---|---|---|---|
| Subdivide (unchanged) | 24,574 | 2 | 24,711 | 24,574 |
| MetadataRenderer (unchanged) | 24,493 | 83 | 24,630 | 24,493 |
| BurnerBond (unchanged) | 24,168 | 408 | 24,278 | 24,168 |
| TermIssuerExtension | 23,815 | 761 | 23,952 | 23,595 |
| RevolvingIssuer | 23,507 | 1,069 | 24,232 | 23,599 |
| TermIssuer | 21,567 | 3,009 | 22,250 | 21,488 |
| Liquidator | 20,608 | 3,968 | 20,745 | 20,432 |
| RevolvingIssuerExtension | 20,335 | 4,241 | 20,472 | 20,467 |
| RevolvingIssuerCycles | 19,393 | 5,183 | 19,447 | 19,553 |
| TermIssuerOrigination | 17,067 | 7,509 | 17,204 | |
| ESADepositVault | 14,565 | 10,011 | 14,702 | |
| ClearUSDUpgradeable | 14,026 | 10,550 | 14,266 | |
| RateSchedule | 8,902 | 15,674 | 9,039 | |

The largest creation code is still BurnerBondFactory's, at 46,956 bytes (unchanged).

**Storage** (solc storage layouts, slot by slot, against `dev`):
- **RevolvingIssuer:** `snapBasis` appended at slot 292; `__gap` 11 → 10; still ends at slot 302.
- **Liquidator:** `realizedPendingOf` appended at slot 264; `__gap` 35 → 34; ends where it did.
- **TermIssuer:** no new slot. `PlanPricing` (only ever inside a mapping) gains `payout` (uint128) and `refundTermsRecorded` (bool) in its fourth slot, which held only `accruedAt`, so the struct is still 4 slots.
- **ESADepositVault, RateSchedule:** layout unchanged.
- **ClearUSDUpgradeable:** its ERC-7201 namespace is unchanged.
- **Live contracts:** OpenZeppelin's storage upgrade report passes for ESADepositVault (both implementations in `.openzeppelin/base.json`) and ClaimEscrow (untouched).

**External human audit: yes, before mainnet member credit.** The original audit (`AUDIT-REPORT.md`) asked for one, and this re-review strengthens the case:
- A blind reviewer of the fix diff alone found three Highs that four phases of fixes and their tests had missed or introduced. Two of them were introduced by fixes: the X-1 fix's obligation primitive, and the cycle rule meeting term plans.
- The credit code has roughly doubled since `7eb5976`: per-second accrual, the member ceiling, CFL aggregation, levelled schedules, section 12 and section 13. Most of it was written and reviewed by the same kind of reviewer.

**Suggested scope, in priority order:**
1. The ledger and both issuers, with their modules: `StableCredit` / `MutualCredit` / `ClearCredit`, `CreditIssuer`, `RevolvingIssuer` with Base, Extension and Cycles, `TermIssuer` with Base, Extension and Origination, and `RateSchedule`. Focus on accrual and caps, refunds, re-splits, the default and cycle rules, and the module split's storage.
2. `Liquidator`, `CollateralRegistry`, `ClearUSDUpgradeable` (the lock, seizure and pauses), and `ESADepositVault` / `ClaimEscrow` (live).
3. `PayoutPool` and `AssurancePool` (section 13's two-person control).
4. The Deed track's v5 trust surface (`DeedNFT` and its two extensions, `CoopTransferAgent`, `FunctionalContractRegistry`), before real-property deeds are minted.

Bonds and LendingPool can follow. The decisions in section 3 should be settled first, so the auditors review the final rules.

## 8. Numbers

- **Tests.**
  - Before (`dev` at `8bd2f75`, Phase 2c's report): 962 passing.
  - After: **986 passing, 0 failing** (`KEEP_REVERT_STRINGS=true npx hardhat test --no-compile`, every fuzz at its default 300 steps). That is 962 + 24 new.
  - New in this phase:
    - `rereview/BlindReview.spec.ts`: 19 tests;
    - `rereview/AccrualInvariants.spec.ts`: 3 seeds;
    - `rereview/DeedInvariants.spec.ts`: 2 seeds.
- **Generated files.** Fingerprints (`packages/command-types/src/chain/code.json`) regenerated from the production build; `code-fingerprints.mjs --check` and `contract-reference.mjs --check` pass (the contract reference describes what is deployed, so no page changed); `check-doc-links.mjs`: 195 files, no broken links.
- **`npx turbo run typecheck test --affected`** (Node 22, bun): 32 of 32 tasks passed.

## 9. Apps and API follow-up

- **Refund service** (`apps/api/src/services/refundSettlement.ts`). Nothing breaks: the `payout` it passes is ignored, and the merchant it passes must be the plan's (it already is).
- **Plan quoting.** For a Clear Cash plan at or above $2,500 whose list rate exceeds the annual cap, the chain now computes the rate per cycle as `annualCapBps × 30 / 365`, not `annualCapBps / 12`. The app must sign that rate, or `openPlan` reverts `TermIssuerTermsMismatch`. Below the cap, nothing changes.
- **Operations.**
  - The operator's hardship re-split can now only lengthen a plan.
  - A pause signer must hand a repeat pause to a colleague within 30 days.
  - `settleRealized` applies only a member's own queued proceeds.
