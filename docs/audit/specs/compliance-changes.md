# Clear Protocol — compliance-driven contract changes (add to the audit fix pass)

Repo: Deed3Labs/Protocol-Contracts, `dev` branch. These are REQUIREMENTS, not suggestions. They come from California lending law (California Financing Law, "CFL") and California's Digital Financial Assets Law ("DFAL"). Apply them alongside the audit fixes, before mainnet. If any item conflicts with an audit finding, stop and list the conflict instead of choosing silently.

Every rate, band, cap and limit below is a GOVERNED PARAMETER (set through governance with a timelock), never a hard-coded constant. The initial values are pending legal counsel and will change.

## Background (why)

- Clear Lending Co. will be the licensed lender of record under the CFL. For consumer loans under $2,500, the CFL caps charges at 2.5%/month on the first $225, 2%/month on $225–$900, 1.5%/month on $900–$1,650 and 1%/month above $1,650. Charges must be computed on UNPAID PRINCIPAL only. Loans of $2,500 to under $10,000 are capped at an annual rate (about 36% + the federal funds rate) and need a scheduled term of at least 12 months.
- Current pricing breaks this: Clear Boost at 3%/cycle, Clear Cash at 2.5%/cycle on six cycles, and partner credit at 2% above $1,125.
- Carry currently accrues INTO the negative balance. If later carry is computed on that total, it is interest on interest, which is not allowed.
- DFAL defines "control" as the power to execute unilaterally, or prevent indefinitely, a digital asset transaction. The one carve-out is stopping transactions solely in response to unauthorized or fraudulent activity. Clear's power over member CLRUSD must stay inside that carve-out wherever possible.

## Do NOT change

CLRUSD vs StableCredit separation · the three-party origination mint (member −amount, merchant +payout, co-op +discount) · PayoutPool and its FIFO order · the invariant that no redemption path touches AssurancePool · cheapest-first draw and most-expensive-first repayment · RTD as pool exposure · the Phase 0 AssurancePool role-gating fixes · a member mapping to a SET of issuers. Do not widen any admin power.

## Required changes

### 1. RateSchedule (new contract, or a module of NetworkRegistry)
- Keyed by `(stateCode, productId)`.
- Holds:
  - graduated bands as `(upperBound, monthlyRateBps)`; initial CA small-loan table: 225 → 250 bps, 900 → 200 bps, 1650 → 150 bps, ∞ → 100 bps
  - an optional flat monthly alternative (CA: 160 bps)
  - a large-loan regime: an `annualCapBps` param for principal ≥ $2,500, plus `minTermSeconds = 365 days` for that regime
  - `productListRateBps` (the price Clear wants to charge)
  - an enabled flag per state
- `effectiveRate(principal, ...)` = min(list rate, legal cap for that principal).
- Changes go through governance plus a timelock, and emit events.

### 2. Separate principal from carry in every position
- Every revolving-tier position and every term plan stores `principal` and `accruedCarry` as separate fields.
- Carry accrues ONLY on `principal`, never on `accruedCarry`.
- The member's derived negative balance is still the sum of both, so the UI is unchanged.
- Repayment order: across positions, most-expensive-first (unchanged). Within a position, apply payment to carry first, then principal. Flag this rule as pending counsel.

### 3. Continuous accrual that never exceeds a monthly cap
- Cycles are 30 days and caps are per month. Accrue per second at `annualRate = monthlyRate × 12`, divided by 365 days.
- 30 days of accrual must never exceed the monthly cap.
- Keep lazy accrual: an index per rate band. A position stores one index snapshot per band it touches.
- Carry between touches = Σ over bands of (principal portion in that band × index delta).
- Principal is constant between touches, so this stays O(bands), not O(accounts).

### 4. Revolving tiers (RevolvingIssuer)
- Unsecured tiers (income-backed, Clear Boost) price at `effectiveRate` from the RateSchedule.
- Add a MEMBER-LEVEL CHARGE CEILING:
  - Treat all of a member's unsecured revolving principal as ONE loan.
  - Each accrual, total carry across those tiers must be ≤ the graduated schedule applied to the total unsecured revolving principal.
  - If it is over, trim carry from the most expensive tier first.
- Savings-backed (0%) and asset-backed tiers are unchanged but still use the principal/carry split.

