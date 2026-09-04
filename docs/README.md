# Documentation

Everything written down about **CLEAR** — the app and the co-op — and about **the Clear Protocol**,
the on-chain layer underneath it. Start with the root [`README.md`](../README.md) for what the
repository is and how to run it; this index is for the longer-form material.

The **Deed track** — T-Deeds, validators, subdivision, fractionalization — is a named subsystem
inside the Clear Protocol, not a separate thing. It is ten of the forty-four production contracts
under [`contracts/`](../contracts/); CLRUSD, the ESA, the two credit issuers, collateral, the
lending pool, merchant settlement and the bond vault are most of the rest.

Two eras of documentation live here. The Clear docs describe what is being built now. The Deed-track
docs describe the RWA layer, and the ones about its *frontend* predate the app rebuild — each group
says which it is.

Every link below points at a file that exists. If one does not, that is a bug worth fixing.

---

## Clear — the product

| | |
|---|---|
| [`CLEAR_MEMBER_OVERVIEW_2026.md`](./CLEAR_MEMBER_OVERVIEW_2026.md) | What CLEAR is, for members and depositors. The plainest statement of the model |
| [`CLEAR_RECONCILIATION_BASELINE_2026.md`](./CLEAR_RECONCILIATION_BASELINE_2026.md) | The decision-ready baseline reconciling repository, narrative and docs — and the source hierarchy to use when they disagree |
| [`CLEAR_INVESTOR_PROTOCOL_DOSSIER.md`](./CLEAR_INVESTOR_PROTOCOL_DOSSIER.md) | The protocol explained for investors, banks and financiers |
| [`CLEAR_LPVC_INVESTMENT_MEMO_2026.md`](./CLEAR_LPVC_INVESTMENT_MEMO_2026.md) | Investment memo for LPs and VCs |

## The Clear Protocol — contracts

| | |
|---|---|
| [`contracts/clear-contracts-build-plan.md`](./contracts/clear-contracts-build-plan.md) | **Read this before touching the on-chain code.** StableCredit as a ledger of obligations rather than a pot of money, the ESA, the yield pool, BurnerBonds, and the connection points to the app and to Lithic |
| [`contracts/clear-deployment-plan.md`](./contracts/clear-deployment-plan.md) | What has to be deployed, in what order, and which part of the app each step unlocks. Companion to the build plan |
| [`clrusd-esa-bootstrap.md`](./clrusd-esa-bootstrap.md) | Runbook for issuing CLRUSD from an isolated `ESADepositVault`, with backing kept segregated from the AssurancePool, and CCIP burn/mint pools for cross-chain |
| [`token-registry.md`](./token-registry.md) | `TokenRegistry` — the presence-based whitelist, and what it means for onboarding a token |
| [`assurancePool.md`](./assurancePool.md) | Multi-token reserve: deposits, withdrawals, RTD |
| [`assuranceOracle.md`](./assuranceOracle.md) | Uniswap-based universal pricing with registry fallback |
| [`burner-bond-complete.md`](./burner-bond-complete.md) | The ERC-1155 discount-bond system end to end |

Deployment runbooks proper live outside `docs/`: [`deploy/README.md`](../deploy/README.md) and
[`deploy/DEPLOYMENT_GUIDE.md`](../deploy/DEPLOYMENT_GUIDE.md). Deployed addresses are tabulated in the
root [`README.md`](../README.md).

## Clear — the apps

| | |
|---|---|
| [`ux/clear-app-design-spec.md`](./ux/clear-app-design-spec.md) | The member app's navigation and screens — what the rebuild is built to |
| [`reference/clear-app-reference-screens.html`](./reference/clear-app-reference-screens.html) | Static reference screens: Home, limit breakdown, Savings, Earn, Activity, Send, Card. Colors, spacing and structure are authoritative; the implementation approach is not |
| [`ux/clear-onboarding-plan.md`](./ux/clear-onboarding-plan.md) | Making the reference onboarding flow real, and the components it needs |
| [`ux/clear-merchant-app-reference.html`](./ux/clear-merchant-app-reference.html) | Design reference for the counter app |
| [`ux/clear-merchant-auth.html`](./ux/clear-merchant-auth.html) | Signing in, shifts, and who is allowed to see what |
| [`ux/clear-merchant-privy-orgs.md`](./ux/clear-merchant-privy-orgs.md) | Why the merchant app creates four Privy objects where the consumer app creates one, and where each call lands in onboarding |
| [`reference/README.md`](./reference/README.md) | Index of the visual reference material |

App-level docs sit with their apps: [`apps/member/README.md`](../apps/member/README.md),
[`apps/api/README.md`](../apps/api/README.md), and the data-fetching, caching and pricing notes in
[`apps/member/docs/`](../apps/member/docs/).

## Clear — integrations

| | |
|---|---|
| [`integrations/lithic-integration-spec.md`](./integrations/lithic-integration-spec.md) | The banking and card rail. Program Managed, and the two rails it must never blur. Read before writing card code |

---

## The Deed track — architecture

