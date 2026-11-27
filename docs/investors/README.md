# Investors

For financial contributors: people and institutions who put money into the co-op's lending pool on
Earn or buy its BurnerBonds. This section explains what happens to that money, what stands behind
it, what can go wrong, and how anyone can check it on the chain.

**Mechanics and risks only.** Nothing in this section is an offer. It sets no terms, states no
returns, and makes no claim about what any contribution will earn. Who may contribute, on what
terms, and the regulatory status of any contribution are not covered.

**Status.** The contracts have not been independently audited. The lending pool, the Earn controls,
the bonds, the bond vault, the Collateral Agent, the AssurancePool and the payout pool run on Base
Sepolia, a test network; none of them is on Base mainnet. Their current versions went onto Base
Sepolia from 17 November 2026, and several of their settings take effect only after a 7-day
timelock. Every deployed contract and its address is in the
[Contract reference](../protocol/contracts/README.md).

## Pages

| Page | What it covers |
|---|---|
| [The lending pool](./lending-pool.md) | Subscriptions and shares, Deployments and Settlement Funding to Clear Lending, Pool Interest at the Funding Rate, the withdrawal queue, losses and holdbacks, shares as collateral |
| [BurnerBonds](./burner-bonds.md) | Buying on a quote from the Ladder, the Redemption Reserve, payment at maturity, rolling by confirmation, bonds as collateral, the Collateral Agent |
| [What stands behind it](./what-stands-behind.md) | The order in which each source pays: the bond vault, the treasury's allowance, the Collateral Agent; what the AssurancePool does and does not cover |
| [Risks](./risks.md) | Contract and upgrade risk, liquidity and queue waits, credit losses and loss charges, settlement exposure, dependence on the co-op's operations |
| [What anyone can read](./on-chain-data.md) | The on-chain figures and events anyone can check, the timelocks, and the Command Center |

## More detail

The full behaviour of each contract, with every function and role, is in
[Protocol](../protocol/README.md):

- [Settlement and the float](../protocol/settlement.md): the payout pool and the lending pool
- [Bonds](../protocol/bonds.md): BurnerBonds and the bond vault
- [The reserve](../protocol/reserve.md): the AssurancePool and its compartments
- [Credit](../protocol/credit.md): the credit ledger, collateral and default
- [Contract reference](../protocol/contracts/README.md): every deployed contract, its address and its
  functions

Who decides the terms, and who holds the keys to the contracts, is in
[Governance](../governance/README.md).
