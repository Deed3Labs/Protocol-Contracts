# Operators

Deploying, upgrading and running Clear: the contracts, the API, and the apps' store builds. Who is
allowed to do each of these is in [Governance](../governance/README.md).

| | |
|---|---|
| [`deploying-contracts.md`](./deploying-contracts.md) | Deploying the contracts: scripts `00`–`27` in order, the wiring after them, pointing the apps at the addresses, handing the keys to the Safe, and upgrades |
| [`clrusd-esa-bootstrap.md`](./clrusd-esa-bootstrap.md) | Deploying CLRUSD and its isolated `ESADepositVault`, the redemption lock, CCIP burn/mint pools for cross-chain, and the emergency controls |
| [`api-deploy.md`](./api-deploy.md) | The API on Railway: what triggers a build, the image, and its environment flags |
| [`going-live.md`](./going-live.md) | Going live: what decides test or real money, each provider's sandbox and live settings, and every webhook the API takes with the signature it checks |
| [`payout-topups.md`](./payout-topups.md) | Automatic PayoutPool top-ups (decision 51): when the bot moves money from CL Operating, the Safe spending limit that caps it, what people sign once, and what its alerts mean |
| [`settlement-funding.md`](./settlement-funding.md) | Automatic Settlement Funding (decision 54): how the desk funds the Credit Settlement Account before each card settlement cut-off (Collection Account, then the Yield Pool's settlement lane and the off-ramp), the limits, what people sign once, Returns, and what its alerts mean |
| [`keepers.md`](./keepers.md) | The chain keepers (decision 53): cycles and defaults, shortfall notices, pledged pool shares and bonds, and the Yield Pool's queue; each one's switch, interval, wallet and dry run, and how to stop it |
| [`command-center-live-switches.md`](./command-center-live-switches.md) | The Command Center's live switches: seeding, `seed` or `live` per section, and the jobs and feeds behind the live data |
| [`assurance-fee-payer.md`](./assurance-fee-payer.md) | The Assurance fee payer: the daily coverage reading, the monthly Credit Enhancement Fee, the funding CL Operating signs, the automatic deposit, Spread Repayments, interchange, and its Railway variables |
| [Store builds](../rewards-reference/store-builds.md) | Building a shop's rewards app for the App Store and Google Play |
| [Measuring the M2](../hardware/m2-timing.md) | Timing a table's card reader on a tablet |
