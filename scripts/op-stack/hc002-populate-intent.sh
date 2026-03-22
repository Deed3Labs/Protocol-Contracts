#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT_ENV_FILE="$ROOT_DIR/.env"
LOCAL_ENV_FILE="$ROOT_DIR/ops/op-stack/hc002/deployer/.env"
INTENT_FILE="$ROOT_DIR/ops/op-stack/hc002/deployer/.deployer/intent.toml"

# shellcheck source=/dev/null
if [[ -f "$ROOT_ENV_FILE" ]]; then
  source "$ROOT_ENV_FILE"
fi

# shellcheck source=/dev/null
if [[ -f "$LOCAL_ENV_FILE" ]]; then
  source "$LOCAL_ENV_FILE"
fi

ADDRESS="${DEPLOYER_ACCOUNT:-${OPERATOR_ADDRESS:-}}"

if [[ ! "$ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Missing valid DEPLOYER_ACCOUNT in root .env (or OPERATOR_ADDRESS)."
  exit 1
fi

if [[ ! -f "$INTENT_FILE" ]]; then
  echo "Missing intent file at $INTENT_FILE. Run npm run hc002:init first."
  exit 1
fi

node - "$INTENT_FILE" "$ADDRESS" <<'NODE'
const fs = require("fs");

const intentFile = process.argv[2];
const address = process.argv[3];

const keys = [
  "baseFeeVaultRecipient",
  "l1FeeVaultRecipient",
  "sequencerFeeVaultRecipient",
  "operatorFeeVaultRecipient",
  "chainFeesRecipient",
  "l1ProxyAdminOwner",
  "l2ProxyAdminOwner",
  "systemConfigOwner",
  "unsafeBlockSigner",
  "batcher",
  "proposer",
  "challenger",
];

let text = fs.readFileSync(intentFile, "utf8");

for (const key of keys) {
  const lineRegex = new RegExp(`^(\\s*${key}\\s*=\\s*).*$`, "m");
  if (lineRegex.test(text)) {
    text = text.replace(lineRegex, (_full, prefix) => `${prefix}"${address}"`);
  }
}

fs.writeFileSync(intentFile, text);
NODE

echo "Updated intent addresses using DEPLOYER_ACCOUNT=$ADDRESS"
