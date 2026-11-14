# Audit hand-off: references for Addendum 2 (Nov 14, 2026)

Excerpts from Deed3Labs/clear-agreements for the contract audit. The spec controls the contracts; these legal sections are the source the spec cites. Treat as REQUIREMENTS context.


## Spec 12.13

**12.13 Assurance relief flags (MB-04 §§8.8–8.10; MB-10 Schedule 4; founder decision Nov 13, 2026).** The contracts must support a per-member `graceCycle` flag and an `incomePause` counter; their limits are governed parameters. `graceCycle` (Cycle Assurance): at most `graceCyclesPerWindow` (initial 1) per rolling `graceWindow` (initial 365 days); when an eligible member's Rebalance Amount is unpaid at the due point and a grace is available, the grace is consumed automatically, the unsecured limit is not halved, nothing settles under 12.5 and the cycle does not count toward default. `incomePause` (Income Assurance): set to at most `incomePauseMaxCycles` (initial 3) consecutive cycles by a two-person attestation recording a hardship forbearance that Clear Lending granted at the member's request on documented income loss (MB-04 §8.9); while it is above zero the Rebalance Amount and the Secured Minimum for the cycle are zero, no miss is recorded, no `securedDrawPause` arises and nothing counts toward default; it falls by one at each cycle end, and only expiry or the member can end it early. Carry keeps accruing at the normal rate on principal only. Eligibility under MB-10 is set by a two-person attestation that can only enable relief. Neither flag can raise a drawn amount, move funds, charge any fee, or cause a miss, settlement or default.

## Spec 12.14

**12.14 Default of a secured term plan (MB-06 §§13.7–13.8; MB-05 §§6.1, 6.4; founder decision Nov 13, 2026).** A term plan secured under MB-05 is in default on-chain only when a scheduled payment has been past due at least 60 days, a cure-notice timestamp has been recorded for it, and 30 days have passed since that timestamp with the past-due amount still unpaid; the trigger is then permissionless (10b), reaches only Earn collateral pledged to secure plans (never CLRUSD) and respects the Liquidation Hold (12.6). The notice timestamp is recorded by a two-person attestation under the same rules as the Liquidation Hold: one signer proposes, a different signer approves, the recorded time is the block time of approval and never earlier, it can be recorded only while the payment is past due, and payment of the past-due amount or an on-chain hardship plan (MB-06 §13.6) cancels it.

## Spec §3 (term-plan clarification, decision C)

### 3. Continuous accrual that never exceeds a monthly cap
- Revolving cycles are calendar months ending on the member's Cycle End Day (12.1); term-plan cycles are 30 days. Caps are per month. Accrue per second at `annualRate = monthlyRate × 12`, divided by 365 days.
- No day may accrue more than 1/30 of the monthly cap (the CFL §22452 daily limit for open-end loans), and 30 days of accrual must never exceed the monthly cap. A 31-day calendar cycle may therefore accrue up to about 1.9% more than one month's cap.
- Term plans (closed-end, MB-06; decided Nov 14, 2026): carry is the plan's list rate per 30-day cycle on remaining principal (12.9: $47.47 on $940 In 4 at 2%, APR 24.33%), then trimmed so it never exceeds the per-second-fitted cap above on the remaining principal. The per-second index governs every cap and all revolving carry; it does not reduce a term plan's list carry below its stated rate per cycle.
- Keep lazy accrual: an index per rate band. A position stores one index snapshot per band it touches.
- Carry between touches = Σ over bands of (principal portion in that band × index delta).
- Principal is constant between touches, so this stays O(bands), not O(accounts).

## MB-05 Security and Pledge Agreement

**5.6 Maturity Without a Roll.** When you pledge a BurnerBond, you also sign a standing instruction (the "**Maturity Instruction**") for its maturity payment if you opt out or a roll is not available. Under it, at maturity:

(a) the part of the maturity payment needed to keep your Asset-Backed Drawn within your Asset-Backed Limit, once that BurnerBond is no longer pledged, is paid to Clear Lending and applied to your Asset-Backed Drawn, as an application on your own instruction under Section 7.9; and

(b) the rest is paid in USDC to your Ready to allocate, free of any pledge, lock or other restriction.

No part of a maturity payment is ever held, locked or restricted in your Smart Account. Before maturity you may reduce or remove the part under clause (a) by repaying Asset-Backed Drawn or pledging other Earn Positions, and the Maturity Instruction then applies only to what is still needed.

