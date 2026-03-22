#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOYER_DIR="$ROOT_DIR/ops/op-stack/hc002/deployer"
RUNTIME_DIR="$ROOT_DIR/ops/op-stack/hc002/managed/railway/runtime"

GENESIS_SRC="$DEPLOYER_DIR/genesis.json"
ROLLUP_SRC="$DEPLOYER_DIR/rollup.json"

if [[ ! -f "$GENESIS_SRC" || ! -f "$ROLLUP_SRC" ]]; then
  echo "Missing deployer artifacts. Run hc002:apply and hc002:artifacts first."
  exit 1
fi

cp "$GENESIS_SRC" "$RUNTIME_DIR/config/genesis.json"
cp "$ROLLUP_SRC" "$RUNTIME_DIR/config/rollup.json"
cp "$GENESIS_SRC" "$RUNTIME_DIR/clear-op-geth/genesis.json"
cp "$ROLLUP_SRC" "$RUNTIME_DIR/clear-op-node/rollup.json"

echo "Synced runtime artifacts:"
echo "  - $RUNTIME_DIR/config/genesis.json"
echo "  - $RUNTIME_DIR/config/rollup.json"
echo "  - $RUNTIME_DIR/clear-op-geth/genesis.json"
echo "  - $RUNTIME_DIR/clear-op-node/rollup.json"
