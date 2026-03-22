# Clear Testnet Runtime on Railway

This package runs the OP Stack runtime in Railway so Clear Testnet does not depend on a local machine.

## Services

1. `clear-op-geth` (execution engine, persistent chain data)
2. `clear-op-node` (rollup node / sequencer)
3. `clear-op-batcher` (L2 batch submission to L1)
4. `clear-op-proposer` (output proposals to L1)
5. `clear-rpc-gateway` (public HTTPS/WSS proxy to `clear-op-geth`)

## Required Secrets (Railway Variables)

1. `L1_RPC_URL`
2. `L1_BEACON_URL`
3. `ENGINE_JWT_SECRET` (64-char hex, no `0x`)
4. `OP_BATCHER_PRIVATE_KEY`
5. `OP_PROPOSER_PRIVATE_KEY`
6. `OP_BATCHER_BATCH_INBOX_ADDR`
7. `OP_PROPOSER_GAME_FACTORY_ADDRESS`

## Deploy Order

1. `clear-op-geth` (attach volume at `/data`)
2. `clear-op-node`
3. `clear-op-batcher`
4. `clear-op-proposer`
5. `clear-rpc-gateway` (generate public domain)

## Public Endpoint Contract

1. HTTP RPC: `https://<clear-rpc-gateway-domain>/`
2. WS RPC: `wss://<clear-rpc-gateway-domain>/ws`

## Artifact Sync

When you regenerate OP Stack artifacts, sync managed runtime files:

```bash
bash scripts/op-stack/hc002-managed-runtime-sync-artifacts.sh
```
