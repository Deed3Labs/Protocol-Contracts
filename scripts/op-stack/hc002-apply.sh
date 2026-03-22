#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OP_DEPLOYER_BIN="$ROOT_DIR/tools/op-stack/bin/op-deployer"
WORKDIR="$ROOT_DIR/ops/op-stack/hc002/deployer/.deployer"
LOCAL_HOME="$ROOT_DIR/tmp/op-deployer-home"
ENV_FILE="$ROOT_DIR/ops/op-stack/hc002/deployer/.env"
ROOT_ENV_FILE="$ROOT_DIR/.env"
APPLIED_STATE="$ROOT_DIR/ops/op-stack/hc002/deployer/state.applied.json"

if [[ ! -x "$OP_DEPLOYER_BIN" ]]; then
  echo "Missing op-deployer binary at $OP_DEPLOYER_BIN"
  echo "Run: npm run opstack:install-op-deployer"
  exit 1
fi

# shellcheck source=/dev/null
if [[ -f "$ROOT_ENV_FILE" ]]; then
  source "$ROOT_ENV_FILE"
fi

# shellcheck source=/dev/null
if [[ -f "$ENV_FILE" ]]; then
  source "$ENV_FILE"
fi

is_placeholder() {
  local v="${1:-}"
  [[ -z "$v" || "$v" =~ REPLACE|YOUR_|your_|example|placeholder ]]
}

if ! is_placeholder "${L1_RPC_URL:-}"; then
  L1_RPC_URL_EFFECTIVE="$L1_RPC_URL"
elif ! is_placeholder "${SEPOLIA_RPC_URL:-}"; then
  L1_RPC_URL_EFFECTIVE="$SEPOLIA_RPC_URL"
else
  L1_RPC_URL_EFFECTIVE="${ETH_SEPOLIA_RPC_URL:-}"
fi

if ! is_placeholder "${PRIVATE_KEY:-}"; then
  PRIVATE_KEY_EFFECTIVE="$PRIVATE_KEY"
else
  PRIVATE_KEY_EFFECTIVE="${DEPLOYER_PRIVATE_KEY:-}"
fi

if is_placeholder "$L1_RPC_URL_EFFECTIVE"; then
  echo "Invalid L1 RPC URL. Set L1_RPC_URL in $ENV_FILE or root .env."
  exit 1
fi

if [[ -n "$PRIVATE_KEY_EFFECTIVE" && ! "$PRIVATE_KEY_EFFECTIVE" =~ ^0x ]]; then
  PRIVATE_KEY_EFFECTIVE="0x$PRIVATE_KEY_EFFECTIVE"
fi

if [[ ! "$PRIVATE_KEY_EFFECTIVE" =~ ^0x[0-9a-fA-F]{64}$ ]] || [[ "$PRIVATE_KEY_EFFECTIVE" =~ ^0x0+$ ]]; then
  echo "Invalid deployer private key. Set PRIVATE_KEY in $ENV_FILE or DEPLOYER_PRIVATE_KEY in root .env."
  exit 1
fi

mkdir -p "$LOCAL_HOME" "$WORKDIR"

HOME="$LOCAL_HOME" "$OP_DEPLOYER_BIN" apply \
  --workdir "$WORKDIR" \
  --l1-rpc-url "$L1_RPC_URL_EFFECTIVE" \
  --private-key "$PRIVATE_KEY_EFFECTIVE"

cp "$WORKDIR/state.json" "$APPLIED_STATE"
echo "Apply complete. Snapshot written to $APPLIED_STATE"
