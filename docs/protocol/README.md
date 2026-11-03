# Protocol

The Clear Protocol: the contracts under [`contracts/`](../../contracts/). Deployed addresses are in
the root [`README.md`](../../README.md) (**Deployed addresses**) and recorded in
[`deployments/`](../../deployments/).

**Read [the contract build plan](./clear-contracts-build-plan.md) before touching the on-chain
code.** StableCredit as a ledger of obligations rather than a pot of money, the ESA, the yield pool,
BurnerBonds, offers, and the connection points to the app and to Lithic.

How each part works, against the code:

| | |
|---|---|
| [`savings.md`](./savings.md) | CLRUSD and its redemption lock, the `ESADepositVault`, gasless savings intents, link-based send (`ClaimEscrow`), the cross-chain pool |
| [`credit.md`](./credit.md) | The ledger, the issuers — revolving tiers, term plans, offers — carry, collateral and the ceiling, default and liquidation, access |
| [`settlement.md`](./settlement.md) | Merchant terms, how a positive balance becomes USDC, who fronts the cash when it is due, how it and its carry come back, the `LendingPool` |
| [`reserve.md`](./reserve.md) | The `AssurancePool` — primary, buffer and excess, RTD, lost debt, lending as a last resort — and pricing |
| [`bonds.md`](./bonds.md) | BurnerBonds, the discount curve, `BondVault` and its backstops, seniority, bonds as collateral |

And the reasoning and reference behind them:

| | |
|---|---|
| [`clear-contracts-build-plan.md`](./clear-contracts-build-plan.md) | The design and the reasons for it. Where it and the pages above disagree, the pages describe the code |
| [`refund-repayment-plan.md`](./refund-repayment-plan.md) | How refunds and repayments route through the PayoutPool |
| [`token-registry.md`](./token-registry.md) | `TokenRegistry` in detail — the presence-based whitelist, and what it means for onboarding a token |

Deploying and running them is in [Operators](../operators/README.md); who holds the roles is in
[Governance](../governance/README.md).

## The Deed track

T-Deeds, validators, subdivision and fractionalization — a named subsystem of the protocol, ten of
its forty-four production contracts. It keeps its own names — `DeedNFT`, `Validator`, the T-Deed
token — because those are on-chain identifiers.
[`protocol-overview.md`](./deed-track/protocol-overview.md) and
[`smart-contracts.md`](./deed-track/smart-contracts.md) name some functions that no longer exist and
are due a rewrite; the other five match the code.

| | |
|---|---|
| [`protocol-overview.md`](./deed-track/protocol-overview.md) | High-level system design |
| [`smart-contracts.md`](./deed-track/smart-contracts.md) | Contract architecture and relationships |
| [`validation-system.md`](./deed-track/validation-system.md) | How validation works, and the validator lifecycle |
| [`asset-workflows.md`](./deed-track/asset-workflows.md) | The asset lifecycle, minting through fractionalization |
| [`subdivision.md`](./deed-track/subdivision.md) | ERC-1155 subdivision |
| [`fractionalization.md`](./deed-track/fractionalization.md) | ERC-20 fractional shares |
| [`metadata-renderer.md`](./deed-track/metadata-renderer.md) | Trait-aware metadata, documents and features |

What a validator checks, per asset type — [land](./deed-track/assets/land-assets.md),
[vehicles](./deed-track/assets/vehicle-assets.md), [estates](./deed-track/assets/estate-assets.md),
[commercial equipment](./deed-track/assets/commercial-equipment.md). The trait keys these list do
not yet match the ones `MetadataRenderer` and `test/templates` use.

## To be written

- `ValidatorFactory`, and a rewrite of the two Deed-track pages above that name functions that no
  longer exist
- Contract interfaces generated from the ABIs, replacing the hand-written reference that was removed
