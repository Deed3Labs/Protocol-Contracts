#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const manifestPath = path.join(root, "config", "chain-manifest.json");
const planPath = path.join(root, "docs", "HOME_CHAIN_30_60_90_EXECUTION_PLAN.md");
const decisionPath = path.join(root, "docs", "HOME_CHAIN_HC001_OP_STACK_DECISION.md");
const freezePath = path.join(root, "ops", "op-stack", "hc001", "chain-config-freeze.yaml");
const intentPath = path.join(root, "ops", "op-stack", "hc001", "intent.template.toml");

const errors = [];

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    errors.push(`Missing required file: ${path.relative(root, filePath)}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function mustMatch(text, regex, label) {
  if (!regex.test(text)) {
    errors.push(`Missing/invalid value in ${label}`);
  }
}

const manifestRaw = readFile(manifestPath);
const planRaw = readFile(planPath);
const decisionRaw = readFile(decisionPath);
const freezeRaw = readFile(freezePath);
const intentRaw = readFile(intentPath);

if (manifestRaw) {
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    errors.push(`Invalid JSON in config/chain-manifest.json: ${err.message}`);
  }

  if (manifest) {
    const networks = Array.isArray(manifest.networks) ? manifest.networks : [];
    const homeTestnet = networks.find((n) => n.key === "home-testnet");
    const homeMainnet = networks.find((n) => n.key === "home-mainnet");

    if (!homeTestnet) errors.push("Missing home-testnet in config/chain-manifest.json");
    if (!homeMainnet) errors.push("Missing home-mainnet in config/chain-manifest.json");

    if (homeTestnet && homeTestnet.chainId !== 92373) {
      errors.push(`home-testnet chainId must be 92373, got ${homeTestnet.chainId}`);
    }
    if (homeMainnet && homeMainnet.chainId !== 92401) {
      errors.push(`home-mainnet chainId must be 92401, got ${homeMainnet.chainId}`);
    }
    if (homeTestnet && homeMainnet && homeTestnet.chainId === homeMainnet.chainId) {
      errors.push("home-testnet and home-mainnet chain IDs must be unique");
    }
  }
}

if (planRaw) {
  mustMatch(
    planRaw,
    /\| HC-001 \|[^\n]*\| (In Progress|Done) \|/,
    "docs/HOME_CHAIN_30_60_90_EXECUTION_PLAN.md HC-001 status"
  );
}

if (decisionRaw) {
  mustMatch(decisionRaw, /OP Stack/i, "docs/HOME_CHAIN_HC001_OP_STACK_DECISION.md");
  mustMatch(decisionRaw, /standard-overrides/, "docs/HOME_CHAIN_HC001_OP_STACK_DECISION.md");
  mustMatch(decisionRaw, /92373/, "docs/HOME_CHAIN_HC001_OP_STACK_DECISION.md");
  mustMatch(decisionRaw, /92401/, "docs/HOME_CHAIN_HC001_OP_STACK_DECISION.md");
}

if (freezeRaw) {
  mustMatch(freezeRaw, /intentType:\s*standard-overrides/, "ops/op-stack/hc001/chain-config-freeze.yaml");
  mustMatch(freezeRaw, /chainId:\s*92373/, "ops/op-stack/hc001/chain-config-freeze.yaml");
  mustMatch(freezeRaw, /chainId:\s*92401/, "ops/op-stack/hc001/chain-config-freeze.yaml");
  mustMatch(freezeRaw, /allowNonStandardOverrides:\s*false/, "ops/op-stack/hc001/chain-config-freeze.yaml");
}

if (intentRaw) {
  mustMatch(intentRaw, /^configType\s*=\s*"standard-overrides"/m, "ops/op-stack/hc001/intent.template.toml");
  mustMatch(intentRaw, /^l1ChainID\s*=\s*11155111/m, "ops/op-stack/hc001/intent.template.toml");
  mustMatch(intentRaw, /^fundDevAccounts\s*=\s*false/m, "ops/op-stack/hc001/intent.template.toml");
  mustMatch(intentRaw, /^useInterop\s*=\s*false/m, "ops/op-stack/hc001/intent.template.toml");
  mustMatch(
    intentRaw,
    /^id\s*=\s*"0x00000000000000000000000000000000000000000000000000000000000168d5"/m,
    "ops/op-stack/hc001/intent.template.toml"
  );
}

if (errors.length > 0) {
  console.error("HC-001 validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("HC-001 validation passed.");
console.log("Provider decision + OP Stack standard config freeze artifacts are present and consistent.");
