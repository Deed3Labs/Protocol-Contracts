#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DEFAULT_CHAIN_ID = 8453;
const NETWORK_BY_CHAIN_ID = {
  1: 'ethereum',
  10: 'optimism',
  137: 'polygon',
  8453: 'base',
  84532: 'base-sepolia',
  42161: 'arbitrum',
  11155111: 'ethereum-sepolia',
};

function parseChainId(rawValue) {
  if (!rawValue) return DEFAULT_CHAIN_ID;
  const parsed = Number.parseInt(String(rawValue), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHAIN_ID;
}

function resolveAccountName(chainId) {
  const chainSpecific = process.env[`SEND_CDP_EVM_ACCOUNT_NAME_${chainId}`];
  if (chainSpecific && chainSpecific.trim()) {
    return chainSpecific.trim();
  }

  const globalName = process.env.SEND_CDP_EVM_ACCOUNT_NAME;
  if (globalName && globalName.trim()) {
    return globalName.trim();
  }

  if (chainId === 8453) return 'send-relayer-base-mainnet';
  if (chainId === 84532) return 'send-relayer-base-sepolia';
  return `send-relayer-chain-${chainId}`;
}

function resolveNetwork(chainId) {
  const chainSpecific = process.env[`SEND_CDP_NETWORK_${chainId}`];
  if (chainSpecific && chainSpecific.trim()) {
    return chainSpecific.trim();
  }

  const globalNetwork = process.env.SEND_CDP_NETWORK;
  if (globalNetwork && globalNetwork.trim()) {
    return globalNetwork.trim();
  }

  return NETWORK_BY_CHAIN_ID[chainId] || '';
}

const apiKeyId = (process.env.SEND_CDP_API_KEY_ID || process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME || '').trim();
const apiKeySecret = (process.env.SEND_CDP_API_KEY_SECRET || process.env.CDP_API_KEY_SECRET || '').trim();
const walletSecret = (process.env.SEND_CDP_WALLET_SECRET || process.env.CDP_WALLET_SECRET || '').trim();
const basePath = (process.env.SEND_CDP_BASE_PATH || '').trim();

if (!apiKeyId || !apiKeySecret || !walletSecret) {
  console.error(
    'Missing CDP credentials. Set SEND_CDP_API_KEY_ID/CDP_API_KEY_ID, SEND_CDP_API_KEY_SECRET/CDP_API_KEY_SECRET, and SEND_CDP_WALLET_SECRET/CDP_WALLET_SECRET.'
  );
  process.exit(1);
}

const chainId = parseChainId(process.env.SEND_DEFAULT_CHAIN_ID);
const accountName = resolveAccountName(chainId);
const network = resolveNetwork(chainId);

if (!network) {
  console.error(`No CDP network configured for chain ${chainId}. Set SEND_CDP_NETWORK or SEND_CDP_NETWORK_${chainId}.`);
  process.exit(1);
}

const cdpModule = await import('@coinbase/cdp-sdk');
if (!cdpModule || typeof cdpModule.CdpClient !== 'function') {
  console.error('Could not load @coinbase/cdp-sdk. Ensure dependency is installed in the server runtime.');
  process.exit(1);
}

const cdp = new cdpModule.CdpClient({
  apiKeyId,
  apiKeySecret,
  walletSecret,
  ...(basePath ? { basePath } : {}),
});

const account = await cdp.evm.getOrCreateAccount({ name: accountName });

console.log(
  JSON.stringify(
    {
      relayerMode: 'cdp_server_wallet',
      chainId,
      network,
      accountName,
      accountAddress: account.address,
      nextStep: `Fund ${account.address} with native gas token (${network.includes('sepolia') ? 'ETH testnet' : 'ETH'})`,
    },
    null,
    2
  )
);
