#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OP_DEPLOYER_BIN="$ROOT_DIR/tools/op-stack/bin/op-deployer"
WORKDIR="$ROOT_DIR/ops/op-stack/hc002/deployer/.deployer"
LOCAL_HOME="$ROOT_DIR/tmp/op-deployer-home"
TRACKED_INTENT="$ROOT_DIR/ops/op-stack/hc002/deployer/intent.initial.toml"
TRACKED_STATE="$ROOT_DIR/ops/op-stack/hc002/deployer/state.initial.json"

if [[ ! -x "$OP_DEPLOYER_BIN" ]]; then
  echo "Missing op-deployer binary at $OP_DEPLOYER_BIN"
  echo "Install it first, then rerun this script."
  exit 1
fi

mkdir -p "$WORKDIR" "$LOCAL_HOME"

if [[ "${HC002_FORCE_INIT:-0}" == "1" ]]; then
  rm -f "$WORKDIR/intent.toml" "$WORKDIR/state.json"
fi

if [[ -f "$WORKDIR/intent.toml" && -f "$WORKDIR/state.json" ]]; then
  echo "HC-002 deployer workspace already initialized, skipping init."
else
  HOME="$LOCAL_HOME" "$OP_DEPLOYER_BIN" init \
    --l1-chain-id 11155111 \
    --l2-chain-ids 92373 \
    --workdir "$WORKDIR" \
    --intent-type standard-overrides
fi

cp "$WORKDIR/intent.toml" "$TRACKED_INTENT"
cp "$WORKDIR/state.json" "$TRACKED_STATE"

echo "HC-002 initialization complete."
echo "Tracked files:"
echo "  - $TRACKED_INTENT"
echo "  - $TRACKED_STATE"
