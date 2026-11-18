# Savings and equity credits

Two different things sit on the Savings page. **Your savings are your money**, and you can take them
out at any time. **Your equity credits are not money.** They can't be withdrawn or cashed in; they
only count toward your [Clear Deed](./clear-deed-and-membership.md#your-clear-deed).

## Savings

**When you save, your dollars become CLRUSD, one-for-one.** USDC goes into Clear's savings vault and
the same amount of CLRUSD comes back to you. Move it back to cash and the vault returns the same
number of dollars. How to move money in and out is in
[Adding and moving money](./adding-and-moving-money.md#moving-money-between-cash-and-savings).

- **Your CLRUSD balance is your savings.** It is yours and stays liquid.
- **Savings pay no interest.** CLRUSD pays nothing to holders.
- **Savings back your credit line, dollar for dollar**, automatically unless you turn that off.
  Spending against them is free. See [Credit](./credit.md#what-backs-your-line-automatically).
- **Savings that back credit you've drawn are held** until that credit is repaid. Apart from that,
  only a pause can stop you moving them, and a pause is short: see
  [How the money works](../overview/how-the-money-works.md#savings).

On the Savings page, **What you hold** splits your balance into cash (CLRUSD), vested credits and
credits still vesting, and shows what your savings add to your credit line.

## Equity credits

### How you earn them

**Matched savings.** Every whole dollar you move into savings earns one equity credit — up to 1,500
matched credits in a calendar month. Auto-save deposits count the same as any other.

**On-time rent and bills through Clear Pay.** A payment counts as on time if it is made no more than
three days after its due date.

| Payment | Base credits |
|---|---|
| Rent | 200 for each on-time payment |
| Any other bill | 10% of the amount paid, up to 500 for one bill |

The base is then multiplied by your **multiplier**. It starts at 1× and rises by 0.25× for every six
months in a row you've paid on time, up to 1.5×.

So on-time rent earns between 200 and 300 credits. The multiplier applies to rent and bill credits,
not to matched savings. Plans are explained in
[Membership and settings](./clear-deed-and-membership.md#membership-plans).

### Vesting

**New credits vest after 30 days.** Until then they show as vesting, beside your vested credits in
**What you hold**. Each award also arrives as a notification saying how many credits you earned.

Matched credits are the ones that can be undone while they vest: move savings back out within those
30 days and the matching credits are cancelled, newest first, up to the amount you moved. Vested
credits are kept.

If your savings are backing credit you've drawn, the Savings page shows your home path as **Paused**
and offers **Top off** to put money back into savings.

### What credits do

- They count toward your Clear Deed, which is reached at 15,000 credits.
- They unlock your protections. See [Assurance](./assurance-and-disputes.md#your-protections).
- **They can't be withdrawn, sold or redeemed for cash.**

### On track for

With auto-save running, the Savings page shows the month you're on track to reach the Clear Deed.
It is worked out from auto-save alone; rent and bill credits aren't projected. Without auto-save,
there's no date.

## Bonds on Earn

Earn holds bonds and the [lending pool](#the-lending-pool-on-earn). It is open before identity
verification, like savings.

**A BurnerBond is a fixed-term bond.** You pay less than its face value today, and at maturity it
is worth its face value. Buying one:

1. On Earn, choose a face value and a term. The sheet shows what you pay today, what you receive at
   maturity, and what the bond adds to your credit limit.
2. Confirm. The price is taken from your cash account.

**A bond can back your credit line** at 95% of what it is worth today, as part of the asset-backed
tier. A bond backs your line only once you agree, and that agreement includes what happens to it at
maturity. A bond backing your line can't be moved to anyone else. See
[Credit](./credit.md#your-credit-line).

### When a bond matures

You choose what happens at maturity, and you can change your choice before then from the bond's
sheet:

- **Roll it over** — the default. It becomes a new bond and keeps backing your line.
- **Take the cash** — redeem it for its face value, paid to Ready to allocate.

**A bond that backs your line pays out in two parts if you take the cash.** At maturity, the part
needed to keep your asset-backed credit within its limit without this bond repays that credit first,
and the rest is paid to you. Rolling it over keeps it backing your line.

If your credit line defaults, a bond backing it can be paid out early, before maturity, to settle
what was past due. Anything beyond that is paid to you.

## The lending pool on Earn

**The lending pool is money you lend to Clear Lending**, which funds members' credit with it.
Clear Lending draws from the pool and pays it back, with interest on what it has drawn. It is not
savings:

- it doesn't become CLRUSD, and it earns no equity credits
- the money can be lent out when you want it back (see below)
- **nothing covers a loss on what the pool has lent.** If lent money isn't repaid, every position in
  the pool is worth less

### What your position is

Your position is a share of everything the pool owns: its cash, what Clear Lending has drawn, and
interest due on it. **It grows as Clear Lending pays interest** on what it has drawn, at the pool's
Funding Rate, which rises as more of the pool is lent out. A loss on what was lent lowers it, and
nothing guarantees it.

The pool's cell on Earn shows:

- **your position**, what it is worth today
- **Earned**, what it is worth now less what you put in
- how much of the pool is lent out
- what your position adds to your credit limit

The cell and the Deposit sheet also show a rate, and the sheet a yearly figure worked out from it.
That rate is today's Funding Rate spread over the whole pool, lent out or not. It changes as the
pool's lending changes, and it is not a promise.

### Adding to the pool

**Deposit** moves money from Ready to allocate into the pool. The least you can put in at a time is
$250. Before you confirm, the sheet shows what it adds to your credit line: **70% of what you put
in**, as part of the asset-backed tier. See [Credit](./credit.md#your-credit-line).

### Taking money out

**Withdraw** returns money to Ready to allocate. **You can only take out what the pool holds in cash
right now**, because the rest is lent out.

- If you ask for more than that, the sheet splits it: **Available now** comes back straight away,
  and the rest is **Queued**. A queued amount stays in the pool until it is paid: it keeps sharing
  in what the pool earns and loses, and is paid at what it is worth then. Queued amounts are paid
  oldest first.
- **Paying out a queued withdrawal.** Not available yet.
- **Taking money out lowers your credit limit** by 70% of the amount. Pool money backing credit
  you've drawn can't leave until that credit is repaid. If a withdrawal would leave your limit below
  what you've drawn, the sheet says by how much. Repay that much from the cycle card on Home first,
  then withdraw.
- **Repaying and withdrawing in one step.** Not available yet.
- **While a loss is being assessed**, the pool can set aside an allowance for it. A withdrawal then
  pays a matching share less, and holds the rest for you. What is held is paid to you later, as the
  allowance comes down or after at most 540 days, unless the loss turns out to need it.
- **The pool can be suspended** for a short time, for a loss, a legal order, or a problem with USDC
  or the network. Nothing goes in or out while it is, and it never lasts past 30 days except under a
  legal order.

How the pool lends, how depositors are paid and how withdrawals queue, in full:
[Investors → The lending pool](../investors/lending-pool.md).

## Related

- [Credit](./credit.md)
- [Your Clear Deed](./clear-deed-and-membership.md#your-clear-deed)
- The contracts: [Protocol → Savings](../protocol/savings.md), [Protocol → Bonds](../protocol/bonds.md)
