# Operators

Deploying, upgrading and running Clear: the contracts, the API, and the apps' store builds. Who is
allowed to do each of these is in [Governance](../governance/README.md).

| | |
|---|---|
| [`deploying-contracts.md`](./deploying-contracts.md) | Deploying the contracts: scripts `00`–`24` in order, the wiring after them, pointing the apps at the addresses, handing the keys to the Safe, and upgrades |
| [`clrusd-esa-bootstrap.md`](./clrusd-esa-bootstrap.md) | Deploying CLRUSD and its isolated `ESADepositVault`, the redemption lock, CCIP burn/mint pools for cross-chain, and the emergency controls |
| [`api-deploy.md`](./api-deploy.md) | The API on Railway: what triggers a build, the image, and its environment flags |
| [`going-live.md`](./going-live.md) | Going live: what decides test or real money, each provider's sandbox and live settings, and every webhook the API takes with the signature it checks |
| [`command-center-live-switches.md`](./command-center-live-switches.md) | The Command Center's live switches: seeding, `seed` or `live` per section, and the jobs and feeds behind the live data |
| [Store builds](../rewards-reference/store-builds.md) | Building a shop's rewards app for the App Store and Google Play |
| [Measuring the M2](../hardware/m2-timing.md) | Timing a table's card reader on a tablet |
