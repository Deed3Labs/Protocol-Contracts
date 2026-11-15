# Deploying the contracts

How the Clear Protocol gets onto a chain: the scripts in [`deploy/`](../../deploy/), the order they
run in, the wiring after them, and handing the keys over. Who is meant to hold each role once it is
done is in [Governance](../governance/README.md).

Base Sepolia carries the whole stack. Base carries the savings and send rails only (`ClearUSD`,
`ESADepositVault`, `ClaimEscrow`), Ethereum Sepolia the cross-chain CLRUSD pool. The addresses are
in the root README's **Deployed addresses**.

## Before you start

**Test first.** `npm run test` runs every suite. The specs in `test/deploy/` run the deploy scripts
themselves against a fresh chain — the wiring is the part most likely to deploy cleanly and then
refuse the first draw: script `20` (`CreditCore`), `25` (`Compliance`), the handovers (`Vault`,
`Earn`, `Compliance`), and the fresh-credit wiring of `22`, `27`, the Yield Pool upgrade, the vault
batch and the bond unwind report (`FreshCredit`).

**Nothing in this repository has been run against a network for the audit.** The full order, with
the waits and every owner-to-confirm item, is [DEPLOY-RUNBOOK.md](../audit/DEPLOY-RUNBOOK.md).

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
with the deployment. Scripts `16` and `20`–`27` are idempotent: anything already recorded is reused, and
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
| `08_deploy_AssurancePool` | The co-op's `AssurancePool` (UUPS) and its 7-day Assurance timelock, through `assurance_timelock_handover.ts` (section 13) |
| `10_deploy_BurnerBondFactory` | `BurnerBondFactory` and `BurnerBondDeposit`, gated on the `TokenRegistry` whitelist |

`deploy/deploy_burner_bonds.ts` runs `07` and `10` in one go (`npm run deploy:burner-bonds:sepolia`).
The AssuranceOracle (the old `09`) is retired, and the AssurancePool is deployed on its own: nothing on
the bond side takes its address.

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

### Credit, capital, Earn and offers — `20`–`27`

**Base Sepolia's credit stack is deployed fresh, not upgraded (decision 47,
[the decisions file](../audit/specs/phase-2f-plan-decisions.md)).** Its old lines and plans would be
charged decades of carry on first touch, and a fresh stack makes Base Sepolia a rehearsal of mainnet,
where credit is fresh anyway. First retire the old records, so the scripts below deploy fresh
instead of reusing them:

```bash
npx hardhat run deploy/retire_credit_stack.ts --network base-sepolia                          # lists what it would move
RETIRE_CREDIT_STACK=1 npx hardhat run deploy/retire_credit_stack.ts --network base-sepolia    # moves them
```

It keeps each of AccessManager, ClearCredit, NetworkRegistry, RevolvingIssuer, TermIssuer,
CollateralRegistry, LimitCalculator, MerchantRegistry, PayoutPool, Liquidator and OffersIssuer as
`<Name>PreAudit` and touches nothing on chain. Then run `16` and `18` again (a fresh AccessManager,
linked to the MembershipRegistry), and the scripts below. ESADepositVault, ClaimEscrow,
ClearUSDUpgradeable, LendingPool and BondVault are upgraded in place (see **Upgrades**) and
re-pointed by these scripts.

The order on Base Sepolia (the full sequence, with what to wait for, is
[DEPLOY-RUNBOOK.md](../audit/DEPLOY-RUNBOOK.md) section 2.2):

0. `CHECK_BASELINE=1 npx hardhat run scripts/check_retired_credit.ts --network base-sepolia`: the
   baseline of what the steps below must disconnect (read-only; expected to fail here).
1. `scripts/unwind_legacy_bonds.ts` (report first), before the BondVault upgrade.
2. The savings rails: the vault, CLRUSD and ClaimEscrow upgrades, then `19`.
3. `deploy/retire_credit_stack.ts`, `16`, `18`, `20`.
4. `26`, then `scripts/upgrade_yield_pool.ts`, then `scripts/upgrade_bond_vault_pledge_guard.ts`.
5. `22` with `REPLACE_BOND_FACTORY=1`, `24`, `23` with `FIRST_BOND_ID`, `27`.
6. The co-signed CollateralAgent changes, `25`, the Pool Tier ceiling, `26` again, `08`, the Deed track.
   Once the old PayoutPool has repaid the BondVault, the co-signed `setBackstops(treasury, 0)` that
   `27` prints (decision 48). On Base Sepolia it need not repay: its loans are test money, and `27`
   skips the backstop while one is open (decision 50).
