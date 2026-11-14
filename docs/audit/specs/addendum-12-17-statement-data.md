# 12.17 Statement data

Verbatim from the owner (Nov 14, 2026). The owner's binding decisions are in `addendum-4-decisions.md`, items 16 to 23.

---

12.17 Statement data (MB-04 §6.2; CFL §22458). For every revolving cycle, the contracts emit events or expose views, as at the cycle-end timestamp, from which the servicer can build the statement without off-chain recomputation:
- each position's principal and accrued carry at cycle start and end;
- every draw (time, amount, tier, position);
- every payment or credit (time, amount, positions reduced, carry and principal portions);
- carry accrued per position in the cycle, with the principal-seconds (or average daily principal) it was computed on;
- the Rebalance Amount, Secured Minimum and their total;
- every collateral change (each change in Encumbered CLRUSD; each Earn pledge, release, roll or force-settlement), with time and amount.
Any cycle ending with a nonzero balance in any position is marked statement-required; there is no minimum-balance threshold.
Test 56: a cycle ending with $0.50 of carry and no principal is marked statement-required; a cycle with an Earn release shows that release, with time and amount, in its collateral-change events; every 12.17 value is readable for a closed cycle without off-chain recomputation.
