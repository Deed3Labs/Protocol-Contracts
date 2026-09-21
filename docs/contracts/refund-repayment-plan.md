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

**What that has already done, on Base Sepolia, 2026-09-21.** Every test repayment is in the buffer:

```
AssurancePool  125.033081 USDC   (buffer 125.033081 · primary 0 · excess 0)
PayoutPool       0.0      USDC
credit totalSupply 125.033081    (merchant 97.50 · co-op 27.53)
```

The cash and the claims match to the cent, and the cash is in the wrong contract. If that merchant
redeemed today their claim would queue against an empty pool while 125 sat one contract away — and
the buffer cannot send it: it leaves only through `reimburse` (a loss), a rebalance into the primary
reserve, or `withdraw`, which takes from *excess* alone. **There is no path from the buffer to the
payout pool.**

That is the routing's real shape, not a testnet artefact: `shortfall()` is non-zero only while claims
are already queued and unfunded, so unless a merchant redeemed *before* a member repaid, the money
goes to the buffer. Merchants would redeem, find nothing, queue, and wait for a manual top-up while
the buffer accumulated what should have paid them.

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

### The position follows the cash

A claim paid in cash used to MOVE to the co-op rather than burn, on the grounds that burning would
leave a member owing with nobody holding the matching claim. That is true of one case and one only.

| Cash that paid the claim | What happens to the credits | Why |
|---|---|---|
| A member's own repayment (`donate`) | **Burned** (`settleClaim`) | Their obligation went when they paid. The claim was backed by that cash, and burning it puts supply back in step with what members owe. |
| The yield pool (`fund`) | **Transferred to the pool** | It advanced the money and the member still owes it, so it holds the position and earns the carry — exactly as it does on the unsecured tiers it funds (`tierCarryRecipient`). |
| Co-op capital (`fund`) | **Transferred to the co-op** | Same rule, different funder. The fallback when no funder is named. |

Only the pool knows which cash paid a claim, so only the pool may call a claim settled — hence
`settleClaim` being restricted to it rather than being a burn anyone can call. The pool holds the
position between redemption and payment for the same reason: until the claim is paid, nobody knows
whose money will pay it, and deciding at redemption is what forced the old guess.

**This is why the earlier draft's `receivablesHolder` is gone.** Nothing accumulates, so there is
nothing to exclude, and the funding target is simply `totalSupply() − held()`.

### Who funds a payout, and in what order

Three sources, and the order is the whole design rather than a policy anyone sets:

1. **The member's own repayments.** What is normally in the pool by the time a merchant's turn
   comes. These claims settle; nothing is bought.
2. **Cash the co-op has put in the pool.** Smoothing money, so the pool is funded between
   repayments. The co-op holds the positions it pays for.
3. **The yield pool, for a shortfall.** A claim whose turn has come and whose net 30 has elapsed,
   with nothing in the pool to pay it, is the obligation that has to be met. It draws on the pool's
   unlent cash, and the yield pool holds what it funds.

**There is no "early payment" path, and nothing decides to advance.** A merchant is paid when it is
their turn and the money is there, and queued when it is not — a claim before its net 30 with a
funded pool is simply paid, and an empty pool means waiting however early or late it is. The only
thing anyone has to fund deliberately is a claim that is due and unpayable.

So `fund` is not one party's door. Whoever puts capital in holds the positions their money paid for
(`capitalOf`, drawn down oldest first), and takes back what it never spent (`withdrawCapital`). The
co-op would ordinarily leave idle capital in the yield pool and earn the return on it; funding the
payout pool directly is for smoothing and emergencies, which is why it stays open rather than being
routed through the pool.

**Carry splits the same way as the positions: by who funded the payout.** That is what the
per-funder tracking is for, and it is the reason `capitalFunder` — a single named party — was
wrong.

### A refund short of cash draws the same way a payout does

A refund can outrun the pool: the merchant may have taken their money out before the purchase came
back. The pool pays what it holds and records the rest (`refundsOwed`), settled ahead of any claim,
because money already belonging to a member is not the pool's to pay somebody else with.