7. The operational roles and the handovers.
8. `npx hardhat run scripts/check_retired_credit.ts --network base-sepolia` until it passes: no
   retired contract still connected. It is the gate before the held app PRs merge. The old
   PayoutPool's open loans, its legs while owed, the BondVault's backstop while it is owed, and
   balances left in retired contracts are WARN there ("test money, decision 50") and do not block;
   on Base mainnet they would FAIL.

On mainnet there is nothing to retire or unwind: `16`–`18`, `20`, `26`, `22`, `23`, `27`, `24`, `25`
(DEPLOY-RUNBOOK.md section 3.5). Every script that sends on Base asks for `CONFIRM_MAINNET=1`.

| Script | Deploys | Reads |
|---|---|---|
| `retire_credit_stack` | Nothing: keeps the old credit records as `*PreAudit` so the next scripts deploy fresh | `RETIRE_CREDIT_STACK=1` to move them |
| `scripts/check_retired_credit.ts` | Nothing, and sends nothing: lists every role, source, refusal, balance, loan and leg that still connects a retired `*PreAudit`, `*Pre2f` or `*Legacy` contract to what we keep, as PASS / WARN / FAIL; exits non-zero on any FAIL (decision 48). On any chain but Base mainnet the old PayoutPool's loans, its legs while owed, the BondVault backstop while owed and balances are WARN, "test money, decision 50" | `CHECK_BASELINE=1` before the retirement; `RESERVE_TOKEN` |
| `20_deploy_CreditCore` | `ClearCredit` (the ledger), `NetworkRegistry`, `CollateralRegistry`, `LimitCalculator`, `RevolvingIssuer` and `TermIssuer` (each with its modules) — all UUPS — on the recorded `AccessManager`. Registers both issuers against the ledger; sets the ledger's reserve token and Lending Co.'s operating address, and the CLRUSD token on the registry and the revolving issuer | `CARRY_TREASURY` (the multisig on mainnet), `LENDER_OPERATING`, `RESERVE_TOKEN`, `CREDIT_LINES_KEY`, `CREDIT_LIMITS_KEY`, the daily caps |
| `21_deploy_ClearUSDUpgradeable` | `ClearUSDUpgradeable`, the CLRUSD that carries the redemption lock | `CLRUSD_ADMIN`, `CLRUSD_ADMIN_DELAY`, `CLRUSD_MAX_SUPPLY` |
| `22_deploy_BondsAndPool` | `MerchantRegistry`, `PayoutPool`, `LendingPool` (the Yield Pool, with its modules), `BondVault`, `Liquidator`, and a Phase 2f `BurnerBondFactory`. Registers pool shares as collateral, writes the pool's legend, and, on a fresh chain, makes the Liquidator an AccessManager operator, grants it CLRUSD's `LIQUIDATOR_ROLE` and names the `CollateralRegistry` as CLRUSD's encumbrance source. Revokes every CLRUSD and AccessManager role a retired contract holds. Switches each PayoutPool's vault and yield legs off once repaid. A recorded pool must already be the Yield Pool | `COOP_TREASURY`, `CLEAR_LENDING_ACCOUNT`, `RESERVE_TOKEN`, `BOND_BASE_URI`, `REPLACE_BOND_FACTORY=1` (keeps a pre-2f factory, collection, deposit contract and valuer as `*Pre2f` and deploys the new factory) |
| `23_deploy_BondCollection` | The `BurnerBond` collection for one token, its `BondValuer`, `HolderDirections`; registers `BOND` at 95%; wires the collection, the BondVault and EarnControls, revokes every BondVault role a retired contract holds (the pre-2f collection's `BOND_ROLE`), then names the Collateral Agent; grants the collection `BOND_ROLE` on EarnControls by resolution; the Ladder | `FIRST_BOND_ID` (required while an older collection is on record), `EARN_RESOLUTION`, `BOND_TOKEN`, `BOND_TOKEN_NAME`, `BOND_TOKEN_SYMBOL`, `BOND_YIELD_BPS`, `BOND_BASE_URI` |
| `24_deploy_OffersIssuer` | `OffersIssuer`, registered against the ledger, its line opened at the cap | `OFFERS_CAP`, `OFFER_AMOUNT`, `OFFER_EXPIRY_DAYS`, `OFFERS_TREASURY` |
| `25_wire_Compliance` | `RateSchedule`, `PauseClock`, `PoolShareEnforcer`; the compliance wiring; the card settler and TermIssuer's mandate source; revokes every ESADepositVault and ClaimEscrow role a retired contract holds | `STATE_ATTESTER_KEY`, `FEE_RECIPIENT`, `CARD_SETTLER_ADDRESS`, `CARD_SETTLEMENT_ACCOUNT` |
| `26_deploy_EarnControls` | The Earn timelock, `EarnControls`, the `CollateralAgent`; refuses the Clear contracts as Earn payers (run it again at the end) | `CLEAR_LENDING_SAFE`, `AGENT_KEY`, `TREASURY_SIGNERS`, `COLLATERAL_ACCOUNT`, `AGENT_COST_ADDRESS`, `EXCESS_DESTINATION` |
| `27_wire_Earn` | Nothing new: names EarnControls and the pool on each other; grants the Earn roles from [`deploy/config/earn-roles.json`](../../deploy/config/earn-roles.json); revokes the pool's retired `BORROWER_ROLE` and `LIQUIDATOR_ROLE` holders; `setYieldPool(0)` and `setBondVault(0)` on every PayoutPool that owes nothing; revokes every pool and EarnControls role a retired contract holds; prints the co-signed `BondVault.setBackstops(treasury, 0)` that clears the retired PayoutPool once `lentToPayoutPool` is 0 (it never sends it); before that it skips it on a testnet (test money, decision 50) and refuses it on Base mainnet; reports the Pool Tier ceiling | `EARN_RESOLUTION`, `POOL_TIER_PRINCIPAL`, `POOL_TIER_EVIDENCE` |

**The Earn role holders are the owner's to fill.** Every list in `deploy/config/earn-roles.json` is
`null`, and deploy 27 grants nothing, saying "owner to fill", until each is set: on the pool two
`DEPLOYER_ROLE`, two `VALUATION_ROLE` (never a Deployment signer), `SUSPENSION_ROLE`, `CCO_ROLE` and
`TREASURER_ROLE`; on EarnControls `ATTESTER_ROLE` and two each of `PAUSE_ROLE`, `SUCCESSOR_ROLE`,
`ELIGIBILITY_ROLE`, `LADDER_ROLE`, `FUNDING_ROLE` and `WIND_DOWN_ROLE`, `ROLL_NOTICE_ROLE` and
`EXCLUDED_HOLDER_ROLE` (`[]` if none).

After a handover, scripts `22`, `25` and `27` cannot make the calls that need the handed-over power;
they print each one with the timelock that must propose it.

**Moving the vault to `ClearUSDUpgradeable` is its own step, after `21`.**
`ESADepositVault.setClrusd` refuses while any of the old token is outstanding, so the order is:
redeem, then re-point. `scripts/migrate_vault_clrusd.ts` writes the batch; `scripts/verify_vault_parity.ts`
checks a replacement vault is configured like the one it replaces.

## Wiring after the deploy

The scripts deploy and register. These grant the roles and set the values that make it work:

| Script | Does | Takes |
|---|---|---|
| `scripts/grant_relayer_roles.ts` | The relayer's roles for gasless submission | `RELAYER_ADDRESS` |
| `scripts/grant_claim_escrow_settler.ts` | `ClaimEscrow`'s settler (`npm run send:grant-settler:base-sepolia`) | `CLAIM_ESCROW_NEW_SETTLER`, or the relayer from the API's env |
| `scripts/grant_collateral_operator.ts` | The credit operator's roles to pledge collateral | `OPERATOR` |
| `scripts/configure-carry-recipients.mjs` | Points carry at the `PayoutPool`. Run with `node`; reports unless given `--apply`. Reads the `PayoutPool`, `TermIssuer` and `RevolvingIssuer` records and refuses a retired `*PreAudit` one; Base mainnet needs `CONFIRM_MAINNET=1` | `SAVINGS_DEFAULT_CHAIN_ID`, `RPC_URL_84532`; optional `PAYOUT_POOL_<chain>`, `TERM_ISSUER_<chain>`, `REVOLVING_ISSUER_<chain>` |
| `scripts/register_merchant.ts` | Registers a merchant — nothing can be charged until one is | `MERCHANT`, optionally `DISCOUNT_BPS`, `APPROVAL_CAP`, `PAYOUT_WINDOW` |
| `scripts/set_merchant_active.ts` | Turns a merchant off or back on | `MERCHANT`, `ACTIVE` |
| `scripts/fund_payout_pool.ts` | Working capital into the `PayoutPool` record | `FUND_USDC` |
| `scripts/sync_savings_collateral.ts` | Pledges members' savings so their lines reflect it | `WALLET` or `WALLETS` |
| `scripts/command/approve_treasury_caps.ts` | The Safe's USDC allowances to the contracts that may draw on it. `TREASURY_CAPS_DRY_RUN` to look first | |

Run each as `npx hardhat run <script> --network base-sepolia` with its variables in front, unless the
table says otherwise. The usage is at the top of every script. Nothing borrows from the `LendingPool`
any more: only Clear Lending draws, as a recorded Deployment (decision 17).

## Pointing the apps at it

The API reads its addresses from `apps/api/src/config/contracts.ts`. Each has a Base Sepolia default
there, and an environment variable named for the contract and the chain wins over it —
`PAYOUT_POOL_84532`, `OFFERS_ISSUER_84532`, and so on. `OffersIssuer` has no default: set
`OFFERS_ISSUER_84532` or the API runs without offers. The member app takes CLRUSD and vault
addresses as `VITE_` variables per chain (`VITE_CLRUSD_84532`, `VITE_ESA_VAULT_84532`).

After the fresh Base Sepolia credit stack, those defaults (and `apps/member/src/lib/clearNetwork.ts`)
still name the retired contracts. [DEPLOY-RUNBOOK.md](../audit/DEPLOY-RUNBOOK.md) section 4.2 lists
every file, line and address, and the record that replaces each. Change them in the app PRs, after
the deploy and once `scripts/check_retired_credit.ts` passes, and check any `*_84532` environment
value set on the hosts: it wins over the file.

`scripts/update-app-contracts.ts` predates the monorepo — it writes to `app/`, which no longer
exists. Do not use it.

## Handing over the keys

Until this is done, the deployer key holds everything. Five steps, the first two rehearsed against a fork of
the live network first:

1. **Operational roles to the wallets that do each job** — `scripts/command/ops-roles.ts`, rehearsed
   with `scripts/command/drill_ops_roles.ts`. The deployer stops being a live key. Which role goes
   to which job is [`scripts/command/ops-roles.map.json`](../../scripts/command/ops-roles.map.json):
   each role goes to a job's wallet (`<JOB>_ADDRESS` in the environment, e.g.
   `CREDIT_OPERATOR_ADDRESS`), to the Safe (`SAFE_ADDRESS`), or is renounced because nothing
   off-chain uses it. Its `checks` list names roles one contract needs on another; `FIX_CHECKS=1`
   with `MODE=run` grants the missing ones. Since Phase 2f the `Liquidator` needs no role on the
   `LendingPool` (pool shares are redeemed through `PoolShareEnforcer`, which deploy 25 grants
   `ENFORCER_ROLE`), and nothing borrows from the pool (decision 17): the map gives no one
   `BORROWER_ROLE`, and the vault's relayer `RELAYER_ROLE`, not `OPERATOR_ROLE`.
