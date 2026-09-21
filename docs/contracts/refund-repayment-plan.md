# Refunds — Giving Back What Was Paid

Plan for the hole found on 2026-09-21: **a refund never returns a member's own money.** It cancels
what they still owe and stops there, so a member who had paid half a plan is out of pocket by that
half on a purchase that was given back.

Scope: `StableCredit`, `PayoutPool`, `TermIssuer`, the refund path in the API, and what the member
is told. Disputes decided for the member go through the same code and get the same fix for free.

---

## 1. What happens today

### Origination is capital-free

A purchase is a three-party mint that nets to zero — the member is debited, the merchant credited,
the co-op credited the discount. No money moves.

### A member's repayments leave the ledger

`_routeRepayment` sends their USDC to the **payout pool** first, up to what merchants are owed, and
the remainder to the assurance buffer. The money is really there; it is not an entry.

### A refund only unwinds debt

`closePlanForRefund` → `reversePurchase` burns the merchant's credits and the co-op's discount, and
reduces what the member owes. Capped twice over: `closePlan` asks for at most `principalOutstanding`,
and `reversePurchase` reverts if the reversal exceeds what is owed.

Two things follow, one right and one wrong.

**Right, and already built.** If the merchant has already redeemed, there is nothing on the shelf to
burn: `_transferObligation(member, merchant, shortfall)` releases the member, the merchant carries
the obligation, and it comes off what they are paid next (`RefundOwedByMerchant`). A refund after the
merchant has drawn down needs nothing new.

**Wrong.** Nothing returns what the member already paid.

### Worked example — $100 purchase, 2.5% fee, member has paid $46, refunded in full

| | Member | Merchant | Co-op | Pool |
|---|---|---|---|---|
| Purchase | −$100 | +$97.50 | +$2.50 | — |
| Member pays $46 | −$54 | | | +$46 cash |
| Refund today | **0 owed** | −$52.65 | −$1.35 | +$46 cash |
| **Net** | **−$46 out of pocket** | keeps $44.85 | keeps $1.15 | holds their $46 |

The member ends level on the ledger and $46 down in cash. The value sits with the merchant and the
co-op, in exactly the proportion the member paid for.

### And the carry is stranded

Carry accrued while they held the plan is materialised before the unwind and survives it, correctly:
a refund does not unmake the time the money was held. But the plan then closes, so no tier and no
open plan holds that carry — it becomes a balance with nothing pointing at it, which is what froze a
member's line over 2.6 cents. #550 gives it a home on screen and a Repay.

---

## 2. What a refund should do

**Reverse what is still owed. Repay what was already paid. Withhold the carry from the cash.**

The split falls out of the arithmetic, so the backend picks it rather than anyone choosing:

| Member has paid | What happens |
|---|---|
| Nothing | Today's behaviour exactly: reverse the debt. Carry remains on the ledger and the member clears it with Repay (#550). Nothing to net against. |
| Some of it | Reverse what is still owed **and** repay what was paid, less carry incurred. |
| All of it | Repay the lot, less carry incurred. No reversal: there is no debt left to cancel. |

Where the cash comes from, and who ends up carrying it:

- **From the payout pool**, which is where their payments landed.
- **The merchant's balance falls by their share** of the repaid part, because that money was theirs
  to be paid. If they have already redeemed, the obligation transfers to them instead and comes off
  their next payout — the mechanism `_transferObligation` already implements.
- **The co-op gives back its 2.5%** on the repaid part, from the treasury's own balance.
- **The carry is withheld from the member's cash** and applied to their ledger balance. They paid for
  the time they held the money, as they should, and no isolated balance is left behind.

### The same example, under this plan

| | Member | Merchant | Co-op | Pool |
|---|---|---|---|---|
| After purchase and $46 paid | −$54 owed | +$97.50 | +$2.50 | +$46 cash |
| Reverse the $54 still owed | 0 owed | −$52.65 | −$1.35 | — |
| Repay the $46 paid, less $0.40 carry | **+$45.60 cash** | −$44.85 | −$1.15 | −$45.60 |
| Carry settled from the withheld $0.40 | **0 owed, nothing stranded** | | +$0.40 | −$0.40 |

Everyone ends where they should: the member whole apart from carry they genuinely incurred, the
merchant and co-op giving back what they were paid, and nothing left on the ledger to chase.

---

## 3. What has to change

### PayoutPool — it can only pay merchants

The gap. `redeem` pays the caller against their own credit balance, and claims are queued per
merchant in age order. A member refund is not a merchant claim and must not jump that queue.

Proposed: `payRefund(address member, uint256 amount)`, callable only by StableCredit, paying from
`held()` and **queuing behind existing claims when the pool is short** — a refund is a claim on the
same money, and merchants who have been waiting are not subordinated to it. The queue already
orders by claim age; a member refund joins it as a claim of its own kind.

> **Open:** should a member's refund outrank a merchant's queued claim? The member is out of pocket
> on a purchase that was given back, which is a worse place to be than waiting for a payout. Argues
> for a separate, shorter queue. Decide before building §3.1.

### StableCredit — a refund path that moves money

`reversePurchase` stays as it is, for the part still owed. Alongside it:

`repayRefund(member, paid, merchant, merchantShare, coop, coopShare, carryWithheld)`

- asserts the legs net, exactly as origination and reversal do;
- burns the merchant's and the co-op's credits for their shares, or transfers the obligation where
  the merchant has redeemed;
- settles `carryWithheld` against the member's credit balance;
- calls `payoutPool.payRefund(member, paid − carryWithheld)`.

### TermIssuer — one entry point, both halves

`closePlanForRefund` currently caps at outstanding principal. It gains the paid half: what the member
paid on this plan, the carry materialised at close, and the call into `repayRefund`. The plan closes
as it does now.

> **Open:** `plan.repaid` is what the member paid on the plan, but a refund of *part* of a purchase
> needs a proportional share of it. Same proportional rule as `payoutShare` today, rounding to the
> co-op rather than the merchant.

### API — no decisions, just arithmetic

`refundSettlement.closePlan` reads the plan, works out owed vs paid for the amount being refunded,
and calls the single entry point. The result already carries `unwoundCents`; it gains the cash repaid
and the carry withheld, for the notification and the member's activity.

### Member app

The refund notification says what came back and what was withheld: "$45.60 returned · $0.40 carry
for the time you held it". The activity row shows the same, because a member seeing $45.60 against a
$46 payment will otherwise ask where the difference went — and the answer should be on the row.

---

## 4. Order to build

1. **PayoutPool.payRefund** with the queue decision settled, and its tests.
2. **StableCredit.repayRefund**, including the redeemed-merchant path, and its tests.
3. **TermIssuer.closePlanForRefund** extended, with the proportional paid share.
4. **API** split and call, with the figures returned.
5. **App**: notification and activity copy.
6. **Upgrade** the deployed proxies on Base Sepolia, then refund a part-paid plan end to end and
   check every balance in the table above.

Steps 1–3 are contract changes to upgradeable proxies (`StableCredit`, `PayoutPool`, `TermIssuer`).
Nothing here touches CLRUSD, which stays immutable.

---

## 5. What this does not change

- **Carry is never forgiven.** It is withheld from cash where there is cash, and shown to the member
  to clear where there is not (#550). The co-op never pays a member to have held a balance.
- **A refund with nothing paid** behaves exactly as it does today.
- **A refund after the merchant has redeemed** behaves as it does today: the obligation moves to the
  merchant and comes off their next payout.
- **Disputes** decided for the member run through the same path, so they are fixed with it rather
  than separately.