Current. These describe the contracts, which are still what they say they are. The track keeps its
own names throughout — `DeedNFT`, `Validator`, the T-Deed token — and those are on-chain
identifiers, so they are not going to change with the protocol's.

| | |
|---|---|
| [`architecture/protocol-overview.md`](./architecture/protocol-overview.md) | High-level system design |
| [`architecture/smart-contracts.md`](./architecture/smart-contracts.md) | Contract architecture and relationships |
| [`architecture/validation-system.md`](./architecture/validation-system.md) | How validation works, and the validator lifecycle |
| [`architecture/asset-workflows.md`](./architecture/asset-workflows.md) | The full asset lifecycle, minting through fractionalization |
| [`architecture/subdivision.md`](./architecture/subdivision.md) | ERC-1155 subdivision |
| [`architecture/fractionalization.md`](./architecture/fractionalization.md) | ERC-20 fractional shares |
| [`architecture/metadata-renderer.md`](./architecture/metadata-renderer.md) | Trait-aware metadata, documents and features |
| [`api/contract-interfaces.md`](./api/contract-interfaces.md) | Contract interfaces, function by function |
| [`architecture/XMTP.md`](./architecture/XMTP.md) | XMTP messaging between members and T-Deed owners |

## The Deed track — asset requirements

What a validator checks, per asset type.

- [Land](./assets/land-assets.md)
- [Vehicles](./assets/vehicle-assets.md)
- [Estates](./assets/estate-assets.md)
- [Commercial equipment](./assets/commercial-equipment.md)

## The Deed track — user guides

| | |
|---|---|
| [`user-guide/README.md`](./user-guide/README.md) | Tokenizing and managing assets as DeedNFTs |
| [`quick-start.md`](./quick-start.md) | The five-minute version |
| [`ux/minting-process.md`](./ux/minting-process.md) | Minting, step by step |
| [`ux/admin-operations.md`](./ux/admin-operations.md) | Validator management and other admin operations |
| [`ux/messaging.md`](./ux/messaging.md) | XMTP messaging, for users |

---

## Pre-rebuild frontend docs

> These describe the frontend as it was before the Clear rebuild — Reown AppKit for
> wallets, a component tree that no longer exists, and an `app/` directory that is now `apps/member`.
> They are kept because the T-Deed surface they document is still in the codebase, but check them
> against the code before relying on anything. [`apps/member/README.md`](../apps/member/README.md) is
> the current account of that app.

| | |
|---|---|
| [`installation.md`](./installation.md) | Local setup and deployment. Paths are pre-monorepo |
| [`api/components.md`](./api/components.md) | React component reference |
| [`api/hooks.md`](./api/hooks.md) | Custom hook reference |
| [`api/DeedNFTMap.md`](./api/DeedNFTMap.md) | The Mapbox asset map |
| [`api/MapEnvironmentSetup.md`](./api/MapEnvironmentSetup.md) | Mapbox tokens |
| [`api/XMTP.md`](./api/XMTP.md) | The `XMTPMessaging` component |
| [`multichain-implementation.md`](./multichain-implementation.md) | Multichain asset views |
| [`rpc-optimization.md`](./rpc-optimization.md) | Reducing RPC calls and rate-limit errors |

---

## Where the missing pieces actually are

This index used to link nine files that were never written: an API reference, a developer guide,
contributing and testing guides, a security model, compliance and audit notes, a validation
workflow, and a troubleshooting page. The links are gone. What they promised, where it exists:

| Was linked as | Read instead |
|---|---|
| `api/README.md` | [`apps/api/README.md`](../apps/api/README.md) — the real route map, auth model and env. For contracts, [`api/contract-interfaces.md`](./api/contract-interfaces.md) |
| `development/README.md`, `development/contributing.md` | The **Quickstart** and **Contributing** sections of the root [`README.md`](../README.md) |
| `development/testing.md` | **Contract tooling → Tests** in the root [`README.md`](../README.md), and the suites in [`test/`](../test/) |
| `security/security-model.md` | **Security** in the root [`README.md`](../README.md); role boundaries are in [`architecture/smart-contracts.md`](./architecture/smart-contracts.md) |
| `security/audits.md` | There has been no audit. The contracts are unaudited and should not carry real money without an independent review |
| `security/compliance.md` | Not written. The nearest thing is the KYC/KYB and program-management split in [`integrations/lithic-integration-spec.md`](./integrations/lithic-integration-spec.md) |
| `ux/validation-workflow.md` | [`architecture/validation-system.md`](./architecture/validation-system.md) |
| `ux/troubleshooting.md` | Not written |

---

## Contributing to these docs

Focused PRs against `dev`, same as code. Update the doc in the same change as the interface or
workflow it describes — that is the only way any of this stays true. If you add a file here, add it
to this index; if you find a link that does not resolve, fix it or remove it rather than leaving it.

- Issues: [Deed3Labs/Protocol-Contracts/issues](https://github.com/Deed3Labs/Protocol-Contracts/issues)
- Discussions: [Deed3Labs/Protocol-Contracts/discussions](https://github.com/Deed3Labs/Protocol-Contracts/discussions)
