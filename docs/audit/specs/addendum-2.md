# Addendum 2: calendar cycles, secured minimum, Automatic Clearing set-up, revolving default notice, Combined Ceiling, origination fee leg; and the Earn addendum (pledged bonds)

Verbatim from the owner (research memos R-04 to R-06 and founder decisions, Nov 14, 2026). The legal sections the spec cites are in `addendum-2-references.md`, also verbatim. The founder's answers to the conflict list are at the end, and they control where they differ from the text.

---

ADDENDUM 2 — Calendar cycles, secured minimum, Automatic Clearing set-up, revolving default notice, Combined Ceiling, origination fee leg (research memos R-04 to R-06 and founder decisions, Nov 14, 2026). Treat each item as a REQUIREMENT; stop and list conflicts with earlier sections or audit findings rather than choosing silently. Every figure is a governed parameter unless marked FIXED.

§3 Accrual (replace the cycle bullets)
- Revolving cycles are calendar months ending on the member's Cycle End Day (12.1); term-plan cycles stay 30 days. Caps are per month. Accrue per second at annualRate = monthlyRate × 12, divided by 365 days.
- No day may accrue more than 1/30 of the monthly cap, and any 30 days must never exceed the monthly cap.
- The Combined Ceiling in 12.3 is permanently on (not a switch).
(Clarified: see `addendum-2-references.md`, "Spec §3 (term-plan clarification, decision C)".)

10b Liquidation (replace the first two bullets)
- Default is COMPUTED, never declared: cycle end passed + equilibrium not met + a cure-notice timestamp recorded under 12.5 + grace period elapsed. Secured term plans follow 12.14. No role can mark a member as defaulted. FAIL CLOSED: with no recorded cure-notice timestamp, the trigger reverts.
- Off-chain attestations are never liquidation inputs, except two-person attestations that can only delay or prevent default: the 12.13 Assurance flags and the cure-notice timestamps in 12.5 and 12.14. A timestamp can never be backdated and can be recorded only while the payment it concerns is unpaid.

12.1 Cycles and timing (replaces 12.1; "line-open + n × 2,592,000 s" is withdrawn)
- Each member has cycleEndDay (1–28), chosen at line opening; if none is chosen, the day before the opening day, or 28 if that would be the 29th–31st.
- Each cycle ends at 23:59:59 Pacific on the Cycle End Day, computed on-chain from cycleEndDay with a calendar date-time library and the US Pacific offset (UTC−7 from the second Sunday in March to the first Sunday in November, otherwise UTC−8). No role can write or move a cycle end.
- The first cycle ends on the first Cycle End Day at least 14 days after line opening.
- The member may change cycleEndDay by signature at most once per rolling 365 days; the running cycle then ends on the first new Cycle End Day on or after its existing end (no due point ever moves earlier).
- Rebalance Amount = unsecured revolving balance (income-backed + Boost) at cycle close.
- Secured Minimum = asset-backed carry accrued in the cycle, plus, if no unsecured principal is outstanding at close, securedMinimumBps (initial 100 = 1%) of savings-backed + asset-backed principal, at least $1 (or the secured principal if less). Raising securedMinimumBps applies only to cycles closing ≥ 45 days after the change.
- Both are due at the next cycle end (Payment Due Date, same day every month). Equilibrium and 12.5 are measured on the Rebalance Amount only.
- A missed Secured Minimum is never a miss: no halving, no settlement, no default. Its only effect is a computed securedDrawPause: new savings-backed and asset-backed draws revert until payments since close reach Rebalance Amount + Secured Minimum, clearing in the same transaction. No role can set it.
- hybridMode (default false) now only stops Automatic Clearing and limits Autopay to the Payment Due Date; it no longer changes cycles.
- Term plans (MB-06) keep 30-day cycles.

