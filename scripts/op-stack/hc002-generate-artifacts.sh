#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OP_DEPLOYER_BIN="$ROOT_DIR/tools/op-stack/bin/op-deployer"
WORKDIR="$ROOT_DIR/ops/op-stack/hc002/deployer/.deployer"
LOCAL_HOME="$ROOT_DIR/tmp/op-deployer-home"
GENESIS_OUT="$ROOT_DIR/ops/op-stack/hc002/deployer/genesis.json"
ROLLUP_OUT="$ROOT_DIR/ops/op-stack/hc002/deployer/rollup.json"

if [[ ! -x "$OP_DEPLOYER_BIN" ]]; then
  echo "Missing op-deployer binary at $OP_DEPLOYER_BIN"
  exit 1
fi

if [[ ! -f "$WORKDIR/intent.toml" ]]; then
  echo "Missing $WORKDIR/intent.toml. Run npm run hc002:init first."
  exit 1
fi

set +e
GENESIS_ERR_FILE="$(mktemp)"
HOME="$LOCAL_HOME" "$OP_DEPLOYER_BIN" inspect genesis --workdir "$WORKDIR" 92373 >"$GENESIS_OUT" 2>"$GENESIS_ERR_FILE"
GENESIS_STATUS=$?
set -e

if [[ $GENESIS_STATUS -ne 0 ]]; then
  rm -f "$GENESIS_OUT"
  echo "Failed to generate genesis.json."
  cat "$GENESIS_ERR_FILE"
  rm -f "$GENESIS_ERR_FILE"
  echo "Expected next step: run op-deployer apply with a funded Sepolia key."
  exit $GENESIS_STATUS
fi

rm -f "$GENESIS_ERR_FILE"
HOME="$LOCAL_HOME" "$OP_DEPLOYER_BIN" inspect rollup --workdir "$WORKDIR" 92373 >"$ROLLUP_OUT"

echo "Generated:"
echo "  - $GENESIS_OUT"
echo "  - $ROLLUP_OUT"
