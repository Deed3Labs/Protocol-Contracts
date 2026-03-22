import rawManifest from "../../../config/chain-manifest.json";

export interface AppChainManifestNetwork {
  key: string;
  hardhatNetworkName: string;
  chainId: number;
  rpcUrl: string;
  blockExplorer: string;
}

interface AppChainManifestFile {
  schemaVersion: number;
  networks: AppChainManifestNetwork[];
}

const manifest = rawManifest as AppChainManifestFile;

function readEnv(name: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[name]?.trim();
  return value ? value : undefined;
}

function readNumericEnv(name: string): number | undefined {
  const raw = readEnv(name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function withEnvOverrides(network: AppChainManifestNetwork): AppChainManifestNetwork {
  const next: AppChainManifestNetwork = { ...network };

  if (network.key === "base-sepolia") {
    next.rpcUrl = readEnv("VITE_BASE_SEPOLIA_RPC_URL") || next.rpcUrl;
    next.blockExplorer = readEnv("VITE_BASE_SEPOLIA_BLOCK_EXPLORER_URL") || next.blockExplorer;
  } else if (network.key === "base") {
    next.rpcUrl = readEnv("VITE_BASE_MAINNET_RPC_URL") || readEnv("VITE_BASE_RPC_URL") || next.rpcUrl;
    next.blockExplorer = readEnv("VITE_BASE_BLOCK_EXPLORER_URL") || next.blockExplorer;
  } else if (network.key === "home-testnet") {
    next.chainId =
      readNumericEnv("VITE_HOME_TESTNET_CHAIN_ID") ||
      readNumericEnv("VITE_CLRUSD_HOME_CHAIN_ID") ||
      next.chainId;
    next.rpcUrl = readEnv("VITE_HOME_TESTNET_RPC_URL") || readEnv("VITE_HOME_CHAIN_RPC_URL") || next.rpcUrl;
    next.blockExplorer =
      readEnv("VITE_HOME_TESTNET_BLOCK_EXPLORER_URL") ||
      readEnv("VITE_HOME_CHAIN_BLOCK_EXPLORER_URL") ||
      next.blockExplorer;
  } else if (network.key === "home-mainnet") {
    next.chainId = readNumericEnv("VITE_HOME_MAINNET_CHAIN_ID") || next.chainId;
    next.rpcUrl = readEnv("VITE_HOME_MAINNET_RPC_URL") || next.rpcUrl;
    next.blockExplorer = readEnv("VITE_HOME_MAINNET_BLOCK_EXPLORER_URL") || next.blockExplorer;
  }

  return next;
}

export function getManifestNetworks(): AppChainManifestNetwork[] {
  return manifest.networks.map(withEnvOverrides);
}

export function getManifestNetworkByKey(key: string): AppChainManifestNetwork | null {
  return getManifestNetworks().find((network) => network.key === key) || null;
}

export function getManifestNetworkById(chainId: number): AppChainManifestNetwork | null {
  return getManifestNetworks().find((network) => network.chainId === chainId) || null;
}
