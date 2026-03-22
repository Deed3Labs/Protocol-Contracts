#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOLVER_SCRIPT="$ROOT_DIR/scripts/op-stack/hc004-resolve-network-name.sh"

NETWORK_KEY="${1:-}"
if [[ -z "$NETWORK_KEY" ]]; then
  echo "Usage: $0 <home-testnet|home-mainnet> <hardhat-script-path> [extra hardhat args]" >&2
  exit 1
fi
shift

SCRIPT_PATH="${1:-}"
if [[ -z "$SCRIPT_PATH" ]]; then
  echo "Missing hardhat script path. Example: deploy/07_deploy_TokenRegistry.ts" >&2
  exit 1
fi
shift

NETWORK_NAME="$(bash "$RESOLVER_SCRIPT" "$NETWORK_KEY")"

echo "Running $SCRIPT_PATH on network '$NETWORK_NAME'..."
cd "$ROOT_DIR"
npx hardhat run "$SCRIPT_PATH" --network "$NETWORK_NAME" "$@"
