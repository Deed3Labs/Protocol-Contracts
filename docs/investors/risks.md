# Risks

What can go wrong with money in the lending pool or in BurnerBonds, as the contracts stand. The list
is not complete, and it says nothing about the regulatory status of any contribution.

## The contracts are unaudited and on a test network

**No independent security review has been done.** The system is an early developer preview (alpha),
and how the contracts work can still change.

**The lending pool, the bonds, the bond vault, the AssurancePool and the payout pool run on Base
Sepolia, a test network.** None of them is on Base mainnet; on Base, only the savings and send
contracts run. The current state is listed under
[Deployed addresses](../../README.md#deployed-addresses).

## Smart-contract risk

A bug in any of these contracts, or in the ones they rely on (the credit ledger, the credit issuers,
the collateral registry, the liquidator), can lose or lock money. The Protocol section records known
behaviour a reader might not expect, for example:

- Some bond functions can never succeed as written
  ([Bonds → Unreachable paths](../protocol/bonds.md#unreachable-paths)).

The AssurancePool values the tokens it holds through a price oracle: a time-weighted price from
Uniswap, with a fallback list of prices. Every contract here holds and pays in a single token, USDC
in the deployed setup, and carries that token's own risk.

## Upgrade and control risk

**Most of these contracts can be replaced.** The lending pool, the payout pool, the bond vault, the
merchant registry and the AssurancePool are upgradeable. Whoever holds the upgrade permission (the
admin, or the owner for the AssurancePool) can change any behaviour described in this section,
including how money leaves. Bond series cannot be upgraded, but a series' owner can point it at a
different vault.

**Settings change without an upgrade.** Permission holders can, among other things:

- change the bond vault's reserve window (no limit) and its floor (anywhere from 20% to 100%);
- name or change the payout pool's lenders and the bond vault's backstops;
- approve new borrowers on the lending pool, or give someone the power to write down its losses or
  seize pledged shares;
- withdraw the bond vault's deployable excess to the co-op's Safe;
- change the AssurancePool's target reserve ratio and its withdrawal list;
- change the discount, maturity and face-value ranges for new bonds.

Who holds each key, and how a change is decided, is in [Governance](../governance/README.md).

## Liquidity

**Lending pool.** A depositor can withdraw only what the pool holds in cash. When the cash is lent
out, the depositor queues, and the request is paid once the pool holds enough cash from repayments
or new deposits. There is no date by which that happens, and requests are not paid in order. The
pool's cash is lent against member credit, which members repay over time.

**Bonds.** A bond is redeemed only at or after maturity. A holder has no way to redeem early; the one
early path belongs to the bond series' liquidator. A bond can be transferred unless it is pledged,
but the contracts provide no market for it.

**Payment at maturity is not funded in full in advance.** The vault keeps face value for bonds
maturing inside its reserve window, and a floor across the rest. The remainder of the proceeds can be
withdrawn by the co-op's Safe or lent to the payout pool. At maturity a bond is paid from the vault,
then the treasury's allowance, then the AssurancePool's excess and buffer
([What stands behind it](./what-stands-behind.md#bonds-at-maturity)). The treasury's allowance is
discretionary, and the AssurancePool's buffer is lent only while its reserve ratio is at target. If
those sources together cannot pay, the redemption fails and the bond stays unpaid until they can.

## Credit losses

**The lending pool funds unsecured credit.** Its borrowers repay it from what members repay. A member
who does not repay leaves a loan that does not come back.

**The lending pool can write down a loss, but no contract or service does.** A write-down lowers the
amount the pool counts as lent, and with it the value of every share. Because nothing makes one, an
unpaid loan stays counted at full value. That means:

- the share value does not fall when a loan goes bad;
- the loss shows up instead as cash that never arrives, so withdrawals and queued requests wait for
  money that may not come;
- depositors who withdraw while cash is available are paid at the undiminished value, and the loss
  falls on those who remain;
- if someone is later given the power to write losses down and does so, the loss falls on the shares
  outstanding at that moment. Requests already queued are fixed in USDC and are not written down.

Nothing in the contracts passes a lending pool loss to the AssurancePool or any other reserve
([What stands behind it](./what-stands-behind.md#what-does-not-stand-behind-the-lending-pool)).

**Bondholders are owed a fixed face value, but the sources that pay it are shared.** The
AssurancePool's buffer, the last source for a maturing bond, is also the first to pay for written-off
member debt. A run of member defaults can spend it, or take the reserve ratio below target so that
it is not lent. The vault's deployable excess may have been lent to the payout pool, which repays
only as members repay.

## Dependence on the co-op's operations

**Much of what this section describes depends on the co-op doing things off the chain.**

- The card-funding wallet's borrowing from, and repayment to, the lending pool is run by the co-op's
  server. If that service stops, or the wallet lacks the USDC to repay, the pool is not repaid on
  time.
- The treasury's allowances to the bond vault and the payout pool are set by the Safe's owners, and
  can be withdrawn.
- No contract governs what the co-op does with the bond vault's deployable excess once the Safe
  withdraws it.
- Merchants are paid in dollars from the co-op's float, which is refilled off the chain.

**It is one co-op and one credit book.** The lending pool, the bonds and the reserve all stand behind
the same members' credit, run by the same operators, so a problem in one part of the co-op's
operations can reach all three at once.

## Not covered here

Who may contribute, on what terms, tax, and the regulatory status of the lending pool, the bonds or
the co-op.
