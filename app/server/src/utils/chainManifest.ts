import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface ServerChainManifestNetwork {
  key: string;
  hardhatNetworkName: string;
  chainId: number;
  rpcUrl: string;
  blockExplorer: string;
}

interface ServerChainManifestFile {
  schemaVersion: number;
  networks: ServerChainManifestNetwork[];
}

let cachedNetworks: ServerChainManifestNetwork[] | null = null;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readNumericEnv(name: string): number | undefined {
  const raw = readEnv(name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function withEnvOverrides(network: ServerChainManifestNetwork): ServerChainManifestNetwork {
  const next: ServerChainManifestNetwork = { ...network };

  if (network.key === 'base-sepolia') {
    next.rpcUrl = readEnv('BASE_SEPOLIA_RPC_URL') || next.rpcUrl;
    next.blockExplorer = readEnv('BASE_SEPOLIA_BLOCK_EXPLORER_URL') || next.blockExplorer;
  } else if (network.key === 'base') {
    next.rpcUrl = readEnv('BASE_MAINNET_RPC_URL') || readEnv('BASE_RPC_URL') || next.rpcUrl;
    next.blockExplorer = readEnv('BASE_BLOCK_EXPLORER_URL') || next.blockExplorer;
  } else if (network.key === 'home-testnet') {
    next.chainId =
      readNumericEnv('HOME_TESTNET_CHAIN_ID') ||
      readNumericEnv('HOME_CHAIN_ID') ||
      readNumericEnv('CLRUSD_HOME_CHAIN_ID') ||
      next.chainId;
    next.rpcUrl = readEnv('HOME_TESTNET_RPC_URL') || readEnv('HOME_CHAIN_RPC_URL') || next.rpcUrl;
    next.blockExplorer =
      readEnv('HOME_TESTNET_BLOCK_EXPLORER_URL') ||
      readEnv('HOME_CHAIN_BLOCK_EXPLORER_URL') ||
      next.blockExplorer;
  } else if (network.key === 'home-mainnet') {
    next.chainId = readNumericEnv('HOME_MAINNET_CHAIN_ID') || next.chainId;
    next.rpcUrl = readEnv('HOME_MAINNET_RPC_URL') || next.rpcUrl;
    next.blockExplorer = readEnv('HOME_MAINNET_BLOCK_EXPLORER_URL') || next.blockExplorer;
  }

  return next;
}

function resolveManifestFile(): string | null {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), 'config/chain-manifest.json'),
    path.resolve(process.cwd(), '../config/chain-manifest.json'),
    path.resolve(process.cwd(), '../../config/chain-manifest.json'),
    path.resolve(currentDir, '../../../../../config/chain-manifest.json'),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) return candidatePath;
  }

  return null;
}

function loadManifestNetworks(): ServerChainManifestNetwork[] {
  if (cachedNetworks) return cachedNetworks;

  const manifestPath = resolveManifestFile();
  if (!manifestPath) {
    cachedNetworks = [];
    return cachedNetworks;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ServerChainManifestFile;
    cachedNetworks = Array.isArray(parsed.networks) ? parsed.networks.map(withEnvOverrides) : [];
  } catch {
    cachedNetworks = [];
  }

  return cachedNetworks;
}

export function getServerChainManifest(): ServerChainManifestNetwork[] {
  return loadManifestNetworks();
}

export function getServerChainById(chainId: number): ServerChainManifestNetwork | null {
  return loadManifestNetworks().find((network) => network.chainId === chainId) || null;
}

export function getServerChainByKey(key: string): ServerChainManifestNetwork | null {
  return loadManifestNetworks().find((network) => network.key === key) || null;
}