## MB-05 Security and Pledge Agreement

**6.1 When Collateral May Be Enforced.** Clear Lending may enforce against Collateral only in two cases:

(a) an Objective Default, as MB-03 Section 4.5 and MB-04 define it, or a Default under MB-06 Section 13.7(a) of a Plan that this Agreement secures, as shown on-chain under Section 6.8, in each case after the notice and cure period in Sections 6.3 and 6.4; or

(b) a Shortfall that continues after the period in Section 6.5, and then only against Pledged Earn Positions.

## MB-05 Security and Pledge Agreement

**6.4 Cure Period of at Least Ten Days.** For a Secured Obligation under MB-04, the notice under MB-04 Section 9.2(a) is the Default Notice, and the Grace Period under MB-04 Section 9.1(a) ends at the later of fifteen (15) days after the second Payment Due Date and ten (10) full days after the time the Default Notice was sent, as recorded on-chain under MB-04 Section 9.2(d). That time is recorded by two authorized persons, is never earlier than the time of approval, and can be recorded only while the amount is unpaid. If no time is recorded, there is no Objective Default and no enforcement, so a late Default Notice only delays enforcement and you always have at least ten (10) full days after it. You may cure at any time before enforcement by paying the cure amount, and then no enforcement occurs for that cycle. For a Plan under MB-06, the longer periods in MB-06 Sections 13.7 and 13.8 apply instead: the notice under MB-06 Section 13.8 is the Default Notice, and enforcement may not happen before the cure date it states.

## MB-05 Security and Pledge Agreement

**6.7 Liquidation Hold.** Clear Lending will set a hold (a "**Liquidation Hold**"), which stops enforcement against your Collateral, while any of the following applies:

(a) a Default Notice whose time was recorded under Section 6.4 or 6.8 but which was not delivered to you, until ten (10) full days after it is delivered;

(b) you have given notice of a billing error or a good-faith dispute about the Defaulted Amount, until it is resolved under MB-04, but only for the disputed amount;

(c) Clear Lending has notice of your bankruptcy, until the court permits enforcement;

(d) ninety (90) days after Clear Lending receives notice of your death; and

(e) any other case in which the law forbids enforcement, including the Servicemembers Civil Relief Act.

A Liquidation Hold cannot move, lock or freeze anything. It ends automatically when its reason ends. No charge accrues on any amount because of a Liquidation Hold.

## MB-05 Security and Pledge Agreement

**7.3 Earn Positions.** Enforcement against an Earn Position is done only as follows:

(a) *BurnerBonds* are collected under their own terms. Under Section 4.9 of the BurnerBond Terms (IV-01), a BurnerBond pledged under this Agreement becomes payable by Clear Lending, as issuer, when this Agreement permits enforcement against it under Section 6.1(a) or 6.1(b), at not less than one hundred percent (100%) of its Present Value at the time of payment, and that payment may be applied only to the Secured Obligations it secures. Payment of a BurnerBond under that Section is collection of an obligation owed on the Collateral, not a sale or other disposition. Clear Lending will never sell a BurnerBond, buy it for itself or accept it in full or partial satisfaction of any Secured Obligation.

(b) *Pool Shares* are redeemed through the yield pool vault's ordinary redemption function at their Pool Share Value. If the vault limits or queues redemptions, Clear Lending will wait in the queue. It will not sell Pool Shares to any person, or at less than Pool Share Value, without your consent given after the Default Notice or Shortfall notice.

(c) Only as many Earn Positions are paid or redeemed as are needed to pay the Defaulted Amount, or to end the Shortfall.

## MB-05 Security and Pledge Agreement

**7.9 Your Own Instruction.** At any time, including after a Default Notice, you may sign an instruction to apply Collateral to any Secured Obligation, in any amount and order you choose. Applying Collateral on your instruction is not enforcement.

## MB-06 Term Plan Agreement

**13.6 Hardship Plans.** If you tell us you are having trouble paying, or a Plan reaches Collections, we will offer a hardship plan. A hardship plan may lower your payments, move Due Dates, or extend a Plan by up to twelve (12) Cycles beyond the limit in Section 6.6(a), as long as the total scheduled term stays within the California Financing Law. A hardship plan never raises your rate and never increases the total Carry above what remained under the Plan's schedule when you asked. Accepting one needs your confirmation in the App, and the new schedule is posted to Documents. A Plan on a hardship plan whose payments are current is not Past Due.

