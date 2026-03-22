# HC-002: OP Stack Testnet Bring-Up (Clear Testnet)

Date: March 21, 2026  
Status: Done  
Plan reference: `docs/HOME_CHAIN_30_60_90_EXECUTION_PLAN.md` (HC-002)

## 1. Scope

Bring up the Clear testnet control plane and execution path:

1. RPC
2. Block explorer
3. Faucet
4. Bridge UI

## 2. What Is Completed

1. Local `op-deployer` binary install flow added (`scripts/op-stack/install-op-deployer.sh`).
2. HC-002 init flow scripted (`scripts/op-stack/hc002-init.sh`).
3. Intent population flow scripted (`scripts/op-stack/hc002-populate-intent.sh`).
4. Apply flow scripted with env fallback to root `.env` (`scripts/op-stack/hc002-apply.sh`).
5. Initial deployer workspace created for:
   - `l1ChainID=11155111` (Sepolia)
   - `l2 chainId=92373` (Clear Testnet)
6. Initial artifacts captured:
   - `ops/op-stack/hc002/deployer/intent.initial.toml`
   - `ops/op-stack/hc002/deployer/state.initial.json`
7. `op-deployer apply` executed successfully with funded deployer wallet.
8. Generated artifacts:
   - `ops/op-stack/hc002/deployer/genesis.json`
   - `ops/op-stack/hc002/deployer/rollup.json`
   - `ops/op-stack/hc002/deployer/state.applied.json`
   - `ops/op-stack/hc002/deployer/deployment.summary.json`
9. Runtime automation scripts added:
   - `scripts/op-stack/hc002-runtime-init.sh`
   - `scripts/op-stack/hc002-runtime-start.sh`
   - `scripts/op-stack/hc002-runtime-status.sh`
   - `scripts/op-stack/hc002-runtime-stop.sh`
10. Local runtime compose added:
   - `ops/op-stack/hc002/runtime/sequencer/docker-compose.yml`
11. Local runtime validated:
   - `op-geth`, `op-node`, `op-batcher`, `op-proposer` are running
   - local RPC chain ID returns `0x168d5` (`92373`)
   - local block height advances on `http://127.0.0.1:9545`
12. Managed-hosted prep artifacts added:
   - `ops/op-stack/hc002/managed/clear-testnet.service-blueprint.yaml`
   - `ops/op-stack/hc002/managed/clear-testnet.hosted.env.example`
13. Local service layer added (explorer + faucet + bridge UI path):
   - `scripts/op-stack/hc002-services-init.sh`
   - `scripts/op-stack/hc002-services-start.sh`
   - `scripts/op-stack/hc002-services-status.sh`
   - `scripts/op-stack/hc002-services-stop.sh`
   - `scripts/op-stack/hc002-services-host.mjs`
   - `ops/op-stack/hc002/services/`
14. End-to-end service validation completed:
   - explorer endpoint healthy (`/explorer`)
   - bridge endpoint healthy (`/bridge`)
   - faucet endpoint healthy (`/faucet`)
   - successful test drip tx: `0xa47e879d909249beb2315b88f49f1e928eae3ca0ad2fd128e220603793814e7d`
15. Railway deployment runbook added for hosted service rollout:
   - `ops/op-stack/hc002/managed/railway/README.md`
   - `ops/op-stack/hc002/managed/railway/railway.service-host.json`
16. Managed Railway runtime package added for independent hosting:
   - `ops/op-stack/hc002/managed/railway/runtime/`
   - `scripts/op-stack/hc002-managed-runtime-sync-artifacts.sh`
   - `scripts/op-stack/hc002-managed-runtime-railway-deploy.sh`
17. Hosted runtime services deployed:
   - `clear-op-geth` + persistent volume
   - `clear-op-node`
   - `clear-op-batcher`
   - `clear-op-proposer`
   - `clear-rpc-gateway` (`https://clear-rpc-gateway-production.up.railway.app`)
18. Hosted app services wired to hosted runtime and validated:
   - services host health: `https://clear-testnet-services-production.up.railway.app/health` -> `200`
   - explorer API: `https://clear-testnet-blockscout-production.up.railway.app/api/v2/stats` -> `200`
   - explorer UI: `https://clear-testnet-explorer-production.up.railway.app/` -> `200`
19. Independence validation completed:
   - local runtime was stopped
   - temporary local tunnels were stopped
   - hosted runtime continued producing blocks and serving traffic
20. Canonical chain defaults now point to hosted Clear Testnet infrastructure:
    - `config/chain-manifest.json` `home-testnet` RPC uses `https://clear-rpc-gateway-production.up.railway.app`
    - `config/chain-manifest.json` `home-testnet` explorer uses `https://clear-testnet-explorer-production.up.railway.app`

## 3. Current Status

HC-002 definition of done is satisfied:

1. Public endpoints are live.
2. Internal runbooks are versioned in repo.
3. Team can fund wallets, call RPC, and use explorer/bridge/faucet flows against hosted endpoints.

Post-HC-002 hardening items (outside this task) remain:

1. Add formal uptime/latency alerting and on-call escalation.
2. Add production-grade key rotation + secret-manager workflow.
3. Add managed backup and restore drills for runtime data.

## 4. Commands

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
