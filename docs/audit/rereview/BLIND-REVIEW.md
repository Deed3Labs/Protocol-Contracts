# Phase 4 blind review: `7eb5976..origin/dev` (contracts/)

Reviewed at `origin/dev` = `8bd2f75`. I read the diff, the full current source of the touched contracts, and only the five allowed docs (AUDIT-REPORT, DEEP-FINDINGS, DEED-FINDINGS, compliance-changes, assurance-contracts). I did not read the PHASE, FIX-PLAN, DECISIONS, UPGRADEABILITY or PROMPTS docs, the deed-trust briefs or commit messages. I wrote scratch Hardhat PoCs in throw-away spec files, using the repo's `deep-setup.ts` / `plans.ts` / `rates.ts` fixtures only to deploy contracts, and deleted them afterwards. Nothing was committed.

## Counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 3 |
| Medium | 7 |
| Low | 9 |
| Info | 5 |

PoC-proven: H-A, H-B, H-C, M-A, M-B, L-A. Everything else comes from code reading and is marked "suspected" where I am not certain of the intended behaviour.

---

## HIGH

### H-A. A refund can name any address as "merchant": a credit-lines key moves a member's debt onto a third party, or pays out cash and bills a stranger (H-4 / X-1 not fully fixed; the X-1 fix added a new primitive)
- **Where:** `TermIssuerExtension.closePlanForRefund`, `contracts/peripherals/TermIssuerExtension.sol:47-158`. It calls `StableCredit.reversePurchase` at `:100` and `StableCredit.repayRefund` at `:116`. The ledger side is `StableCredit.reversePurchase` → `_transferObligation(member, merchant, shortfall)` at `contracts/core/StableCredit.sol:381`, and `StableCredit._takeBack` → `_createObligation(holder, shortfall)` at `StableCredit.sol:475-487`.
- **Problem:** `merchant` and `payout` are caller arguments. Nothing checks them against the plan, even though the plan now records its merchant (`planPricing[planId].merchant`, set in `TermIssuerOrigination.sol:75-87`). The X-1 fix made `_takeBack` mint a brand-new obligation on whatever `holder` it is given. That is a "create debt on any address" primitive reachable through one operator key (`CREDIT_LINES_ROLE`).
- **Scenario (proven):**
  - *B1, plan already paid.* A member opens a $1,000 In-full plan at merchant M (payout $975) and pays it. The operator calls `closePlanForRefund(0, 1000e6, victim, 1000e6)`. Result: the member receives $1,000 USDC from the PayoutPool, the victim's `creditBalanceOf` rises from 0 to $1,000 (with `refundReceivableOf` = $1,000), and M keeps its $975 claim.
  - *B1b, plan unpaid.* The same call moves the member's $1,000 obligation onto the victim. Member debt becomes 0, victim debt becomes $1,000, and the merchant keeps its claims.
  - If the victim is a registered merchant, its payable balance is burned instead.
  - If the victim holds a revolving line, its `inCompliance` turns false. That leads to a missed cycle, then default, then revocation and liquidation exposure. This is the "indirect lock / raises a member's debt" that compliance 10a and acceptance test 14 forbid.
  - `payout = 0` instead puts the whole loss on the co-op fee recipient.
- **Proof:** scratch tests B1 and B1b passed. The victim's debt was 1,000 USDC in both.
- **Fix:** take `merchant` from `planPricing[planId].merchant`, and record the plan's payout (or discount) at origination, then derive both legs from storage. Reject caller-supplied values that differ. Consider limiting `_createObligation` to the plan's own merchant and fee recipient.

### H-B. Operator re-split without the member's signature can accelerate any plan and force a default (10b "no declared default")
- **Where:** `TermIssuerExtension._resplit`, `TermIssuerExtension.sol:214-288`. The operator bypass is at `:218-224` and `:233`. The cost test at `:263` only stops a higher rate or *more* installments. Then `TermIssuer.declareDefault` (`TermIssuer.sol:388-402`) is permissionless.
- **Scenario (proven, B2):**
  1. A member is on an In-12 plan of $1,200 and pays installment 1 on time.
  2. The `CREDIT_LINES_ROLE` key calls `setSplit(0, 1)`. That is "In full", which counts as free, so the cost does not rise and no signature is needed. The operator path also skips the arrears, change-count and cool-down limits.
  3. One cycle later arrears are $1,100. After two more installment lengths, a random address calls `declareDefault`.
  4. Outcome: write-off, `termSuspended`, and `revokeMember` through `_onDefault`.
