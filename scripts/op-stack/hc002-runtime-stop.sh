#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/ops/op-stack/hc002/runtime/sequencer"
DOCKER_CONFIG_DIR="$ROOT_DIR/tmp/docker-config"
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
  docker compose down
)

echo "HC-002 runtime stopped."