12.2 Automatic Clearing (amend)
- The authorization runs to the Bank, Clear Financial and Clear Lending, under Reg Z §1026.12(d)(3)(i) and Reg E §1005.10(b). It does not depend on the overdraft-line exclusion; only hybridMode switches it off.
- autoClear is set at line opening from the member's choice on a separate "Automatic clearing" screen, shown ON. "Approve automatic clearing" signs the authorization, sets autoClear true and records autoClearAuthHash (hash of the approved text; a copy goes to the member). "Turn off" leaves it false. The onboarding line is notice only and sets nothing.
- clearingLevel UNSECURED and DUE_ONLY also clear any unpaid Secured Minimum.
- The excluded-payer list is pre-populated with federal benefit payers (Social Security, SSI, VA and other U.S. Treasury benefit ACH originators); the member may remove them by signature. Never sweep excluded payers.
- Ledger order (off-chain): each deposit posts to Spendable first; the clearing is a separate debit after posting and before availability.

12.3 Combined Ceiling (add)
- Total carry on the unsecured revolving tiers plus every unsecured term plan whose principal at opening was under $2,500 never exceeds the graduated schedule on their combined principal (1% a month on every dollar above $1,650).
- Trim any excess from the newest plan first, then earlier plans, then the revolving tiers (Boost first).
- Clear Cash plans of $2,500 or more are excluded. FIXED: no switch, and no role can disable it.

12.5 Missed cycle and default (replace the default rule)
- Revolving default requires: two consecutive misses + a cure-notice timestamp recorded for the second miss + the grace period elapsed with the second Rebalance Amount unpaid.
- Grace ends at the later of 15 days after the second due point and 10 full days (864,000 s) after the recorded timestamp.
- The timestamp is recorded by two-person attestation, as in 12.14: one proposes, a different signer approves, recorded time = approval block time. It can be recorded only while that amount is unpaid; paying that amount cancels it. No timestamp, no default.
- A missed Secured Minimum is never a miss.

12.12 Permissions (amend)
- The Automatic Clearing authorization is given on its own screen at line opening, revocable any time and listed on the Permissions page. The onboarding line is never listed among required permissions.

12.13 Assurance (amend)
- incomePause records a hardship forbearance Clear Lending grants at the member's request on documented income loss.
- While incomePause is above zero, the Secured Minimum is also zero and no securedDrawPause arises.

12.16 Origination fee leg (new)
- The origination mint is unchanged except its third leg. The fee leg credits feeRecipient, a governed address held for Clear Lending Co. (its own multisig, or an account Clear Financial holds as its agent), never a Clear Collective address. Changing feeRecipient is a two-person governed action with a reason code and event.
- fee = min(discountBpsBySplit[split] × amount, cap): cap = maxFeeUsdSmall (initial $50) when amount ≤ $2,500, maxFeeUsdLarge (initial $75) above. One fee per Financed Charge; never charged to the member. Merchant payout = amount − fee.
- Refunds and reversals reverse the fee pro rata from feeRecipient. The co-op receives nothing in the mint. The Program Fee Clear Lending pays Clear Financial is off-chain bookkeeping, not a contract function.

Amended tests
1. Boost at a 2.5% list rate (was 3%) accrues ≤ $11.125 per 30 days on $500.
3. Same example at a 2.5% list rate; a calendar cycle of d days accrues 12 × d / 365 of each monthly figure.
18. UNSECURED clears Boost, then income-backed, then any unpaid Secured Minimum, and stops.
25. Any 30 days accrue ≤ the monthly cap and no day > 1/30 of it, on every position; autoClear never moves Ready to allocate USDC or CLRUSD.
28. DUE_ONLY clears exactly the unpaid Rebalance Amount plus any unpaid Secured Minimum.

