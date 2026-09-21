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

### PayoutPool — a withdrawal, not a claim

**Settled: the queue does not change.** A merchant redeeming is a *claim* on the pool and waits its
turn by age. A member's refund is not — it is the withdrawal of money that member paid in, which is
sitting there because `_routeRepayment` put it there. Nothing is being taken from the merchants in
the queue in aggregate; the merchant whose sale it was gives it back.

This is how a card refund works, and the reasoning is the same: the sale was the merchant's, so the
merchant bears it. If they have already redeemed, their balance goes negative and their next payout
settles it — a drawn line, exactly as `_transferObligation` already does.

`payRefund(address member, uint256 amount)`, callable only by StableCredit, paying from `held()`.
No priority field, no second queue.

### Routing — fund the pool against payables, not queued claims

**Settled, and it is where the residual actually lived.** A refund could find an empty pool, and the
reason is not refunds at all: `_routeRepayment` funds the pool against `shortfall()`, which is
`queuedTotal − held()` — cash for claims a merchant has *already redeemed against*. A merchant's
unredeemed balance is a payable too ("the merchant's positive balance IS the payables ledger"), and
nothing reserves cash against it. So when no claim happens to be queued, a member's repayment goes
straight past the pool into the assurance buffer, and the pool was never funded for the obligation
that money belongs to.

The fix is in the routing:

```
target   = every outstanding payable
toPayout = min(amount, target − held())
remainder → assurance buffer
```

Payables get covered before provisions, which is the right order: a payable is a present liability
and the buffer is a provision against future losses. The buffer fills more slowly as a result, and
that is the intended trade.

With this, the money a member repays sits in the pool against the merchant's payable — which is
exactly the money a refund gives back. **The assurance buffer never enters the refund path**, and
"we remove the USDC the member paid from the payout pool" is literally what happens.

### Two co-op addresses, so nothing is counted twice

The positive side of the ledger is the ERC20 itself (`_accrueCredit` mints, `_reverseCredit` burns),
so `totalSupply()` is every outstanding claim. It is not the target as it stands, because `_pay`
transfers cash **without burning credits**: at `redeem` the merchant's credits move to
`coopTreasury`, and at payment the cash leaves while those credits stay. That is correct — the co-op
bought the receivable and the member still owes it — but it leaves one address holding two unlike
things:

| | what it is | fund cash against it? |
|---|---|---|
| The co-op's 2.5% at origination | income it is owed, a payable like any merchant's | **yes** |
| Credits bought by paying claims | receivables already settled in cash | **no** — that is the double count |

So they get separate addresses, and the target is exact with no new bookkeeping:

```
target = totalSupply() − balanceOf(receivablesHolder)
```

The co-op's income is then funded in the pool like anyone else's and **withdrawn by role to a
treasury address**, with the address settable only by that role.

**It does not queue.** The 2.5% was never the merchant's money: on a $100 purchase the merchant is
owed $97.50 and the co-op $2.50, and a $100 repayment covers both. So the fee is not a claim and
takes no place in the queue — it is withdrawable from cash **not already earmarked for queued
claims**:

```
withdrawable = held() − queuedTotal
```

The co-op takes its fee as soon as the money is there, and can never take cash already promised to a
merchant who is waiting. Both halves of that matter: it is owed its fee, and it is the one party here
that must not be able to pay itself first.

> **Checked on Base Sepolia, 2026-09-21: they are the same address.**
>
> ```
> coopTreasury  (PayoutPool)  0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA
> carryTreasury (TermIssuer)  0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA
> holding 27.533081 credits · totalSupply 125.033081 · pool holds 0 USDC, nothing queued
> ```
>
> So the funding target is wrong until they are apart, and the split is step zero. Nothing has been
> settled in cash yet on this chain, so the balance is fee and carry income only — the two kinds have
> not yet been mixed in that address, and separating them now costs nothing.

### StableCredit — a refund path that moves money

`reversePurchase` stays as it is, for the part still owed. Alongside it:

`repayRefund(member, paid, merchant, merchantShare, coop, coopShare, carryWithheld)`

- asserts the legs net, exactly as origination and reversal do;
- burns the merchant's and the co-op's credits for their shares, or transfers the obligation where
  the merchant has redeemed;
- settles `carryWithheld` against the member's credit balance;
- calls `payoutPool.payRefund(member, paid − carryWithheld)`.

### TermIssuer — one entry point, both halves

`closePlanForRefund` currently caps at outstanding principal. It gains the paid half: the carry
materialised at close, and the call into `repayRefund`.

**Settled: the split is arithmetic, not proportion.** Money paid is fungible against the purchase, so:

```
reverse = min(refund, still owed)
cash    = refund − reverse
```

| refund | owed | paid | reverse | cash | the member afterwards |
|---|---|---|---|---|---|
| $100 | $54 | $46 | $54 | $46 | owes nothing, is paid back what they paid |
| $40 | $54 | $46 | $40 | — | owes $14 on a $60 purchase, having paid $46 |
| $60 | $54 | $46 | $54 | $6 | purchase is $40, they paid $46, $6 comes back |

A proportional share of `plan.repaid` would have taken cash out of the pool in the middle row, where
nothing needs to move at all. Proportion applies only to splitting the **cash** leg between the
merchant and the co-op, at the sale's own fee ratio, rounding to the co-op rather than clawing a cent
from a merchant.

The carry is withheld from the cash leg and capped at it: no cash, no netting, and the member clears
it with Repay (#550).

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

0. **Split the two co-op addresses**, and change `_routeRepayment` to fund against payables. Without
   this the pool is not funded for refunds at all, and everything below it is untested in the case
   that matters.
1. **PayoutPool.payRefund** — pay from `held()`, and the role-gated withdrawal of the co-op's income
   to its treasury address.
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
