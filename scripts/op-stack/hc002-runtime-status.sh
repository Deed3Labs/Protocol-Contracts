#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/ops/op-stack/hc002/runtime/sequencer"
DOCKER_CONFIG_DIR="$ROOT_DIR/tmp/docker-config"
RPC_URL="${HC002_RPC_URL:-http://127.0.0.1:9545}"
COLIMA_SOCKET="$HOME/.colima/default/docker.sock"

if [[ -z "${DOCKER_HOST:-}" && -S "$COLIMA_SOCKET" ]]; then
  export DOCKER_HOST="unix://$COLIMA_SOCKET"
fi

if [[ ! -d "$RUNTIME_DIR" ]]; then
  echo "Missing runtime directory: $RUNTIME_DIR"
  exit 1
fi

if [[ -f "$DOCKER_CONFIG_DIR/config.json" ]]; then
  export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"
fi

(
  cd "$RUNTIME_DIR"
  docker compose ps
)

echo
CHAIN_ID_HEX="$(curl -sS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  "$RPC_URL" | jq -r '.result // empty' || true)"
BLOCK_HEX="$(curl -sS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}' \
  "$RPC_URL" | jq -r '.result // empty' || true)"

if [[ "$CHAIN_ID_HEX" =~ ^0x[0-9a-fA-F]+$ ]]; then
  echo "RPC chainId: $CHAIN_ID_HEX"
else
  echo "RPC chainId: unavailable"
fi

if [[ "$BLOCK_HEX" =~ ^0x[0-9a-fA-F]+$ ]]; then
  echo "RPC latest block: $BLOCK_HEX"
else
  echo "RPC latest block: unavailable"
fi