- **Fix:** an unsigned re-split must never shorten the remaining term or raise any installment amount. Only allow `installments >= remaining` and `newInstallment <= oldInstallment`, or require the member's signature for every re-split.

### H-C. A member who is current on a term plan fails every revolving cycle and is defaulted on the revolving line (missed; now automatic through section-12 judging)
- **Where:** `CreditIssuer.inCompliance` (`contracts/peripherals/CreditIssuer.sol:130-133`) returns `creditBalanceOf(member) == 0`, using the whole ledger balance. `RevolvingIssuer` does not override it. It is used by `RevolvingIssuerCycles.judgeCycle` (`RevolvingIssuerCycles.sol:79`), by `isFrozen`, and by `inDefault` (`RevolvingIssuer.sol:405-409`).
- **Problem:** term-plan principal, refund receivables and residual carry all sit in `creditBalanceOf`. So a member who never draws the revolving line but carries a current term plan is "not clean" at every revolving cycle end.
- **Scenario (proven, B7):**
  1. A member holds an income tier (never drawn) and an In-12 term plan, and pays every installment on time.
  2. Anyone calls `syncCreditPeriod`.
  3. Cycle 1: `missedInRow = 1`, and unsecured capacity is halved.
  4. Cycle 2: cure notice. `cureWindow` is 0 by default, so the line defaults straight away. `hasDefaulted = true`, membership is revoked and capacity is zeroed.
  5. Combined with M-C, anyone can then liquidate the member's savings tier whenever it is next drawn.
- **Fix:** have the revolving issuer judge compliance on its own positions, for example `totalDrawnOf(member) == 0`, or its tier principal plus pending carry. Do not use the shared ledger balance.

---

## MEDIUM

### M-A. Fraud and security pauses: one signer can hold a freeze indefinitely, and the admin can set any window (10c two-person rule bypassed)
- **Where:**
  - `ClearUSDUpgradeable.pauseAccount` (`ClearUSDUpgradeable.sol:229-237`), `unpauseAccount` (`:248`), `pauseForSecurity` (`:256-262`) and `setPauseWindow` (`:276-279`). There is no bound on the window.
  - `ESADepositVault.pause` (`ESADepositVault.sol:474-479`) and `setPauseWindow` (`:502-505`) have the same pattern.
- **Problem:** "renew" is blocked for the same signer, but nothing stops that signer from re-pausing in the block where the pause lapses, or from calling unpause and then pause. The window is admin-set with no maximum, so it can be 100 years, or large enough that `timestamp + window` overflows and disables pausing altogether.
- **Proof (B3):** a single `FRAUD_ROLE` signer re-paused at `until`, then ran unpause followed by pause. After `setPauseWindow(100y)` the member was frozen for 100 years. Everything passed.
- **Fix:**
  - Record the last signer per account even after a lapse, and require a different signer for any new pause within N hours of the previous one. Alternatively, require two signers to start a pause.
  - Cap `pauseWindow`, for example at 72 hours or at most 7 days, and put it behind the timelock.

### M-B. Pricing configured after positions exist bricks revolving members (permanent until governance unwinds it)
- **Where:**
  - `RevolvingIssuerBase._pendingCarry` / `_resnapshot` (`RevolvingIssuerBase.sol:285-338`)
  - `RevolvingIssuer.setPricing` / `setTierProduct` (`RevolvingIssuer.sol:319-338`)
  - `RateSchedule._cap` (`RateSchedule.sol:339`)
  - The same hazard exists in `TermIssuer.setRateSchedule` (`TermIssuer.sol:326`).
- **Problem:** `tierSnap` stores either a RateSchedule list accumulator or the tier's local accumulator, and `ceilingSnap` is only written when a ceiling product exists. Several actions mix the two bases or index an empty snapshot:
  - setting pricing or a tier product while members hold principal;
  - adding a state's products after a member was snapshotted in that state (for example after the attester re-attests them to a new state);
  - swapping the RateSchedule address.
- **Proof:**
  - B5: positions open, then `setPricing` and `setTierProduct`. `drawnOf` and `repayCreditBalance` revert with panic 0x32 (`from.bands[i]` out of bounds).
  - B5b: member moved CA→NY, then NY products launched. `repayCreditBalance` and `materialiseCarry` revert with panic 0x11 (`acc - tierSnap` underflow).
  - In both cases every ledger transfer or repayment that touches the member reverts. The member cannot repay, be written off or be liquidated.
