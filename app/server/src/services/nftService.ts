import { ethers } from 'ethers';
import { getRpcUrl } from '../utils/rpc.js';
import { withRetry, createRetryProvider } from '../utils/rpcRetry.js';
import { getContractAddress } from '../config/contracts.js';
import { getNFTFloorPrice } from './priceService.js';
import { 
  getNFTsByAddress, 
  convertPortfolioNFTToGeneralNFT 
} from './portfolioService.js';

/**
 * Standard ERC721 ABI for general NFTs
 */
const ERC721_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function tokenByIndex(uint256 index) external view returns (uint256)',
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
];

/**
 * Standard ERC1155 ABI for multi-token NFTs
 */
const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) external view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) external view returns (uint256[])',
  'function uri(uint256 tokenId) external view returns (string)',
  'function supportsInterface(bytes4 interfaceId) external view returns (bool)',
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
];

/**
 * Get DeedNFT ABI (simplified - you may want to load from file)
 */
function getDeedNFTAbi(): any[] {
  // Minimal ABI for DeedNFT (extends ERC721Enumerable, so has balanceOf and tokenOfOwnerByIndex)
  return [
    'function balanceOf(address owner) external view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
    'function ownerOf(uint256 tokenId) external view returns (address)',
    'function tokenURI(uint256 tokenId) external view returns (string)',
    'function getValidationStatus(uint256 tokenId) external view returns (bool, address)',
    'function getTraitValue(uint256 tokenId, bytes32 key) external view returns (bytes)',
    'function token(uint256 tokenId) external view returns (address)',
    'function salt(uint256 tokenId) external view returns (uint256)',
  ];
}

export interface DeedNFTData {
  tokenId: string;
  owner: string;
  assetType: number;
  uri: string;
  definition: string;
  configuration: string;
  validatorAddress: string;
  token: string;
  salt: string;
  isMinted: boolean;
  priceUSD?: number; // Optional: price from OpenSea or other sources
}

export interface GeneralNFTData {
  tokenId: string;
  owner: string;
  contractAddress: string;
  uri: string;
  name?: string;
  symbol?: string;
  priceUSD?: number; // Optional: floor price from OpenSea
  standard: 'ERC721' | 'ERC1155'; // Token standard
  amount?: string; // For ERC1155: quantity owned (defaults to "1" for ERC721)
}

/**
 * Get DeedNFTs for an address on a chain
 * Uses Alchemy Portfolio API (get-nfts-by-address) - more reliable than NFT API v3
 * https://www.alchemy.com/docs/data/portfolio-apis/portfolio-api-endpoints/portfolio-api-endpoints/get-nfts-by-address
 */
