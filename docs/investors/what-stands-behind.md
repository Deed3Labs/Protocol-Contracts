# What stands behind it

The contracts pay from fixed sources in a fixed order. Contributed money is at stake in two places:
the lending pool's money deployed to Clear Lending, and a bond coming due. The detail is in
[Settlement and the float](../protocol/settlement.md#lendingpool), [Bonds](../protocol/bonds.md) and
[The reserve](../protocol/reserve.md).

| | Bonds at maturity | Lending pool deployments |
|---|---|---|
| First | Bond vault holdings | Returns from Clear Lending: interest, then principal |
| Then | Treasury allowance to the vault | |
| If still short | Paid what there is; the rest recorded as owed and paid as money arrives | A loss charge lowers the value of every share |
| Under an Enforcement Notice | The Collateral Agent's distribution rounds | |
| Never | The AssurancePool | The AssurancePool, directly. Its Credit Backstop pays Clear Lending, ahead of the pool ([below](#what-stands-in-front-of-the-lending-pool)) |

## The AssurancePool

**The AssurancePool is the co-op's reserve. It holds USDC in separate compartments, lends nothing,
and no lending pool, bond or payout contract holds its address.** Nothing on the Earn side can draw
on it ([The reserve](../protocol/reserve.md)).

| Compartment | What it pays | How money leaves |
|---|---|---|
| Credit Backstop | Principal Clear Lending has charged off | A draw: Clear Lending requests it, a co-op signer approves it, a different signer releases it, only to Clear Lending's loss-reserve address |
| Member Assurance | Member Assurance grants | Two signers release each grant, only to the co-op's Assurance disbursement address |

A draw is released only within the available coverage: the Credit Backstop's balance less draws
approved and not yet paid, capped at a coverage cap two signers post each month. The Credit
Backstop keeps a floor tied to the credit it covers, and money moves between compartments only by a
proposal one signer makes and a different signer carries out, after at least 14 days unless it moves
into the Credit Backstop.

## Bonds at maturity

**A bond is paid from the bond vault, then the treasury's allowance.** When a matured bond is
settled, the vault pays from:

1. **Its own holdings** of USDC. The Redemption Reserve keeps back every bond due within 90 days
   that will not roll, and a glide schedule across the rest, never less than 30% of what is
   outstanding ([BurnerBonds → Where the proceeds go](./burner-bonds.md#where-the-proceeds-go)).
2. **The treasury**, up to the lesser of the allowance it has given the vault and what it holds. This
   is a contribution, not a loan.

If the two together fall short, the bond is paid what there is and the rest is recorded as owed.
What is owed is kept back ahead of anything else, and anyone can trigger its payment as money
arrives. While any of it is owed, no bond can be bought back.

**Bond money is kept apart.** The vault's USDC is the bonds' collateral, held for bondholders
under the Collateral Agent. The vault has no path to or from the AssurancePool, and it lends
nothing: not to the payout pool, not to the lending pool. Above the reserve, money leaves only to
Clear Lending's registered multisig, through the Collateral Agent.

**Under an Enforcement Notice**, the Collateral Agent pays bondholders in rounds, in proportion to
each bond's amount due at the time of the notice, and every other payment out of the vault stops
([BurnerBonds → The Collateral Agent](./burner-bonds.md#the-collateral-agent)).

## Lending pool deployments

**Money the lending pool deploys comes back only as Returns from Clear Lending.** Members' credit
repayments go to Clear Lending, apart from what the payout pool is owed; Clear Lending pays the pool
interest at the Funding Rate and returns what was deployed. Interest is billed each month, and
interest left unpaid past its due date is added to the Deployed Balance
([The lending pool → How holders are paid](./lending-pool.md#how-holders-are-paid)).

While any withdrawal request waits in the queue, the pool deploys nothing more, so cash coming back
goes to the queue first.

## What stands in front of the lending pool

**A loss reaches the lending pool last.** Clear Lending absorbs a credit loss in this order, each
layer used up before the next takes any of it:

1. the member's own collateral, where the credit was secured;
2. Clear Lending's margin for the period;
3. Clear Lending's loss reserve;
4. draws on the Credit Backstop, for charged-off principal only, up to its available coverage;
5. Clear Lending's own capital;
6. the lending pool, through a loss charge.

The order is binding: it is part of the terms Clear Lending holds the pool's money on. On the
chain:

- Pledged collateral pays first, toward the debt it secures.
- The Credit Backstop pays Clear Lending's charged-off principal to Clear Lending's own loss-reserve
  address, within the available coverage, where it absorbs the loss ahead of the pool. Reserve
  money is never paid into the pool itself, and the AssurancePool does not lend to the pool.
- A loss is passed to holders by a loss charge, posted by two valuation signers with evidence. It lowers the value
  of every share outstanding, queued shares included, after any holdbacks have absorbed their part.

See [Risks](./risks.md#credit-losses).

## Merchant payouts

**Contributed money no longer pays merchants.** The lending pool does not lend to the payout pool,
and the bond vault lends nothing. When a merchant's payout comes due and the payout pool cannot pay
it from its own cash, it draws on the treasury's allowance to the payout pool, which is capital, not
a loan.

## The treasury's allowances are discretionary

Both treasury steps read the allowance the treasury has given each contract at the moment of the
draw. The treasury's owners set those allowances themselves, and can lower them to zero. A zero
allowance means that step contributes nothing. Who can sign for each Safe can be read on the chain:
see
[On-chain authority → Who holds each role today](../governance/on-chain-authority.md#who-holds-each-role-today).
