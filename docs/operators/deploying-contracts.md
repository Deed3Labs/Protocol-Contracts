# Deploying the contracts

How the Clear Protocol gets onto a chain: the scripts in [`deploy/`](../../deploy/), the order they
run in, the wiring after them, and handing the keys over. Who is meant to hold each role once it is
done is in [Governance](../governance/README.md).

Base Sepolia carries the whole stack. Base carries the savings and send rails only (`ClearUSD`,
`ESADepositVault`, `ClaimEscrow`), Ethereum Sepolia the cross-chain CLRUSD pool. The addresses are
in the root README's **Deployed addresses**.

## Before you start

**Test first.** `npm run test` runs every suite, and `test/deploy/CreditCore.deploy.spec.ts` runs
script `20` itself against a fresh chain — the wiring is the part most likely to deploy cleanly and
then refuse the first draw.

**Configure** the root `.env` (from `.env.example`):

| | |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | The key that deploys, and holds every admin role until they are handed over |
| `ALCHEMY_API_KEY` | RPC for the named networks |
| `ETHERSCAN_API_KEY` | Verifying source on Basescan |

Each script reads more of its own; they are listed below and at the top of every script.

**Networks** are named in `hardhat.config.ts`: `base-sepolia`, `base`, `sepolia`, `mainnet`,
`arbitrum`, `polygon` and a few older testnets. Every command takes `--network <name>`.

**Where addresses go.** Every script records what it deploys in
`deployments/<network>/<Contract>.json` — address and ABI — through `deploy/helpers.ts`, and reads
earlier contracts from the same place. That folder is the record of what is deployed; commit it
with the deployment. Scripts `20`–`24` are idempotent: anything already recorded is reused, and
every wiring call is a set, so a failed run can be run again.

## The order

Run the scripts in number order. Each group needs the ones above it.

```bash
npx hardhat run deploy/<script>.ts --network base-sepolia
```

### The Deed track — `00`–`06`

| Script | Deploys |
|---|---|
| `00_deploy_ValidatorRegistry` | `ValidatorRegistry` |
| `01_deploy_MetadataRenderer` | `MetadataRenderer` |
| `02_deploy_Validator` | `Validator` |
| `03_deploy_DeedNFT` | `DeedNFT` |
| `04_deploy_FundManager` | `FundManager` — 5% commission, capped at 10% |
| `05_deploy_Subdivide` | `Subdivide` |
| `06_deploy_Fractionalize` | `FractionTokenFactory`, then `Fractionalize` |