**That gap is funded in the same order as a merchant payout** — pool cash, then the yield pool's
unlent cash, then the reserve — and whoever funds it holds the claim, exactly as they do there. The
only difference is whose claim it is:

| funding | the funder ends up holding |
|---|---|
| a merchant payout | a claim on the **member**, who still owes it |
| a refund | a claim on the **merchant**, who owes it back |

Both come back the same way: credits reaching a party with an obligation burn against it, so the
next sale settles it before it pays them anything.

So the draw is one piece of work serving both, and until it exists a member can be left waiting for
their own money — which is the same timing gap as the payout queue, pointed the other way.

### Built: the draw, and what it is not

`PayoutPool.drawForDueClaim()` finds the money for a claim whose turn has come **and** whose terms
have run out. It refuses a claim that is not due (`PayoutPoolClaimNotDue`), so nothing in it can be
used to pay anybody early — a funded pool already does that, and an unfunded one is a wait.

The yield pool's unlent cash first, then `AssurancePool.lendToPayoutPool`: excess, then buffer while
`hasValidRTD()` holds, never the primary reserve. Repayment restores the cushion before anything is
called spare again.

**Both are repaid rather than handed the position**, which is where this departs from the co-op
funding directly. The yield pool's share price is cash plus what is out on loan; the reserve's cover
is counted in reserve tokens. A credit claim sitting in either reads as a hole in their books until
somebody redeems it, so what they put up comes back as what they put up. Members' repayments
therefore go to the lenders before they settle anything — otherwise the pool would borrow against
money it already had.

**The pool holds what it buys with borrowed money.** It has to be somebody, and it must not be the
co-op: that would have it holding a claim it never paid for and collecting the carry on a float the
yield pool was bearing. The holding is excluded from `distributableCarry`, so it cannot be paid out
as anybody else's earnings, and it is burned when the member's repayment reaches the lender.

**And they are paid for lending.** Carry is added to what a member owes, so the repayment that
settles the principal carries the interest in the same cash — nothing has to be converted, which is
what an earlier draft of this section got wrong. The pool's share of the carry is held as
`carryEarned`, handed to the lenders in the same proportion as the principal they put up, and the
claim it stood for is burned with it. Lending to the pool is a business rather than a favour.

### Superseded: the reserve as funder of last resort

The order above has three sources. A fourth exists and is not wired: **the AssurancePool**, for a
claim whose turn has come and whose net 30 has elapsed when the payout pool is empty and the yield
pool has nothing unlent. Not for paying anybody early — that needs no decision and no reserve, only
a funded pool — but for the obligation that is due and that somebody must meet. That is one of the
things a reserve is for, and the machinery is already here: whoever's capital pays a claim holds the
position and earns carry on the float they bore, so the reserve would be another funder in
`capitalOf`, with positions and the carry split following on their own.

The order to draw in, each only when the one before is exhausted:

