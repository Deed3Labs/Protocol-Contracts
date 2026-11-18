# Risks

What can go wrong with money in the lending pool or in BurnerBonds, as the contracts stand. The list
is not complete, and it says nothing about the regulatory status of any contribution.

## The contracts are unaudited and on a test network

**No independent security review has been done.** The system is an early developer preview (alpha),
and how the contracts work can still change.

**The lending pool, the Earn controls, the bonds, the bond vault, the Collateral Agent, the
AssurancePool and the payout pool run on Base Sepolia, a test network.** None of them is on Base
mainnet; on Base, only the savings and send contracts run. The current versions went onto Base
Sepolia from 17 November 2026, and several of their settings take effect only after a 7-day
timelock, Settlement Funding among them. Every contract and its address is in the
[Contract reference](../protocol/contracts/README.md).

## Smart-contract risk

A bug in any of these contracts, or in the ones they rely on (the credit ledger, the credit issuers,
the collateral registry, the liquidator, the pool-share enforcer), can lose or lock money. Several
of them run part of their logic in separate modules they call into, which adds code that has to be
right.

Every contract here holds and pays in a single token, USDC in the deployed setup, and carries that
token's own risk: a token that refuses a payment, or a network problem, can stop payments. The
lending pool keeps a refused payment for its payee to claim later, and can be suspended for a USDC
or network problem.

## Upgrade and control risk

**Most of these contracts can be replaced.** The lending pool, the Earn controls, the bond vault, the
Collateral Agent, the payout pool and the AssurancePool are upgradeable. Whoever holds the upgrade
permission can change any behaviour described in this section, including how money leaves. Upgrades
and admin settings of the lending pool, the Earn controls and the bond vault go through the Earn
timelock, which delays each by 7 days, and the bond vault's also need the Collateral Agent's
co-signature. The AssurancePool's go through its own timelock, also at least 7 days. Bond series
cannot be upgraded.

**Settings change without an upgrade.** Permission holders can, among other things:

- post the Pool Tier principal, a loss allowance, a loss charge or a recovery (two valuation
  signers);
