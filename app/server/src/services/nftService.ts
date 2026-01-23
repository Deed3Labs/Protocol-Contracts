import { ethers } from 'ethers';
import { getRpcUrl } from '../utils/rpc.js';
import { withRetry, createRetryProvider } from '../utils/rpcRetry.js';
import { getContractAddress } from '../config/contracts.js';
import { getOpenSeaNFTPrice } from './priceService.js';

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

    // Use retry provider to handle rate limits and network issues
    const provider = createRetryProvider(rpcUrl, chainId);
    
    // Normalize contract address to proper checksum format
    const normalizedContractAddr = ethers.getAddress(contractAddr.toLowerCase());
    const normalizedAddress = ethers.getAddress(address.toLowerCase());
    
    const abi = getDeedNFTAbi();
    const contract = new ethers.Contract(normalizedContractAddr, abi, provider);

    // Get user's balance first (much more efficient than checking all tokens)
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

    const nfts: DeedNFTData[] = [];
    const balanceNum = Number(balance);
    const maxTokens = Math.min(balanceNum, 100); // Limit to 100 tokens to prevent timeouts

    // Process in smaller batches to reduce concurrent RPC calls
    const batchSize = 5;
    for (let i = 0; i < maxTokens; i += batchSize) {
      const batchPromises: Promise<void>[] = [];

      for (let j = i; j < Math.min(i + batchSize, maxTokens); j++) {
        batchPromises.push(
          (async () => {
            try {
              // Use tokenOfOwnerByIndex to get only user-owned tokens (much more efficient!)
              const tokenId = await withRetry(() => contract.tokenOfOwnerByIndex(normalizedAddress, j));
              const tokenIdString = tokenId.toString();

              // Get token URI with retry logic
              const uri = await withRetry(() => contract.tokenURI(tokenId)).catch(() => '');

              // Get validation status with retry logic
              let validatorAddress = ethers.ZeroAddress;
              try {
                const [isValidated, validator] = await withRetry(() => contract.getValidationStatus(tokenId));
                if (isValidated) {
                  validatorAddress = validator;
                }
              } catch (err) {
                // Silent error
              }

              // Get asset type
              let assetType = 0;
              try {
                const assetTypeKey = ethers.keccak256(ethers.toUtf8Bytes('assetType'));
                const assetTypeBytes = await withRetry(() => contract.getTraitValue(tokenId, assetTypeKey));
                if (assetTypeBytes && assetTypeBytes.length > 0) {
                  assetType = Number(ethers.AbiCoder.defaultAbiCoder().decode(['uint8'], assetTypeBytes)[0]);
                }
              } catch (err) {
                // Silent error
              }

              // Get definition
              let definition = `T-Deed #${tokenIdString}`;
              try {
                const definitionKey = ethers.keccak256(ethers.toUtf8Bytes('definition'));
                const definitionBytes = await withRetry(() => contract.getTraitValue(tokenId, definitionKey));
                if (definitionBytes && definitionBytes.length > 0) {
                  definition = ethers.AbiCoder.defaultAbiCoder().decode(['string'], definitionBytes)[0];
                }
              } catch (err) {
                // Silent error
              }

              // Get configuration
              let configuration = '';
              try {
                const configurationKey = ethers.keccak256(ethers.toUtf8Bytes('configuration'));
                const configurationBytes = await withRetry(() => contract.getTraitValue(tokenId, configurationKey));
                if (configurationBytes && configurationBytes.length > 0) {
                  configuration = ethers.AbiCoder.defaultAbiCoder().decode(['string'], configurationBytes)[0];
                }
              } catch (err) {
                // Silent error
              }

              // Get token and salt
              let token = ethers.ZeroAddress;
              let salt = '0';
              try {
                token = await withRetry(() => contract.token(tokenId)).catch(() => ethers.ZeroAddress);
                salt = (await withRetry(() => contract.salt(tokenId)).catch(() => 0n)).toString();
              } catch (err) {
                // Silent error
              }

              // Fetch price for T-Deed (optional - can be slow)
              let priceUSD: number | undefined;
              try {
                const price = await getOpenSeaNFTPrice(chainId, normalizedContractAddr);
                priceUSD = price !== null ? price : undefined;
              } catch (error) {
                // Silent error - pricing is optional
              }

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
                priceUSD,
              });
            } catch (err) {
              // Skip this token
            }
          })()
        );
      }

      await Promise.all(batchPromises);
    }

    // Fetch prices for T-Deeds (optional - can be slow, so make it async/optional)
    // Prices are fetched separately and added later if needed
    
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
    let floorPrice: number | undefined;
    try {
      const price = await getOpenSeaNFTPrice(chainId, normalizedContractAddr);
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
