# Phase 2 report: compliance spec

Branch `audit/phase-2-compliance`, stacked on `audit/phase-1` (PR #883, not yet merged into `dev`). Spec: `specs/compliance-changes.md`. Decisions applied: DECISIONS #1, #4, #5, #6, #7 and #10. Progress log and design notes: `PHASE-2-PROGRESS.md`. Upgrade authority: `UPGRADEABILITY.md`.

Nothing was deployed, no key was used, and no live network was touched.

## 1. What changed

| Spec item | Where | What |
|---|---|---|
| 1 RateSchedule | `peripherals/RateSchedule.sol` (new) | Products keyed by `(stateCode, productId)`. Each holds graduated bands (fixed once a product exists), a flat alternative, the large-loan regime (`largeLoanThreshold`, `annualCapBps`, `minTermSeconds`), a list rate, free rules for term products and an enabled flag. RAY-scaled accumulators are checkpointed on every rate change. `effectiveMonthlyBps` = min(list, cap). Setters are `onlyOwner`; the owner is the credit timelock after the handover. Every change emits an event. |
| 2 Principal and carry | both issuers | Every tier position and every plan keeps principal and carry apart. Carry accrues on principal only (acceptance 4). The ledger balance is still principal + carry. Inside a position, a payment clears carry first; across positions the order is unchanged. |
| 3 Per-second accrual | both issuers, RateSchedule | Simple accrual per second at monthly × 12 / 365 days (DECISIONS #1). A position stores accumulator snapshots, so each touch costs O(bands). |
| 4 Revolving | `RevolvingIssuer(Base, Extension)` | Unsecured tiers (INCOME, BOOST) are priced from RateSchedule through `setTierProduct`, which can be set only once. A member ceiling caps all unsecured revolving principal as one loan, trimming the dearest tier first (acceptance 3). Secured tiers keep a local rate accumulator. |
| 5 Term pricing and free rules | `TermIssuer`, `TermIssuerOrigination` (new) | `openPlan` prices on chain. Rate = min(list, cap) − merchant subsidy. The member's signed `ratePerCycle` and `payout` must equal what the chain computes (`TermIssuerTermsMismatch`). Free plans (In-full, under `freeBelowAmount`, or splits ≤ `freeSplitMax` at either the schedule or the merchant level) never accrue, even past due. The schedule is equal principal plus carry on the declining principal (acceptance 5). `PlanOpened` now carries the merchant, principal, split, rate, schedule hash, total carry and disclosure hash. |
| 6 Re-split | `TermIssuerExtension` | Carry is accrued up to the switch at the old terms. A re-split needs the member's EIP-712 `Resplit` signature if the new rate is higher, or if the plan carries a rate and the new split is longer (acceptance 6). |
| 7 Clear Cash | `_quote` | At or above $2,500 the term must be at least 365 days. That means 13 thirty-day cycles (DECISIONS #4), under `annualCapBps` (acceptance 7). |
| 7 MerchantRegistry | `MerchantRegistry.sol` | Discount and subsidy per split, `freeSplitMax`, and `noSurcharge`. Admin-only setters. |
| 8 State gate | `NetworkRegistry.stateCodeOf`, `STATE_ATTESTER_ROLE` | Lines and plans revert without an enabled product for the member's attested state (acceptance 8). |
| 9 / 10a Encumbrance | Phase 1 computed lock, plus `CollateralRegistry` | The CLRUSD collateral kind and its terms (`setClrusdKind`, `setCollateralTerms`, `setCollateralValuer`) are fixed once set, so no admin call can raise a lock indirectly (acceptance 9, 14). |
| 10b Liquidation | `Liquidator.liquidate` | Permissionless once default is computed on chain. Works only for trusted savings issuers. Seizes min(owed, balance, encumbered) (acceptance 13). |
| 10c Pauses | `ClearUSDUpgradeable`, `ESADepositVault` | `FRAUD_ROLE` pauses one account and `SECURITY_ROLE` pauses everyone. Each lapses after 72 hours unless a different signer renews it, and every action is logged (acceptance 15). The vault's admin pause now expires the same way. |
| 10d Token powers | `ClearUSDUpgradeable` | Nothing else can stop a transfer (acceptance 16). `burnFrom` stays, allowance-gated (DECISIONS #5). |
| 10e Upgrade delay | `governance/Timelock.sol`, `deploy/credit_timelock_handover.ts` | An OZ `TimelockController` with a 7-day delay takes every credit and savings upgrade and admin power (acceptance 17; `UPGRADEABILITY.md`). |
| 11 Pilot cap | `ESADepositVault` | Rolling 365-day CA volume in day buckets. CA mints revert past the cap, with an alert threshold first. Redeems are counted but never blocked. A member with no stateCode counts as WY (DECISIONS #6). Storage is append-only (acceptance 12). |
| DECISIONS #7 | RateSchedule `capFor`/`chargesFor`, `cflPrincipalOf` on both issuers | A governed switch, default ON. A member's term principal plus unsecured revolving principal form one loan. Each position is capped at min(its own cap, its pro-rata share of the cap on the aggregate). |

Deploy wiring (none of it run against a network):
- `deploy/25_wire_Compliance.ts` sets up RateSchedule and its products from `deploy/config/rate-schedule.json`, the issuer pricing, the CFL sources, the state attester, liquidator trust and the vault state source. The pilot cap is set only when `PILOT_CAP_USD` is given.
- `deploy/credit_timelock_handover.ts` deploys the 7-day timelock and hands over.
- `test/deploy/Compliance.deploy.spec.ts` runs both on a fresh chain.

## 2. Acceptance tests (`test/audit/compliance/`)

All 17 are implemented and pass. Tests 1, 2 and 5 are recomputed for per-second accrual; the code was not tuned to the old figures. For example, $940 In 4 at 2% now carries about $18.54, $13.91, $9.27 and $4.64.

| # | File |
|---|---|
| 1, 2 | `RateSchedule.spec.ts` (2 also in `Term.spec.ts`) |
| 3, 4, 11 | `Revolving.spec.ts` |
| 5, 6, 7, 8, 10, DECISIONS #7 | `Term.spec.ts` |
| 9, 12, 13, 14, 15, 16, 17 | `Dfal.spec.ts` |

Existing tests changed:
- RevolvingIssuer.spec: `carryOf` now means materialised plus pending carry.
- TermIssuer.spec: the level-payment test was rewritten for the declining schedule, and a 7-unit rounding difference is compared with `closeTo`.
- Liquidator.spec: names the trusted issuer.
- `test/helpers/plans.ts`: takes `productId`.

## 3. Deviations, and section 7 defaults used

1. **No ERC-7579 encumbrance module (spec 10a).** The lock stays computed at the token from drawn credit, as Phase 1 left it. This meets the same requirement: the lock follows the draw within the block and has no admin-settable input. A module would add an installable surface, and that surface is itself an upgrade power.
2. **Legacy mode.** With no RateSchedule set, a term plan keeps the rate the member signed and accrues it simply, with no state rules. The deploy script sets the schedule, so legacy mode exists only for old tests and an issuer mid-upgrade.
3. **Disclosed rate vs. aggregated cap.** A plan discloses min(list, cap on its own principal). Under DECISIONS #7 the charge can then be trimmed further at accrual, so the member pays at most what was disclosed and sometimes less. The aggregate is read at each touch, not continuously.
4. **Initial rate table** (`deploy/config/rate-schedule.json`): CA bands as in the spec, flat alternative 160 bps, threshold $2,500, `annualCapBps` 3,650 (a placeholder for "about 36% + fed funds"), and `freeBelowAmount` 0 because the spec leaves it pending. Every figure is pending counsel.
5. **Section 7 defaults used:** `Liquidator.liquidate` is permissionless with default computed on chain. Term plans are signed by the member over EIP-712, which this phase extends with `productId`, and re-splits get the same treatment.
6. **The pilot cap counts redeems but never blocks them.** Blocking a redemption would be a control power over a member's own funds (10d).

## 4. The "Do NOT change" list

No item on the list was changed:
- **CLRUSD/StableCredit separation:** untouched.
- **Three-party origination mint:** member −purchase, merchant +payout, co-op +discount. It moved into `TermIssuerOrigination` with the same call.
- **PayoutPool and its FIFO order:** untouched.
- **No redemption path touches AssurancePool:** still true; the pilot cap never blocks a redeem.
- **Cheapest-first draw, dearest-first repayment:** unchanged across positions. Clearing carry before principal applies only inside one position.
- **RTD as pool exposure, and the AssurancePool gating:** untouched.
- **A member's set of issuers:** untouched.

**New powers.** The spec requires every new power below. None widens an existing power, none can move a member's funds, and acceptance 14 shows none can raise a drawn amount or a lock:
- RateSchedule owner (the timelock)
- `STATE_ATTESTER_ROLE`
- `FRAUD_ROLE` and `SECURITY_ROLE` (72 hours each, renewable only by a second signer)
- the vault's `setPilotCap` and `setStateSource` (admin)
- MerchantRegistry split terms (admin)
- issuer `setPricing`, `setTierProduct` (set once) and `setRateSchedule` (CREDIT_SETTINGS_ROLE)
- `setCflAggregation` and `setCflSources` (RateSchedule owner)

Some powers narrowed:
- The vault pause now lapses.
- The CLRUSD collateral terms are frozen once set.
- Liquidation no longer needs a role.

## 5. Open questions for the owner and counsel

1. **Who holds `STATE_ATTESTER_ROLE`, and can an attestation change?** A changed state reprices a member's next accrual under that state's product. Options are set-once, member-signed, or a timelocked change.
2. **Every RateSchedule figure** (section 3, item 4), including whether CA's flat alternative applies to these products.
3. **DECISIONS #7 scope.** Should free plans and secured revolving tiers count toward the aggregate? Today free plans count and secured tiers don't.
4. **DECISIONS #6.** An unattested CA resident is counted as WY. The preferred mitigation is to require an attestation before any member mint. That is an app or API change and is not done here.
5. **10f** (below): the Privy dashboard settings can't be seen from the repo.
6. **Operational roles after the handover.** Once the AccessManager admin is the timelock, granting a new operational key takes 7 days. Grant the keys first, or accept the delay.

## 6. 10f: wallet configuration (Privy)

What the code shows:
- **Member wallets.** The API uses Privy only to verify a member's login token (`@privy-io/server-auth`: `middleware/auth.ts`, `memberSource.ts`, `privyPasskeys.ts`). No server-side signer, delegated action or session signer is attached to a member's embedded wallet. The member apps create an embedded EOA (`createOnLogin: 'users-without-wallets'`), and a ZeroDev Kernel account (EIP-7702) sits on top of it.
- **Relayers.** `savingsRelayerService`, `sendRelayerService` and `autopayRunner` submit what the member signed: `depositWithAuthorization`, `redeemWithAuthorization` and `executeMandateDeposit`. The member signs the token, amount, receiver and deadline, or for a mandate the amount per run, interval, number of runs and expiry, which the vault enforces on chain. These match "amounts the member signed for". They move USDC in; CLRUSD leaves a member only through a member-signed `redeemWithAuthorization`.
- **Autopay.** The header comment in `apps/api/src/services/autopayStore.ts` still describes a ZeroDev session key stored on the server. The live code (`apps/member/src/lib/autopay.ts`) uses the on-chain `DepositMandate` instead. The comment should be fixed so nobody reintroduces a session key from it.
- **Merchant wallets (not members).** Clear holds one P-256 authorization key per merchant organization, registered as an additional signer on the merchant's Privy wallet under a policy ceiling (`services/merchant/privySigner.ts`, `clearSignerGrant.ts`, `shopWallet.ts`). That is a server-side signer able to move merchant funds up to the policy. It is out of 10f's member scope, but counsel should know about it if merchants hold CLRUSD.
- **Can't be confirmed from the repo:** the Privy dashboard settings, such as whether server-side or delegated wallet access is enabled for the member app. An operator should confirm both are off.

## 7. Apps (PR #884)

The app and API work for Phases 1 and 2 is in draft PR #884. After this PR merges, its plan-signing module must:
- add `productId` to `PlanTerms`;
- read the new `PlanOpened` fields;
- sign `Resplit` (planId, installments, rateBps, nonce, deadline) for a re-split that costs more;
- show the chain-computed rate and payout, since `openPlan` rejects anything else.

## 8. Numbers

- **Tests:** full Hardhat suite 885 passing, 0 failing (after the `_localAcc` fix). Compliance and deploy specs: 29 of them. `npx turbo run typecheck test --affected`: 32 of 32 tasks passed.
- **Sizes** (production build, EIP-170 limit 24,576):

  | Contract | Size (bytes) |
  |---|---|
  | TermIssuerExtension | 24,202 |
  | TermIssuer | 21,733 |
  | RevolvingIssuer | 20,567 |
  | RevolvingIssuerExtension | 19,044 |
  | TermIssuerOrigination | 16,783 |

  Every contract is under the limit.
- **Storage:**
  - ESADepositVault and ClaimEscrow pass OpenZeppelin's storage upgrade report against every implementation in `.openzeppelin/base.json`.
  - Against `audit/phase-1`, RevolvingIssuer, TermIssuer, NetworkRegistry, MerchantRegistry, CollateralRegistry, Liquidator and LimitCalculator are append-only, with gaps shrunk so each layout ends at the same slot.
  - ClearUSDUpgradeable appends to the end of its ERC-7201 namespaced struct.
  - No credit contract breaks layout, even on Base Sepolia.
- **Slither** (Medium and High only, per contract, run the FIX-PLAN section 6 way, compared with the same run on `audit/phase-1`). No new real finding. One cleanup was applied. Triage of everything new:
  - **`uninitialized-state` (High), every entry: false positive.** In the issuers these are artifacts of the Base/Extension split. Slither analyses a Base or Extension whose setter lives in the sibling contract that shares the storage (for example `rateSchedule` is set in TermIssuer and read in TermIssuerExtension). `RateSchedule.bandsOf` is filled with `push`, which Slither does not count. Every flagged variable has a setter, and a test covers it.
  - **`reentrancy-no-eth` on `_materialiseCarry`, `_resplit` and the moved card functions: false positive.** The external calls are to the ledger (`accrueCarry`, `_accrueCredit` → `_mint`, with no transfer hook and no call out) and to RateSchedule views. `aggregatePrincipalOf` reaches the issuers only through `view` calls, which compile to STATICCALL and cannot re-enter. Phase 1 already triaged the same pattern on `initializeCreditLine`, `normalizeUp` and the card paths. They show as "new" only because they moved into the extension contracts.
  - **`divide-before-multiply` in `RevolvingIssuerBase._localAcc`: fixed.** The per-second rate was truncated before being multiplied by the elapsed time. The error was below 1e-18 relative, but the multiplication now comes first.
  - **`incorrect-equality` (`== 0` on timestamps and indexes) and `uninitialized-local` (locals relying on the zero default): intended, not defects.**
