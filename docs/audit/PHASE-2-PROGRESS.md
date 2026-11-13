# Phase 2 progress: compliance spec

Branch `audit/phase-2-compliance`, cut from `audit/phase-1` (PR #883, not yet merged into `dev`). Spec: `docs/audit/specs/compliance-changes.md`. Decisions: `docs/audit/DECISIONS.md` #1, #4, #6, #7, #10.

## Steps (FIX-PLAN section 4, Phase 2)

- [x] 1. RateSchedule (governed; owner is the credit timelock)
- [ ] 2. Principal/carry split and per-band indexes in both issuers (revolving done; term next)
- [x] 3. Member-level ceiling (revolving)
- [ ] 4. Term-plan free rules; `PlanOpened` disclosure event
- [ ] 5. Re-split with EIP-712 signature when the cost rises
- [ ] 6. Clear Cash, including the 13-cycle option (DECISIONS #4)
- [ ] 7. MerchantRegistry additions (discount/subsidy by split, freeSplitMax, noSurcharge)
- [ ] 8. State gate (stateCode by attestation in NetworkRegistry)
- [ ] 9. DFAL 10a–10e (computed lock, permissionless liquidation, fraud/security pause with 72h expiry and two-person renewal, token powers, 7-day upgrade timelocks)
- [ ] 10. ESADepositVault pilot cap (storage-safe; no stateCode counts as WY, DECISIONS #6)
- [ ] Acceptance tests 1–17 (`test/audit/compliance/`), figures recomputed for per-second accrual (DECISIONS #1)
- [ ] PHASE-2-REPORT.md, UPGRADEABILITY.md, PR

## Design (so a resumed session does not re-derive it)

**Accrual.** Simple interest on principal only, per second, at `monthlyBps × 12 / 365 days`. No compounding: carry is never charged on carry. Rates change only going forward, so every rate has a cumulative accumulator `I(t) = ∫ ratePerSecond dt` (RAY-scaled), checkpointed whenever its rate changes. A position stores snapshots of the accumulators it uses and its principal, which is constant between touches. Carry for a touch = principal × (I(now) − snapshot).

**Legal cap.** For principal P over an interval, the cap is computed from RateSchedule's band accumulators:
- Graduated: the sum over bands of (the part of P in that band) × ΔI_band.
- If a flat alternative is enabled: max(graduated, P × ΔI_flat).
- If P ≥ largeLoanThreshold: P × ΔI_annual (the large-loan regime).

Carry = min(list carry, cap). Band upper bounds are fixed per product key; changing them means a new product id, so band snapshots keep their meaning.

**RateSchedule.** Keyed by `(stateCode, productId)` (bytes32 each). Holds: enabled flag, list rate, bands, flat alternative, largeLoanThreshold, annualCapBps, minTermSeconds, and the free rules for term products (freeInFull, freeBelowAmount, freeSplitMax). Setters are `onlyOwner`; deploy hands the owner to the credit TimelockController (7 days, Ops Safe as proposer, DECISIONS #10). It emits events.

**Revolving.**
- Per member and tier: `principal` and `carry`, kept separately.
- Secured tiers accrue at a tier-local rate accumulator.
- Unsecured tiers (INCOME, BOOST) take their list rate from RateSchedule for the member's state and the tier's product id.
- Member ceiling: the total unsecured principal is one loan. Its graduated cap over the interval bounds the unsecured tiers' list carry together; any excess is trimmed from the dearest tier first.
- Carry is still materialised onto the ledger at each touch, so the member's balance stays principal + carry.
- Repayment inside a tier clears carry first, then principal; across positions the order is still dearest-first.

**Term.**
- Per plan: `principal` and `carry`, kept separately, with accumulator snapshots.
- Rate = min(list, cap on the plan's principal) − merchant subsidy for the split; a plan is free if any free rule matches.
- A free plan never accrues, even past due.
- The schedule is equal principal installments plus carry on the declining principal. Test 5's shape: carry is $18.54, $13.91, $9.27, $4.64 under DECISIONS #1.
- `PlanTerms` stays the struct the member signs. `ratePerCycle` must equal the computed effective rate and `payout` must equal the registry-derived payout, so the signature covers what was disclosed.
- Clear Cash (product CASH): at ≥ $2,500 it needs ≥ 365 days, which means 13 thirty-day cycles (DECISIONS #4), and the annual cap applies.

**DFAL.**
- The lock stays computed at the token from drawn credit (Phase 1). This deviates from the spec's ERC-7579 module.
- The CLRUSD kind's collateral terms are frozen once set, so no admin can raise a lock indirectly.
- `Liquidator.liquidate` is permissionless, takes min(encumbered, debt), and works only for trusted issuers.
- `FRAUD_ROLE` per-account pause and a security-only global pause on CLRUSD, each expiring after 72 hours unless a different signer renews it.
- Upgrades go behind the 7-day TimelockController (deploy wiring plus a test).

**Pilot cap.** On ESADepositVault, append-only storage:
- a rolling 365-day volume of CA mints and redeems in day buckets;
- CA mints revert past the cap, with an event at the alert threshold;
- redeems are counted but never blocked;
- state codes are read from NetworkRegistry.