## MB-06 Term Plan Agreement

**13.7 Default.** You are in "**Default**" on a Plan only if:

(a) a scheduled payment on that Plan has been Past Due for at least sixty (60) days, we have given you a notice under Section 13.8, and you have not cured within the time it states; or

(b) you obtained that Plan by fraud, including by using another person's identity.

Nothing else is a Default, including your death, your bankruptcy, a change in your credit, a Default on another Plan, or the end of your membership.

## MB-06 Term Plan Agreement

**13.8 Notice and Right to Cure.** Before a Plan can go into Default under Section 13.7(a), we will send you a written notice, by the methods in MB-17 and, if you do not open it within five (5) days, by first-class mail. The notice states the Plan, the amount you must pay to cure, the date by which you must pay it (at least thirty (30) days after we send the notice), how to pay, how to ask for a hardship plan, and what may happen if you do not cure. Paying the stated amount by that date cures the Default as if it had not happened. Accepting a hardship plan by that date also cures it. For a Plan secured under MB-05, the date we send the notice is recorded on-chain by two authorized persons, one proposing and another approving, with the same safeguards as a Liquidation Hold under MB-05; it is never recorded with an earlier date than the day it is made, and the Plan is in Default on-chain only as MB-05 Section 6.8 provides.

## IV-01 BurnerBond Terms

**4.9 Pledged Bonds Payable on the Pledgor's Default.** This Section is a term of every Bond.

(a) *When payable.* A Bond pledged under the Security and Pledge Agreement (MB-05) becomes due and payable by Clear Lending, without any act of the Holder, when MB-05 permits enforcement against it under MB-05 Section 6.1(a) (a default of the Holder's secured credit, after the notice and cure period MB-05 requires) or MB-05 Section 6.1(b) (a Shortfall that has continued uncured for the period in MB-05 Section 6.5), in each case as recorded on-chain, and only for as many pledged Bonds as MB-05 Section 7.3(c) permits.

(b) *Amount.* The amount payable is not less than one hundred percent (100%) of the Bond's Present Value (which equals its Accreted Value) at the time of payment (the "**Pledge Payment Amount**").

(c) *Payable only to the secured debt.* Clear Lending pays the Pledge Payment Amount only by applying it to the Holder's obligations secured under MB-05, in the order MB-05 Article 7 sets, and pays any surplus in USDC to the Holder's Smart Account (Ready to allocate) within two (2) Business Days. It may not pay the Pledge Payment Amount to any other person, apply it to any other obligation, or pay less. The Bond is then cancelled.

(d) *Nature.* A payment under this Section is payment of the Bond by its terms, not a buyback, sale or other disposition. No Holder may require payment under this Section, and it does not apply to a Bond that is not pledged, or once MB-05 has released the pledge.

## Earn spec §1 (BurnerBond token)

### 1. BurnerBond token (ERC-1155)
- Quantity 1 per token ID; IDs never reused. Store per token: series ID, Maturity Amount, Issue Yield (bps, annual compounding), Issue Date, Maturity Date, opt-out deadline (end of day Pacific before maturity, as a timestamp computed at mint), auto-roll flag (default ON), pledged flag, paid amount.
- `accretedValue(id)` = Maturity Amount ÷ (1 + yield)^(days to maturity ÷ 365), and Maturity Amount at or after maturity. Use fixed-point math with documented rounding; never round in the Holder's disfavor by more than one cent.
- Mint only atomically with receipt of the Purchase Price into the BondVault from the buyer's Smart Account, on a Wallet Signature over a quote that expires after 15 minutes. Purchase Price ≥ $250 (FIXED floor). Reject a purchase that would exceed the Funding Limit or the offering cap (`offeringCap`, initial $1,000,000), or that is made during a Reserve Shortfall (rolls excepted), or while an Enforcement Notice is in effect.
- Reject payment from any Clear contract holding ESA capital, CLRUSD, collateral, credit proceeds or Earn funds.
- Transfer allowlist (FIXED): only (a) burn on settlement, buyback, `payPledged` or `redeemAll`; (b) between two Smart Accounts registered to the same Holder; (c) the Successor path: Clear Lending two-person approval plus an evidence hash, to the Successor's verified Smart Account; (d) pledge to Clear Lending via the pledge module (the token stays in the Holder's account). Every other `safeTransferFrom` reverts. No approvals for third-party operators.
- Metadata carries the IV-01 §4.12 legend.
