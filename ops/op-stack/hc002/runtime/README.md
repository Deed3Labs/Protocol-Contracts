# HC-002 Runtime (Clear Testnet)

This runtime directory hosts local OP Stack services for Clear Testnet (`chainId: 92373`):

1. `op-geth` (execution)
2. `op-node` (consensus/sequencer)
3. `op-batcher`
4. `op-proposer`

## Quick Start

From repo root:

```bash
npm run hc002:runtime:init
npm run hc002:runtime:start
npm run hc002:runtime:status
```

Stop services:

```bash
npm run hc002:runtime:stop
```

## Local Endpoints

1. L2 JSON-RPC: `http://127.0.0.1:9545`
2. L2 WS: `ws://127.0.0.1:9546`
3. op-node RPC: `http://127.0.0.1:9547`
4. op-batcher RPC: `http://127.0.0.1:9548`
5. op-proposer RPC: `http://127.0.0.1:9560`