1. cash the pool holds (members' repayments, then co-op smoothing capital)
2. the yield pool's unlent cash
3. the assurance reserve

**What it already does right.** `poolExposure()` is `stableCredit.totalSupply()` — every outstanding
claim, what merchants are owed included — narrowed by an `exposureSource` where one is set (the
CollateralRegistry, reporting uncollateralised exposure). So it already measures itself against what
is uncovered rather than against everything.

**And burning settled claims makes that honest.** While a claim paid in cash stayed on the ledger,
supply stayed inflated and the reserve held cover against obligations that had already been settled.
On Base Sepolia today the ledger says 125.03 of exposure where members owe 0.026197.

**Which tier, and how much: excess first, then buffer, never primary.** Excess is spare by
definition. The buffer is first-loss money, but meeting a due claim is not a loss — the position
comes back, with carry — so lending it for a timing gap is what it is there for. The primary reserve
is what the RTD is measured against, and drawing on it would report the co-op as under-reserved when
nothing had been lost.

**Capped at whatever keeps RTD at or above target.** The constraint enforces itself: the reserve
covers due claims until covering one more would put the network below its own policy, and then it
stops and reports the shortfall — which is what `shortfall()` already does for the pool. Nobody sets
a number, and the number cannot drift out of date.

**The carry split is built, and cannot be switched on yet.** The pool splits carry by each funder's
share of every claim outstanding — three fifths of the carry for three fifths of the float — and what
no funder bore goes to the co-op, which is all of it until somebody funds a payout.

> **The fee and the carry share one recipient, and must not.** `TermIssuer.openPlan` mints the
> co-op's 2.5% to `carryTreasury`:
> `originatePurchase(member, purchase, merchant, payout, carryTreasury, discount)`. So pointing that
> at the pool — which is the only way carry reaches it — also sends every new purchase's fee there,
> and `distributeCarry` would split the co-op's own income among funders.
>
> Done and undone on Base Sepolia on 2026-09-21; nothing was lost, because no purchase happened in
> the window. `scripts/configure-carry-recipients.mjs` now refuses to run.
>
> **The fix is a recipient of its own for the fee**, so that `carryTreasury` means carry alone. It
> is a small change to `TermIssuer` — a `feeRecipient` address, defaulting to the carry treasury so
> nothing moves until it is set — and it is the first thing to build before any of the carry work
> can be used. `tierCarryRecipient` is unaffected: a tier the LendingPool funds already names it.

> **Watch:** `receiveRepayment` (once `donate`) means "a member paid down their balance", and that
> is what makes claims burn. Capital must never arrive that way, whoever sends it — burning a claim
> whose member still owes leaves an obligation with nothing holding it. The contract now refuses
> anyone but the ledger.

### The co-op's income

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

Where the money LANDS is a separate question from who holds the claim, and separately settable
(`coopIncomeRecipient`). The co-op's multisig holds the position and its balance falls when it is
paid; the cash can go to an on-ramp account, another custodian, or whatever pays the co-op's bills.
Unset, it goes to the holder.

> **On Base Sepolia, 2026-09-21**, `coopTreasury` (PayoutPool) and `carryTreasury` (TermIssuer) are
> the same address, `0x895d44d10d1b7B4F5f38E2ae2322539Cf93F7AAA`, holding 27.533081 credits against
> a totalSupply of 125.033081. An earlier draft made splitting them step zero, to keep the co-op's
> income apart from positions it had bought. Burning settled claims removes that need: nothing
> accumulates, so one address can hold both and the two may stay as they are.

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

0. **Route against payables, and settle claims paid with members' money.** Without this the pool is
   not funded for refunds at all, and everything below it is untested in the case that matters.
   Deploying it needs three things beyond the upgrade: the pool must be granted **network
   membership** (it holds a position between redemption and payment, and cannot pay a claim
   without it), `capitalFunder` should name the yield pool once it funds payouts, and on Base
   Sepolia the pool needs funding directly, since the 125 already in the buffer cannot be moved to
   it. Test USDC, so no loss — but on a live chain this is the difference between member repayments
   paying merchants and a treasury paying them by hand.
1. **PayoutPool.payRefund** — pay from `held()`, and the role-gated withdrawal of the co-op's income
   to its treasury address.
2. **StableCredit.repayRefund**, including the redeemed-merchant path, and its tests.
3. **TermIssuer.closePlanForRefund** extended, with the proportional paid share.
4. **API** split and call, with the figures returned.
5. **App**: notification and activity copy.
6. **A fee recipient of its own on TermIssuer**, so carry can reach the pool without the co-op's
   income following it. Nothing built above can be switched on until this lands.
7. ~~**The draw**: pool, then yield pool, then reserve.~~ **Built.** Within the reserve: excess,
   then buffer while the primary cover is at target, never primary.
8. ~~**Interest for the lenders.**~~ **Built** — it comes out of the member's own repayment, which
   carries principal and carry together.
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
