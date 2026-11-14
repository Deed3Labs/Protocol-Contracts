# Addendum 3 (ELPA contributions) and Earn Addendum 2 (Pool Shares as debt, Loss Holdback, exemption tag, Equity Cushion pause)

Verbatim from the owner, Nov 14, 2026 (research memos R-07, R-08, R-09).

---

ADDENDUM 3 — ELPA contributions (research memo R-09, Nov 14, 2026). REQUIREMENT.

§12 (new first bullet)
- ELPA Equity Contributions (MB-13) are never a debt. No contract, position, collections state, event or app view may record, accrue, flag or show a missed, reduced or paused Equity Contribution as due, past due or delinquent, trigger any reminder or dunning about it, or use it in any credit decision, limit or report (MB-13 §6.3(d); L-02 §9.9).

---

EARN ADDENDUM 2 — Pool Shares as debt, Loss Holdback, exemption tag, Equity Cushion pause (research memos R-07 and R-08; founder decisions, Nov 14, 2026). REQUIREMENTS; list conflicts rather than choosing. Keep the queue, suspension, ERC-4626 shell and pledging as built.

BACKGROUND
- The token contracts are the issuer's register for securities sold in separate Earn offerings under Rule 506(c), Rule 506(b) and, once a California permit issues, Rule 147A. The exemption for each sale is recorded off-chain by the app's eligibility step; the only on-chain trace is the tag in §6.
- Pool Shares are limited-recourse subordinated demand notes. Share Value = principal + accrued interest − realized loss write-downs. An expected-loss allowance never lowers it; instead it sets a Loss Holdback on redemptions.

§1 mint (changed sentence)
- Reject a purchase that would exceed the Funding Limit or offeringCap (initial $1,000,000), or that is made during a Reserve Shortfall, while the Equity Cushion pause is set (rolls excepted in both cases), or while an Enforcement Notice is in effect.

§6 (changed bullets)
- Deposits only from eligible Smart Accounts using Ready to allocate USDC; reject the Clear-contract sources in §1.
- The existing eligibility attestation gains one field, exemptionCode (e.g. 506C, 506B, 147A), set off-chain. The vault stores it with the subscription and emits it in the subscription event. No contract logic reads or branches on it.
- Minimum $250 (FIXED floor); holder cap 10% of shares.
- Subscriptions pause during a Reserve Shortfall, while the Equity Cushion pause is set (two-person set and clear, like the Reserve Shortfall pause) or during a Suspension. No pause ever affects withdrawals.
- Share Value = Pool Assets ÷ shares, where Pool Assets = Vault Cash + Deployed Balance + accrued Pool Interest. The Pool Loss Allowance is NOT subtracted, and Vault Cash excludes Holdback Amounts.
- Expose shareValue() (replaces navPerShare()), holdbackBps(), vaultCash(), deployedBalance(), utilization(), fundingRate(), total and per-Holder holdbacks, queue state and suspension state.
- convertToAssets uses Share Value; previewRedeem, previewWithdraw, maxWithdraw and maxRedeem are net of the Loss Holdback.
- postAllowance(value, evidenceHash) and postLossCharge(value, evidenceHash): proposed by one authorized individual, approved by a different one; 0 ≤ allowance ≤ Pool Assets; timestamped.
- postAllowance changes ONLY holdbackBps (allowance ÷ Pool Assets, rounded up), never Share Value.
- A loss charge is applied first to open holdbacks (§6A). Only the remainder reduces Deployed Balance, and only the part above Deployed Balance + accrued interest leaves the vault, to Clear Lending.
- The error-correction path pays INTO the vault only. No sweep, rescue or other admin transfer.

