# CLRUSD and the ESA vault

Deploying and running CLRUSD: the savings token, issued one-for-one against USDC by an isolated
`ESADepositVault` whose reserve is kept apart from the `AssurancePool`. How the token and the vault
behave, including the redemption lock, is in [Savings](../protocol/savings.md). Where this fits in
the full deployment order is [Deploying the contracts](./deploying-contracts.md).

## Contracts

| Contract | Script | What it is |
|---|---|---|
| `ClearUSDUpgradeable` | `21_deploy_ClearUSDUpgradeable` | The current CLRUSD. UUPS, built on Chainlink's `BurnMintERC20UUPS`, 6 decimals. Carries the redemption lock (through an encumbrance source) and `seize` (`LIQUIDATOR_ROLE`) |
| `ClearUSD` | `12_deploy_ClearUSD` | The original CLRUSD: a plain deployment, optionally through CREATE2, behind no proxy. It cannot carry the lock |
| `ESADepositVault` | `13_deploy_ESADepositVault` | UUPS. Mints CLRUSD on deposit and burns it on redemption; `depositWithAuthorization` takes gasless EIP-3009 USDC deposits from a relayer |
| `CLRUSDTokenPool` | `15_deploy_CLRUSDTokenPool` | The CCIP burn/mint pool for cross-chain CLRUSD |

## Deploying on a new network

Each command takes `--network <name>`; the npm scripts take the network after `--`.

**1. The token.**

```bash
npx hardhat run deploy/21_deploy_ClearUSDUpgradeable.ts --network base-sepolia
```

Reads `CLRUSD_ADMIN` (the deployer if unset), `CLRUSD_MAX_SUPPLY` and `CLRUSD_ADMIN_DELAY` (two days
if unset). Nothing is pre-minted: supply arrives only through the vault. The admin delay is
scheduled at deployment, so a later handover of the admin role waits out the delay. If a vault is
already recorded, the script grants it mint and burn.

**2. The vault.**

```bash
npm run deploy:esa-vault -- base-sepolia
```

The vault backs, in order of preference: `VAULT_CLRUSD`, the recorded `ClearUSDUpgradeable`, the
recorded `ClearUSD`, then `CLRUSD_ADDRESS`. The script:

- deploys the vault proxy, with `CLRUSD_ADMIN` holding `DEFAULT_ADMIN_ROLE`, `OPERATOR_ROLE` and
  `PAUSER_ROLE`
- grants `OPERATOR_ROLE` to the savings relayer (`SAVINGS_RELAYER_ADDRESS_<chainId>`, else
  `SAVINGS_RELAYER_ADDRESS`), and warns if neither is set
- grants the vault `MINTER_ROLE` and `BURNER_ROLE` on the token
- accepts `ESA_VAULT_DEPOSIT_TOKEN` as a deposit token, or USDC by default on Base, Base Sepolia,
  Ethereum and Sepolia
- records the vault as `ESADepositVault`, or as `VAULT_DEPLOYMENT_NAME` so a replacement can be
  recorded without overwriting the vault it replaces

**3. The redemption lock.** No script sets it. The token's admin calls
`ClearUSDUpgradeable.setEncumbranceSource` with the `CollateralRegistry` (deployed by script `20`),
which reports how much of each holder's CLRUSD stands behind drawn credit. Until it is set, nothing
is locked.

**4. The liquidator.** After script `22` deploys the `Liquidator`,
`scripts/upgrade_liquidator_savings.ts` upgrades it and grants it `LIQUIDATOR_ROLE` on the token, so
savings-backed credit can be settled from a member's savings. It is idempotent.

**5. Registry and cross-chain.**

```bash
npm run deploy:clrusd-register -- base-sepolia   # 14: registers CLRUSD in the TokenRegistry
npm run deploy:clrusd-pool -- base-sepolia       # 15: the CCIP pool (CCIP_ROUTER, CCIP_RMN_PROXY)
npm run clrusd:ccip:configure -- base-sepolia    # token admin and the remote lane
npm run clrusd:validate -- base-sepolia          # roles, accepted token, registry entry
```