- suspend the pool, or hold one holder's shares under a legal order (two authorized people);
- set the settlement lane's funder, cap and headroom (two deployment signers), or the forwarder's
  allowance (the owners of Clear Lending's Safe);
- change the Funding Rate curve, with 48 hours' notice, or 30 days' for a change that lowers it;
- change the Ladder of bond terms and rates, with 48 hours' notice;
- pause new subscriptions and bond purchases, or set the bonds' wind-down flag;
- raise the bond vault's reserve floor, or change its glide schedule;
- change the treasury's allowances, which pay merchants and help pay bonds.

Who holds each key, and how a change is decided, is in [Governance](../governance/README.md).

## Liquidity

**Lending pool.** A holder can redeem on demand only while nobody is waiting in the queue and the
pool holds the cash. Otherwise the request waits its turn, first in, first out, and is filled as
Clear Lending returns money or new subscriptions arrive. There is no date by which that happens. A
Deployment can take Utilization up to 90%, and money deployed comes back only as Returns. Queued
shares are paid at the Share Value when they are filled, so they share in interest and in losses
until then.

Other things can delay a redemption:

- a suspension, which stops redemptions and queue fills for up to 72 hours at a time and 30 days in
  all, longer under a legal order;
- a legal hold on the holder's shares;
- a loss allowance, which keeps back part of each redemption until it is released, at the latest
  after 540 days;
- a pledge: pledged shares cannot be redeemed or queued until the credit they back is paid down.

**Bonds.** A holder cannot redeem before maturity, and bonds move only between a holder's own
accounts, so the contracts provide no market for them. A buyback happens only if someone offers one
and the holder accepts.

**Payment at maturity is not funded in full in advance.** The vault keeps back every bond due within
90 days that will not roll, and a glide schedule across the rest, at least 30% of what is
outstanding. The remainder can leave to Clear Lending. At maturity a bond is paid from the vault,
then the treasury's allowance, which is discretionary. If they fall short, the unpaid part is
recorded as owed and paid only as money arrives
([What stands behind it](./what-stands-behind.md#bonds-at-maturity)).

## Credit losses

**The lending pool's money is deployed to Clear Lending, which funds members' credit.** A member who
does not repay leaves a loss with Clear Lending, and the pool's Returns depend on Clear Lending paying
them.

**A loss reaches holders only when two valuation signers post it.** A loss charge lowers the Deployed
Balance, then accrued interest, and with them the value of every share outstanding at that moment,
queued shares included. Holdbacks kept from earlier redemptions absorb their part first. A charge
larger than the Deployed Balance and accrued interest together is paid out of the pool's cash. That
means:

- until a loss is posted, the Share Value counts deployed money and accrued interest at full value,
  even if some will not come back;
- interest Clear Lending does not pay by its due date is added to the Deployed Balance, so it raises
  the Share Value without bringing in cash;
- holders who redeem before a loss is posted are paid at the undiminished value, less any holdback
  then in force, and the loss falls on those who remain.

**A loss reaches the pool last.** Clear Lending absorbs a credit loss in this order, each layer used
up before the next takes any of it: the member's own collateral, where the credit was secured;
Clear Lending's margin for the period; its loss reserve; draws on the AssurancePool's Credit
Backstop, for charged-off principal only and up to its available coverage; Clear Lending's own
capital; and only then the lending pool, through a loss charge. Bonds are not written down. The
order is binding: it is part of the terms Clear Lending holds the pool's money on. On the chain,
pledged collateral pays first, Credit Backstop draws go only to Clear Lending's loss reserve, and a
loss reaches the pool only through a loss charge that two valuation signers post with evidence.
Reserve money is never paid into the pool itself: the Credit Backstop pays Clear Lending, which
absorbs the loss ahead of the pool. The Credit Backstop is not a guarantee: it can run out, and nothing requires the co-op to
refill it. Because the pool stands behind the whole credit book, it can bear a loss on credit it
did not fund.
See [What stands behind it](./what-stands-behind.md#what-stands-in-front-of-the-lending-pool).

**Bondholders are owed a fixed amount, but what pays it is limited.** The vault's reserve covers the
near term and part of the rest; the treasury's allowance can be lowered to zero; the AssurancePool
does not pay bonds.

## Settlement exposure

**Settlement Funding moves pool money without two signatures for each move.** Within its cap per
period, the registered settlement funder deploys to Clear Lending's Safe, and the forwarder sends it
on to an off-ramp that pays the account card purchases settle from. It can take the Deployed Balance
above the posted Pool Tier principal by the Settlement Headroom. If the funder's key were misused,
it could deploy up to the cap for the period into Clear Lending's Safe; any one deployment signer or
compliance signer can stop the lane with a single call. Surplus comes back to the pool only when
Clear Lending makes a Return.

## Dependence on the co-op's operations

**Much of what this section describes depends on people and services off the chain.**

- Returns, and the interest in them, are made by Clear Lending. Nothing on the chain makes it pay.
- The Pool Tier principal, loss allowances and loss charges are posted by people, from records kept
  off the chain.
- Settlement Funding is run by the co-op's server, and the money it sends passes through an off-ramp
  and the card settlement account before it pays for members' credit.
- Eligibility attestations, Roll Notices and Ladder changes come from the co-op's signers.
- The treasury's allowances to the bond vault and the payout pool are set by the treasury's owners,
  and can be withdrawn.
- No contract governs what Clear Lending does with money deployed to it, or with the bond vault's
  excess once it arrives.

**It is one co-op and one credit book.** The lending pool, the bonds and the reserve all stand behind
the same members' credit, run by the same operators, so a problem in one part of the co-op's
operations can reach all three at once.

## Not covered here

Who may contribute, on what terms, tax, and the regulatory status of the lending pool, the bonds or
the co-op.
