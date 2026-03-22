# HC-004: Home Testnet Hardhat + Deploy Tooling

Date: March 22, 2026  
Status: Done  
Plan reference: `docs/HOME_CHAIN_30_60_90_EXECUTION_PLAN.md` (HC-004)

## 1. Goal

Ensure home-chain deployment commands run without manual network-name edits.

## 2. What Is Completed

1. Home chain network definitions in `hardhat.config.ts` are sourced from `config/chain-manifest.json`.
2. Network-name resolver script added:
   - `scripts/op-stack/hc004-resolve-network-name.sh`
3. Generic Hardhat runner added:
   - `scripts/op-stack/hc004-hardhat-run.sh`
4. Home chain deploy shortcuts added in `package.json`:
   - `deploy:burner-bonds:home-testnet`
   - `deploy:burner-bonds:home-mainnet`
   - `deploy:token-registry:home-testnet`
   - `deploy:assurance-pool:home-testnet`
   - `deploy:assurance-oracle:home-testnet`
   - `deploy:burner-bond-factory:home-testnet`
   - `deploy:clrusd:home-testnet`
   - `deploy:esa-vault:home-testnet`
   - `deploy:clrusd-register:home-testnet`
   - `deploy:clrusd-pool:home-testnet`
   - `deploy:savings-intents:home-testnet`
   - `verify:deployments:home-testnet`
5. Equivalent `:home-mainnet` shortcuts added for the same deploy/verify flows.

## 3. Usage

From repo root:

```bash
npm run hc004:network:home-testnet
npm run deploy:burner-bonds:home-testnet
npm run verify:deployments:home-testnet
```

Generic command form:

```bash
npm run hc004:hardhat:home-testnet -- deploy/07_deploy_TokenRegistry.ts
npm run hc004:hardhat:home-mainnet -- deploy/07_deploy_TokenRegistry.ts
```

## 4. Notes

1. `HOME_TESTNET_NETWORK_NAME` / `HOME_MAINNET_NETWORK_NAME` env vars override manifest network names.
2. If env vars are not set, scripts resolve names from `config/chain-manifest.json`.
3. This keeps deployment commands stable while allowing network-name changes during chain rollout.