export async function getDeedNFTs(
  chainId: number,
  address: string,
  contractAddress?: string
): Promise<DeedNFTData[]> {
  try {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return [];
    }

    const contractAddr = contractAddress || getContractAddress(chainId);
    if (!contractAddr) {
      return [];
    }

    // Normalize contract address to proper checksum format
    const normalizedContractAddr = ethers.getAddress(contractAddr.toLowerCase());
    const normalizedAddress = ethers.getAddress(address.toLowerCase());
    
    // Step 1: Use Alchemy Portfolio API to get all NFTs (more reliable than NFT API v3)
    // Portfolio API supports multiple chains and has better coverage
    const portfolioResults = await getNFTsByAddress(
      [{ address: normalizedAddress, chainIds: [chainId] }],
      {
        withMetadata: true,
        pageSize: 50, // Alchemy best practice: Keep batches under 50
      }
    );

    const addressMap = portfolioResults.get(normalizedAddress);
    if (!addressMap) {
      return [];
    }

    const chainData = addressMap.get(chainId);
    if (!chainData || !chainData.nfts || chainData.nfts.length === 0) {
      return [];
    }

    // Step 2: Filter NFTs by contract address and extract T-Deed data
    const tokenDataMap = new Map<string, {
      uri: string;
      assetType: number;
      definition: string;
      configuration: string;
      validatorAddress: string;
    }>();

    // Map asset type string to number (from MetadataRenderer contract)
    const assetTypeMap: Record<string, number> = {
      'Land': 0,
      'Vehicle': 1,
      'Estate': 2,
      'CommercialEquipment': 3,
    };

    for (const nft of chainData.nfts) {
      // Filter by contract address
      const nftContract = ethers.getAddress(nft.contract.address.toLowerCase());
      if (nftContract !== normalizedContractAddr) {
        continue;
      }

      const tokenId = nft.tokenId;
      if (!tokenId) continue;

      // Extract data from Portfolio API response
      const tokenURI = nft.tokenUri || nft.raw?.tokenUri || '';
      const description = nft.description || nft.raw?.metadata?.description || '';
      const attributes = nft.raw?.metadata?.attributes || [];

      // Parse attributes to extract T-Deed specific data
      let assetType = 0;
      let validatorAddress = ethers.ZeroAddress;
      let configuration = '';

      for (const attr of attributes || []) {
        const traitType = attr.trait_type || '';
        const traitTypeLower = traitType.toLowerCase();
        const value = attr.value;

        // Match trait names from DeedNFT contract (case-insensitive)
        if (traitTypeLower === 'asset type' || traitTypeLower === 'assettype') {
          if (typeof value === 'string') {
            assetType = assetTypeMap[value] ?? 0;
          } else if (typeof value === 'number') {
            assetType = value;
          }
        } else if (traitTypeLower === 'validator') {
          try {
            if (typeof value === 'string' && value.startsWith('0x')) {
              validatorAddress = ethers.getAddress(value);
            }
          } catch {
            // Invalid address format
          }
        } else if (traitTypeLower === 'configuration') {
          if (typeof value === 'string') {
            configuration = value;
          }
        }
      }

      // Definition comes from description field
      const definition = description || `T-Deed #${tokenId}`;

      // Store all data from Portfolio API
      tokenDataMap.set(tokenId, {
        uri: tokenURI,
        assetType,
        definition,
        configuration,
        validatorAddress,
      });
    }

    if (tokenDataMap.size === 0) {
      console.log(`[getDeedNFTs] Portfolio API returned ${chainData.nfts.length} NFTs but none matched contract ${normalizedContractAddr} on chain ${chainId}`);
      return [];
    }

    console.log(`[getDeedNFTs] Found ${tokenDataMap.size} T-Deeds via Portfolio API for ${normalizedAddress} on chain ${chainId}`);

    // Step 3: Fetch collection floor price once (not per NFT)
    let collectionFloorPrice: number | undefined;
    try {
      const price = await getNFTFloorPrice(chainId, normalizedContractAddr);
      collectionFloorPrice = price !== null ? price : undefined;
    } catch (error) {
      // Silent error - pricing is optional
    }

    // Step 4: Build NFT data from Portfolio API metadata
    // Only need RPC for token() and salt() which are not in metadata
    const nfts: DeedNFTData[] = [];
    const provider = createRetryProvider(rpcUrl, chainId);
    const abi = getDeedNFTAbi();
    const contract = new ethers.Contract(normalizedContractAddr, abi, provider);

    // Process tokens - only make RPC calls for token() and salt()
    for (const [tokenIdString, tokenData] of tokenDataMap.entries()) {
      try {
        // Get token() and salt() from contract (only 2 RPC calls per NFT)
        const tokenId = BigInt(tokenIdString);
        const [tokenResult, saltResult] = await Promise.allSettled([
          withRetry(() => contract.token(tokenId)).catch(() => ethers.ZeroAddress),
          withRetry(() => contract.salt(tokenId)).catch(() => 0n),
        ]);

        const token = tokenResult.status === 'fulfilled' ? tokenResult.value : ethers.ZeroAddress;
        const salt = saltResult.status === 'fulfilled' ? saltResult.value.toString() : '0';

        // Use all data from Portfolio API metadata
        const {
          uri,
          assetType,
          definition,
          configuration,
          validatorAddress,
        } = tokenData;

        nfts.push({
          tokenId: tokenIdString,
          owner: normalizedAddress,
          assetType,
          uri,
          definition,
          configuration,
          validatorAddress,
          token,
          salt,
          isMinted: true,
          priceUSD: collectionFloorPrice,
        });
      } catch (err) {
        console.warn(`[getDeedNFTs] Error processing token ${tokenIdString}:`, err);
        // Skip this token
      }
    }

    return nfts;
  } catch (error) {
    console.error(`Error fetching NFTs for ${address} on chain ${chainId}:`, error);
    return [];
  }
}