### 5. Term plans (TermIssuer) — partner credit pricing with "free" rules
- `openPlan(member, merchant, amount, split)` reads RateSchedule and MerchantRegistry.
- A plan is FREE (rate 0, permanently) if ANY free rule matches. Every free rule is a governed parameter:
  - `freeInFull` (default true): a single-cycle "In full" plan is free.
  - `freeBelowAmount` (default [● pending]): a plan whose principal is under this amount is free on any split.
  - `freeSplitMax` (default 0, meaning off): plans with this many splits or fewer are free.
  - Merchant subsidy: if the merchant's `subsidyBpsBySplit` covers the full rate, the plan is free.
- A free plan NEVER accrues carry, not even when past due. Delinquency is handled by limit freezes and collections states, never by charges. This keeps those plans free of any finance charge.
- Otherwise the plan carries: rate = min(product list rate, legal cap on that plan's principal) − merchant subsidy, accrued on the declining unpaid principal.
- Note: at a 2% list rate the cap never binds below $1,125, because the first $225 is capped at 2.5%. Above that, the cap trims automatically.
- The origination mint is unchanged. The discount amount comes from MerchantRegistry by split length.
- Emit `PlanOpened(planId, member, merchant, principal, split, rateBps, scheduleHash, totalCarry, disclosureHash)` so loan disclosures can be reproduced later.

### 6. Re-split
- `resplit(planId, newSplit)`: accrue to now, then set the new rate going forward only, then recompute the schedule on remaining principal.
- No carry is ever applied to the period before the switch.
- A re-split that turns a free plan into a charged plan creates new finance-charge terms, so it requires the member's EIP-712 signature over the new terms. A re-split that lowers the cost needs no signature.

### 7. Clear Cash (TermIssuer product)
- Principal ≥ $2,500: term must be ≥ 365 days (12 thirty-day cycles is only 360 days, so it must be at least 13 cycles, or the schedule must be calendar-based). Rate ≤ `annualCapBps`.
- Principal < $2,500: priced on the graduated schedule.
- Optional: at most one open Clear Cash plan per member.

### 8. MerchantRegistry additions
- `discountBpsBySplit[split]`
- `subsidyBpsBySplit[split]` (the merchant pays extra to make longer splits cheaper or free)
- `freeSplitMax`
- `noSurcharge` flag (informational; the contract terms enforce it)
- Refund clawback on a refund of `r` against a plan:
  1. Reduce member principal by `r`.
  2. Reduce the merchant's positive balance by its share.
  3. Reverse the co-op's discount pro rata.
  4. If the merchant has already redeemed, the merchant goes negative and is netted against future payouts (the existing drawdown rule).

### 9. NetworkRegistry: member jurisdiction
- Each member's `stateCode` is set by attestation from the trusted signer.
- Issuers revert if a product isn't enabled for that state.
- RateSchedule is read using the member's state.

### 10. DFAL "control" — Clear must not be able to move or block member CLRUSD except by fixed rules
Goal: no Clear key can execute a member's CLRUSD transaction or block one indefinitely, except (a) the pledge lock, which is computed from on-chain state and lifts on its own, (b) liquidation on objective default, and (c) a fraud or security pause. Check every contract and configuration below, not only the module.

**10a. Pledge lock (ERC-7579 module)**
- The lock is COMPUTED from on-chain state: withdrawable CLRUSD = ESA − savings-backed drawn. It lifts automatically in the same block the draw reaches zero.
- No owner or admin function can set, extend or hold a lock.
- The "drawn" figure may only change through member-signed actions (draws, approved charges) and repayments. No admin or attestation-signer write can increase a member's drawn amount, because that would be an indirect lock.

**10b. Liquidation**
- Default is COMPUTED, never declared: cycle end timestamp passed + equilibrium not met (an on-chain fact) + grace period elapsed. No role can mark a member as defaulted.
- Off-chain attestations (income estimates) must not be inputs to the liquidation trigger.
- The trigger is permissionless: anyone can call it once conditions hold, and it reverts otherwise.
- Amount ≤ min(encumbered collateral, debt). Proceeds go only to the debt burn.

**10c. Fraud and security pause**
- A per-account `FRAUD_ROLE` pause, with a reason code and events. It cannot move funds, and cannot be used for credit or collections.
- Any global emergency pause is limited to security incidents (exploits, i.e. unauthorized activity).
- Every pause expires automatically after a governed window (default 72 hours) unless renewed by a second, separate signer (two-person rule). Each renewal is logged with a reason.
- No other path can freeze a member's CLRUSD.

**10d. Token-level admin powers**
- Audit CLRUSD and StableCredit for `pause`, `blacklist`, `freeze`, `forceTransfer`, `burnFrom` or similar admin functions. Remove them, or restrict them to 10b and 10c with the same limits.
- CLRUSD transfers between members must not be blockable by any other admin path.

**10e. Upgradeability**
- An upgradeable proxy whose admin can swap the module, issuer or token logic is itself a power to block transactions. Either make the encumbrance module and CLRUSD non-upgradeable, or put every upgrade behind a timelock (at least 7 days) so a member can withdraw their unencumbered CLRUSD before it takes effect.
- Document which contracts are upgradeable, and who holds the admin keys.

**10f. Wallet configuration (off-chain, but in scope)**
- Confirm the Privy setup gives Clear's servers NO delegated or server-side signer able to move CLRUSD from member smart accounts.
- Any session keys must be scoped to actions that move no funds, or to amounts the member signed for.
- Report what the current configuration allows.

**Not fixable in code:** CLRUSD redemption to USDC by Clear is "digital financial asset administration" whatever the custody design. It stays a licensing question for counsel, apart from the pilot cap in item 11.

### 11. Pilot volume cap (DFAL small-volume exemption, temporary)
- ESADepositVault keeps a rolling 365-day counter of USD value minted and redeemed for members whose `stateCode` is CA.
- New CA mints revert once a governed cap is reached (initially $50,000, with a margin below it as an alert threshold). Emit events at the alert threshold.
- Designed to be switched off later by governance.

## Acceptance tests (add to the suite)

1. Graduated cap: on $500 the monthly cap is $11.125. Boost at a list rate of 3% accrues ≤ $11.125 per 30 days (with per-second accrual, about $10.97).
2. Partner credit at a 2% list rate on $940 is under the cap ($18.80 vs $19.725) and charges the list rate. At $1,500 the cap is $28.125, so 2% ($30.00) is trimmed to the cap. Breakeven is $1,125.
3. Member ceiling: Boost $500 at 3% plus income-backed $1,000 at 1.5% gives a list total of $30.00 on $1,500 of unsecured revolving principal. The ceiling is $28.125, and the trim comes out of Boost first.
4. No interest on interest: leave a position untouched for 3 cycles. Carry for cycles 2 and 3 is computed on principal only.
5. Charged split: $940 In 4 at 2% carries $18.80, $14.10, $9.40, $4.70 = $47.00. Each cycle is ≤ the cap on the remaining principal ($19.725, $15.225, $10.525, $5.825). Free plans: an In-full plan, and any plan under `freeBelowAmount`, accrue $0.00 forever, including 60 days past due.
6. Re-split: after 1 cycle, In 4 → In 12 on the remaining $705.00. Zero carry before the switch timestamp. The call reverts without the member's signature.
7. Clear Cash: $3,000 over 12 × 30-day cycles reverts. $3,000 over ≥ 365 days at 2.5%/30d (about 30.4% APR) succeeds while `annualCapBps` ≥ that rate.
8. State gate: a member with no `stateCode`, or a disabled state, cannot open any credit product.
9. Encumbrance: the lock releases in the same block that the savings-backed draw reaches 0. No admin call can re-lock it. Liquidation reverts unless default is recorded. `FRAUD_ROLE` cannot transfer funds.
10. Refund: a full refund of a plan whose merchant has already redeemed leaves the merchant net negative by the payout. The next payout nets that balance first.
11. Phase 0 invariant kept: with only savings-backed credit live, reserves needed = exactly 0.
12. Pilot cap: CA mint volume above the cap reverts. Non-CA mints are unaffected.
13. No declared default: no role can set default status. The liquidation trigger succeeds for a random caller once conditions hold, and reverts one second before grace ends.
14. No indirect lock: every admin and attestation-signer function is called with a member's address; none raises that member's drawn amount or lock.
15. Pause expiry: a fraud pause lifts automatically at 72 hours. A renewal by the same signer that set the pause reverts; a renewal by a second signer succeeds and is logged.
16. Token powers: no address can pause, freeze or blacklist member-to-member CLRUSD transfers outside 10c (test every role).
17. Upgrade delay: an upgrade to the module or CLRUSD can't take effect before the timelock ends, and a member's unencumbered withdrawal succeeds during the delay.

## Return

A list of the changes made, files touched, any conflicts with audit findings, and anything you think is ambiguous in this spec.
