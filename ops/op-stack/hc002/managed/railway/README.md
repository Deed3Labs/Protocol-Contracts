# Clear Testnet Railway Runbook

This runbook deploys HC-002 hosted services on Railway:

1. `clear-op-geth` + `clear-op-node` + `clear-op-batcher` + `clear-op-proposer` (managed OP Stack runtime)
2. `clear-rpc-gateway` (public RPC + WSS proxy)
1. `clear-testnet-services` (Bridge UI + Faucet UI/API + lightweight explorer endpoint)
2. `clear-testnet-blockscout` (Blockscout backend API/indexer)
3. `clear-testnet-explorer` (Blockscout frontend UI)

## Required Inputs

1. Public Clear RPC URL (`https://...`) for indexer + hosted services
2. Funded faucet private key for L2 (`FAUCET_PRIVATE_KEY`)
3. OP Stack proxy addresses from `ops/op-stack/hc002/deployer/deployment.summary.json`

## 0) Deploy Managed Runtime (Independent of Local Machine)

```bash
npm run hc002:managed:runtime:sync
npm run hc002:managed:runtime:deploy
```

This creates/updates:

1. `clear-op-geth` with persistent volume
2. `clear-op-node`
3. `clear-op-batcher`
4. `clear-op-proposer`
5. `clear-rpc-gateway`

Current hosted RPC gateway endpoint:

1. `https://clear-rpc-gateway-production.up.railway.app`
2. `wss://clear-rpc-gateway-production.up.railway.app/ws`

If you need temporary fallback only, you can expose local HC-002 with tunnels:

```bash
cloudflared tunnel --url http://127.0.0.1:9545 --no-autoupdate
cloudflared tunnel --url http://127.0.0.1:9546 --no-autoupdate
```

Use the generated `https://...trycloudflare.com` URL as HTTP/TRACE RPC and `wss://...trycloudflare.com` for WS. Keep these tunnel processes running.

If the RPC URL is not publicly reachable, the stack still deploys but:
- `clear-testnet-services /health` returns `500`
- Blockscout runs but cannot index Clear blocks

## 1) Deploy `clear-testnet-services`

```bash
railway up --service clear-testnet-services \
  --path-as-root ops/op-stack/hc002/managed/railway/service-host
railway domain --service clear-testnet-services
```

Set vars:

```bash
railway variables --service clear-testnet-services --environment production \
  --set "PORT=8080" \
  --set "SERVICES_PORT=8080" \
  --set "CLEAR_CHAIN_NAME=Clear Testnet" \
  --set "CLEAR_CHAIN_ID=92373" \
  --set "CLEAR_L1_CHAIN_ID=11155111" \
  --set "RPC_URL=https://REPLACE_CLEAR_RPC_PUBLIC_URL" \
  --set "PUBLIC_RPC_URL=https://REPLACE_CLEAR_RPC_PUBLIC_URL" \
  --set "PUBLIC_FAUCET_URL=https://clear-testnet-services-production.up.railway.app/faucet" \
  --set "PUBLIC_BRIDGE_URL=https://clear-testnet-services-production.up.railway.app/bridge" \
  --set "FAUCET_DRIP_AMOUNT_ETH=0.01" \
  --set "FAUCET_COOLDOWN_SECONDS=86400" \
  --set "FAUCET_PRIVATE_KEY=0xREPLACE_FUNDED_L2_KEY" \
  --set "OPTIMISM_PORTAL_PROXY=0xREPLACE_OPTIMISM_PORTAL_PROXY" \
  --set "L1_STANDARD_BRIDGE_PROXY=0xREPLACE_L1_STANDARD_BRIDGE_PROXY" \
  --set "L1_CROSS_DOMAIN_MESSENGER_PROXY=0xREPLACE_L1_XDOMAIN_PROXY" \
  --set "L1_ERC721_BRIDGE_PROXY=0xREPLACE_L1_ERC721_BRIDGE_PROXY" \
  --set "SYSTEM_CONFIG_PROXY=0xREPLACE_SYSTEM_CONFIG_PROXY"
```

## 2) Deploy `clear-testnet-blockscout` backend

Deploy from the bundled Dockerfile wrapper (adds runtime command):

```bash
railway up --service clear-testnet-blockscout \
  --path-as-root ops/op-stack/hc002/managed/railway/blockscout
railway domain --service clear-testnet-blockscout
```

If this service was originally created as a raw Docker image service, apply vars first and then run the same `railway up ... --path-as-root ...` command again so Railway uses this wrapper deployment.

Use Railway `Postgres` + `Redis` services (same environment), then set:

