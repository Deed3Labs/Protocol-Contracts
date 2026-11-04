# The lending pool

The lending pool (the `LendingPool` contract) holds money that depositors put in, and lends it for a
time to fund members' credit. When members repay, the money comes back to the pool, together with
the carry they paid on it. The pool holds and pays out a single token: USDC, in the deployed setup.

The pool follows ERC-4626, a common standard for vaults on Ethereum-compatible chains, so standard
wallets and block explorers can read it. Its full behaviour is in
[Settlement and the float](../protocol/settlement.md#lendingpool), and its address is listed under
[Deployed addresses](../../README.md#deployed-addresses).

## Shares and what they are worth

**A depositor receives shares. Each share is a claim on everything the pool owns, whether it is
held as cash or lent out.** Anyone can deposit; the pool does not check membership. Members can
deposit from Earn in the member app.

The pool counts what it owns as:

- the cash it holds,
- plus what it has lent and not yet been repaid,
- less what it already owes depositors waiting in the withdrawal queue (see
  [Withdrawing](#withdrawing)).

A share is worth that total divided by the number of shares. Its value rises when money comes back
to the pool above what was lent. Nothing else raises it.

## What the pool lends to

**Only borrowers the pool's admin has approved can borrow, and only from cash the pool holds.** No
borrower is approved when the pool is deployed; the co-op's setup approves two:

| Borrower | When it borrows |
|---|---|
| The payout pool | When a merchant's payout has come due and the payout pool cannot pay it from its own cash. The lending pool is the first source it borrows from ([What stands behind it](./what-stands-behind.md#merchant-payout-claims)) |
| The co-op's card-funding wallet | When a member's card purchase settles on a credit tier the pool funds. It repays when the member repays that tier |

**The pool funds unsecured credit only:** by default, the income-based tier and Boost. Credit backed
by savings or by other assets is not funded from the pool.

The card-funding wallet's borrowing and repayment are run by the co-op's server, not by a contract.
The pool records each loan and each repayment, but nothing on the chain makes either happen.
Merchants are paid in dollars from the co-op's float; the borrowed USDC reaches that float when the
co-op periodically converts it to dollars.

Both borrowers fund credit that members repay over time, so the pool's cash is lent against what
members will repay.

## How depositors are paid

**What comes back to depositors above what was lent is carry: the charge members pay on the credit
the pool funded.** How carry is charged is in [Credit → Carry](../protocol/credit.md#carry). It
reaches the pool by two routes, one for each borrower.

**Through the payout pool.** Carry on members' credit is paid to the payout pool, which divides it
among everyone whose money paid merchants, in proportion to what each put up. The part earned by
money the payout pool borrowed is set aside for its lenders. When a member's repayment reaches the
payout pool, it:

1. repays what it borrowed, the lending pool first;
2. pays its lenders the carry set aside for them, split by how much each had lent.

The lending pool's carry arrives as cash on top of what it lent, so it raises the value of every
share.

**Through the card-funding wallet.** Carry on a pool-funded tier is added to what the member owes on
that tier. When the tier is repaid, what the wallet repays to the pool includes the carry.

**The pool does not track each borrower's loan separately.** Every repayment lowers the pool's total
amount lent by the full amount paid. While any other loan is still outstanding, the carry part of a
card-funding repayment counts as repaid principal and does not raise the value of a share. It
reaches share value only once nothing is left on loan.

### The rate curve is not charged

The pool reports a borrowing rate and a supply rate, worked out from how much of the pool is lent
out. **Nothing charges or pays either one.** Borrowing and repaying move only the amounts lent. What
depositors receive is what comes back above what was lent, as described above, not what those
reported rates show.

### Timing

Nothing is weighted by time. Carry is divided by what each party has put up at the moment it is
divided, and the payout pool pays its lenders by what each was owed when a repayment arrives. Inside
the lending pool, carry raises the value of every share when the cash lands, so whoever holds shares
at that moment shares in it, however recently they deposited.

## Withdrawing

**A depositor can withdraw only what the pool holds in cash.** The pool's figures for the most a
depositor can withdraw are capped by its available cash, so they show what would succeed right now.
When the cash is lent out, the depositor joins a queue:

1. Asking to withdraw burns the shares straight away and fixes the amount owed, in USDC, at that
   moment's share value. From then on the request no longer gains or loses with the pool.
2. The depositor claims the money once the pool's cash covers that request.

Requests are **not paid in order**. Any request the cash covers can be claimed, so a smaller, later
request can be paid before an earlier, larger one. Cash already owed to queued requests is held back
from lending and from ordinary withdrawals.

There is no date by which a queued request is paid. It is paid once repayments or new deposits
bring in enough cash.

## Shares as collateral

**A member can pledge pool shares against credit.** Pledged shares count at 70% of a fixed price per
share, not at a share's current value. Limits and haircuts are in
[Credit → Collateral and the ceiling](../protocol/credit.md#collateral-and-the-ceiling).

- Shares that back credit a member has drawn cannot be transferred, withdrawn or queued for
  withdrawal until that credit is paid down. If the record of pledges cannot be read, no shares are
  treated as pledged.
- After a default, pledged shares can be seized only by an address holding the pool's liquidator
  permission, and the co-op's setup does not give that permission to the liquidator contract. Until
  it does, pledged pool shares are not seized. Seized shares are withdrawn for what the pool can pay
  now and queued for the rest, so recovery waits on the pool's cash like any other withdrawal.

## Losses

The pool has a way to write down a loss: it lowers the amount counted as lent, which lowers the
value of every share. By design, depositors take the first loss on what the pool funded. **No
contract or service writes losses down today.** What follows from that is in
[Risks](./risks.md#credit-losses).

## Who controls the pool

- **The pool's admin** can grant and remove every other permission, and can replace the pool's code
  (an upgrade).
- **The operator** sets the reported rate curve and where pledges of pool shares are recorded.
- **Approved borrowers** can borrow.
- **The loss reporter** can write down losses.
- **The liquidator** can seize pledged shares.

Anyone can repay the pool. Who holds each permission is in
[Governance → On-chain authority](../governance/on-chain-authority.md).