- **Fix:**
  - Store which basis each snapshot uses (schedule vs local, and the product key).
  - Treat a missing or empty snapshot as "snapshot now, no carry".
  - Make `setPricing` / `setTierProduct` / `setRateSchedule` refuse while positions exist, or provide a per-member migration.

### M-C. `liquidate` became permissionless, but `hasDefaulted` is sticky forever (regression)
- **Where:** `Liquidator.liquidate` (`Liquidator.sol:326-373`, check at `:341`), `CreditIssuer.hasDefaulted` (`CreditIssuer.sol:534`, `defaultedAt` is never cleared), and `RevolvingIssuer.openLine` (no check for a past default).
- **Problem:** at `7eb5976` `liquidate` was `OPERATOR_ROLE`. It is now open to anyone and accepts `inDefault || hasDefaulted`.
- **Scenario:** a member defaulted once, settled and was re-onboarded with `openLine`. Their period was deleted, so the `notInActivePeriod` check passes. Any stranger can now call `liquidate` on their new savings-tier draw at any time while they are fully current. Their CLRUSD is seized and redeemed against the tier. That is a forced, unauthorised execution of a member transaction, against 10b ("reverts otherwise").
- **Status:** verified by reading, not tested.
- **Fix:** key liquidation to the default episode, for example `defaultedAt[member] >= lineOpenedAt[member]`. Or clear `defaultedAt` when a new line opens, or refuse `openLine` for defaulted members.

### M-D. Term-plan carry is scaled ×365/360, so a binding annual cap is exceeded by about 1.4% (compliance item 5/7: "rate ≤ annualCapBps")
- **Where:** `TermIssuerBase._pendingPlanCarry`, `TermIssuerBase.sol:435-441`, which computes `charge = min(list, cap) * 365 / 360`.
- **Problem:** the cap returned by `RateSchedule.chargesFor` is already a per-second accrual of `annualCapBps / 365 days`. Multiplying it by 365/360 lets a large loan accrue `annualCapBps × 1.0139` per year whenever the cap binds. With list 3%/month and a 30% annual cap, the charge is about 30.42%.
- **Also:** for the graduated bands, 30-day accrual equals exactly the monthly cap, so a 31-day month carries 31/30 of the cap. Spec item 3 asked for `monthly × 12 / 365`; the revolving side follows that, the term side does not.
- **Status:** by reading.
- **Fix:** apply the 365/360 factor to the list leg only, never to the cap, or compute the term cap per 30-day cycle explicitly.

### M-E. The `NetworkRegistry` operator can register an arbitrary issuer and so gains every ledger power (H-4 missed)
- **Where:** `NetworkRegistry.registerIssuer`, `NetworkRegistry.sol:150`, gated by `onlyRole(OPERATOR_ROLE)`.
- **Problem:** a registered issuer passes `StableCredit.onlyCreditIssuer`. It can then call:
  - `accrueCarry(anyMember, attacker, x)`, which debits anyone and mints claims to anyone;
  - `originatePurchase`, `createCreditLine`, `writeOffCreditLine` and `reversePurchase`.
- This is pre-existing, but it sits outside the H-4 role split and outside the "do not widen admin power / timelock" intent.
- **Fix:** move `registerIssuer` / `deregisterIssuer` to `DEFAULT_ADMIN_ROLE` behind the credit timelock.

### M-F. Deed freeze can be dodged and is irreversible (suspected; design intent not read)
- **Where:** `DeedTrustExtension.markVoid` (`DeedTrustExtension.sol:331-345`), `DeedNFT.reassignValidator` (`DeedNFT.sol:246`) and `DeedNFT.burnAsset` (`DeedNFT.sol:287`). The freeze check sits after the burn branch in `_onTransfer` (`DeedTrustExtension.sol:56-72`).
- **Problems:**
  - The holder can front-run a validator's freezing `markVoid` with `reassignValidator(tokenId, friendlyValidator)`, and the old validator's call then reverts with `NotTrustParty`.
  - A frozen deed can still be burned (retired) by its holder, because `to == 0` returns before the freeze check.
  - No function ever clears `STATUS_VOID`, so one validator signer, a role any validator admin can hand out, freezes a deed permanently with no second signer.
- **Fix:**
  - Block `reassignValidator` and `burnAsset` on trust deeds that are VOID or under review.
  - Require two signers to freeze, and add an unfreeze path.

