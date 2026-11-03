# Investors

For financial contributors: people and institutions who put money into the co-op's lending pool or
buy its BurnerBonds. These pages describe how that money moves through the contracts, what stands
behind it, and what can go wrong.

**This section describes mechanics and risks only.** It is not an offer of anything. It sets no
terms, states no returns, and makes no claim about what any contribution will earn. Who may
contribute, on what terms, and the regulatory status of any contribution are not covered here.

**Status.** The contracts are unaudited. The lending pool, the bonds, the BondVault, the
AssurancePool and the PayoutPool are deployed on Base Sepolia, a test network; none of them is on
Base mainnet. The root [`README.md`](../../README.md) lists every deployed address by network, and
is the place to check what has changed.

## Pages

| Page | What it covers |
|---|---|
| [The lending pool](./lending-pool.md) | Deposits and shares, what the pool lends to, how depositors are paid the carry their money bore, withdrawals and the queue, shares as collateral |
| [BurnerBonds](./burner-bonds.md) | Buying at a discount, where proceeds go, the derived redemption reserve, payment at maturity, rolling, bonds as collateral |
| [What stands behind it](./what-stands-behind.md) | The order in which each source pays: the BondVault, the treasury's allowance, the AssurancePool's excess and buffer; the PayoutPool's lender order |
| [Risks](./risks.md) | Contract and upgrade risk, liquidity, credit losses, dependence on the co-op's operations |
| [What anyone can read](./on-chain-data.md) | The on-chain figures and events anyone can check, and the Command Center |

## Where the detail lives

These pages summarise the contracts for contributors. The full behaviour, with every function and
role, is in [Protocol](../protocol/README.md):

- [Settlement and the float](../protocol/settlement.md): the PayoutPool and the LendingPool
- [The reserve](../protocol/reserve.md): the AssurancePool and RTD
- [Bonds](../protocol/bonds.md): BurnerBonds and the BondVault
- [Credit](../protocol/credit.md): the ledger, carry, collateral and default

Who decides the terms, and who holds the keys to the contracts, is in
[Governance](../governance/README.md).
