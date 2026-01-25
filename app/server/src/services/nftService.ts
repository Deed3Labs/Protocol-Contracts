import { ethers } from 'ethers';
import { getRpcUrl, getAlchemyNFTUrl, getAlchemyApiKey } from '../utils/rpc.js';
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
 * Optimized to use Alchemy NFT API first, then batch RPC calls for T-Deed specific data
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
    
    // Step 1: Try to get tokenIds using Alchemy NFT API (single API call instead of multiple RPC calls)
    let tokenIds: string[] = [];
    const alchemyNFTUrl = getAlchemyNFTUrl(chainId);
    const apiKey = getAlchemyApiKey();
    
    if (alchemyNFTUrl && apiKey) {
      try {
        // Use Alchemy NFT API v3 getNFTsForOwner to get all NFTs owned by address
        const response = await fetch(
          `${alchemyNFTUrl}/getNFTsForOwner?owner=${normalizedAddress}&contractAddresses[]=${normalizedContractAddr}&withMetadata=false&pageSize=100`,
          {
            headers: {
              'Accept': 'application/json',
            },
          }
        );

        if (response.ok) {
          const data = await response.json() as {
            ownedNfts?: Array<{ id: { tokenId: string } }>;
            error?: { message?: string };
          };

          if (data.ownedNfts && !data.error) {
            tokenIds = data.ownedNfts.map(nft => nft.id.tokenId);
            console.log(`[getDeedNFTs] Found ${tokenIds.length} NFTs via Alchemy API for ${normalizedAddress} on chain ${chainId}`);
          }
        }
      } catch (error) {
        console.warn(`[getDeedNFTs] Alchemy NFT API failed, falling back to RPC:`, error);
      }
    }

    // Step 2: If Alchemy API didn't work, fall back to RPC to get tokenIds
    if (tokenIds.length === 0) {
      const provider = createRetryProvider(rpcUrl, chainId);
      const abi = getDeedNFTAbi();
      const contract = new ethers.Contract(normalizedContractAddr, abi, provider);

      // Get user's balance first
      let balance: bigint;
      try {
        balance = await withRetry(() => contract.balanceOf(normalizedAddress));
      } catch (error: any) {
        if (error?.code === 'BAD_DATA' || error?.shortMessage?.includes('could not decode')) {
          return [];
        }
        throw error;
      }

      if (balance === 0n) {
        return []; // User owns no T-Deeds
      }

      const balanceNum = Number(balance);
      const maxTokens = Math.min(balanceNum, 100); // Limit to 100 tokens

      // Get tokenIds using tokenOfOwnerByIndex
      const tokenIdPromises: Promise<bigint>[] = [];
      for (let i = 0; i < maxTokens; i++) {
        tokenIdPromises.push(
          withRetry(() => contract.tokenOfOwnerByIndex(normalizedAddress, i))
        );
      }

      const tokenIdResults = await Promise.allSettled(tokenIdPromises);
      tokenIds = tokenIdResults
        .filter((result): result is PromiseFulfilledResult<bigint> => result.status === 'fulfilled')
        .map(result => result.value.toString());
    }

    if (tokenIds.length === 0) {
      return [];
    }

    // Step 3: Batch fetch T-Deed specific data using RPC (but batch the calls)
    const provider = createRetryProvider(rpcUrl, chainId);
    const abi = getDeedNFTAbi();
    const contract = new ethers.Contract(normalizedContractAddr, abi, provider);

    // Fetch collection floor price once (not per NFT)
    let collectionFloorPrice: number | undefined;
    try {
      const price = await getNFTFloorPrice(chainId, normalizedContractAddr);
      collectionFloorPrice = price !== null ? price : undefined;
    } catch (error) {
      // Silent error - pricing is optional
    }

    // Process tokens in batches to avoid overwhelming RPC
    const nfts: DeedNFTData[] = [];
    const batchSize = 10; // Process 10 tokens at a time
    const assetTypeKey = ethers.keccak256(ethers.toUtf8Bytes('assetType'));
    const definitionKey = ethers.keccak256(ethers.toUtf8Bytes('definition'));
    const configurationKey = ethers.keccak256(ethers.toUtf8Bytes('configuration'));

    for (let i = 0; i < tokenIds.length; i += batchSize) {
      const batch = tokenIds.slice(i, i + batchSize);
      const batchPromises = batch.map(async (tokenIdString) => {
        try {
          const tokenId = BigInt(tokenIdString);

          // Batch all RPC calls for this token in parallel
          const [
            uriResult,
            validationResult,
            assetTypeResult,
            definitionResult,
            configurationResult,
            tokenResult,
            saltResult,
          ] = await Promise.allSettled([
            withRetry(() => contract.tokenURI(tokenId)).catch(() => ''),
            withRetry(() => contract.getValidationStatus(tokenId)).catch(() => [false, ethers.ZeroAddress]),
            withRetry(() => contract.getTraitValue(tokenId, assetTypeKey)).catch(() => '0x'),
            withRetry(() => contract.getTraitValue(tokenId, definitionKey)).catch(() => '0x'),
            withRetry(() => contract.getTraitValue(tokenId, configurationKey)).catch(() => '0x'),
            withRetry(() => contract.token(tokenId)).catch(() => ethers.ZeroAddress),
            withRetry(() => contract.salt(tokenId)).catch(() => 0n),
          ]);

          const uri = uriResult.status === 'fulfilled' ? uriResult.value : '';
          const [isValidated, validator] = validationResult.status === 'fulfilled' ? validationResult.value : [false, ethers.ZeroAddress];
          const validatorAddress = isValidated ? validator : ethers.ZeroAddress;

          // Decode asset type
          let assetType = 0;
          if (assetTypeResult.status === 'fulfilled' && assetTypeResult.value && assetTypeResult.value !== '0x') {
            try {
              assetType = Number(ethers.AbiCoder.defaultAbiCoder().decode(['uint8'], assetTypeResult.value)[0]);
            } catch (err) {
              // Silent error
            }
          }

          // Decode definition
          let definition = `T-Deed #${tokenIdString}`;
          if (definitionResult.status === 'fulfilled' && definitionResult.value && definitionResult.value !== '0x') {
            try {
              definition = ethers.AbiCoder.defaultAbiCoder().decode(['string'], definitionResult.value)[0];
            } catch (err) {
              // Silent error
            }
          }

          // Decode configuration
          let configuration = '';
          if (configurationResult.status === 'fulfilled' && configurationResult.value && configurationResult.value !== '0x') {
            try {
              configuration = ethers.AbiCoder.defaultAbiCoder().decode(['string'], configurationResult.value)[0];
            } catch (err) {
              // Silent error
            }
          }

          const token = tokenResult.status === 'fulfilled' ? tokenResult.value : ethers.ZeroAddress;
          const salt = saltResult.status === 'fulfilled' ? saltResult.value.toString() : '0';

          return {
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
            priceUSD: collectionFloorPrice, // Use collection floor price for all NFTs
          };
        } catch (err) {
          console.warn(`[getDeedNFTs] Error processing token ${tokenIdString}:`, err);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const result of batchResults) {
        if (result) {
          nfts.push(result);
        }
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
