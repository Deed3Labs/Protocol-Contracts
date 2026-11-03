# The lending pool

`LendingPool` is an ERC-4626 vault over the reserve token (USDC in the deployed configuration).
Depositors put the token in and receive shares; the pool lends that cash to a short list of
borrowers and takes it back, with anything above principal. The contract's full behaviour is in [Settlement and the float](../protocol/settlement.md#lendingpool). Its address is in
the root [`README.md`](../../README.md#deployed-addresses).

## Shares and what they are worth

**A share is a claim on everything the pool owns, lent out or not.** The standard ERC-4626 calls
(`deposit`, `mint`, `withdraw`, `redeem`) work as the standard describes. No role or membership check
gates a deposit.

```
totalAssets = cash held + totalBorrowed − queuedAssets
```

| Term | What it is |
|---|---|
| `totalBorrowed` | Principal lent and not yet repaid, as the pool counts it |
| `queuedAssets` | What depositors who have queued a withdrawal are owed. Their shares are already burned |
| `availableCash()` | Cash held less `queuedAssets`. The most that can be lent or withdrawn now |

A share's value is `totalAssets` divided by the shares outstanding (`convertToAssets`). It rises when
cash comes back above what was lent. Nothing else in the contract raises it.

## What the pool lends to

**Only an address holding `BORROWER_ROLE` can borrow, and only up to `availableCash()`.** Nothing
grants the role at deploy. Two scripts grant it:

| Borrower | Granted by | When it borrows |
|---|---|---|
| `PayoutPool` | `scripts/upgrade_reserve_draw.ts` | When a merchant's payout claim has passed its payout window and the PayoutPool cannot pay it from its own cash. The lending pool is the first source it draws on ([What stands behind it](./what-stands-behind.md#merchant-payout-claims)) |
| The co-op's card-funding wallet | `scripts/grant_pool_borrower.ts` | When a member's card purchase settles on a pool-funded credit tier. The co-op's API borrows the same amount, and repays when that tier is repaid |

The pool-funded tiers are the unsecured ones: by default `INCOME` and `BOOST`, set in the API by
`POOL_FUNDED_TIER_KINDS`. Savings-backed and asset-backed credit is not funded from the pool. The
card-funding wallet's borrowing is driven by the co-op's API (`apps/api`, `poolFunding.ts`), not by
a contract: the pool records each `borrow` and `repay`, and nothing on-chain requires either to
happen. The merchant is paid in fiat from the co-op's float; the borrowed USDC reaches that float
through the co-op's periodic off-ramp.

Both borrowers fund credit that members repay over time, so the pool's cash is lent against member
repayments.

## How depositors are paid

**What comes back to depositors above principal is carry: the charge members pay on the float the
pool funded.** Carry is the charge on a member's credit, derived from each tier's `CarryIndex` ([Credit](../protocol/credit.md#carry)). It
reaches the pool by two routes, one for each borrower.

**Through the PayoutPool.** `scripts/configure-carry-recipients.mjs` names the PayoutPool as the
issuers' carry treasury, so carry they mint there reaches it as credits. `distributeCarry()` splits
it by the positions each party holds; the share that falls to positions the PayoutPool bought with borrowed cash is set aside as
`carryEarned`. When a member's repayment reaches the PayoutPool (`receiveRepayment`), it:

1. repays principal to its lenders, the lending pool first;
2. pays interest from what is left, up to `carryEarned`, split between its lenders by each one's
   share of what the PayoutPool owed before step 1. The lending pool takes the rounding remainder,
   and all of it when nothing was owed.

The lending pool's interest is sent as a plain token transfer. It adds to the pool's cash without
reducing `totalBorrowed`, so it raises the value of every share outstanding.

**Through the card-funding wallet.** Carry on a tier is written into that tier's principal whenever
it is materialised, so the amount the API repays when the tier is repaid includes the carry. It is
repaid through `LendingPool.repay`.

**`repay` does not track principal per borrower.** It lowers `totalBorrowed` by the whole amount
paid, floored at zero. While any other loan is still outstanding, the carry part of a repayment
lowers `totalBorrowed` instead of raising `totalAssets`, and so does not move the share price. It
reaches the share price only once `totalBorrowed` has fallen to zero.

### The rate curve is not charged

`borrowRatePerCycle()` and `supplyRatePerCycle()` compute a rate from the pool's utilisation, on a
curve the operator sets with `setRateCurve`. **No contract reads either.** `borrow` and `repay` move
principal only; nothing charges a borrower the curve's rate. What depositors receive is what comes
back above principal, as described above, and not what the curve reports.

### Timing

Nothing is time-weighted. `distributeCarry()` splits by positions held at the moment it is called,
and interest is split by what each lender was owed at the moment a repayment arrives. In the lending
pool itself, carry raises the value of the shares outstanding when the cash lands, so whoever holds
shares then shares in it, whenever they deposited.

## Withdrawing

**A depositor can withdraw only what the pool holds in cash.** `maxWithdraw` and `maxRedeem` are
capped by `availableCash()`, so they report what would succeed right now. When the cash is lent out,
the depositor queues:

1. `requestWithdrawal(shares, receiver)` burns the shares now and fixes the claim in assets at
   `previewRedeem`. From that moment the request no longer gains or loses with the pool.
2. `claimWithdrawal(id)`, called by the request's owner, pays it once the pool's cash covers that
   request.

Requests are **not paid in order**: any request whose amount the cash covers can be claimed, so a
smaller request can be paid before an earlier, larger one. Cash already owed to queued requests is
held back from lending and from ordinary withdrawals, since both see only `availableCash()`.

There is no date by which a queued request is paid. It is paid once the pool's cash, from repayments
or new deposits, covers it.

## Shares as collateral

**A member can pledge pool shares against credit.** The deploy script registers pool shares in
`CollateralRegistry` as `POOL_SHARE`, counted at 70% (`7_000` bps), at a fixed unit price per share
rather than at the share's current `convertToAssets` value. Details are in
[Credit](../protocol/credit.md#collateral-and-the-ceiling).

- Shares the registry reports as backing drawn credit (`encumberedOf`) cannot be transferred. If the
  registry cannot be read, nothing is treated as pledged.
- The lock applies to burns too: a holder's own `withdraw`, `redeem` or `requestWithdrawal` burns
  shares, and is refused for shares backing drawn credit.
- `seizeShares` (`LIQUIDATOR_ROLE`) can take only pledged shares. On a default, the `Liquidator`
  seizes them, redeems what the pool can pay now and queues the rest, so recovery waits on the pool's
  cash like any other withdrawal.

## Losses

`absorbLoss` (`LOSS_REPORTER_ROLE`) writes down `totalBorrowed`, which lowers the share price. The
contract's design is that depositors take the first loss on what the pool funded. **No contract calls
`absorbLoss`.** What follows from that is in [Risks](./risks.md#credit-losses).

## Who controls the pool

| Role | Can |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Grant and revoke every role; upgrade the contract (UUPS) |
| `OPERATOR_ROLE` | `setRateCurve`, `setEncumbranceSource` |
| `BORROWER_ROLE` | `borrow` |
| `LOSS_REPORTER_ROLE` | `absorbLoss` |
| `LIQUIDATOR_ROLE` | `seizeShares` |

`repay` is open to anyone. Who holds each role is in [Governance](../governance/README.md).
