# Earn

Earn is where members can lend to Clear Lending, the co-op's lending company, in two ways: by
holding **bonds**, or by putting money in **the lending pool**. Both can back your credit line.

**Earn is offered only to qualifying members, and only in the app.** Nothing on this page is an
offer. It sets no terms, states no returns, and makes no claim about what anything on Earn will
earn.

**Status.** The smart contracts behind Earn have not been independently audited, and they run on Base
Sepolia, a test network, where nothing is real money.

## Earn is not savings

| | Savings | Earn |
|---|---|---|
| What you hold | CLRUSD, one-for-one with the dollars you saved | Bonds, and a position in the lending pool |
| Equity credits | Every dollar saved can earn them | None |
| Taking it out | Any time | Lending pool: only what the pool holds in cash, the rest waits in a queue. Bonds: at maturity |
| What it's worth | The dollars you saved | It can be worth less than you put in. See [If a loss happens](#if-a-loss-happens) |

Savings is explained in [Savings and equity credits](./savings-and-equity-credits.md).

## Who can use Earn

**Before you can buy a bond or add to the lending pool, you need an eligibility check on file.** A
check lasts at most 12 months. It records your net worth, and your Earn holdings, counted at what
you paid, can't be more than 10% of it.

- The least you can put in at a time is $250, for a bond or for the pool.
- One household can hold only so much of the lending pool.
- If you don't meet any of these, the move doesn't go through, and nothing leaves your account.

**Getting checked in the app.** Not available yet.

## The Earn page

**Earn** is in the main menu, and on Home under **Ready to allocate** when you have money there. At
the top:

- **Earning**: your lending pool position plus what you paid for your bonds, split by product.
- **Earned**: what your pool position has gained or lost, plus what your bonds are worth today
  above what you paid.
- **Backs your limit**: what Earn adds to your credit limit. That's 70% of your pool position plus
  95% of what your bonds are worth today.

Below that are the lending pool's card, **Buy a bond**, and **Your bonds**. On a phone, the
**Buy** button in the menu opens the bond sheet.

## The lending pool

**The lending pool is money you lend to Clear Lending**, which funds members' credit with it.
Clear Lending draws from the pool and pays it back, with interest on what it has drawn.

### What your position is

Your position is a share of everything the pool owns: its cash, what Clear Lending has drawn, and
interest due on it. **It grows as Clear Lending pays interest** on what it has drawn, at the pool's
Funding Rate, which rises as more of the pool is lent out. A loss lowers it, and nothing guarantees
it.

The pool's card shows:

- **Your position**: what it is worth today.
- **Earned**: what it is worth now, less what you put in.
- How much of the pool is lent out.
- **Backs limit at 70%**: what your position adds to your credit limit.

The card and the deposit sheet also show a rate, and the sheet shows a yearly figure worked out
from it. That rate is today's Funding Rate spread over the whole pool, lent out or not. It changes
as the pool's lending changes, and it is not a promise.

### Adding to the pool

