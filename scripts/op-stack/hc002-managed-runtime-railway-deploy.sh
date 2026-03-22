#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_ENV_FILE="$ROOT_DIR/ops/op-stack/hc002/runtime/sequencer/.env"
JWT_FILE="$ROOT_DIR/ops/op-stack/hc002/runtime/sequencer/jwt.txt"
SUMMARY_FILE="$ROOT_DIR/ops/op-stack/hc002/deployer/deployment.summary.json"
RUNTIME_BASE="$ROOT_DIR/ops/op-stack/hc002/managed/railway/runtime"
BLOCKSCOUT_PATH="$ROOT_DIR/ops/op-stack/hc002/managed/railway/blockscout"

if ! command -v railway >/dev/null 2>&1; then
  echo "railway CLI is required"
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

bash "$ROOT_DIR/scripts/op-stack/hc002-managed-runtime-sync-artifacts.sh"

if [[ ! -f "$RUNTIME_ENV_FILE" ]]; then
  echo "Missing runtime env file: $RUNTIME_ENV_FILE"
  exit 1
fi
if [[ ! -f "$JWT_FILE" ]]; then
  echo "Missing JWT file: $JWT_FILE"
  exit 1
fi
if [[ ! -f "$SUMMARY_FILE" ]]; then
  echo "Missing deployment summary file: $SUMMARY_FILE"
  exit 1
fi

# shellcheck source=/dev/null
set -a
source "$RUNTIME_ENV_FILE"
set +a

