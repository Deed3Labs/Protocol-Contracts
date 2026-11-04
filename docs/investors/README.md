# Investors

For financial contributors: people and institutions who put money into the co-op's lending pool or
buy its BurnerBonds. This section explains what happens to that money, what stands behind it, what
can go wrong, and how anyone can check it on the chain.

**Mechanics and risks only.** Nothing in this section is an offer. It sets no terms, states no
returns, and makes no claim about what any contribution will earn. Who may contribute, on what
terms, and the regulatory status of any contribution are not covered.

**Status.** The contracts have not been independently audited. The lending pool, the bonds, the
bond vault, the AssurancePool and the payout pool run on Base Sepolia, a test network; none of them
is on Base mainnet. Every deployed address, by network, is listed under
[Deployed addresses](../../README.md#deployed-addresses).

## Pages

| Page | What it covers |
|---|---|
| [The lending pool](./lending-pool.md) | Deposits and shares, what the pool lends to, how depositors are paid the carry their money bore, withdrawals and the queue, shares as collateral |
| [BurnerBonds](./burner-bonds.md) | Buying at a discount, where proceeds go, the redemption reserve, payment at maturity, rolling, bonds as collateral |
| [What stands behind it](./what-stands-behind.md) | The order in which each source pays: the bond vault, the treasury's allowance, the AssurancePool's excess and buffer; the payout pool's lender order |
| [Risks](./risks.md) | Contract and upgrade risk, liquidity, credit losses, dependence on the co-op's operations |
| [What anyone can read](./on-chain-data.md) | The on-chain figures and events anyone can check, and the Command Center |

## More detail

The full behaviour of each contract, with every function and role, is in
[Protocol](../protocol/README.md):

- [Settlement and the float](../protocol/settlement.md): the payout pool and the lending pool
- [The reserve](../protocol/reserve.md): the AssurancePool and its reserve ratio
- [Bonds](../protocol/bonds.md): BurnerBonds and the bond vault
- [Credit](../protocol/credit.md): the credit ledger, carry, collateral and default

Who decides the terms, and who holds the keys to the contracts, is in
[Governance](../governance/README.md).