2. **Admin to the Ops Safe** — `scripts/command/safe-handover.ts`, rehearsed with
   `scripts/command/drill_safe_handover.ts`. It surveys who holds each admin role and `owner()`,
   grants each to the Safe, and only then has the deployer renounce. It moves admin roles only;
   operational roles stay unless named in `INCLUDE_ROLES`. Contracts that want ownership accepted
   (`Ownable2Step`) need a Safe transaction to finish. It leaves out `ESADepositVault`,
   `ClearUSDUpgradeable` and the CLRUSD token pool, which are Clear Financial Co.'s (step 3).
3. **The ESA vault and CLRUSD to the vault timelock** — `deploy/vault_timelock_handover.ts`
   (Phase 2d, addendum 10g). A 7-day timelock with a Clear Financial Co. Safe (two signers at
   least; the script checks) as proposer gets every admin and upgrade power over the vault, CLRUSD
   and the token pool. The relayer, pause, CA-mint-pause, fraud and security keys named in the
   environment are granted first, and the deployer then renounces every vault and CLRUSD role. The
   Safe finishes it by accepting CLRUSD's admin (and the pool's ownership) through the timelock.
   See [UPGRADEABILITY.md](../audit/UPGRADEABILITY.md). Run it after deploy 22 has granted the
   Liquidator its CLRUSD role.
