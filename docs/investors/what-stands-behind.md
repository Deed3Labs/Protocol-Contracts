# What stands behind it

The contracts pay from fixed sources in a fixed order. Contributed money is at stake in two places:
a bond coming due, and a merchant's payout that the lending pool may be asked to fund. The detail is
in [The reserve](../protocol/reserve.md) and
[Settlement and the float](../protocol/settlement.md).

| | Bonds at maturity | Merchant payout claims |
|---|---|---|
| First | Bond vault holdings | The payout pool's own cash |
| Then | Treasury allowance to the vault | Lending pool's available cash |
| Then | AssurancePool excess, then buffer | Bond vault's deployable excess |
| Then | | Treasury allowance to the payout pool |
| Last | | AssurancePool excess, then buffer |
| Never | AssurancePool primary reserve | AssurancePool primary reserve |

## The AssurancePool's three tiers

**The AssurancePool is the co-op's reserve against member defaults. It holds its money in three
tiers, and the primary tier is never lent.** Each tier is an amount in USDC
([The reserve → Three tiers](../protocol/reserve.md#three-tiers)).

| Tier | What it pays for | Lent to the bond vault or payout pool |
|---|---|---|
| Primary | Debt written off after a member defaults, once the buffer is empty | Never |
| Buffer | Written-off debt, before the primary tier | Only while the reserve ratio is at target, and only after the excess |
| Excess | Withdrawals by an approved address | First |

The reserve ratio, RTD (reserve to debt), is the primary reserve divided by what it stands behind:
the part of members' credit that collateral does not cover, plus the bond gap (below). The buffer is
lent only while that ratio is at or above its target, so it is lent only while the primary reserve
is at target. The primary reserve is never lent.

The excess is not held for contributors. An address on the AssurancePool's withdrawal list can
withdraw it. The list is empty when the pool is deployed, and no deployment step adds anyone. Who
can add to it is in [Governance](../governance/README.md).

## Bonds at maturity

**A bond is paid from the bond vault, then the treasury's allowance, then the AssurancePool.** When
a holder redeems a matured bond, the vault pays from:

1. **Its own holdings** of USDC.
2. **The treasury**, up to the lesser of the allowance the co-op's Safe has given the vault and what
   the Safe holds. This is a contribution, not a loan. It comes back to the Safe as deployable
   excess.
3. **The AssurancePool**: excess first, then buffer while the reserve ratio is at target. The vault
   records what it borrows.

If the three together fall short, the redemption fails and nothing moves.

What the vault owes the AssurancePool is repaid from money above the redemption reserve, before the
Safe can withdraw anything. Anyone can trigger that repayment.

**The bond gap counts in the reserve ratio.** The bond gap is the face value due within the reserve
window that neither the vault's holdings nor the treasury's allowance can pay. It is added to what
the AssurancePool stands behind, so a gap lowers the ratio and raises the reserve the target calls
for.

**Bond money is kept apart from the credit book.** Proceeds sit in the vault, not the AssurancePool.
The AssurancePool has no way to pull money from the vault; the vault only borrows from it and repays
it. The vault lends to the payout pool only from its deployable excess, never from the redemption
reserve.

## Merchant payout claims

**When a merchant's payout has come due and the payout pool cannot pay it, the payout pool borrows
for it.** Payouts are paid strictly in order. Once the next unpaid payout's window has run out,
anyone can trigger the borrowing. It draws the shortfall from each source in turn, each only for
what the one before could not cover:

1. **The lending pool**, up to its available cash.
2. **The bond vault**, from its deployable excess only.
3. **The treasury**, up to the allowance the co-op's Safe has given the payout pool. This is
   capital, not a loan: the treasury takes the position it pays for.
4. **The AssurancePool**: excess, then buffer while the reserve ratio is at target, never primary.

The lending pool comes first. Its depositors' cash is the first money lent to pay a merchant.

### Repayment order

**A member's repayment repays the payout pool's lenders before it settles anything else.** From the
part of each repayment that goes to the payout pool, it:

1. repays what was **lent**: the lending pool, then the bond vault, then the AssurancePool, each up
   to what it is owed;
2. pays **carry** from what is left, up to the carry set aside for its lenders, split among the three
   in proportion to what each was owed before step 1.

The lending pool is repaid first. Carry is shared in proportion, not in order. How it reaches the
lending pool's depositors is in [The lending pool](./lending-pool.md#how-depositors-are-paid).

## What does not stand behind the lending pool

**Nothing in the contracts covers a loss on money the lending pool has lent.**

- The AssurancePool lends to the payout pool and the bond vault. It does not lend to, or reimburse,
  the lending pool.
- If a loss larger than the whole pool were written down, the pool would report the uncovered part
  in a public event. Nothing acts on it.
- The AssurancePool's primary reserve pays for written-off debt to whoever retires that debt on the
  credit ledger. Nothing routes that payment to the lending pool.

See [Risks](./risks.md#credit-losses).

## The treasury's allowances are discretionary

Both treasury steps read the allowance the co-op's Safe has given each contract at the moment of the
draw. The Safe's owners set those allowances themselves, and can lower them to zero. A zero allowance
means that step contributes nothing and the next source is asked. Who can sign for the Safe can be
read on the chain: see
[On-chain authority → Who holds each role today](../governance/on-chain-authority.md#who-holds-each-role-today).
