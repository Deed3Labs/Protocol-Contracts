/**
 * NFT contract configurations across all chains
 * Similar to COMMON_TOKENS, but for NFTs
 * Allows categorization and filtering of NFT types
 */

export type NFTType = 'rwa' | 'collectible' | 'general';

export interface NFTContractConfig {
  address: string;
  name: string;
  symbol?: string;
  type: NFTType; // RWA (Real World Asset), Collectible, or General NFT
  standard: 'ERC721' | 'ERC1155';
  logoUrl?: string;
  description?: string;
}

/**
 * NFT contracts by chain ID
 * Used by NFT hooks to fetch user's NFTs from known collections
 * 
 * @example
 * ```typescript
 * // T-Deed (RWA) on Base Sepolia
 * { 
 *   address: '0x1a4e89225015200f70e5a06f766399a3de6e21E6',
 *   name: 'DeedNFT',
 *   type: 'rwa',
 *   standard: 'ERC721'
 * }
 * 
 * // Bored Apes (Collectible) on Ethereum
 * {
 *   address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
 *   name: 'Bored Ape Yacht Club',
 *   symbol: 'BAYC',
 *   type: 'collectible',
 *   standard: 'ERC721'
 * }
 * ```
 */
export const NFT_CONTRACTS: Record<number, NFTContractConfig[]> = {
  // Ethereum Mainnet
  1: [
    // Add popular collectibles or general NFTs here
    // Example:
    // {
    //   address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
    //   name: 'Bored Ape Yacht Club',
    //   symbol: 'BAYC',
    //   type: 'collectible',
    //   standard: 'ERC721',
    // },
  ],
  
  // Base Mainnet
  8453: [
    // Add NFT contracts here
  ],
  
  // Base Sepolia Testnet
  84532: [
    {
      address: '0x1a4e89225015200f70e5a06f766399a3de6e21E6',
      name: 'DeedNFT',
      symbol: 'T-Deed',
      type: 'rwa',
      standard: 'ERC721',
      description: 'Real World Asset (RWA) T-Deed tokens',
    },
    // Add more NFT contracts here as needed
    // Example collectible:
    // {
    //   address: '0x...',
    //   name: 'Cool NFT Collection',
    //   symbol: 'CNFT',
    //   type: 'collectible',
    //   standard: 'ERC721',
    // },
  ],
  
  // Sepolia Testnet
  11155111: [
    // Add NFT contracts here
  ],
  
  // Arbitrum One
  42161: [
    // Add NFT contracts here
  ],
  
  // Polygon
  137: [
    // Add NFT contracts here
  ],
  
  // Gnosis
  100: [
    // Add NFT contracts here
  ],
};

/**
 * Get NFT contracts for a specific chain
 * @param chainId - The chain ID
 * @returns Array of NFT contract configurations for the chain, or empty array if not found
 */
export const getNFTContracts = (chainId: number): NFTContractConfig[] => {
  return NFT_CONTRACTS[chainId] || [];
};

/**
 * Get NFT contracts filtered by type
 * @param chainId - The chain ID
 * @param type - Filter by NFT type (rwa, collectible, general)
 * @returns Array of NFT contract configurations matching the type
 */
export const getNFTContractsByType = (
  chainId: number,
  type: NFTType
): NFTContractConfig[] => {
  return getNFTContracts(chainId).filter(contract => contract.type === type);
};

/**
 * Get all NFT contracts across all chains
 * @returns Array of all NFT contract configurations with chainId
 */
export const getAllNFTContracts = (): Array<NFTContractConfig & { chainId: number }> => {
  const all: Array<NFTContractConfig & { chainId: number }> = [];
  for (const [chainIdStr, contracts] of Object.entries(NFT_CONTRACTS)) {
    const chainId = parseInt(chainIdStr, 10);
    for (const contract of contracts) {
      all.push({ ...contract, chainId });
    }
  }
  return all;
};