**These four read the recorded `ClearUSD` first**, and use `CLRUSD_ADDRESS` only when no `ClearUSD`
is recorded. On a network that has only `ClearUSDUpgradeable`, set `CLRUSD_ADDRESS` to it. On a
network that has both, they act on the original `ClearUSD`; registering, bridging or validating
`ClearUSDUpgradeable` there is not available through these scripts yet.

## Moving an existing vault to the new token

A vault backing the original `ClearUSD` moves in two steps, in this order:

1. **Redeem** every outstanding `ClearUSD`.
2. **Re-point:** the vault's admin calls `ESADepositVault.setClrusd(<ClearUSDUpgradeable>)`. It
   refuses while any of the old token is outstanding.

`scripts/verify_vault_parity.ts` checks that a replacement vault holds the same roles and settings
as the one it replaces.

## Environment variables

| Variable | Read by |
|---|---|
| `CLRUSD_ADMIN` | `12`, `13`, `21` |
| `CLRUSD_MAX_SUPPLY` | `12`, `21` |
| `CLRUSD_ADMIN_DELAY` | `21` |
| `CLRUSD_PREMINT`, `CLRUSD_USE_CREATE2`, `CLRUSD_CREATE2_SALT`, `CLRUSD_CREATE2_FACTORY_ADDRESS` | `12` |
| `VAULT_CLRUSD`, `VAULT_DEPLOYMENT_NAME` | `13` |
| `CLRUSD_ADDRESS` | `13`, `14`, `15`, `configure_ccip`, `validate_setup`, when nothing is recorded |
| `ESA_VAULT_ADDRESS` | `validate_setup`, `repair_vault`, when no vault is recorded |
| `ESA_VAULT_DEPOSIT_TOKEN` | `13`, `validate_setup`, `repair_vault` |
| `SAVINGS_RELAYER_ADDRESS(_<chainId>)` | `13` |
| `TOKEN_REGISTRY_ADDRESS`, `CLRUSD_REMOTE_CHAIN_ID`, `CLRUSD_REMOTE_ADDRESS` | `14` |
| `CCIP_ROUTER`, `CCIP_RMN_PROXY` | `15` |
| `CCIP_TOKEN_ADMIN_REGISTRY`, `CCIP_REGISTRY_MODULE_OWNER_CUSTOM`, `CCIP_REMOTE_CHAIN_SELECTOR`, `CCIP_REMOTE_TOKEN_ADDRESS`, `CCIP_REMOTE_POOL_ADDRESS` | `configure_ccip` |
| `CLRUSD_TOKEN_POOL_ADDRESS` | `15`, `configure_ccip`, `validate_setup` |

`npm run clrusd:repair-vault -- <network>` re-grants the vault's mint and burn roles if they are
missing.

## Emergency controls

| To | Do | Needs |
|---|---|---|
| Stop deposits and redemptions | `ESADepositVault.pause()` | `PAUSER_ROLE` on the vault |
| Stop issuance | Revoke `MINTER_ROLE` on the token from the vault and the CCIP pool | The token's `DEFAULT_ADMIN_ROLE` |
| Stop a compromised burner | Revoke its `BURNER_ROLE` on the token | The token's `DEFAULT_ADMIN_ROLE` |
| Stop seizures | Revoke `LIQUIDATOR_ROLE` on the token | The token's `DEFAULT_ADMIN_ROLE` |
| Lift the redemption lock for everyone | `setEncumbranceSource(address(0))`, for example if the source breaks | The token's `DEFAULT_ADMIN_ROLE` |
| Stop upgrades | Revoke `UPGRADER_ROLE` on the token. The vault upgrades under its `DEFAULT_ADMIN_ROLE` | The token's `DEFAULT_ADMIN_ROLE` |

To resume: re-grant roles only after the incident is reviewed and the state reconciled, then
`unpause()` the vault.

## Solvency checks

For each accepted deposit token:

1. The vault's balance covers expected redemptions.
2. CLRUSD on the home chain reconciles against the vault's reserve. The API's hourly reconciler
   compares the vault's USDC with CLRUSD in circulation
   ([Lithic → Reconciliation](../developers/integrations/lithic.md#3-reconciliation)).
3. In-flight CCIP transfers are reconciled before large redemptions.
4. The `TokenRegistry` entry and chain mappings for CLRUSD are current.