4. **The credit stack to the credit timelock** — `deploy/credit_timelock_handover.ts`
   (`OPS_SAFE`, `CREDIT_HANDOVER=1`). It covers the records by name, so the fresh stack; the
   `*PreAudit` contracts keep the deployer as admin. They are disconnected instead (decision 48):
   no pause, no timelock.
5. **Earn to the Earn timelock** — `deploy/earn_timelock_handover.ts` (`CLEAR_LENDING_SAFE`,
   `EARN_RESOLUTION`, `EARN_HANDOVER=1`), last, after deploy 27 and the second run of deploy 26. It
   also moves the `*Pre2f` and `*Legacy` collections and deposit contracts, whose owner can still
   seize bonds and recover tokens (decision 48), and the new `BurnerBondFactory` with every
   `*Pre2f` and `*Legacy` factory on record (decision 50; `Ownable`, one step). On Base it asks for
   `CONFIRM_MAINNET=1`.

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
sits with each contract's admin — once that is a timelock, an upgrade is a Safe proposal and 7 days,
not something the deployer key can do.

- **ESADepositVault:** never a bare upgrade. `scripts/upgrade_vault.ts` (`PREPARE_VAULT_IMPL=1`)
  validates and deploys the implementation and never touches the proxy;
  `scripts/migrate_vault_clrusd.ts` (`VAULT_IMPL`, `RELAYER`, `CLEAR_FINANCIAL_SAFE`, optional
  `VAULT_ADMIN`, `USDC`, `NEW_CLRUSD`) sends nothing and writes the batch: the one
  `upgradeToAndCall(impl, setAcceptedToken(USDC, true))` and the relayer's role split. It reads the
  `ESADepositVault` record and checks who holds the vault's admin: through the vault timelock (the
  Clear Financial Co. Safe schedules, then executes after 7 days), the Clear Financial Safe directly,
  or a named account.
