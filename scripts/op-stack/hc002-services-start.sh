#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICES_DIR="$ROOT_DIR/ops/op-stack/hc002/services"
ENV_FILE="$SERVICES_DIR/.env"
HOST_SCRIPT="$ROOT_DIR/scripts/op-stack/hc002-services-host.mjs"
STATE_DIR="$ROOT_DIR/tmp/hc002-services"
PID_FILE="$STATE_DIR/services.pid"
LOG_FILE="$STATE_DIR/services.log"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing services config."
  echo "Run: npm run hc002:services:init"
  exit 1
fi

if [[ ! -f "$HOST_SCRIPT" ]]; then
  echo "Missing host service script: $HOST_SCRIPT"
  exit 1
fi

if ! curl -sS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://127.0.0.1:9545 >/dev/null 2>&1
then
  echo "Runtime RPC http://127.0.0.1:9545 is unavailable."
  echo "Run: npm run hc002:runtime:start"
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"
SERVICES_PORT="${SERVICES_PORT:-8077}"

mkdir -p "$STATE_DIR"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if ps -p "$EXISTING_PID" >/dev/null 2>&1; then
    echo "HC-002 services already running (pid $EXISTING_PID)."
    echo "Health: http://127.0.0.1:$SERVICES_PORT/health"
    exit 0
  fi
fi

nohup node "$HOST_SCRIPT" >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

echo "Starting HC-002 services host..."
for _ in {1..30}; do
  if curl -sS "http://127.0.0.1:$SERVICES_PORT/health" >/dev/null 2>&1; then
    echo "HC-002 services are up."
    echo "  Explorer:  http://127.0.0.1:$SERVICES_PORT/explorer"
    echo "  Faucet:    http://127.0.0.1:$SERVICES_PORT/faucet"
    echo "  Bridge UI: http://127.0.0.1:$SERVICES_PORT/bridge"
    echo "  Log file:  $LOG_FILE"
    exit 0
  fi
  sleep 1
done

echo "HC-002 services failed to start."
echo "See logs: $LOG_FILE"
exit 1
