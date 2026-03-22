#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/ops/op-stack/hc002/runtime/sequencer"
COMPOSE_FILE="$RUNTIME_DIR/docker-compose.yml"
ENV_FILE="$RUNTIME_DIR/.env"
DOCKER_CONFIG_DIR="$ROOT_DIR/tmp/docker-config"
RPC_URL="${HC002_RPC_URL:-http://127.0.0.1:9545}"
COLIMA_SOCKET="$HOME/.colima/default/docker.sock"

if [[ -z "${DOCKER_HOST:-}" && -S "$COLIMA_SOCKET" ]]; then
  export DOCKER_HOST="unix://$COLIMA_SOCKET"
fi

ensure_compose() {
  if docker compose version >/dev/null 2>&1; then
    return 0
  fi

  mkdir -p "$DOCKER_CONFIG_DIR"
  cat >"$DOCKER_CONFIG_DIR/config.json" <<'EOF'
{
  "cliPluginsExtraDirs": [
    "/opt/homebrew/lib/docker/cli-plugins",
    "/usr/local/lib/docker/cli-plugins"
  ]
}
EOF

  export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"

  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose is unavailable. Install docker-compose plugin."
    exit 1
  fi
}

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing $COMPOSE_FILE"
  echo "Ensure runtime templates exist in ops/op-stack/hc002/runtime/sequencer."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing runtime env at $ENV_FILE"
  echo "Run: npm run hc002:runtime:init"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not reachable. Start Docker/Colima first."
  exit 1
fi

ensure_compose

if [[ ! -d "$RUNTIME_DIR/op-geth-data/geth" ]]; then
  echo "Initializing op-geth data directory from genesis.json..."
  docker run --rm \
    -v "$RUNTIME_DIR:/workspace" \
    -w /workspace \
    us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:v1.101511.1 \
    init --datadir=/workspace/op-geth-data --state.scheme=hash /workspace/genesis.json
fi

(
  cd "$RUNTIME_DIR"
  if [[ -f "$DOCKER_CONFIG_DIR/config.json" ]]; then
    export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"
  fi
  docker compose up -d op-geth op-node op-batcher op-proposer
)

echo "Waiting for RPC at $RPC_URL ..."
CHAIN_ID_HEX=""
for _ in {1..20}; do
  CHAIN_ID_HEX="$(curl -sS -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    "$RPC_URL" | jq -r '.result // empty' || true)"
  if [[ "$CHAIN_ID_HEX" =~ ^0x[0-9a-fA-F]+$ ]]; then
    break
  fi
  sleep 3
done

if [[ ! "$CHAIN_ID_HEX" =~ ^0x[0-9a-fA-F]+$ ]]; then
  echo "Services started, but RPC did not return chainId yet."
  echo "Check logs:"
  echo "  npm run hc002:runtime:status"
  exit 1
fi

echo "HC-002 runtime is up."
echo "RPC chainId: $CHAIN_ID_HEX"
echo
echo "Quick checks:"
echo "  - curl -s -H 'content-type: application/json' --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_blockNumber\",\"params\":[]}' $RPC_URL"
echo "  - npm run hc002:runtime:status"
