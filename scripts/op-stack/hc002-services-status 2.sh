#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICES_DIR="$ROOT_DIR/ops/op-stack/hc002/services"
ENV_FILE="$SERVICES_DIR/.env"
STATE_DIR="$ROOT_DIR/tmp/hc002-services"
PID_FILE="$STATE_DIR/services.pid"
LOG_FILE="$STATE_DIR/services.log"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing services env: $ENV_FILE"
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"
SERVICES_PORT="${SERVICES_PORT:-8077}"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if ps -p "$PID" >/dev/null 2>&1; then
    echo "HC-002 services process: running (pid $PID)"
  else
    echo "HC-002 services process: stale pid file ($PID)"
  fi
else
  echo "HC-002 services process: not running"
fi

for endpoint in \
  "http://127.0.0.1:$SERVICES_PORT/health|Health" \
  "http://127.0.0.1:$SERVICES_PORT/explorer|Explorer" \
  "http://127.0.0.1:$SERVICES_PORT/faucet|Faucet" \
  "http://127.0.0.1:$SERVICES_PORT/bridge|Bridge UI"; do
  url="${endpoint%%|*}"
  name="${endpoint##*|}"
  code="$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)"
  if [[ "$code" =~ ^2|3 ]]; then
    echo "$name: healthy ($code) $url"
  else
    echo "$name: unavailable ($code) $url"
  fi
done

if [[ -f "$LOG_FILE" ]]; then
  echo "Log file: $LOG_FILE"
fi
