# 12.18 Workout states

Verbatim from the owner (Nov 14, 2026). The conflict list and the owner's answers will be recorded in `addendum-4-decisions.md` once decided.

---

12.18 Workout states (MB-04 §8.11; L-02 §9.5). Separate from Assurance (12.13). Set only by two-person attestation recording a workoutRef hash, at most once per member per rolling 365 days unless a separately attested second approval is recorded. A workout can only reduce or delay what is due; it never causes a miss, default or liquidation.
- DEFERRAL (≤2 consecutive cycles): Rebalance Amount is zero and no carry accrues on the member's unsecured positions; secured carry and the Secured Minimum are unchanged.
- REDUCED (≤3 consecutive cycles): the Rebalance Amount is the attested reduced amount (never more than normal); paying it is not a miss.
- PLAN (≤12 cycles): unsecured revolving balances (income-backed and Boost, principal plus accrued carry) move into one fixed 0% term plan with equal cycle payments; the revolving unsecured positions go to zero. It follows the term-plan default rules (12.14) except that it carries no rate.
- While any workout state is set, new unsecured draws revert.
- Re-age: after 3 consecutive cycles paying what the workout requires, the consecutive-miss count resets to zero; at most once per rolling 365 days and twice per rolling 5 years, computed on-chain.

Test 57. A single-signer workout attestation reverts; a second workout within 365 days reverts without the separate approval. DEFERRAL: no unsecured carry for 2 cycles and no miss; a third DEFERRAL cycle reverts. REDUCED $40 against a normal $120: paying $40 records no miss. PLAN: $900 principal + $12 carry becomes a 0% plan of 12 × $76, and the revolving unsecured positions go to zero. Any unsecured draw during a workout reverts. After 3 qualifying payments the miss count resets; a second re-age within 365 days does not occur.