### M-G. The standby trustee can promote itself (suspected)
- **Where:** `DeedTrustExtension.applyLicensingDetermination`, `DeedTrustExtension.sol:202-224`.
- **Problem:** any one of protector, trustee or standby can post a "licensing determination" with an arbitrary `docHash`. If the caller is an eligible standby, it is installed as trustee at once, with no protector consent and no evidence check. The standby can therefore oust the current trustee on its own word.
- **Fix:** require the protector's consent, or a determination signed by the licensing authority or validator, before a standby is promoted.

---

## LOW

- **L-A. Unlimited savings allowance makes card settlement overflow.**
  - `RevolvingIssuerExtension.settleCardSpend`, `RevolvingIssuerExtension.sol:87`: `savingsBefore + savingsDrawAllowance` overflows when the member chose `type(uint256).max`, the "unlimited" value the code itself handles at `:101`.
  - Once any savings principal exists, every card settlement for that member reverts with panic 0x11, so authorized purchases cannot be booked.
  - Proven (B6).
  - Fix: saturate the addition.
- **L-B. M-3 is only partly fixed for CLRUSD.**
  - `ClearUSDUpgradeable._encumberedOf` / `_update` (`:139-143`, `:190-209`) fall back to `lastKnownLock`.
  - That value only refreshes when the holder moves CLRUSD or someone calls `syncEncumbrance`. A member who drew after their last CLRUSD transfer has `lastKnownLock = 0`, so a registry outage fails open for exactly those holders.
  - LendingPool fails closed (max lock); CLRUSD should do the same for holders with drawn credit.
- **L-C. Card settler self-authorizes "approved charges" (M-2 and 10a partial).**
  - `authorizeCardSpend` and `settleCardSpend` both use the same `isCardSettler` key, so the settler alone can raise a member's revolving debt up to headroom and the daily cap.
  - With a member-granted savings allowance it can also raise savings drawn, which is a CLRUSD lock.
  - Authorization should carry a member or card-network attestation.
- **L-D. Settler can still divert sends to the treasury (H-4 partial).**
  - `ClaimEscrow.claimToPayoutTreasury` (`ClaimEscrow.sol:289-295`) lets `SETTLER_ROLE` sweep any open escrow (principal plus fee) to `PAYOUT_TREASURY` without the claim key's signature.
  - It can no longer steal, but it can still divert a member's send unilaterally.
- **L-E. The DFAL pilot cap is bypassable.**
  - `ESADepositVault._countPilot` (`:560-578`) counts only receivers attested `"CA"`. `deposit()` lets any CA member mint to an unattested receiver, which is not counted.
  - Unknown state fails open.
- **L-F. Clear Cash loan-splitting.**
  - The large-loan regime and the ≥365-day term are decided per plan (`TermIssuerBase.sol:478`), and the optional "one open Clear Cash plan per member" is not enforced.
  - Two $2,400 plans avoid the large-loan term rule.
- **L-G. Repayment order uses stale configured rates.**
  - `_absorbRepayment` and `nextRepaymentRate` (`RevolvingIssuer.sol:463`, `:475-488`; `TermIssuer.sol:439`, `:461-477`) order by `index.ratePerCycle`, not by the RateSchedule-effective rate.
  - Once caps bind, "most expensive first" can pick a cheaper position.
- **L-H. `Liquidator.settleRealized` can apply pooled USDC to any member (suspected).**
  - `Liquidator.sol:457-464`: `OPERATOR_ROLE` applies any amount of the Liquidator's pooled USDC (queued share redemptions from many members) to any member and tier. One member's realized collateral can pay another's debt.
  - Fix: track queued proceeds per member.
- **L-I. Operator can pledge a member's bond or pool shares without consent (suspected).**
  - `CollateralRegistry.pledgeItem` / `pledge` (`CollateralRegistry.sol:412-432`) are `OPERATOR_ROLE` with no member signature.
  - Under the 12.5 excess lock (`:247-253`, `:341-365`), an operator-pledged Earn asset becomes encumbered and seizable after a missed cycle.

## INFO

- **I-1. Deployed-proxy upgrade hazard (testnet).**
  - `RevolvingIssuerBase._localAcc` (`:350-355`) reads `localAccAt[tierId] = 0` for tiers created before the upgrade, and `tierSnap` = 0 for old members, so the first touch charges about 56 years of carry.
  - `TermIssuerBase._pendingPlanCarry` (`:433`) has the same problem with `pricing.accruedAt = 0` on legacy plans.
  - Both proxies exist on Base Sepolia (`.openzeppelin/base-sepolia.json`). `AssurancePool` has a "fresh layout" and must not be upgraded in place.
  - Redeploy, or migrate the snapshots first.
