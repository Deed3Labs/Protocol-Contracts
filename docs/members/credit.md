# Credit

Clear lends without a credit check. **You have two separate credit lines**, and they are never added
together:

| | Your credit line | Your term limit |
|---|---|---|
| What it's for | Spending on your card, beyond your cash | Paying for a shop purchase over time |
| Set by | What backs each tier — your savings, your bonds and pool position, your income | $500.00 to start, growing as you pay on time, up to what your deposits support |
| Where you see it | **Credit** on Home | **Term plans** on Home |

Both open once your identity is verified. See
[Getting started](./getting-started.md#verifying-your-identity). Credit is offered state by state, so
your line also needs your state of residence on record, in a state where Clear offers credit.

## Your credit line

**Your credit line is made of tiers, each backed by something different.** Your limit is the sum of
the tiers you have.

| Tier | Backed by | How much it adds |
|---|---|---|
| **Savings** | Your CLRUSD | 100% of your savings. No carry |
| **Assets** | Your bonds and lending-pool position | 95% of what your bonds are worth today, 70% of your pool position |
| **Income** | The income landing in your account | Half of your estimated monthly deposits. Income and Boost together never go above $2,499 |
| **Clear Boost** | Nothing — it's opt-in | Nothing until you add it |

**Savings and Assets are secured**: what you draw on them is already covered by what you hold.
**Income and Boost are unsecured**: nothing stands behind them but your next deposit.

Each tier except Savings carries a charge per cycle, called **carry**. The Credit card on Home shows
each tier's rate beside its name, and so does **Spends from** on the Card page. **Limit breakdown**
shows what backs each tier.

**A card purchase that draws on your credit line will have a 30¢ credit swipe fee**, from any tier,
Savings included. A purchase your cash covers in full has no fee. The fee is added to what you owe
on that purchase, and it comes back if the shop refunds the whole purchase. Not charged yet.

### What backs your line automatically

**What you hold in Savings and in the [lending pool on Earn](./earn.md#the-lending-pool) backs your
line without asking each time.** Each backing is signed by your own wallet in the background. A bond is different: it backs
your line only once you agree, because that agreement includes what happens to the bond at maturity.

To stop it, turn off **Back my credit line with my Savings and Earn automatically** in **Settings →
Advanced → Permissions**. Turning it off stops new backing only.

### Spending order

You never pick which tier pays. **Your card spends your cash first, then your credit, cheapest tier
first**: Savings, then Assets, then Income, then Boost.

When you repay, it works the other way round: **the most expensive tier clears first.**

### Your cycle

Your line runs in monthly cycles. Each ends on the same day of the month, at 11:59:59 pm Pacific
time. The cycle card on Home tells you where you stand:

| What it says | What it means |
|---|---|
| Nothing carried this cycle | You owe nothing |
| Using your own savings | You've only drawn on your savings. Nothing is owed, but those savings are held and your home path is paused until you top them back up |
| Your deposit covers this | You're carrying unsecured credit, and your next expected deposit covers it |
| To clear this cycle | You're carrying unsecured credit that your expected deposit won't cover. This is the one state that asks you to act |

What has to be cleared each cycle is the unsecured part — what you've drawn on Income and Boost —
plus any carry left over from a plan you've closed.

Draws on Savings and Assets never make you miss a cycle. They have a small minimum each cycle: the
carry on your asset-backed draws and, when you carry no unsecured credit, 1% of what you've drawn on
Savings and Assets (at least $1). If the minimum goes unpaid, only new draws on Savings and Assets
pause, until it is paid.

### Repaying

**Repay** on the cycle card puts money against what you carry, most expensive tier first. It comes
from Ready to allocate, and you can also repay from savings. A repayment can't be more than you
carry.

### Automatic repayment

**Auto-clear from deposits**, in **Settings → Advanced → Permissions**, clears what you owe from
money that arrives in Spendable, such as a paycheck sent to your account and routing numbers, before
the rest is yours to spend. It's turned on when you join, unless you decline, and you can turn it
off or back on at any time.

- **What it clears** is your choice: income-backed credit and Boost only, which is where it starts,
  or everything, most expensive tier first.
- **USDC deposits are never touched.** USDC in Ready to allocate, and your savings, are never taken
  automatically. When you owe something, the same page offers to clear it now from your cash, with
  one tap.
- **Federal benefit payments are left alone** unless you choose otherwise.
- A card purchase that is still pending isn't debt yet; it's cleared once it settles.

### If a cycle ends and you still owe

A cycle that ends with its unsecured part unpaid is a **missed cycle**. Nothing is taken from your
savings or anything else you hold for a missed cycle.

- **One missed cycle** halves your income-backed and Boost limit, until you pay a later cycle's amount in full.
- **Two missed cycles in a row** pause your line: no new credit until the second amount is paid.
  Clear may then send a **cure notice**, which two people record on the chain.
- **Default** comes only if that amount is still unpaid when the grace period ends: 15 days after the
  second due date, and at least 10 days after the notice. Without a notice there is no default, and
  paying the amount cancels the notice.

When a line defaults, only what was past due can be collected from what backs it: pledged bonds
first, paid out early, then pool shares, which are redeemed through the pool's queue and never
seized. Savings are used only for what you drew against Savings. Anything beyond what you owe comes
back to you. If the default stands, Clear can also close the line, which two people record on the
chain; the whole balance is then due, and the savings held for your Savings tier can be applied to
it.

**Paused time never counts against you.** While the savings vault or your account is paused, no
cycle is judged missed and no default can be declared, and due dates and grace periods move back by
the time the pause lasted.

## Your term limit and paying over time

**Paying over time turns one shop purchase into a plan**, split across cycles. Plans draw only on
your term limit, never on your card's credit line.

### Your term limit

Your term limit is not set from a credit score. It starts at $500.00 once your identity check has
passed, and grows by $250.00 for every three instalments you pay on time. Growth past $500.00 is
capped by your deposits, and the automatic rule stops at $5,000.00. A new plan has to fit inside what's left of it, so clearing a plan early
frees its share straight away.

### Opening a plan

At a shop, choose **Pay over time** on the charge and pick how to split it:

- **Next cycle** — the whole amount, at the end of this cycle
- **In 2**, **In 4** or **In 12** cycles

Paying over time is for charges of $50 or more; below that, a charge is paid now. Some shops,
especially online, offer Pay now only. Paying in full is free, and so is a plan under $100;
otherwise each plan has its own rate, and the sheet shows your first
payment and the rate before you approve. How the charge itself works is in
[Paying at Clear shops](./paying-at-shops.md#approving-a-charge).

### Paying a plan

Open a plan from **Term plans** on Home. Each plan shows what you owe today, your next payment and
what's still owed. You can pay from Ready to allocate or from savings that aren't backing credit.
Paying early always costs less.

With auto-clear on, installments are cleared from money arriving in Spendable as they fall due —
never ahead of schedule. USDC in Ready to allocate is never taken.

### Changing a split

From a plan's sheet, **Change split** spreads what's left over a new number of cycles. You can't
change a split while you're behind. A plan can be re-split up to three times, at least one installment apart.

### Falling behind on a plan

If you miss an installment, the plan's sheet shows what's behind and the date to catch up by.

**A plan that falls two installments behind defaults.** When that happens:

- what you owe on your plans is written off and your open plans close
- term plans are paused and your term limit goes to zero
- your card, savings and membership are not affected

Time while the savings vault or your account is paused doesn't count toward a plan falling behind.

There are two ways back. Pay back what was written off: **Term plans → Limit** shows what's left
and a **Pay it back** button, and term plans reopen once it is fully repaid. Or, after six clean
cycles on your card's credit line, the co-op reopens them. Either way, Clear then sets a new term
limit; until it does, the limit stays at zero.

## Related

- [The Clear Visa card](./clear-visa-card.md)
- [Paying at Clear shops](./paying-at-shops.md)
- [Disputes](./assurance-and-disputes.md#disputes) — a disputed amount is held and charged no carry
- Who sets credit parameters: [Governance](../governance/README.md)
- The contracts: [Protocol → Credit](../protocol/credit.md)
