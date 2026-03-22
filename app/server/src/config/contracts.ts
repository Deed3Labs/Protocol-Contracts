/**
 * Contract addresses by chain ID
 * These should match the addresses in app/src/config/networks.ts
 * 
 * For production, consider loading from deployment JSON files or environment variables
 */
import { getServerChainByKey } from '../utils/chainManifest';

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function addressEnv(name: string): string {
  const value = process.env[name]?.trim();
  return value && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? value
    : '0x0000000000000000000000000000000000000000';
}

const HOME_TESTNET_CHAIN_ID =
  getServerChainByKey('home-testnet')?.chainId ||
  parseIntEnv('HOME_TESTNET_CHAIN_ID', parseIntEnv('HOME_CHAIN_ID', parseIntEnv('CLRUSD_HOME_CHAIN_ID', 92373)));
const HOME_MAINNET_CHAIN_ID =
  getServerChainByKey('home-mainnet')?.chainId ||
  parseIntEnv('HOME_MAINNET_CHAIN_ID', 92401);

export const DEPLOYED_CONTRACTS: Record<number, Record<string, string>> = {
  [HOME_TESTNET_CHAIN_ID]: {
    DeedNFT: addressEnv(`DEEDNFT_${HOME_TESTNET_CHAIN_ID}`),
    Validator: addressEnv(`VALIDATOR_${HOME_TESTNET_CHAIN_ID}`),
    ValidatorRegistry: addressEnv(`VALIDATOR_REGISTRY_${HOME_TESTNET_CHAIN_ID}`),
    FundManager: addressEnv(`FUND_MANAGER_${HOME_TESTNET_CHAIN_ID}`),
    MetadataRenderer: addressEnv(`METADATA_RENDERER_${HOME_TESTNET_CHAIN_ID}`),
    Subdivide: addressEnv(`SUBDIVIDE_${HOME_TESTNET_CHAIN_ID}`),
    Fractionalize: addressEnv(`FRACTIONALIZE_${HOME_TESTNET_CHAIN_ID}`),
    FractionTokenFactory: addressEnv(`FRACTION_TOKEN_FACTORY_${HOME_TESTNET_CHAIN_ID}`),
    CLRUSD: process.env[`CLRUSD_${HOME_TESTNET_CHAIN_ID}`] || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env[`ESA_VAULT_${HOME_TESTNET_CHAIN_ID}`] || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env[`CLRUSD_POOL_${HOME_TESTNET_CHAIN_ID}`] || '0x0000000000000000000000000000000000000000',
  },
  [HOME_MAINNET_CHAIN_ID]: {
    DeedNFT: addressEnv(`DEEDNFT_${HOME_MAINNET_CHAIN_ID}`),
    Validator: addressEnv(`VALIDATOR_${HOME_MAINNET_CHAIN_ID}`),
    ValidatorRegistry: addressEnv(`VALIDATOR_REGISTRY_${HOME_MAINNET_CHAIN_ID}`),
    FundManager: addressEnv(`FUND_MANAGER_${HOME_MAINNET_CHAIN_ID}`),
    MetadataRenderer: addressEnv(`METADATA_RENDERER_${HOME_MAINNET_CHAIN_ID}`),
    Subdivide: addressEnv(`SUBDIVIDE_${HOME_MAINNET_CHAIN_ID}`),
    Fractionalize: addressEnv(`FRACTIONALIZE_${HOME_MAINNET_CHAIN_ID}`),
    FractionTokenFactory: addressEnv(`FRACTION_TOKEN_FACTORY_${HOME_MAINNET_CHAIN_ID}`),
    CLRUSD: process.env[`CLRUSD_${HOME_MAINNET_CHAIN_ID}`] || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env[`ESA_VAULT_${HOME_MAINNET_CHAIN_ID}`] || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env[`CLRUSD_POOL_${HOME_MAINNET_CHAIN_ID}`] || '0x0000000000000000000000000000000000000000',
  },
  // Base Sepolia
  84532: {
    DeedNFT: '0x1a4e89225015200f70e5a06f766399a3de6e21E6',
    Validator: '0x18C53C0D046f98322954f971c21125E4443c79b9',
    ValidatorRegistry: '0x979E6cC741A8481f96739A996D06EcFb9BA2bc91',
    FundManager: '0x73ea6B404E6B81E7Fe6B112605dD8661B52d401e',
    MetadataRenderer: '0xAc50869E89004aa25A8c1044195AC760A7FC48BE',
    Subdivide: '0x3c947D71cb1698dFd4D7551b87E17306865C923F',
    Fractionalize: '0xeC464847C664Cc208478adbe377f7Db19e199823',
    FractionTokenFactory: '0x3E513d3c3c2845B5cAc4FA5e21C0f7f80f9328dc',
    CLRUSD: process.env.CLRUSD_84532 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_84532 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_84532 || '0x0000000000000000000000000000000000000000',
  },
  // Sepolia
  11155111: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_11155111 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_11155111 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_11155111 || '0x0000000000000000000000000000000000000000',
  },
  // Base Mainnet
  8453: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_8453 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_8453 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_8453 || '0x0000000000000000000000000000000000000000',
  },
  // Ethereum Mainnet
  1: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_1 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_1 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_1 || '0x0000000000000000000000000000000000000000',
  },
  // Optimism Mainnet
  10: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_10 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_10 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_10 || '0x0000000000000000000000000000000000000000',
  },
  // Arbitrum One
  42161: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_42161 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_42161 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_42161 || '0x0000000000000000000000000000000000000000',
  },
  // Polygon
  137: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_137 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_137 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_137 || '0x0000000000000000000000000000000000000000',
  },
  // Gnosis
  100: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
    CLRUSD: process.env.CLRUSD_100 || '0x0000000000000000000000000000000000000000',
    ESADepositVault: process.env.ESA_VAULT_100 || '0x0000000000000000000000000000000000000000',
    CLRUSDTokenPool: process.env.CLRUSD_POOL_100 || '0x0000000000000000000000000000000000000000',
  },
};

/**
 * Get contract address for a chain
 * @param chainId - Chain ID
 * @param contractName - Contract name (default: 'DeedNFT')
 * @returns Contract address or null if not deployed
 */
export function getContractAddress(chainId: number, contractName: string = 'DeedNFT'): string | null {
  const chainContracts = DEPLOYED_CONTRACTS[chainId];
  if (!chainContracts) {
    return null;
  }

  const address = chainContracts[contractName];
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  return address;
}

export function getClrUsdAddressesByChain(): Array<{ chainId: number; tokenAddress: string }> {
  return Object.entries(DEPLOYED_CONTRACTS)
    .map(([chainId, contracts]) => ({
      chainId: Number(chainId),
      tokenAddress: contracts.CLRUSD || '',
    }))
    .filter(
      (entry) =>
        /^0x[a-fA-F0-9]{40}$/.test(entry.tokenAddress) &&
        entry.tokenAddress !== '0x0000000000000000000000000000000000000000'
    );
}