**Use `deploy/deploy_all.ts` for `00`–`05`.** It deploys and wires those contracts in one run, then
`06` adds fractionalization. The numbered scripts `00`–`04` do not match the current contracts:
they call roles and functions the contracts don't have (for example `OPERATOR_ROLE` on `ValidatorRegistry`,
`ADMIN_ROLE` on `DeedNFT` and `MetadataRenderer`) and would fail. What `deploy_all.ts` wires, and
what it leaves for an admin to set, is in
[The Deed track's contracts](../protocol/deed-track/smart-contracts.md#deployment-and-wiring).

### Reserve, pricing and the first bonds — `07`–`10`

| Script | Deploys |
|---|---|
| `07_deploy_TokenRegistry` | `TokenRegistry`, with the network's tokens |
| `08_deploy_AssurancePool` | `AssurancePool` (UUPS) |
| `09_deploy_AssuranceOracle` | `AssuranceOracle`, and points the pool at it |
| `10_deploy_BurnerBondFactory` | `BurnerBondFactory` and `BurnerBondDeposit` |

`deploy/deploy_burner_bonds.ts` runs `07`–`10` in one go (`npm run deploy:burner-bonds:sepolia`).

### Send and savings — `11`–`19`

| Script | Deploys | Reads |
|---|---|---|
| `11_deploy_ClaimEscrow` | `ClaimEscrow`, and grants `SETTLER_ROLE` to the relayer | `SEND_PAYOUT_TREASURY`, `SEND_RELAYER_ADDRESS` |
| `12_deploy_ClearUSD` | `ClearUSD` — the original CLRUSD, a plain deployment behind no proxy | `CLRUSD_ADMIN`, `CLRUSD_MAX_SUPPLY`, `CLRUSD_PREMINT`, `CLRUSD_USE_CREATE2`, `CLRUSD_CREATE2_*` |
| `13_deploy_ESADepositVault` | `ESADepositVault` (UUPS). Backs `ClearUSDUpgradeable` when one is recorded, else `ClearUSD` | `VAULT_CLRUSD`, `CLRUSD_ADDRESS`, `ESA_VAULT_DEPOSIT_TOKEN`, `SAVINGS_RELAYER_ADDRESS` |
| `14_register_CLRUSD_in_registry` | Registers CLRUSD in the `TokenRegistry` | `CLRUSD_ADDRESS`, `TOKEN_REGISTRY_ADDRESS`, `CLRUSD_REMOTE_*` |
| `15_deploy_CLRUSDTokenPool` | The CCIP burn/mint pool for cross-chain CLRUSD | `CCIP_ROUTER`, `CCIP_RMN_PROXY` |
| `16_deploy_AccessManager` | `AccessManager` | |
| `17_deploy_MembershipRegistry` | `MembershipRegistry` | |
| `18_configure_AccessManagerMembershipRegistry` | Points the `AccessManager` at the registry | |
| `19_deploy_SavingsIntentFactory` | `SavingsIntentFactory`, for gasless deposits | `SAVINGS_FACTORY_ADMIN`, `SAVINGS_RELAYER_ADDRESS` |

Each has an npm script as well — `npm run deploy:clrusd -- base-sepolia` and so on; the list is in
the root README. CCIP lanes are configured after `15`: `npm run clrusd:ccip:configure`, then
`npm run clrusd:validate`. The full CLRUSD runbook is
[CLRUSD and the ESA vault](./clrusd-esa-bootstrap.md).

### Credit, capital and offers — `20`–`24`

| Script | Deploys | Reads |
|---|---|---|
| `20_deploy_CreditCore` | `ClearCredit` (the ledger), `NetworkRegistry`, `CollateralRegistry`, `LimitCalculator`, `RevolvingIssuer`, `TermIssuer` — all UUPS — reusing the `AccessManager`. Registers the issuers against the `AssurancePool` and oracle if they exist, and says so if they do not | `CARRY_TREASURY` — where carry lands. The deployer stands in on a testnet; on mainnet it must be the multisig |
| `21_deploy_ClearUSDUpgradeable` | `ClearUSDUpgradeable`, the CLRUSD that carries the redemption lock | `CLRUSD_ADMIN`, `CLRUSD_ADMIN_DELAY`, `CLRUSD_MAX_SUPPLY` |
| `22_deploy_BondsAndPool` | `BondVault`, `LendingPool`, `PayoutPool`, `MerchantRegistry`, `Liquidator`, and the `BurnerBondFactory` if none is recorded. Registers bonds and pool shares as collateral, with different haircuts | `COOP_TREASURY`, `RESERVE_TOKEN`, `BOND_BASE_URI` |
| `23_deploy_BondCollection` | A `BurnerBond` collection for one token, its `BurnerBondDeposit`, and the `BondValuer` that prices it. Registers `BOND` collateral at 95% | `BOND_TOKEN`, `BOND_TOKEN_NAME`, `BOND_TOKEN_SYMBOL`, `BOND_YIELD_BPS`, `BOND_MAX_DISCOUNT`, `BOND_MAX_MATURITY`, `BOND_BASE_URI` |
| `24_deploy_OffersIssuer` | `OffersIssuer`, registered against the ledger, its line opened at the cap | `OFFERS_CAP`, `OFFER_AMOUNT`, `OFFER_EXPIRY_DAYS`, `OFFERS_TREASURY` |

**Moving the vault to `ClearUSDUpgradeable` is its own step, after `21`.**
`ESADepositVault.setClrusd` refuses while any of the old token is outstanding, so the order is:
redeem, then re-point. `scripts/verify_vault_parity.ts` checks a replacement vault is configured
like the one it replaces.

## Wiring after the deploy

The scripts deploy and register. These grant the roles and set the values that make it work:

| Script | Does | Takes |
|---|---|---|
| `scripts/grant_relayer_roles.ts` | The relayer's roles for gasless submission | `RELAYER_ADDRESS` |
| `scripts/grant_claim_escrow_settler.ts` | `ClaimEscrow`'s settler (`npm run send:grant-settler:base-sepolia`) | `CLAIM_ESCROW_NEW_SETTLER`, or the relayer from the API's env |
| `scripts/grant_collateral_operator.ts` | The credit operator's roles to pledge collateral | `OPERATOR` |
| `scripts/grant_pool_borrower.ts` | Lets the card-funding wallet borrow from the `LendingPool` | `CARD_SETTLER_ADDRESS` |
| `scripts/configure-carry-recipients.mjs` | Points carry at the `PayoutPool`. Run with `node`; reports unless given `--apply` | `RPC_URL_84532`, the issuer and pool addresses |
| `scripts/set_target_rtd.ts` | The oracle's target reserve-to-debt ratio | `TARGET_RTD` |
| `scripts/register_merchant.ts` | Registers a merchant — nothing can be charged until one is | `MERCHANT`, optionally `DISCOUNT_BPS`, `APPROVAL_CAP`, `PAYOUT_WINDOW` |
| `scripts/set_merchant_active.ts` | Turns a merchant off or back on | `MERCHANT`, `ACTIVE` |
| `scripts/fund_payout_pool.ts` | Working capital into the `PayoutPool` | `FUND_USDC` |
| `scripts/sync_savings_collateral.ts` | Pledges members' savings so their lines reflect it | `WALLET` or `WALLETS` |
| `scripts/command/approve_treasury_caps.ts` | The Safe's USDC allowances to the contracts that may draw on it. `TREASURY_CAPS_DRY_RUN` to look first | |

Run each as `npx hardhat run <script> --network base-sepolia` with its variables in front, unless the
table says otherwise. The usage is at the top of every script.

## Pointing the apps at it

The API reads its addresses from `apps/api/src/config/contracts.ts`. Each has a Base Sepolia default
there, and an environment variable named for the contract and the chain wins over it —
`PAYOUT_POOL_84532`, `OFFERS_ISSUER_84532`, and so on. `OffersIssuer` has no default: set
`OFFERS_ISSUER_84532` or the API runs without offers. The member app takes CLRUSD and vault
addresses as `VITE_` variables per chain (`VITE_CLRUSD_84532`, `VITE_ESA_VAULT_84532`).

`scripts/update-app-contracts.ts` predates the monorepo — it writes to `app/`, which no longer
exists. Do not use it.

## Handing over the keys

Until this is done, the deployer key holds everything. Two steps, each rehearsed against a fork of
the live network first:

1. **Operational roles to the wallets that do each job** — `scripts/command/ops-roles.ts`, rehearsed
   with `scripts/command/drill_ops_roles.ts`. The deployer stops being a live key. Which role goes
   to which job is [`scripts/command/ops-roles.map.json`](../../scripts/command/ops-roles.map.json):
   each role goes to a job's wallet (`<JOB>_ADDRESS` in the environment, e.g.
   `CREDIT_OPERATOR_ADDRESS`), to the Safe (`SAFE_ADDRESS`), or is renounced because nothing
   off-chain uses it. Its `checks` list names roles one contract needs on another; `FIX_CHECKS=1`
   with `MODE=run` grants the missing ones. **No deploy script grants `LendingPool`'s
   `LIQUIDATOR_ROLE` to the `Liquidator`; only this step does**, and until it has run
   `Liquidator.liquidateShares` reverts
   ([Settlement → LendingPool](../protocol/settlement.md#lendingpool)).
2. **Admin to the Ops Safe** — `scripts/command/safe-handover.ts`, rehearsed with
   `scripts/command/drill_safe_handover.ts`. It surveys who holds each admin role and `owner()`,
   grants each to the Safe, and only then has the deployer renounce. It moves admin roles only;
   operational roles stay unless named in `INCLUDE_ROLES`. Contracts that want ownership accepted
   (`Ownable2Step`, and `ClearUSDUpgradeable`'s delayed admin) need a Safe transaction to finish.

```bash
SAFE_ADDRESS=0x… DEPLOYER=0x… npx hardhat run scripts/command/safe-handover.ts --network base-sepolia                    # survey
SAFE_ADDRESS=0x… MODE=run CONFIRM=handover npx hardhat run scripts/command/safe-handover.ts --network base-sepolia      # do it
```

**Run without `MODE=run`, each script only reads the chain:** it needs no key and sends nothing.

- **`safe-handover.ts`** lists every contract deployed on Base Sepolia, which of its roles the
  deployer and the Ops Safe each hold (marking the admin roles), who owns it and any owner still to
  accept, and the steps a hand-over would still take.
- **`ops-roles.ts`** lists each role in the map, whether the deployer and that job's wallet hold it
  now, and where it is meant to go. It also reports whether each contract holds the roles in the
  map's `checks` list.

Both read the Base Sepolia deployment list (`deployments/base-sepolia`) and ask only about the
addresses they are given: the deployer, the Safe and the job wallets. They answer "does this wallet
hold it?", not "who else does?"; for that, read the contracts' `RoleGranted` and `RoleRevoked`
events ([On-chain authority](../governance/on-chain-authority.md)).

```bash
DEPLOYER=0x… CREDIT_OPERATOR_ADDRESS=0x… … npx hardhat run scripts/command/ops-roles.ts --network base-sepolia                            # survey
MODE=run CONFIRM=ops-roles FIX_CHECKS=1 CREDIT_OPERATOR_ADDRESS=0x… … npx hardhat run scripts/command/ops-roles.ts --network base-sepolia   # do it
```

Who holds what afterwards, and why, is in [Governance](../governance/README.md).

## Upgrades

Upgradeable contracts keep their proxy address; only the implementation changes. Upgrade authority
sits with each contract's admin — once that is the Safe, an upgrade is a Safe transaction, not
something the deployer key can do.

- **The Deed track and the reserve:** `deploy/upgrade/` — check first, then execute:

  ```bash
  CONTRACT_NAME=DeedNFT PROXY_ADDRESS=0x… npm run upgrade:check   -- base-sepolia
  CONTRACT_NAME=DeedNFT PROXY_ADDRESS=0x… npm run upgrade:execute -- base-sepolia
  ```

- **The credit stack:** one script per change in `scripts/upgrade_*.ts`, each named for what it
  ships (`upgrade_bond_backstops.ts`, `upgrade_card_settlement.ts`, `upgrade_offers_owner.ts`, …).
  Each says at the top which proxies it upgrades and what it wires afterwards.

## Checking it

- `scripts/drill_redemption.ts` rehearses a merchant redemption against a fork of what is deployed
- `npm run clrusd:validate` checks the CLRUSD, vault and CCIP setup
- `npm run verify:deployments:sepolia` checks the reserve and the first bond contracts only
  (`07`–`10`); it predates everything after
- Verifying source on Basescan: `npx hardhat verify --network base-sepolia <address>`
- The Command Center's Build page compares each deployed contract's code with this branch, from
  `scripts/command/code-fingerprints.mjs`; CI fails if that file is stale after a contract change