/**
 * Detect if a contract is ERC721 or ERC1155
 */
async function detectNFTStandard(
  erc721Contract: ethers.Contract,
  erc1155Contract: ethers.Contract
): Promise<'ERC721' | 'ERC1155' | null> {
  try {
    // Try ERC721 interface check (0x80ac58cd)
    const erc721InterfaceId = '0x80ac58cd';
    try {
      // Check if contract has supportsInterface function
      if (erc721Contract.supportsInterface) {
        const supportsERC721 = await withRetry(() => erc721Contract.supportsInterface(erc721InterfaceId));
        if (supportsERC721) {
          return 'ERC721';
        }
      }
    } catch (err) {
      // Continue to try ERC1155
    }

    // Try ERC1155 interface check (0xd9b67a26)
    const erc1155InterfaceId = '0xd9b67a26';
    try {
      // Check if contract has supportsInterface function
      if (erc1155Contract.supportsInterface) {
        const supportsERC1155 = await withRetry(() => erc1155Contract.supportsInterface(erc1155InterfaceId));
        if (supportsERC1155) {
          return 'ERC1155';
        }
      }
    } catch (err) {
      // Continue to fallback detection
    }

    // Fallback: Try calling standard functions
    try {
      // Try ERC721 balanceOf(address) - this is unique to ERC721
      await withRetry(() => erc721Contract.balanceOf(ethers.ZeroAddress));
      // If that works, try ownerOf to confirm it's ERC721
      try {
        await withRetry(() => erc721Contract.ownerOf(0n));
        return 'ERC721';
      } catch (err) {
        // balanceOf worked but ownerOf didn't - might be ERC1155
      }
    } catch (err) {
      // Not ERC721, try ERC1155
    }

    // Try ERC1155 balanceOf(address, uint256) - this is unique to ERC1155
    try {
      await withRetry(() => erc1155Contract.balanceOf(ethers.ZeroAddress, 0n));
      return 'ERC1155';
    } catch (err2) {
      return null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Get general ERC721 or ERC1155 NFTs for an address on a chain
 * Fetches all NFTs from a given contract address owned by the user
 * Automatically detects whether the contract is ERC721 or ERC1155
 */
export async function getGeneralNFTs(
  chainId: number,
  address: string,
  nftContractAddress: string
): Promise<GeneralNFTData[]> {
  try {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return [];
    }

    if (!nftContractAddress || nftContractAddress === '0x0000000000000000000000000000000000000000') {
      return [];
    }

    // Use retry provider to handle rate limits and network issues
    const provider = createRetryProvider(rpcUrl, chainId);
    
    // Normalize addresses to proper checksum format
    const normalizedContractAddr = ethers.getAddress(nftContractAddress.toLowerCase());
    const normalizedAddress = ethers.getAddress(address.toLowerCase());
    
    // Create contracts for both standards to detect which one it is
    const erc721Contract = new ethers.Contract(normalizedContractAddr, ERC721_ABI, provider);
    const erc1155Contract = new ethers.Contract(normalizedContractAddr, ERC1155_ABI, provider);

    // Detect NFT standard
    const standard = await detectNFTStandard(erc721Contract, erc1155Contract);
    if (!standard) {
      return []; // Not a recognized NFT standard
    }

    const nfts: GeneralNFTData[] = [];

    // Get collection name and symbol (optional)
    let collectionName: string | undefined;
    let collectionSymbol: string | undefined;
    try {
      [collectionName, collectionSymbol] = await Promise.all([
        withRetry(() => erc721Contract.name()).catch(() => 
          withRetry(() => erc1155Contract.name()).catch(() => undefined)
        ),
        withRetry(() => erc721Contract.symbol()).catch(() => 
          withRetry(() => erc1155Contract.symbol()).catch(() => undefined)
        ),
      ]);
    } catch (error) {
      // Silent error - not all contracts have name/symbol
    }

    // Fetch floor price for the collection (optional, can be slow)
    // Uses Alchemy NFT API first, falls back to OpenSea
    let floorPrice: number | undefined;
    try {
      const price = await getNFTFloorPrice(chainId, normalizedContractAddr);
      floorPrice = price !== null ? price : undefined;
    } catch (error) {
      // Silent error - pricing is optional
    }

    if (standard === 'ERC721') {
      // Handle ERC721 NFTs
      let balance: bigint;
      try {
        balance = await withRetry(() => erc721Contract.balanceOf(normalizedAddress));
      } catch (error: any) {
        if (error?.code === 'BAD_DATA' || error?.shortMessage?.includes('could not decode')) {
          return [];
        }
        throw error;
      }

      if (balance === 0n) {
        return [];
      }

      const balanceNum = Number(balance);
      const maxTokens = Math.min(balanceNum, 50); // Limit to 50 NFTs per contract to prevent timeouts

      // Process in smaller batches to reduce concurrent RPC calls
      const batchSize = 5;
      for (let i = 0; i < maxTokens; i += batchSize) {
        const batchPromises: Promise<void>[] = [];

        for (let j = i; j < Math.min(i + batchSize, maxTokens); j++) {
          batchPromises.push(
            (async () => {
              try {
                // Use retry logic for RPC calls
                const tokenId = await withRetry(() => erc721Contract.tokenOfOwnerByIndex(normalizedAddress, j));
                const tokenIdString = tokenId.toString();

                // Get token URI with retry logic
                let uri = '';
                try {
                  uri = await withRetry(() => erc721Contract.tokenURI(tokenId)).catch(() => '');
                } catch (err) {
                  // Silent error
                }

                nfts.push({
                  tokenId: tokenIdString,
                  owner: normalizedAddress,
                  contractAddress: normalizedContractAddr,
                  uri,
                  name: collectionName,
                  symbol: collectionSymbol,
                  priceUSD: floorPrice,
                  standard: 'ERC721',
                  amount: '1', // ERC721 always has quantity 1
                });
              } catch (err) {
                // Skip this token
              }
            })()
          );
        }

        await Promise.all(batchPromises);
      }
    } else if (standard === 'ERC1155') {
      // Handle ERC1155 NFTs
      // ERC1155 is more complex - we need to find which tokenIds the user owns
      // Common approach: Try to enumerate tokenIds (if contract supports it) or use events
      // For now, we'll use a simpler approach: try common tokenId ranges
      
      // Note: ERC1155 doesn't have a standard way to enumerate owned tokens
      // This is a limitation - we'd need to use indexed events or a service like Alchemy
      // For now, we'll try a limited range of tokenIds (0-100) to find owned tokens
      // Reduced from 1000 to 100 to prevent excessive RPC calls and request timeouts
      
      const maxTokenId = 100; // Limit search range to prevent timeouts
      const batchSize = 20; // Smaller batches to reduce concurrent RPC calls
      
      for (let startId = 0; startId < maxTokenId; startId += batchSize) {
        const batchPromises: Promise<void>[] = [];
        
        for (let tokenId = startId; tokenId < Math.min(startId + batchSize, maxTokenId); tokenId++) {
          batchPromises.push(
            (async () => {
              try {
                // Check balance for this tokenId
                const balance = await withRetry(() => 
                  erc1155Contract.balanceOf(normalizedAddress, BigInt(tokenId))
                );
                
                if (balance === 0n) {
                  return; // User doesn't own this token
                }

                // Get token URI with retry logic
                let uri = '';
                try {
                  uri = await withRetry(() => erc1155Contract.uri(BigInt(tokenId))).catch(() => '');
                } catch (err) {
                  // Silent error
                }

                nfts.push({
                  tokenId: tokenId.toString(),
                  owner: normalizedAddress,
                  contractAddress: normalizedContractAddr,
                  uri,
                  name: collectionName,
                  symbol: collectionSymbol,
                  priceUSD: floorPrice,
                  standard: 'ERC1155',
                  amount: balance.toString(), // ERC1155 can have multiple copies
                });
              } catch (err) {
                // Skip this token
              }
            })()
          );
        }

        await Promise.all(batchPromises);
      }
    }

    return nfts;
  } catch (error) {
    console.error(`Error fetching general NFTs for ${address} on chain ${chainId}:`, error);
    return [];
  }
}

/**
 * Get ALL NFTs (ERC721, ERC1155) for multiple addresses and chains using Alchemy Portfolio API
 * This is the most efficient way to fetch NFTs across multiple chains in a single request
 * 
 * @param requests - Array of { address, chainIds[] } to fetch NFTs for
 * @param options - Optional parameters
 * @returns Map of address -> chainId -> { nfts, totalCount?, pageKey? }
 */
export async function getAllNFTsMultiChain(
  requests: Array<{ address: string; chainIds: number[] }>,
  options: {
    withMetadata?: boolean;
    pageKey?: string;
    pageSize?: number;
    orderBy?: 'transferTime';
    sortOrder?: 'asc' | 'desc';
    excludeFilters?: Array<'SPAM' | 'AIRDROPS'>;
    includeFilters?: Array<'SPAM' | 'AIRDROPS'>;
    spamConfidenceLevel?: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  } = {}
): Promise<Map<string, Map<number, { nfts: GeneralNFTData[]; totalCount?: number; pageKey?: string }>>> {
  try {
    // Use Portfolio API for multi-chain fetching
    const portfolioResults = await getNFTsByAddress(requests, options);
    
    // Convert Portfolio API format to GeneralNFTData format
    const resultMap = new Map<string, Map<number, { nfts: GeneralNFTData[]; totalCount?: number; pageKey?: string }>>();
    
    for (const [address, chainMap] of portfolioResults.entries()) {
      const addressResultMap = new Map<number, { nfts: GeneralNFTData[]; totalCount?: number; pageKey?: string }>();
      
      for (const [chainId, portfolioData] of chainMap.entries()) {
        const convertedNFTs: GeneralNFTData[] = [];
        
        for (const nft of portfolioData.nfts) {
          const converted = convertPortfolioNFTToGeneralNFT(nft, chainId);
          if (converted) {
            convertedNFTs.push({
              tokenId: converted.tokenId,
              owner: converted.owner,
              contractAddress: converted.contractAddress,
              uri: converted.uri,
              name: converted.name,
              symbol: converted.symbol,
              priceUSD: converted.priceUSD,
              standard: converted.standard,
              amount: converted.amount,
            });
          }
        }
        
        if (convertedNFTs.length > 0 || portfolioData.totalCount !== undefined) {
          addressResultMap.set(chainId, {
            nfts: convertedNFTs,
            totalCount: portfolioData.totalCount,
            pageKey: portfolioData.pageKey,
          });
        }
      }
      
      if (addressResultMap.size > 0) {
        resultMap.set(address, addressResultMap);
      }
    }
    
    return resultMap;
  } catch (error) {
    console.error(`Error fetching multi-chain NFTs:`, error);
    return new Map();
  }
}