```bash
railway variables --service clear-testnet-blockscout --environment production \
  --set "PORT=4000" \
  --set "DATABASE_URL=postgresql://REPLACE_USER:REPLACE_PASS@postgres.railway.internal:5432/railway" \
  --set "REDIS_URL=redis://default:REPLACE_PASS@redis.railway.internal:6379" \
  --set "ECTO_USE_SSL=false" \
  --set "ETHEREUM_JSONRPC_VARIANT=geth" \
  --set "ETHEREUM_JSONRPC_HTTP_URL=https://REPLACE_CLEAR_RPC_PUBLIC_URL" \
  --set "ETHEREUM_JSONRPC_TRACE_URL=https://REPLACE_CLEAR_RPC_PUBLIC_URL" \
  --set "ETHEREUM_JSONRPC_WS_URL=wss://REPLACE_CLEAR_WS_PUBLIC_URL" \
  --set "CHAIN_ID=92373" \
  --set "NETWORK=Clear Testnet" \
  --set "SUBNETWORK=Clear Testnet" \
  --set "COIN=ETH" \
  --set "COIN_NAME=Sepolia ETH" \
  --set "SECRET_KEY_BASE=REPLACE_LONG_RANDOM_HEX" \
  --set "DISABLE_WEBAPP=true" \
  --set "API_V2_ENABLED=true"
```

## 3) Deploy `clear-testnet-explorer` frontend (origin)

```bash
railway add --service clear-testnet-explorer --image ghcr.io/blockscout/frontend:latest
railway domain --service clear-testnet-explorer
```

Set vars:

```bash
railway variables --service clear-testnet-explorer --environment production \
  --set "PORT=3000" \
  --set "NEXT_PUBLIC_APP_PROTOCOL=https" \
  --set "NEXT_PUBLIC_APP_HOST=clear-testnet-explorer-production.up.railway.app" \
  --set "NEXT_PUBLIC_NETWORK_NAME=Clear Testnet" \
  --set "NEXT_PUBLIC_NETWORK_SHORT_NAME=Clear" \
  --set "NEXT_PUBLIC_NETWORK_ID=92373" \
  --set "NEXT_PUBLIC_NETWORK_RPC_URL=https://REPLACE_CLEAR_RPC_PUBLIC_URL" \
  --set "NEXT_PUBLIC_NETWORK_CURRENCY_NAME=Sepolia ETH" \
  --set "NEXT_PUBLIC_NETWORK_CURRENCY_SYMBOL=ETH" \
  --set "NEXT_PUBLIC_IS_TESTNET=true" \
  --set "NEXT_PUBLIC_API_PROTOCOL=https" \
  --set "NEXT_PUBLIC_API_HOST=clear-testnet-blockscout-production.up.railway.app" \
  --set "NEXT_PUBLIC_API_WEBSOCKET_PROTOCOL=wss"
```

Optional branding var (recommended):

```bash
railway variables --service clear-testnet-explorer --environment production \
  --set "NEXT_PUBLIC_NETWORK_ICON=https://raw.githubusercontent.com/Deed3Labs/Protocol-Contracts/main/app/public/ClearPath-Logo.png" \
  --set "NEXT_PUBLIC_NETWORK_LOGO=https://raw.githubusercontent.com/Deed3Labs/Protocol-Contracts/main/app/public/ClearPath-Logo.png"
```

Optional typography override (General Sans for headings + body):

```bash
railway variables --service clear-testnet-explorer --environment production \
  --set "NEXT_PUBLIC_FONT_FAMILY_HEADING={'name':'General Sans','url':'https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap'}" \
  --set "NEXT_PUBLIC_FONT_FAMILY_BODY={'name':'General Sans','url':'https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap'}"
```

## 4) Wire services host to explorer UI

```bash
railway variables --service clear-testnet-services --environment production \
  --set "PUBLIC_EXPLORER_URL=https://clear-testnet-explorer-production.up.railway.app" \
  --set "BLOCKSCOUT_HOST=clear-testnet-explorer-production.up.railway.app"
```

## Validation

```bash
curl -sS https://clear-testnet-services-production.up.railway.app/bridge-config.json
curl -sS https://clear-testnet-blockscout-production.up.railway.app/api/v2/stats
curl -I https://clear-testnet-explorer-production.up.railway.app/
curl -sS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  https://clear-rpc-gateway-production.up.railway.app
```

## Optional Cleanup

To stop accidentally created extra Postgres deployments:

```bash
railway down --service Postgres-cSxe --environment production -y
railway down --service Postgres-vCqp --environment production -y
railway down --service Postgres-6SqX --environment production -y
```