§6A Loss Holdback (NEW)
- Record: while holdbackBps > 0, every redemption (on demand, redeemOrQueue, queue fill, MB-05 enforcement, Successor path, Final Maturity run-off) burns shares at Share Value (gross G), pays G × (1 − holdbackBps) (rounded down) to the Holder's Smart Account, and records {G, H = G − paid, open} for that Holder. H stays in the vault, is never deployed, earns nothing, and is excluded from Vault Cash, Pool Assets and Utilization. Liquidity checks use the full G.
- Release: when postAllowance lowers holdbackBps, each open holdback falls to min(H, G × new bps) (rounded up), and the excess is paid to that Holder's Smart Account. Processing is permissionless, batched in creation order (releaseHoldbacks(maxCount)). No new posting can be made, and postLossCharge reverts, until releases from the previous lower posting are processed. At holdbackBps = 0 everything is released. A higher posting never raises an existing H.
- Maximum age: an open holdback not applied to a loss charge posted within holdbackMaxAge (governed; initial 540 days) of its creation is released in full to the Holder's Smart Account. Processing is permissionless and batched in creation order (the same releaseHoldbacks(maxCount)). Lowering holdbackMaxAge applies to existing holdbacks; raising it never does. A loss charge posted before a holdback's age limit still applies to it under the Application rule.
- Application: on postLossCharge(L), each open holdback absorbs min(H, G × L ÷ (Pool Assets before the charge + Σ G of open holdbacks)) (rounded up). Absorbed amounts move into Vault Cash; only L − Σ absorbed reduces Deployed Balance. Processing is permissionless and batched (applyHoldbacks(maxCount)). Until the last batch completes, the charge is pending: redemptions, fills and subscriptions revert, while cancellations still work. A Holder never loses more than its H.
- No role can choose, raise, redirect or release a holdback except by these formulas. Releases go only to the Holder's registered Smart Account (or the Successor path). No new admin power. Emit HoldbackRecorded(holder, id, gross, held), HoldbackReleased(id, amount), HoldbackApplied(id, amount, lossChargeId).
- Pledged shares: the pledge module values them at previewRedeem(shares). A holdback from an MB-05 enforcement redemption is released or applied like any other, to the Holder's Smart Account, and is never re-applied to debt.

§7 Queue (changed): fill price = Share Value at fill, less the Loss Holdback then applying. Everything else unchanged.
§8 Suspension (changed): on end, any pending allowance or loss-charge posting, and its holdback processing, precedes the first fill.
§9 Pledge (changed): pool shares are valued by previewRedeem(shares).
§10 Events (changed): events must suffice to rebuild the Register, queue, Share Value history, holdback ledger and collateral report.

TESTS (changed)
13. Queue: A then B; B cannot fill before A. A loss charge lowers Share Value 2% between request and fill, and A fills at the new value. A cancels half before fill and gets the rest. maxRedeem = 0 while the queue is open. With holdbackBps = 150 at fill, A receives 98.5% of its gross fill and a 1.5% holdback is recorded to A.
15. postAllowance above Pool Assets reverts; a single-signer posting reverts. A valid postAllowance leaves shareValue() unchanged to the wei and sets holdbackBps. A loss charge is applied to open holdbacks first, and only the remainder above Deployed Balance + accrued interest leaves the vault.

TESTS (new)
20. Worked example: Pool Assets $100,000, Share Value $1.04, allowance $1,500 → holdbackBps 150.
- Redeeming 10,000 shares pays $10,244 and records {G $10,400, H $156}, excluded from Vault Cash, Pool Assets and Utilization.
- holdbackBps 50 → releaseHoldbacks pays $104 to the Holder (H $52).
- postLossCharge($900) with Pool Assets $89,600 and this as the only open holdback: applies $52 (ratable $93.60, capped), adds $52 to Vault Cash and reduces Deployed Balance by $848.
- Rounding never favors the leaver.
21. Holdback invariants:
- No function pays a holdback anywhere but the Holder's Smart Account (or the Successor path), raises an existing H, or applies more than the formula.
- A higher allowance leaves every H unchanged.
- At holdbackBps = 0, previewRedeem = shares × shareValue() and every holdback is releasable.
- postLossCharge reverts while earlier releases are unprocessed.
- Redemptions, fills and subscriptions revert while a loss charge has unapplied holdbacks; cancellations succeed.
22. With no loss charge, shareValue() rises monotonically as interest accrues, whatever the allowance. A subscription while holdbackBps > 0 mints at shareValue() with nothing deducted.
23. With holdbackBps = 150, the pledge module values 1,000 pledged shares at 98.5% of 1,000 × shareValue(). An MB-05 enforcement redemption records a holdback to the pledgor, and its release goes only to the pledgor's Smart Account.
24. A subscription stores and emits its exemptionCode, and changing the tag changes no other outcome. While the Equity Cushion pause is set, subscriptions and new BurnerBond purchases revert, while rolls and withdrawals succeed. A single-signer set or clear reverts.
25. Holdback age: with holdbackMaxAge = 540 days and holdbackBps unchanged at 150, a holdback created on day 0 cannot be released before day 540, and is releasable in full by any caller from day 540, paid only to the Holder's Smart Account. A loss charge posted on day 539 applies to it under 6A. Raising holdbackMaxAge to 720 on day 500 leaves its release date at day 540.
