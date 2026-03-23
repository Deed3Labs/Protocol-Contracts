#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST_FILE="$ROOT_DIR/config/chain-manifest.json"

NETWORK_KEY="${1:-}"
if [[ -z "$NETWORK_KEY" ]]; then
  echo "Usage: $0 <home-testnet|home-mainnet>" >&2
  exit 1
fi

if [[ "$NETWORK_KEY" != "home-testnet" && "$NETWORK_KEY" != "home-mainnet" ]]; then
  echo "Unsupported network key: $NETWORK_KEY" >&2
  exit 1
fi

if [[ "$NETWORK_KEY" == "home-testnet" ]]; then
  if [[ -n "${HOME_TESTNET_NETWORK_NAME:-}" ]]; then
    echo "$HOME_TESTNET_NETWORK_NAME"
    exit 0
  fi

  if [[ -n "${HOME_CHAIN_NETWORK_NAME:-}" ]]; then
    echo "$HOME_CHAIN_NETWORK_NAME"
    exit 0
  fi
fi

if [[ "$NETWORK_KEY" == "home-mainnet" && -n "${HOME_MAINNET_NETWORK_NAME:-}" ]]; then
  echo "$HOME_MAINNET_NETWORK_NAME"
  exit 0
fi

if [[ ! -f "$MANIFEST_FILE" ]]; then
  echo "$NETWORK_KEY"
  exit 0
fi

RESOLVED_NAME="$(node -e '
const fs = require("fs");
const filePath = process.argv[1];
const networkKey = process.argv[2];
try {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const match = Array.isArray(parsed.networks)
    ? parsed.networks.find((network) => network.key === networkKey)
    : null;
  process.stdout.write((match && match.hardhatNetworkName) ? String(match.hardhatNetworkName) : networkKey);
} catch {
  process.stdout.write(networkKey);
}
' "$MANIFEST_FILE" "$NETWORK_KEY")"

if [[ -z "$RESOLVED_NAME" ]]; then
  echo "$NETWORK_KEY"
  exit 0
fi

echo "$RESOLVED_NAME"
