# Credit

Clear lends without a credit check. **You have two separate credit lines**, and they are never added
together:

| | Your credit line | Your term limit |
|---|---|---|
| What it's for | Spending on your card, beyond your cash | Paying for a shop purchase over time |
| Set by | What backs each tier — your savings, your bonds and pool position, your income | Your observed income |
| Where you see it | **Credit** on Home | **Term plans** on Home |

Both open once your identity is verified. See
[Getting started](./getting-started.md#verifying-your-identity).

## Your credit line

**Your credit line is made of tiers, each backed by something different.** Your limit is the sum of
the tiers you have.

| Tier | Backed by | How much it adds |
|---|---|---|
| **Savings** | Your CLRUSD | 100% of your savings. Free to use |
| **Assets** | Your bonds and lending-pool position | 95% of what your bonds are worth today, 70% of your pool position |
| **Income** | The income landing in your account | Half of your estimated monthly deposits |
| **Clear Boost** | Nothing — it's opt-in | Nothing until you add it |

**Savings and Assets are secured**: what you draw on them is already covered by what you hold.
**Income and Boost are unsecured**: nothing stands behind them but your next deposit.

Each tier except Savings carries a charge per cycle, called **carry**. The Credit card on Home shows
each tier's rate beside its name, and so does **Spends from** on the Card page. **Limit breakdown**
shows what backs each tier.

### Spending order

You never pick which tier pays. **Your card spends your cash first, then your credit, cheapest tier
first**: Savings, then Assets, then Income, then Boost.

When you repay, it works the other way round: **the most expensive tier clears first.**

### Your cycle

Your line runs in cycles. The cycle card on Home tells you where you stand:

| What it says | What it means |
|---|---|
| Nothing carried this cycle | You owe nothing |
| Using your own savings | You've only drawn on your savings. Nothing is owed, but those savings are held and your home path is paused until you top them back up |
| Your deposit covers this | You're carrying unsecured credit, and your next expected deposit covers it |
| To clear this cycle | You're carrying unsecured credit that your expected deposit won't cover. This is the one state that asks you to act |

What has to be cleared each cycle is the unsecured part — what you've drawn on Income and Boost —
plus any carry left over from a plan you've closed. Draws on Savings and Assets don't need clearing.

### Repaying

**Repay** on the cycle card puts money against what you carry, most expensive tier first. It comes
from Ready to allocate, and you can also repay from savings. If you repay more than you carry, the
rest spills into your Spendable balance.

### Automatic repayment

In **Settings → Advanced → Permissions**, **Repay from USDC deposits** turns on automatic repayment.
When a USDC deposit arrives, what you owe is repaid from it first, most expensive tier first, and
the rest is yours. A card purchase that is still pending isn't debt yet; it's repaid once it
settles. Turning the switch off clears anything set aside and the money is simply yours again.

### If a cycle ends and you still owe

Clear renews your cycle automatically when you owe nothing. If a cycle ends while you're still
carrying a balance, you enter a grace period:

- **During grace**, you can't draw new credit. Clearing what you owe brings your line back, and the
  next cycle starts.
- **If grace runs out with a balance still owed**, your line is in default. Your tiers are set to
  zero and the debt is written off on the co-op's books, and savings or bonds that were backing what
  you drew can be taken to settle it.

## Your term limit and paying over time

**Paying over time turns one shop purchase into a plan**, split across cycles. Plans draw only on
your term limit, never on your card's credit line.

### Your term limit

Your term limit is set from your observed income, not from a credit score, and only once your
identity check has passed. A new plan has to fit inside what's left of it, so clearing a plan early
frees its share straight away.

### Opening a plan

At a shop, choose **Pay over time** on the charge and pick how to split it:

- **Next cycle** — the whole amount, at the end of this cycle
- **In 2**, **In 4** or **In 12** cycles

Paying over time is for charges of $50 or more; below that, a charge is paid now. Some shops,
especially online, offer Pay now only. Each plan has its own rate, and the sheet shows your first
payment and the rate before you approve. How the charge itself works is in
[The Clear card and paying at shops](./card-and-shops.md#approving-a-charge).

### Paying a plan

Open a plan from **Term plans** on Home. Each plan shows what you owe today, your next payment and
what's still owed. You can pay from Ready to allocate or from savings that aren't backing credit.
Paying early always costs less.

With automatic repayment on, your installments are collected from USDC deposits as they fall due —
never ahead of schedule.

### Changing a split

From a plan's sheet, **Change split** spreads what's left over a new number of cycles. Anything you
are behind on stays due now; only the rest is re-spread. You can't change a split while you're
behind. A plan can be re-split up to three times, at least one installment apart.

### Falling behind on a plan

If you miss an installment, the plan's sheet shows what's behind and the date to catch up by.

**A plan that falls two installments behind defaults.** When that happens:

- what you owe on your plans is written off and your open plans close
- term plans are paused and your term limit goes to zero
- your card, savings and membership are not affected

To bring term plans back, pay back what was written off: **Term plans → Limit** shows what's left
and a **Pay it back** button. Once it is fully repaid the pause lifts, and a new term limit is set
from your income.

## Related

- [The Clear card and paying at shops](./card-and-shops.md)
- [Disputes](./assurance-and-disputes.md#disputes) — a disputed amount is held and charged no carry
- Who sets credit parameters: [Governance](../governance/README.md)
- The contracts: [Protocol → Credit](../protocol/credit.md)