- **LendingPool → the Yield Pool:** `scripts/upgrade_yield_pool.ts` (`CLEAR_LENDING_ACCOUNT`,
  `INITIAL_CLOSING`, `YIELD_POOL_UPGRADE=1` to send). It validates against the manifest first, then
  deploys the modules and the implementation and makes the one
  `upgradeToAndCall(impl, initializeYieldPool(...))`, writes the legend and reports the Pool Tier
  ceiling.
- **BondVault:** `scripts/upgrade_bond_vault_pledge_guard.ts`, only once
  `scripts/unwind_legacy_bonds.ts` (`MODE=report` by default; `MODE=unwind CONFIRM=unwind HOLDER=…`)
  shows no pre-2f bond outstanding in any collection on record.
- **ClaimEscrow, ClearUSDUpgradeable, the Deed track and the reserve:** `deploy/upgrade/` — check
  first, then execute (it refuses `ESADepositVault` and `LendingPool`, and asks for
  `CONFIRM_MAINNET=1` on Base):

  ```bash
  CONTRACT_NAME=ClaimEscrow PROXY_ADDRESS=0x… npm run upgrade:check   -- base-sepolia
  CONTRACT_NAME=ClaimEscrow PROXY_ADDRESS=0x… npm run upgrade:execute -- base-sepolia
  ```

  DeedNFT takes its two extensions as constructor arguments: `scripts/upgrade_deednft_reserved_traits.ts`
  deploys them, if the old Deed track is kept rather than redeployed.
- **The credit stack:** deployed fresh on both networks (decision 47), so no credit upgrade script
  remains. A later upgrade of a credit contract is a new script, through the credit timelock;
  TermIssuer and RevolvingIssuer take their modules as constructor arguments
  (`deploy/issuerModules.ts`).

## Checking it

- `scripts/drill_redemption.ts` rehearses a merchant redemption against a fork of what is deployed
- `npm run clrusd:validate` checks the CLRUSD, vault and CCIP setup
- `npm run verify:deployments:sepolia` checks the reserve and the first bond contracts only
  (`07`–`10`); it predates everything after
- Verifying source on Basescan: `npx hardhat verify --network base-sepolia <address>`
- The Command Center's Build page compares each deployed contract's code with this branch, from
  `scripts/command/code-fingerprints.mjs`; CI fails if that file is stale after a contract change
