# Risks

What can go wrong with money in the lending pool or in BurnerBonds, as the contracts stand. This is
not a complete list, and it says nothing about the regulatory status of any contribution, which is
not covered in these pages.

## The contracts are unaudited and on a test network

**No independent security review has been done.** The root [`README.md`](../../README.md) marks the
system as an alpha developer preview, unaudited, with interfaces still moving.

**The lending pool, the bonds, the BondVault, the AssurancePool and the PayoutPool are deployed on
Base Sepolia, a test network.** None of them is on Base mainnet; Base carries only the savings and
send rails. Check the root README's **Deployed addresses** for the current state.

## Smart-contract risk

A bug in any of these contracts, or in the ones they call (the credit ledger, the issuers,
`CollateralRegistry`, the `Liquidator`), can lose or lock money. The protocol pages record known
behaviour that differs from what a reader might expect, for example:

- Some bond functions can never succeed as written ([Bonds](../protocol/bonds.md#unreachable-paths)).

The AssurancePool values tokens through an oracle (a Uniswap V3 time-weighted price with a registry
fallback). Every contract here holds and pays in a single reserve token, USDC in the deployed
configuration, and carries that token's own risk.

## Upgrade and control risk

**Most of these contracts can be replaced.** `LendingPool`, `PayoutPool`, `BondVault`,
`MerchantRegistry` and `AssurancePool` are UUPS proxies. Whoever holds the upgrade authority
(`DEFAULT_ADMIN_ROLE`, or the owner for the AssurancePool) can change any behaviour on these pages,
including how money leaves. `BurnerBond` and `BurnerBondDeposit` are clones and cannot be upgraded,
but a collection's owner can point it at a different vault.

**Parameters move without an upgrade.** Role holders can, among other things:

- change the BondVault's reserve window (no bound) and floor (2,000–10,000 bps);
- name or change the PayoutPool's lenders and the BondVault's backstops;
- grant `BORROWER_ROLE`, `LOSS_REPORTER_ROLE` or `LIQUIDATOR_ROLE` on the lending pool;
- withdraw the BondVault's deployable excess to the Safe;
- change the AssurancePool's target RTD and its withdrawal allowlist;
- change the bond factory's discount, maturity and face-value bounds for new bonds.

Who holds each key, and how a change is decided, is in [Governance](../governance/README.md).

## Liquidity

**Lending pool.** A depositor can withdraw only what the pool holds in cash. When the cash is lent
out, the depositor queues, and the request is paid once the pool holds enough cash, from repayments
or new deposits. There is no date by which that happens, and requests are not paid in order. The pool's cash is lent against member
credit, which members repay over time.

**Bonds.** A bond is redeemed only at or after maturity. A holder has no way to redeem early; the one
early path belongs to the collection's liquidator. A bond can be transferred unless it is pledged, but
the contracts provide no market for it.

**Payment at maturity is not pre-funded in full.** The vault keeps face value for bonds maturing
inside its window, and a floor across the rest; the remainder of the proceeds can be withdrawn by the
Safe or lent to the PayoutPool. At maturity a bond is paid from the vault, then the treasury's
allowance, then the AssurancePool's excess and buffer
([What stands behind it](./what-stands-behind.md#bonds-at-maturity)). The treasury's allowance is
discretionary, and the AssurancePool's buffer is lent only while its RTD is at target. If those
sources together cannot pay, the redemption reverts and the bond stays unpaid until they can.

## Credit losses

**The lending pool funds unsecured credit.** The borrowers repay it from what members repay. A member
who does not repay leaves a loan that does not come back.

**`LendingPool.absorbLoss` exists, but no contract calls it.** The function writes a loss off
`totalBorrowed`, which lowers the share price, and is restricted to `LOSS_REPORTER_ROLE`. With no
caller, an unpaid loan stays in `totalBorrowed` at full value. That means:

- the share price does not fall when a loan goes bad;
- the loss shows up instead as cash that never arrives, so withdrawals and queued requests wait for
  money that may not come;
- depositors who withdraw while cash is available are paid at the undiminished price, and the loss
  falls on those who remain;
- if a role holder is later granted `LOSS_REPORTER_ROLE` and writes the loss down, it falls on the
  shares outstanding at that moment. Requests already queued are fixed in assets and are not written
  down.

Nothing in the contracts passes a lending pool loss to the AssurancePool or any other reserve
([What stands behind it](./what-stands-behind.md#what-does-not-stand-behind-the-lending-pool)).

**Bondholders are owed a fixed face value, but the sources that pay it are shared.** The
AssurancePool's buffer, the last source for a maturing bond, is also the first to pay lost debt. A period of member defaults can spend it, or take the RTD below target so that it is not lent.
The vault's deployable excess may have been lent to the PayoutPool, which repays only as members
repay.

## Dependence on the co-op's operations

**Much of what these pages describe depends on the co-op doing things off-chain.**

- The card-funding wallet's borrowing from, and repayment to, the lending pool is run by the co-op's
  API. If that service stops, or the wallet lacks the USDC to repay, the pool is not repaid on time.
- The treasury's allowances to the BondVault and the PayoutPool are set by the Safe's owners, and can
  be withdrawn.
- What the Safe does with the BondVault's deployable excess is not governed by any contract.
- Merchants are paid in fiat from the co-op's float, which is refilled off-chain.

**It is one co-op and one credit book.** The lending pool, the bonds and the reserve all stand behind
the same members' credit, run by the same operators, so a problem in one part of the co-op's
operations can reach all three at once.

## Not covered here

Who may contribute, on what terms, tax, and the regulatory status of the lending pool, the bonds or
the co-op are not covered in these pages.
