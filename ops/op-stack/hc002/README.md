# HC-002 OP Stack Bring-Up Workspace

This workspace is for `HC-002` in `docs/HOME_CHAIN_30_60_90_EXECUTION_PLAN.md`.

## Target Networks

1. `Clear Testnet` (`chainId: 92373`)
2. `Clear Mainnet` reserved (`chainId: 92401`, not launching in this phase)

## Commands

From repo root:

```bash
npm run opstack:install-op-deployer
npm run hc002:init
npm run hc002:populate-intent
npm run hc002:apply
npm run hc002:artifacts
npm run hc002:runtime:init
npm run hc002:runtime:start
npm run hc002:runtime:status
npm run hc002:runtime:stop
npm run hc002:services:init
npm run hc002:services:start
npm run hc002:services:status
npm run hc002:services:stop
npm run hc002:managed:runtime:sync
npm run hc002:managed:runtime:deploy
```

## Expected Flow

1. `hc002:init` creates `.deployer/intent.toml` and `.deployer/state.json`.
2. `hc002:populate-intent` fills OP Stack role/recipient addresses from `DEPLOYER_ACCOUNT`.
3. `hc002:apply` runs `op-deployer apply`.
4. `hc002:artifacts` generates `genesis.json` and `rollup.json` only after `hc002:apply` succeeds.
5. `op-deployer apply` requires:
   - reachable Sepolia `L1_RPC_URL`
   - funded Sepolia deployment `PRIVATE_KEY`
6. Create deployer env file:
   - copy `ops/op-stack/hc002/deployer/.env.example` to `ops/op-stack/hc002/deployer/.env`

## Runtime Workspace

1. Runtime compose and env templates:
   - `ops/op-stack/hc002/runtime/sequencer/docker-compose.yml`
   - `ops/op-stack/hc002/runtime/sequencer/.env.example`
2. Local RPC endpoint after startup:
   - `http://127.0.0.1:9545` (chainId `92373`)

## Local Service Layer

1. Service host endpoints:
   - Explorer: `http://127.0.0.1:8077/explorer`
   - Faucet: `http://127.0.0.1:8077/faucet`
   - Bridge UI: `http://127.0.0.1:8077/bridge`
2. Service artifacts:
   - `ops/op-stack/hc002/services/`
   - `scripts/op-stack/hc002-services-host.mjs`

## Managed Hosted Prep

1. Service blueprint:
   - `ops/op-stack/hc002/managed/clear-testnet.service-blueprint.yaml`
2. Provider env template:
   - `ops/op-stack/hc002/managed/clear-testnet.hosted.env.example`
3. Railway runbook and manifest:
   - `ops/op-stack/hc002/managed/railway/README.md`
   - `ops/op-stack/hc002/managed/railway/railway.service-host.json`
4. Managed runtime package:
   - `ops/op-stack/hc002/managed/railway/runtime/`
   - public RPC gateway runs at `https://clear-rpc-gateway-production.up.railway.app`

## Canonical Chain Defaults

1. `config/chain-manifest.json` now defaults `home-testnet` RPC + explorer to hosted Clear Testnet endpoints.
2. Local overrides are still supported via:
   - frontend: `VITE_HOME_TESTNET_RPC_URL`, `VITE_HOME_TESTNET_BLOCK_EXPLORER_URL`
   - backend: `HOME_TESTNET_RPC_URL`, `HOME_TESTNET_BLOCK_EXPLORER_URL`