ENGINE_JWT_SECRET="$(tr -d '\n' < "$JWT_FILE")"
if [[ ! "$ENGINE_JWT_SECRET" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Invalid ENGINE_JWT_SECRET in $JWT_FILE"
  exit 1
fi

BATCH_INBOX_ADDRESS="${OP_BATCHER_BATCH_INBOX_ADDR:-$(jq -r '.batchInboxAddress // empty' "$SUMMARY_FILE")}"
GAME_FACTORY_ADDRESS="${OP_PROPOSER_GAME_FACTORY_ADDRESS:-$(jq -r '.disputeGameFactoryProxy // empty' "$SUMMARY_FILE")}"

if [[ -z "${L1_RPC_URL:-}" || -z "${L1_BEACON_URL:-}" ]]; then
  echo "Missing L1 RPC/Beacon URLs in $RUNTIME_ENV_FILE"
  exit 1
fi
if [[ -z "${OP_BATCHER_PRIVATE_KEY:-}" || -z "${OP_PROPOSER_PRIVATE_KEY:-}" ]]; then
  echo "Missing batcher/proposer keys in $RUNTIME_ENV_FILE"
  exit 1
fi
if [[ -z "$BATCH_INBOX_ADDRESS" || -z "$GAME_FACTORY_ADDRESS" ]]; then
  echo "Missing batch inbox or dispute game factory address"
  exit 1
fi

ensure_service() {
  local svc="$1"
  if railway status --json | jq -e --arg svc "$svc" '.services.edges[].node.name == $svc' >/dev/null; then
    return
  fi
  railway add --service "$svc" --image alpine:3.20 >/dev/null
}

get_service_id() {
  local svc="$1"
  railway status --json | jq -r --arg svc "$svc" '.services.edges[] | select(.node.name==$svc) | .node.id' | head -n1
}

echo "Ensuring runtime services exist..."
for svc in clear-op-geth clear-op-node clear-op-batcher clear-op-proposer clear-rpc-gateway; do
  ensure_service "$svc"
done

CLEAR_OP_GETH_SERVICE_ID="$(get_service_id clear-op-geth)"
if [[ -z "$CLEAR_OP_GETH_SERVICE_ID" ]]; then
  echo "Unable to resolve clear-op-geth service ID"
  exit 1
fi

if ! railway status --json | jq -e --arg sid "$CLEAR_OP_GETH_SERVICE_ID" '
  any(.volumes.edges[]?.node.volumeInstances.edges[]?.node.serviceId; . == $sid)
' >/dev/null; then
  railway volume -s "$CLEAR_OP_GETH_SERVICE_ID" add -m /data >/dev/null
fi

echo "Configuring runtime service variables..."
railway variables --service clear-op-geth --environment production \
  --set "ENGINE_JWT_SECRET=$ENGINE_JWT_SECRET" >/dev/null

railway variables --service clear-op-node --environment production \
  --set "L1_RPC_URL=$L1_RPC_URL" \
  --set "L1_BEACON_URL=$L1_BEACON_URL" \
  --set "ENGINE_JWT_SECRET=$ENGINE_JWT_SECRET" \
  --set "L2_ENGINE_RPC_URL=http://clear-op-geth.railway.internal:8551" >/dev/null

railway variables --service clear-op-batcher --environment production \
  --set "OP_BATCHER_L1_ETH_RPC=${OP_BATCHER_L1_ETH_RPC:-$L1_RPC_URL}" \
  --set "OP_BATCHER_PRIVATE_KEY=$OP_BATCHER_PRIVATE_KEY" \
  --set "OP_BATCHER_L2_ETH_RPC=http://clear-op-geth.railway.internal:8545" \
  --set "OP_BATCHER_ROLLUP_RPC=http://clear-op-node.railway.internal:8547" \
  --set "OP_BATCHER_BATCH_INBOX_ADDR=$BATCH_INBOX_ADDRESS" \
  --set "OP_BATCHER_POLL_INTERVAL=${OP_BATCHER_POLL_INTERVAL:-1s}" \
  --set "OP_BATCHER_SUB_SAFETY_MARGIN=${OP_BATCHER_SUB_SAFETY_MARGIN:-6}" \
  --set "OP_BATCHER_NUM_CONFIRMATIONS=${OP_BATCHER_NUM_CONFIRMATIONS:-1}" \
  --set "OP_BATCHER_SAFE_ABORT_NONCE_TOO_LOW_COUNT=${OP_BATCHER_SAFE_ABORT_NONCE_TOO_LOW_COUNT:-3}" \
  --set "OP_BATCHER_MAX_CHANNEL_DURATION=${OP_BATCHER_MAX_CHANNEL_DURATION:-1}" \
  --set "OP_BATCHER_DATA_AVAILABILITY_TYPE=${OP_BATCHER_DATA_AVAILABILITY_TYPE:-calldata}" \
  --set "OP_BATCHER_RPC_PORT=${OP_BATCHER_RPC_PORT:-8548}" >/dev/null

railway variables --service clear-op-proposer --environment production \
  --set "OP_PROPOSER_L1_ETH_RPC=${OP_PROPOSER_L1_ETH_RPC:-$L1_RPC_URL}" \
  --set "OP_PROPOSER_ROLLUP_RPC=http://clear-op-node.railway.internal:8547" \
  --set "OP_PROPOSER_GAME_FACTORY_ADDRESS=$GAME_FACTORY_ADDRESS" \
  --set "OP_PROPOSER_PRIVATE_KEY=$OP_PROPOSER_PRIVATE_KEY" \
  --set "OP_PROPOSER_PROPOSAL_INTERVAL=${OP_PROPOSER_PROPOSAL_INTERVAL:-3600s}" \
  --set "OP_PROPOSER_GAME_TYPE=${OP_PROPOSER_GAME_TYPE:-0}" \
  --set "OP_PROPOSER_POLL_INTERVAL=${OP_PROPOSER_POLL_INTERVAL:-20s}" \
  --set "OP_PROPOSER_ALLOW_NON_FINALIZED=${OP_PROPOSER_ALLOW_NON_FINALIZED:-true}" \
  --set "OP_PROPOSER_WAIT_NODE_SYNC=${OP_PROPOSER_WAIT_NODE_SYNC:-true}" \
  --set "OP_PROPOSER_RPC_PORT=${OP_PROPOSER_RPC_PORT:-8560}" >/dev/null

railway variables --service clear-rpc-gateway --environment production \
  --set "PORT=8080" >/dev/null

echo "Deploying runtime services..."
railway up --service clear-op-geth --path-as-root "$RUNTIME_BASE/clear-op-geth" >/dev/null
railway up --service clear-op-node --path-as-root "$RUNTIME_BASE/clear-op-node" >/dev/null
railway up --service clear-op-batcher --path-as-root "$RUNTIME_BASE/clear-op-batcher" >/dev/null
railway up --service clear-op-proposer --path-as-root "$RUNTIME_BASE/clear-op-proposer" >/dev/null
railway up --service clear-rpc-gateway --path-as-root "$RUNTIME_BASE/clear-rpc-gateway" >/dev/null

if ! railway status --json | jq -e '
  .services.edges[]
  | select(.node.name=="clear-rpc-gateway")
  | any(.node.serviceInstances.edges[]?.node.domains.serviceDomains[]?.domain; . != null)
' >/dev/null; then
  railway domain --service clear-rpc-gateway >/dev/null
fi

RPC_DOMAIN="$(railway status --json | jq -r '
  .services.edges[]
  | select(.node.name=="clear-rpc-gateway")
  | .node.serviceInstances.edges[]?.node.domains.serviceDomains[]?.domain
' | head -n1)"

if [[ -z "$RPC_DOMAIN" ]]; then
  echo "Unable to resolve clear-rpc-gateway public domain"
  exit 1
fi

PUBLIC_RPC_URL="https://$RPC_DOMAIN"
PUBLIC_WS_URL="wss://$RPC_DOMAIN/ws"

echo "Updating downstream hosted services..."
railway variables --service clear-testnet-services --environment production \
  --set "RPC_URL=$PUBLIC_RPC_URL" \
  --set "PUBLIC_RPC_URL=$PUBLIC_RPC_URL" >/dev/null

railway variables --service clear-testnet-blockscout --environment production \
  --set "ETHEREUM_JSONRPC_HTTP_URL=$PUBLIC_RPC_URL" \
  --set "ETHEREUM_JSONRPC_TRACE_URL=$PUBLIC_RPC_URL" \
  --set "ETHEREUM_JSONRPC_WS_URL=$PUBLIC_WS_URL" >/dev/null

railway variables --service clear-testnet-explorer --environment production \
  --set "NEXT_PUBLIC_NETWORK_RPC_URL=$PUBLIC_RPC_URL" >/dev/null

railway up --service clear-testnet-blockscout --path-as-root "$BLOCKSCOUT_PATH" >/dev/null

echo "Managed runtime deployed."
echo "  Public RPC: $PUBLIC_RPC_URL"
echo "  Public WS:  $PUBLIC_WS_URL"
