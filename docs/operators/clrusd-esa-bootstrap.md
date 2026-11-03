# CLRUSD ESA Bootstrap Runbook

> **Out of date in places — read with [`docs/protocol/savings.md`](../protocol/savings.md).** This
> runbook was written for the original `ClearUSD`. Since then:
>
> - `ClearUSDUpgradeable` (`deploy/21_deploy_ClearUSDUpgradeable.ts`) replaces it, and
>   `13_deploy_ESADepositVault.ts` points a new vault at it first. Moving an existing vault is
>   redeem, then `setClrusd`, which refuses while any of the old token is outstanding.
> - CLRUSD is credit collateral: the token enforces the redemption lock through its encumbrance
>   source, and holds a `LIQUIDATOR_ROLE`. "`StableCredit` remains independent" below no longer holds.
> - `15_deploy_CLRUSDTokenPool.ts` and `scripts/clrusd/configure_ccip.ts` bind to the old
>   `ClearUSD` record; the replacement token needs its own pool.
> - The emergency controls below leave out `UPGRADER_ROLE`, `LIQUIDATOR_ROLE` and the encumbrance
>   source.

## Scope

This v1 flow issues `CLRUSD` from an isolated `ESADepositVault` and keeps backing segregated from `AssurancePool`.

- Home chain mints/redeems through `ESADepositVault`
- Cross-chain movement uses CCIP burn/mint token pools
- `StableCredit` remains independent in v1

## Contracts

- `ClearUSD` (`CLRUSD`, 6 decimals)
- `ESADepositVault`
- `Create2Deployer` (optional, for deterministic deployment)

## Deployment Sequence

1. Deploy CLRUSD

```bash
npm run deploy:clrusd -- base-sepolia
```

2. Deploy ESA vault and grant token roles

```bash
npm run deploy:esa-vault -- base-sepolia
```

3. Register CLRUSD in token registry

```bash
npm run deploy:clrusd-register -- base-sepolia
```

4. Configure CCIP token admin + pool linkage

```bash
npm run clrusd:ccip:configure -- base-sepolia
```

5. Validate setup

```bash
npm run clrusd:validate -- base-sepolia
```

## Required Env Vars

- `CLRUSD_ADMIN`
- `CLRUSD_MAX_SUPPLY`
- `CLRUSD_PREMINT`
- `CLRUSD_USE_CREATE2`
- `CLRUSD_CREATE2_SALT`
- `CLRUSD_CREATE2_FACTORY_ADDRESS` (optional)
- `CLRUSD_ADDRESS` (optional override)
- `ESA_VAULT_ADDRESS` (optional override)
- `ESA_VAULT_DEPOSIT_TOKEN`
- `TOKEN_REGISTRY_ADDRESS`
- `CCIP_TOKEN_ADMIN_REGISTRY`
- `CLRUSD_TOKEN_POOL_ADDRESS`
- `CCIP_REMOTE_CHAIN_SELECTOR`
- `CCIP_REMOTE_TOKEN_ADDRESS`
- `CCIP_REMOTE_POOL_ADDRESS`

## Emergency Controls

1. Pause vault operations:
- Call `pause()` on `ESADepositVault` (requires `PAUSER_ROLE`).

2. Freeze issuance:
- Revoke `MINTER_ROLE` from vault/pool on `ClearUSD`.

3. Freeze redemptions from a compromised actor:
- Revoke `BURNER_ROLE` from compromised actor on `ClearUSD`.

4. Resume safely:
- Regrant roles only after incident review and state reconciliation.
- Unpause vault.

## Solvency Checklist

For each accepted deposit token:

1. Vault token balance is sufficient for expected redemptions.
2. Home-chain CLRUSD liability is reconciled against vault reserves.
3. In-flight CCIP transfers are reconciled before large redemptions.
4. Registry metadata and chain mappings are current for CLRUSD.
