# What stands behind it

The contracts pay from fixed sources in a fixed order. This page sets out that order for the two
places contributed money is at stake: a bond coming due, and a merchant's payout claim that the
lending pool may be asked to fund. The detail is in [The reserve](../protocol/reserve.md) and
[Settlement and the float](../protocol/settlement.md).

| | Bonds at maturity | Merchant payout claims |
|---|---|---|
| First | BondVault holdings | The PayoutPool's own cash |
| Then | Treasury allowance to the vault | Lending pool's available cash |
| Then | AssurancePool excess, then buffer | BondVault's deployable excess |
| Then | | Treasury allowance to the PayoutPool |
| Last | | AssurancePool excess, then buffer |
| Never | AssurancePool primary reserve | AssurancePool primary reserve |

## The AssurancePool's three tiers

**The AssurancePool holds the reserve in three tiers, and only one of them lends.** Each tier is a
number in reserve-token units ([The reserve](../protocol/reserve.md#three-tiers)).

| Tier | What spends it | Lent to the BondVault or PayoutPool |
|---|---|---|
| Primary | `reimburse`, for lost debt, once the buffer is empty | Never |
| Buffer | `reimburse` first | Only while `hasValidRTD()` is true, and only after excess |
| Excess | Withdrawals by an allowlisted instrument | First |

RTD is the primary reserve divided by what it stands behind: members' exposure plus the bond gap
(`bondExposure()`, below). `hasValidRTD()` is true when RTD is at or above the target. So the buffer
is lent only while the primary reserve is at target, and the primary reserve is never lent.

The excess is not held for contributors. An address on the `withdrawalCallers` allowlist can withdraw
it. The list is empty on a fresh deployment and no deploy script adds anyone; who can add to it is in
[Governance](../governance/README.md).

## Bonds at maturity

**A bond is paid from the BondVault, then the treasury's allowance, then the AssurancePool.**
`BondVault._cover` runs when a holder redeems a matured bond:

1. **The vault's holdings** (`held()`), its balance of the reserve token.
2. **The treasury**, up to `treasuryAvailable()`: the lesser of the allowance the Safe has given the
   vault and the Safe's balance. This is a contribution, not a loan. It comes back to the Safe as
   deployable excess.
3. **The AssurancePool**, through `lendToBondVault`: excess first, then buffer while `hasValidRTD()`
   holds. What it lends is recorded in `owedToReserve`.

If the three together fall short, the redemption reverts and nothing moves.

What the vault owes the AssurancePool is repaid from money above `requiredReserve()`, before the Safe
can withdraw anything: `withdrawDeployable` repays first, and `repayReserve()` is open to anyone.

**The bond gap counts in the reserve's ratio.** `BondVault.uncoveredNearTerm()` is the face value due
inside the reserve window that the vault's holdings and the treasury's allowance cannot pay.
`AssurancePool.bondExposure()` adds it to the RTD denominator, so a gap lowers RTD and raises the
reserve the target calls for.

**Bond money is kept apart from the credit book.** Proceeds sit in the vault, not the AssurancePool.
The AssurancePool has no function that pulls from the vault; the vault calls it only to borrow and to
repay. The vault lends to the PayoutPool only from its deployable excess, never from the redemption
reserve.

## Merchant payout claims

**When a merchant's claim has come due and the PayoutPool cannot pay it, `drawForDueClaim()` borrows
for it.** Claims are paid strictly in order. Anyone may call it for the next unpaid claim once that
claim's payout window has run out. It draws the shortfall
from each source in turn, each only for what the one before could not cover:

1. **The lending pool**, up to its `availableCash()`. Recorded in `borrowedFromYield`.
2. **The BondVault**, from its deployable excess only. Recorded in `borrowedFromVault`.
3. **The treasury**, up to the Safe's allowance to the PayoutPool. This is capital, not a loan: it
   buys the position it pays for.
4. **The AssurancePool**: excess, then buffer while `hasValidRTD()` holds, never primary. Recorded in
   `borrowedFromReserve`.

The lending pool is first. Its depositors' cash is the first money lent to pay a merchant.

### Repayment order

**A member's repayment repays the PayoutPool's lenders before it settles anything else.**
`receiveRepayment` takes the part of each repayment routed to the PayoutPool and:

1. repays **principal**: the lending pool, then the BondVault, then the AssurancePool, each up to what
   it is owed;
2. pays **interest** from what is left, up to `carryEarned`, split between the three by each one's
   share of what the PayoutPool owed before step 1.

The lending pool is repaid principal first. Interest is shared pro rata, not in order. How interest
reaches lending pool depositors is in [The lending pool](./lending-pool.md#how-depositors-are-paid).

## What does not stand behind the lending pool

**Nothing in the contracts covers a loss on money the lending pool has lent.**

- The AssurancePool lends to the PayoutPool and the BondVault. It does not lend to, or reimburse, the
  lending pool.
- `LendingPool.absorbLoss` reports a loss larger than the pool as `uncovered` in an event. No
  contract acts on it.
- The AssurancePool's primary reserve pays lost debt through `reimburse` to whoever retires it with
  `StableCredit.burnLostDebt`. No contract routes that to the lending pool.

See [Risks](./risks.md#credit-losses).

## The treasury's allowances are discretionary

Both treasury steps read the allowance the Safe has given each contract, at the moment of the draw.
The Safe's owners set those allowances themselves, and can lower them to zero. A zero allowance means
that step contributes nothing and the next one is asked. Who the Safe's owners are is in
[Governance](../governance/README.md).