New tests
39. Calendar cycles. Line opened 2027-01-10 10:00 Pacific with cycleEndDay 15: first end 2027-02-15 23:59:59 PST (Jan 15 is under 14 days away), then 2027-03-15 23:59:59 PDT, and the 15th thereafter for 24 cycles. With no day chosen: opened on the 20th → 19; opened on the 1st or 31st → 28. No role can write or move a cycle end.
40. Cycle End Day change. Running cycle ends Feb 15; a member-signed change on Feb 2 to day 5 ends it Mar 5, never Feb 5. A second change within 365 days reverts; a change without the member's signature reverts.
41. Calendar accrual. Boost $500: a 31-day cycle accrues ≈ $11.34, a 28-day cycle ≈ $10.24; no day accrues more than $11.125 / 30.
42. Secured Minimum. Savings-backed $3,000 only, no unsecured principal: $30.00. Bonds $1,000 at 0.65%, 30-day cycle: $6.41 + $10.00 = $16.41; with unsecured principal outstanding, $6.41. If unpaid: no miss, limit unchanged, nothing settles, no default; secured draws revert while unsecured draws succeed; the payment reaching Rebalance Amount + Secured Minimum clears the pause in the same transaction. No role can set the pause. With incomePause > 0, no pause.
43. Combined Ceiling. Two $1,000 plans at 2%, no revolving balance: monthly carry limited to $33.875 (newer plan $13.875, older $20.00). Income-backed $1,000 at 1.5% + a $940 plan at 2%: total $33.275, $0.525 trimmed from the plan. A $3,000 Clear Cash plan is not counted. No function can disable the ceiling.
44. Revolving default fails closed. Two misses and 15 days past the second due point with no timestamp: trigger reverts. Same-signer propose and approve reverts; a timestamp submitted after the amount is paid reverts; recorded time = approval block time. With a timestamp approved on day 12, the trigger reverts until day 22, then succeeds for a random caller. Paying the amount cancels the timestamp and the trigger reverts.
45. Automatic Clearing set-up. "Turn off" → autoClear false, nothing swept. Approve → autoClear true and autoClearAuthHash recorded. A federal-benefit deposit is not swept until the member removes that payer by signature. No role but the member can change autoClear.
46. hybridMode true stops every sweep and leaves every cycle end and cycleEndDay unchanged.
47. Fee leg. $1,000 at 250 bps: member −1,000, merchant +975, feeRecipient +25. $2,400: fee $50 (cap), merchant +2,350. $3,000: fee $75, merchant +2,925. Legs always sum to zero; no other address receives any fee.
48. Fee reversal and recipient. A full refund of the $1,000 charge reverses $25 from feeRecipient; a 40% refund reverses $10. A same-signer feeRecipient change reverts; a two-person change emits its event and applies only to later charges.

---

EARN ADDENDUM — pledged bonds (R-06, Nov 14, 2026). REQUIREMENTS; list conflicts rather than choosing.

§1 allowlist (a): burn on settlement, buyback, payPledged or redeemAll.

§4 payPledged(id) — the pledge payment term in the bond itself (IV-01 §4.9):
- Callable by anyone, but succeeds only when the pledge module reports that MB-05 permits enforcement against that bond (default after notice and cure as recorded on-chain, or a Shortfall uncured for 72 hours), and only for as many bonds as the module requests.
- The bond is payable at accretedValue(id) in that block. FIXED: never less than 100% of Present Value.
- The amount is applied only to that Holder's MB-05 secured debt in the module's order. Any surplus goes in USDC only to the Holder's Smart Account. The bond burns.
- Nothing else can trigger or redirect it. It never runs for an unpledged or released bond. It is not a buyback.

§4 settle(id) — pledged bond that does not roll:
- toDebt = min(Maturity Amount, max(0, Asset-Backed Drawn − limitWithout)), where limitWithout is the Holder's asset-backed limit computed in that block without this bond. Record it as a repayment (carry, then principal) on the Holder's own instruction, not enforcement.
- toHolder = the rest, paid in USDC to the Holder's Smart Account. FIXED: never locked, held or restricted by any module or role; no "Pledged Proceeds" state exists.
- The pledge releases and the bond burns in the same transaction. If the vault is short, apply toDebt first and the shortfall rule to toHolder only. Emit PledgedMaturitySplit(id, toDebt, toHolder).

§9 Advance rates:
- advanceRateBondBps (9500, of Present Value) and advanceRatePoolBps (7000, of Pool Share Value) are stored per pledge at pledging. Decided Nov 13, 2026 (95% and 70%); 80% and 60% are superseded.
- A bond pledge requires the Holder's signature over the Maturity Instruction (hash stored); without it, the pledge reverts.
- Pledged positions exit only through MB-05 enforcement (payPledged for bonds; queued redemption for pool shares).

