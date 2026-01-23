/**
 * Contract addresses by chain ID
 * These should match the addresses in app/src/config/networks.ts
 * 
 * For production, consider loading from deployment JSON files or environment variables
 */
export const DEPLOYED_CONTRACTS: Record<number, Record<string, string>> = {
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
  },
  // Sepolia
  11155111: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
  },
  // Base Mainnet
  8453: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
  },
  // Ethereum Mainnet
  1: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
  },
  // Arbitrum One
  42161: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
  },
  // Polygon
  137: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
  },
  // Gnosis
  100: {
    DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
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
