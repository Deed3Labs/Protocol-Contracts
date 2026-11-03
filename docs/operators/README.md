# Operators

Deploying, upgrading and running Clear: the contracts, the API, and the apps' store builds. Who is
allowed to do each of these is in [Governance](../governance/README.md).

| | |
|---|---|
| [`deploying-contracts.md`](./deploying-contracts.md) | Deploying the contracts. Covers the reserve and bond scripts (`07`–`10`) in detail; the numbered order for all of `00`–`24` is in the root README's **Contract tooling** |
| [`clrusd-esa-bootstrap.md`](./clrusd-esa-bootstrap.md) | Issuing CLRUSD from an isolated `ESADepositVault`, and CCIP burn/mint pools for cross-chain. Covers the original `ClearUSD`, not `ClearUSDUpgradeable` |
| [`api-deploy.md`](./api-deploy.md) | The API on Railway, and what it costs |
| [Store builds](../rewards-reference/store-builds.md) | Building a shop's rewards app for the App Store and Google Play |
| [Measuring the M2](../hardware/m2-timing.md) | Timing a table's card reader on a tablet |

## To be written

- The deploy runbook for the whole stack, `00`–`24`, replacing the BurnerBond-only one
- Upgrades: `deploy/upgrade/` for the Deed track, `scripts/upgrade_*.ts` for the credit stack
- Operational scripts: roles, merchants, the payout pool, carry recipients, vault checks
- Handing roles to the Safe
- Going live: environments, providers, webhooks — from the merchant pilot checklist
- The Command Center's live switches