Tests
18. payPledged reverts on an unpledged bond, with no recorded enforcement condition, on a Shortfall under 72 hours, or before the recorded cure date. On a qualifying default with debt $500 against Accreted Value $950: $500 to the debt, $450 to the Holder's Smart Account, the bond burns. No call can pay less than accretedValue(id) or send any amount elsewhere.
19. Pledged maturity split. Pledged bond with Maturity Amount $1,000, second pledged bond with Present Value $500 (Collateral Value $475), Asset-Backed Drawn $1,200, auto-roll off. settle by a random caller applies $725, pays $275 with no lock, releases the pledge, burns the bond, emits PledgedMaturitySplit(id, 725, 275). With Drawn $400: toDebt $0 and the Holder gets $1,000. With Drawn $1,600: toDebt $1,000 and the $125 above the limit goes to the Shortfall rules. With the vault short, the $725 is still applied and only the $275 is subject to SettlementShortfall. No caller can change toDebt or send it elsewhere.

---

## Founder's answers to the conflict list (Nov 14, 2026), binding

- **A. Accept.** Calendar-month revolving cycles supersede the earlier "stay 30 days" instruction. California Fin. Code §22452 requires a monthly billing cycle with the same closing date each month, so 30-day revolving cycles don't comply. Term plans keep 30-day cycles.
- **B. Accept.** A two-person cure-notice timestamp; default at the later of 15 days after the second due date and 10 days after the timestamp; fail closed. This replaces the earlier chain-dated notice (Phase 2b decision #4).
- **C. The $47.47 wins for term plans.** Term plans are closed-end. Carry is the list rate per 30-day cycle on remaining principal (MB-06 Schedule 1 discloses $47.47 and an APR of 24.33%), then trimmed so it never exceeds the per-second-fitted cap on that principal. The per-second index (monthly × 12 / 365) governs every cap and all revolving carry; it doesn't reduce a term plan's list carry below its stated rate. Test 5 stands as written. (Clarified §3 bullet in `addendum-2-references.md`.)
- **D. Accept.** Remove the switch; the Combined Ceiling is permanent. Use the new trim order (newest plan first, then earlier plans, then the revolving tiers, Boost first) and exclude Clear Cash plans of $2,500 or more. This replaces DECISIONS #7's switch and the pro-rata share design.
- **E. Accept as an explicit override** of the "Do NOT change" three-party mint item. Only the third leg changes: it pays Clear Lending's feeRecipient instead of the co-op, with the $50/$75 cap and pro-rata reversal. Everything else in the three-party mint stays.
- **F. Three levels:** UNSECURED (the default), DUE_ONLY, EVERYTHING.
  - EVERYTHING is the existing ALL renamed: all tiers most-expensive-first, then the remainder to Spendable.
  - UNSECURED_ONLY becomes UNSECURED. DUE_ONLY is new.
  - Add autoClearAuthHash, hybridMode and the federal-benefit default exclusions as specified.
- **G. Accept.** `payPledged` in the bond replaces the Liquidator's seize-and-redeem path (this supersedes the Phase 2b bond settlement gate and the Phase 4b/REREVIEW bond decision), and `settle` gets the pledged maturity split. A module split for BurnerBond is fine.
- **Timing:** Phase 4b and 2d finish first; this is built as Phase 2e.
- **The Hardship Grant** needs no contract change.
- **§13 addition:** `releaseAssurance` also pays Hardship Grants (MB-10 Schedule 5), with the same two-signer rule and destination. Clear then pays the landlord, lender or servicer off chain. No new function, and the Credit Backstop compartment can never fund a grant.

## Also built in Phase 2e (owner, Nov 14, 2026)
- Phase 4c items 1, 2, 3 and 7 from `docs/audit/PHASE-4B-OPEN-DECISIONS.md` are folded into 2e, because they change the same RevolvingIssuer code:
  1. a per-member daily card cap;
  2. the card follows the current line;
  3. `openLine` waits until an earlier default's collateral has been applied;
  7. issuer-internal repayments follow the effective-rate order.
- Items 4, 5 and 9 are built separately in Phase 4c.
- Correct TermIssuer's description: ELPA is not a term plan ("the ELPA that buys a home" is wrong; see `phase-2f-decisions.md` on `audit/phase-2f-earn-pool`).