- **I-2. Size margin.** Subdivide runtime is 24,574 bytes, a 2-byte margin (production `--force` build). Any edit will break deployment.
- **I-3. Donations break an AssurancePool invariant.** Direct USDC transfers break `sum(compartments) == asset balance`. There is no sweep (by design), so 13b's invariant reads "≤", not "==".
- **I-4. Deed trait names are global.** `DeedNFTMintExtension.setTrait` writes `_traitNames[key]` globally, so any holder can rename the display name of a shared, non-reserved key such as `definition`. Cosmetic.
- **I-5. Removing a coop agent doesn't fully revoke it.** `FunctionalContractRegistry.remove` leaves `kinds` set. `_policyAllows(POLICY_COOP)` (`DeedTrustExtension.sol:91-96`) ignores `active`, so a removed coop agent can still move COOP-policy deeds out.

---

## Size check (production build, `npx hardhat compile --force`, no `KEEP_REVERT_STRINGS`)

Everything is within both limits. The closest:

| Contract | Runtime (bytes) | Creation (bytes) | Runtime headroom (bytes) |
|---|---|---|---|
| Subdivide | 24,574 | 24,711 | **2** |
| MetadataRenderer | 24,493 | | 83 |
| BurnerBond | 24,168 | | 408 |
| DeedNFTMintExtension | 23,804 | | 772 |
| RevolvingIssuer | 23,599 | 24,324 | 977 |
| TermIssuerExtension | 23,595 | | 981 |

## Storage and upgrade checks

- **Main contracts vs their delegatecall modules:** RevolvingIssuer/Extension/Cycles (48 entries), TermIssuer/Extension/Origination (35) and DeedNFT/MintExtension/TrustExtension (45) have identical layouts, compared from build-info. Each main contract uses only immutables for module addresses. Each constructor checks `extensionKind`. Module functions called directly on a module address only touch the module's own empty storage, and their role checks call `address(0).access()`, which reverts.
- **ESADepositVault (live):** compared with `.openzeppelin/base.json`. Slots 353-356 are unchanged. Ten new slots (357-366) come out of the gap, which shrinks 43 → 33. `DepositMandateState` is unchanged. Compatible.
- **ClaimEscrow (live):** slots 251-253 are unchanged. `claimSignerOf` takes slot 254 and the gap shrinks 45 → 44. `TransferRecord` is unchanged. Compatible.
- **RevolvingIssuer gap accounting:** 13 old slots + 24 new = 37, plus gap 11, totals 48, matching the old 13 + 35. OK. The semantic hazard is I-1.

## Original findings I checked and believe are fixed

- **C-1:**
  - transfer recipient policy (`StableCredit._checkTransferPolicy`, `isEligibleRecipient`);
  - redeem eligibility (`PayoutPool.redeem`);
  - term allocation excluded from plain transfers (`_drawableCreditOf` + `lockedAllocationOf`);
  - unplaced draws revert (`RevolvingIssuerDrawUnplaced`).
- **C-2:** `_unitsHeld` takes min(pledged, balance); `backedHeadroomOf` gates savings draws. This depends on configuration: `exposureSource` must be set, and `clrusdKind` must equal the savings tier's kind.
- **H-1:** merchants may only send to the pool, and redeem requires active registration.
- **H-2:** compliant periods roll forward; "limit with no period" is refused.
- **H-3:** accepted token is admin-only and limited to one token.
- **M-1, M-4, M-5, M-6** (seize needs encumbrance plus default or the settlement gate; `setLiquidator` is timelocked), **M-8.**
- **L-1, L-2, L-5, L-6.**
- **X-1 for the member side** (the member's obligation is no longer moved), **X-2, X-3, X-4, X-5, X-6** (directed write-off), **X-7, X-8, X-10, X-11, X-12, X-20.**
- **D-1, D-2, D-3, D-4, D-5, D-7, D-8** (`_everMinted`), **D-9, D-10.**

## Partially fixed or not fixed

- **H-4:** see H-A, H-B, M-E, L-C and L-D.
- **M-2:** see L-C.
- **M-3:** see L-B.
- **X-1:** the new obligation-creation primitive is reachable with arbitrary holders; see H-A.
- **10a/10b/10c compliance:** see H-A, H-B, H-C, M-A and M-C.
