# Protocol

The Clear Protocol: the contracts under [`contracts/`](../../contracts/). Deployed addresses are in
the root [`README.md`](../../README.md) (**Deployed addresses**) and recorded in
[`deployments/`](../../deployments/).

[The contract design](./clear-contracts-build-plan.md) explains the model behind them: StableCredit
as a ledger of obligations rather than a pot of money, the ESA (Equity Savings Account) vault, the
lending pool, BurnerBonds, offers, and where the contracts meet the app and the card issuer.

How each part works:

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
| [`clear-contracts-build-plan.md`](./clear-contracts-build-plan.md) | The design and the reasons for it. For exact behaviour, the pages above are the reference |
| [`refund-repayment-plan.md`](./refund-repayment-plan.md) | How refunds and repayments route through the PayoutPool |
| [`token-registry.md`](./token-registry.md) | `TokenRegistry` in detail — the presence-based whitelist, and what it means for onboarding a token |
| [`contracts/`](./contracts/README.md) | **The contract reference**: one page per deployed contract — address on each network, every function and who can call it, events, errors. Generated from [`deployments/`](../../deployments/) and checked in CI |

Deploying and running them is in [Operators](../operators/README.md); who holds the roles is in
[Governance](../governance/README.md).

## The Deed track

T-Deeds, validators, subdivision and fractionalization — a named subsystem of the protocol, ten of
its forty-four production contracts. It keeps its own names — `DeedNFT`, `Validator`, the T-Deed
token — because those are on-chain identifiers. For a plain-language introduction, see
[Clear Deeds and real-world assets](../overview/deeds-and-real-world-assets.md).

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
[commercial equipment](./deed-track/assets/commercial-equipment.md).

Each page lists the trait keys the contracts read, and the example metadata for that type in
[`test/templates`](../../test/templates/). **Known limitation:** the templates use display labels
(such as "Parcel Number") where the contracts read camelCase keys (`parcelNumber`), so a trait set
under a template's label is not read.
