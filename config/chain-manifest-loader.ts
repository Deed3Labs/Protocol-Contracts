import rawManifest from "./chain-manifest.json";

export interface ChainTokenAddresses {
  usdc: string;
  usdt: string;
  dai: string;
  weth: string;
}

export interface ChainManifestNetwork {
  key: string;
  hardhatNetworkName: string;
  chainId: number;
  rpcUrl: string;
  blockExplorer: string;
  uniswapV3Factory: string;
  tokens: ChainTokenAddresses;
}

interface ChainManifestFile {
  schemaVersion: number;
  networks: ChainManifestNetwork[];
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const manifest = rawManifest as ChainManifestFile;

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

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function withEnvOverrides(network: ChainManifestNetwork): ChainManifestNetwork {
  const next: ChainManifestNetwork = {
    ...network,
    tokens: { ...network.tokens },
  };

  if (network.key === "base-sepolia") {
    next.rpcUrl = readEnv("BASE_SEPOLIA_RPC_URL") || next.rpcUrl;
    next.blockExplorer = readEnv("BASE_SEPOLIA_BLOCK_EXPLORER_URL") || next.blockExplorer;
    next.uniswapV3Factory = readEnv("BASE_SEPOLIA_UNISWAP_V3_FACTORY") || next.uniswapV3Factory;

    next.tokens.usdc = readEnv("BASE_SEPOLIA_USDC_ADDRESS") || next.tokens.usdc;
    next.tokens.usdt = readEnv("BASE_SEPOLIA_USDT_ADDRESS") || next.tokens.usdt;
    next.tokens.dai = readEnv("BASE_SEPOLIA_DAI_ADDRESS") || next.tokens.dai;
    next.tokens.weth = readEnv("BASE_SEPOLIA_WETH_ADDRESS") || next.tokens.weth;
  } else if (network.key === "base") {
    next.rpcUrl = readEnv("BASE_MAINNET_RPC_URL") || readEnv("BASE_RPC_URL") || next.rpcUrl;
    next.blockExplorer = readEnv("BASE_BLOCK_EXPLORER_URL") || next.blockExplorer;
    next.uniswapV3Factory = readEnv("BASE_UNISWAP_V3_FACTORY") || next.uniswapV3Factory;

    next.tokens.usdc = readEnv("BASE_USDC_ADDRESS") || next.tokens.usdc;
    next.tokens.usdt = readEnv("BASE_USDT_ADDRESS") || next.tokens.usdt;
    next.tokens.dai = readEnv("BASE_DAI_ADDRESS") || next.tokens.dai;
    next.tokens.weth = readEnv("BASE_WETH_ADDRESS") || next.tokens.weth;
  } else if (network.key === "home-testnet") {
    next.hardhatNetworkName =
      readEnv("HOME_TESTNET_NETWORK_NAME") ||
      readEnv("HOME_CHAIN_NETWORK_NAME") ||
      next.hardhatNetworkName;
    next.chainId =
      readNumericEnv("HOME_TESTNET_CHAIN_ID") ||
      readNumericEnv("HOME_CHAIN_ID") ||
      readNumericEnv("CLRUSD_HOME_CHAIN_ID") ||
      next.chainId;
    next.rpcUrl = readEnv("HOME_TESTNET_RPC_URL") || readEnv("HOME_CHAIN_RPC_URL") || next.rpcUrl;
    next.blockExplorer =
      readEnv("HOME_TESTNET_BLOCK_EXPLORER_URL") ||
      readEnv("HOME_CHAIN_BLOCK_EXPLORER_URL") ||
      next.blockExplorer;
    next.uniswapV3Factory =
      readEnv("HOME_TESTNET_UNISWAP_V3_FACTORY") ||
      readEnv("HOME_CHAIN_UNISWAP_V3_FACTORY") ||
      next.uniswapV3Factory;

    next.tokens.usdc = readEnv("HOME_TESTNET_USDC_ADDRESS") || readEnv("HOME_CHAIN_USDC_ADDRESS") || next.tokens.usdc;
    next.tokens.usdt = readEnv("HOME_TESTNET_USDT_ADDRESS") || readEnv("HOME_CHAIN_USDT_ADDRESS") || next.tokens.usdt;
    next.tokens.dai = readEnv("HOME_TESTNET_DAI_ADDRESS") || readEnv("HOME_CHAIN_DAI_ADDRESS") || next.tokens.dai;
    next.tokens.weth = readEnv("HOME_TESTNET_WETH_ADDRESS") || readEnv("HOME_CHAIN_WETH_ADDRESS") || next.tokens.weth;
  } else if (network.key === "home-mainnet") {
    next.hardhatNetworkName = readEnv("HOME_MAINNET_NETWORK_NAME") || next.hardhatNetworkName;
    next.chainId = readNumericEnv("HOME_MAINNET_CHAIN_ID") || next.chainId;
    next.rpcUrl = readEnv("HOME_MAINNET_RPC_URL") || next.rpcUrl;
    next.blockExplorer = readEnv("HOME_MAINNET_BLOCK_EXPLORER_URL") || next.blockExplorer;
    next.uniswapV3Factory = readEnv("HOME_MAINNET_UNISWAP_V3_FACTORY") || next.uniswapV3Factory;

    next.tokens.usdc = readEnv("HOME_MAINNET_USDC_ADDRESS") || next.tokens.usdc;
    next.tokens.usdt = readEnv("HOME_MAINNET_USDT_ADDRESS") || next.tokens.usdt;
    next.tokens.dai = readEnv("HOME_MAINNET_DAI_ADDRESS") || next.tokens.dai;
    next.tokens.weth = readEnv("HOME_MAINNET_WETH_ADDRESS") || next.tokens.weth;
  }

  return next;
}

function getManifestNetworks(): ChainManifestNetwork[] {
  return manifest.networks.map(withEnvOverrides);
}

export function getCanonicalChainManifest(): ChainManifestNetwork[] {
  return getManifestNetworks();
}

export function getChainConfigById(chainId: number): ChainManifestNetwork | null {
  return getManifestNetworks().find((network) => network.chainId === chainId) || null;
}

export function getChainConfigByKey(key: string): ChainManifestNetwork | null {
  return getManifestNetworks().find((network) => network.key === key) || null;
}

export function requireChainConfigById(chainId: number): ChainManifestNetwork {
  const config = getChainConfigById(chainId);
  if (!config) {
    const known = getManifestNetworks()
      .map((network) => `${network.key}:${network.chainId}`)
      .join(", ");
    throw new Error(`Unsupported chainId ${chainId}. Known manifest chains: ${known}`);
  }
  return config;
}

export function assertChainHasTokenAddresses(config: ChainManifestNetwork, tokenKeys: Array<keyof ChainTokenAddresses>): void {
  for (const tokenKey of tokenKeys) {
    const value = config.tokens[tokenKey];
    if (!isAddress(value) || value === ZERO_ADDRESS) {
      throw new Error(
        `Missing ${tokenKey.toUpperCase()} address for ${config.key} (chainId ${config.chainId}). ` +
          `Set ${
            config.key === "home-testnet"
              ? `HOME_TESTNET_${tokenKey.toUpperCase()}_ADDRESS (or HOME_CHAIN_${tokenKey.toUpperCase()}_ADDRESS)`
              : `${config.key.replace("-", "_").toUpperCase()}_${tokenKey.toUpperCase()}_ADDRESS`
          }.`
      );
    }
  }
}

export function assertChainHasOracleFactory(config: ChainManifestNetwork): void {
  if (!isAddress(config.uniswapV3Factory) || config.uniswapV3Factory === ZERO_ADDRESS) {
    const envName =
      config.key === "home-testnet"
        ? "HOME_TESTNET_UNISWAP_V3_FACTORY (or HOME_CHAIN_UNISWAP_V3_FACTORY)"
        : `${config.key.replace("-", "_").toUpperCase()}_UNISWAP_V3_FACTORY`;
    throw new Error(
      `Missing Uniswap V3 factory address for ${config.key} (chainId ${config.chainId}). Set ${envName}.`
    );
  }
}