**Deposit** moves money from Ready to allocate into the pool. Before you confirm, the sheet shows
your position afterwards and what the deposit adds to your credit line: **70% of what you put in**.
See [Earn and your credit line](#earn-and-your-credit-line).

### Taking money out

**Withdraw** returns money to Ready to allocate. **You can take out only what the pool holds in
cash right now**, because the rest is lent out. The sheet shows how much of your position is free.

- **If you ask for more than that, the sheet splits it.** **Available now** comes back straight
  away, and the rest is **Queued**. A queued amount stays in the pool until it is paid: it keeps
  sharing in what the pool gains and loses, and is paid at what it is worth then. Queued amounts are
  paid oldest first, as Clear Lending repays the pool and new money comes in. There is no date by
  which a queued amount is paid.
- **While anything is queued, nobody can withdraw on demand**, and the pool lends nothing new.
- **Seeing or cancelling a queued withdrawal.** Not available yet.
- **Taking money out lowers your credit limit** by 70% of the amount. Pool money backing credit
  you've drawn can't leave until that credit is repaid. If a withdrawal would leave your limit below
  what you've drawn, the sheet shows the most you can take now. Repay from the cycle card on Home
  first, then withdraw.
- **Repaying and withdrawing in one step.** Not available yet.

### When the pool pauses

- **While a loss is being assessed**, the pool can set aside an allowance for it. A withdrawal then
  pays a matching share less, and holds the rest for you. What is held is paid to you later, as the
  allowance comes down or after at most 540 days, unless the loss turns out to need it.
- **The pool can be suspended** for a short time, for a loss, a legal order, or a problem with USDC
  or the network. Nothing goes in or out while it is, interest keeps building, and a suspension
  never lasts past 30 days in total except under a legal order.
- **A legal order** can freeze one member's position, and only that position.
- **New deposits can pause** while the bond vault is short of its reserve, or while less than half
  the pool has been lent out for 30 days in a row. These pauses never stop a withdrawal.

A position can move only between two of your own accounts, or, when someone dies, becomes
incapacitated, divorces or goes bankrupt, to the person entitled to it, once two signers approve.

## Bonds

**A bond costs less than its face value today, and pays its face value at maturity.** Nothing is
paid in between. What you receive is fixed when you buy: the face value, at maturity.

### Buying a bond

**Buy a bond** on Earn lists the terms on offer. For each term it shows what you pay today and what
you get at maturity. Longer terms are never priced to pay less than shorter ones.

**Buying a bond in the app.** Not available yet. If you try, the sheet says buying is paused, and
nothing is taken from your balance.

### Your bonds

**Your bonds** lists each bond with its face value, the month it matures, what you paid, the months
left and what it is worth today. A bond's worth today rises from what you paid to its face value
over its term. Tap a bond for its detail: what you paid, when it matures, the gain at maturity, and
what it adds to your credit limit.

### At maturity

**A bond pays its face value to Ready to allocate.** Once it has matured, **Settle** on the bond's
detail pays it. Anyone can settle a matured bond, so it may be paid before you press it.

- **A bond backing credit you've drawn pays out in two parts.** The part needed to keep your
  asset-backed credit within its limit without this bond repays that credit first, and the rest is
  paid to you.
- **If the bond vault is short,** the bond is paid what there is, and the rest is recorded as owed
  and paid as money arrives.

### Rolling a bond

**Nothing rolls on its own.** At least 20 days before maturity, Clear may post a roll notice for a
bond, with its new term, its rate and a deadline at least seven days before maturity. A bond rolls
into a new one only if you confirm that notice before its deadline. A rolled bond is the same term
or the nearest shorter one on offer. It keeps backing your line if the old one did, and any amount
too small to buy a whole new bond is paid to you.

**Confirming a roll notice in the app.** Not available yet.

### Getting out before maturity

**You can't redeem a bond early.** Bonds move only between two of your own accounts, so there's
nowhere to sell one. Two other ways out exist:

- **A buyback:** someone outside the bond vault offers to buy the bond, for no more than it is worth
  that day, and you sign to accept. A bond backing your credit line can't be bought back.
- **A wind-down:** if the bonds are wound down, sales stop, and 30 days later every bond can be paid
  what it is worth that day.

## Earn and your credit line

**Earn backs the asset-backed tier of your credit line.** A pool position counts at 70% of what it
is worth, and a bond at 95% of what it is worth today. How the tiers work is in
[Credit](./credit.md#your-credit-line).

- **Your pool position backs your line without asking each time**, like your savings. To stop it,
  turn off **Back my credit line with my Savings and Earn automatically** in **Settings → Advanced →
  Permissions**. Turning it off stops new backing only.
- **A bond backs your line only once you agree.** The agreement includes what happens to it at
  maturity: it repays the credit it was backing first, then pays the rest to you.
- **Money backing your line stays put.** A pool position backing credit you've drawn can't be
  withdrawn or moved, and a bond backing it can't be moved or bought back, until that credit is
  repaid.
- **Releasing a bond from your credit line.** Not available yet.

**If your credit line defaults, Earn backing it is used, never taken.** Pool shares backing it are
put in the ordinary withdrawal queue, only as many as are needed, and when they're paid the money
goes to what you owe and the rest to you. A bond backing it can be paid early, at what it is worth
that day: first to what you owe, then the rest to you.

## If a loss happens

**A loss on credit reaches the lending pool last.** When a member doesn't repay and Clear Lending
can't collect, the loss is absorbed in this order, and each layer is used up before the next takes
any of it:

1. **The member's own collateral**, where the credit was secured: pledged savings, bonds or pool
   positions. Only what they don't cover is a loss.
2. **Clear Lending's margin** for that period.
3. **Clear Lending's loss reserve.**
4. **The Credit Backstop** in the co-op's AssurancePool, for unpaid principal only, and only up to
   the coverage it has at that moment.
5. **Clear Lending's own capital.**
6. **The lending pool:** first what was held back from earlier withdrawals, then every position in
   proportion, queued amounts included.

**Bonds are not written down for a loss.** They are owed their face value. What pays it is limited
to the bond vault and the treasury's allowance to it; the AssurancePool doesn't pay bonds.

What to know about this order:

- **The order is binding.** It is part of the terms Clear Lending holds the pool's money on, and
  the steps on the chain follow it: pledged collateral pays first, the Credit Backstop pays only
  Clear Lending, and a loss reaches the pool only when two valuation signers post it, with
  evidence, taking it from held-back amounts first.
- **The Credit Backstop isn't a guarantee.** It can run out, and nothing requires the co-op to refill
  it.
- **The pool stands behind the whole credit book,** so it can take a loss on credit it didn't fund.
- **Until a loss is posted, positions count at full value.** Anyone who withdraws before then is paid
  at that value, and the loss falls on those who remain.

The full list of risks is in [Investors → Risks](../investors/risks.md).

## Related

- [Credit](./credit.md)
- [Investors → The lending pool](../investors/lending-pool.md) and
  [BurnerBonds](../investors/burner-bonds.md), in full
- [Investors → What stands behind it](../investors/what-stands-behind.md)
- The smart contracts: [Protocol → Bonds](../protocol/bonds.md),
  [Protocol → Settlement and the float](../protocol/settlement.md#lendingpool)
