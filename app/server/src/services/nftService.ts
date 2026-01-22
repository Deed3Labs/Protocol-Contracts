import { ethers } from 'ethers';

/**
 * Get RPC URL for a chain
 */
function getRpcUrl(chainId: number): string {
  const rpcUrls: Record<number, string> = {
    1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    8453: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    11155111: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    84532: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  };

  return rpcUrls[chainId] || '';
}

/**
 * Get contract address for a chain
 */
function getContractAddress(chainId: number): string | null {
  // You can add contract addresses here or load from deployments
  const addresses: Record<number, string> = {
    84532: '0x...', // Add your deployed addresses
    // Add more as needed
  };

  return addresses[chainId] || null;
}

/**
 * Get DeedNFT ABI (simplified - you may want to load from file)
 */
function getDeedNFTAbi(): any[] {
  // Minimal ABI for DeedNFT
  return [
    'function totalSupply() external view returns (uint256)',
    'function tokenByIndex(uint256 index) external view returns (uint256)',
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

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const abi = getDeedNFTAbi();
    const contract = new ethers.Contract(contractAddr, abi, provider);

    // Get total supply
    const totalSupply = await contract.totalSupply().catch(() => 0n);
    if (totalSupply === 0n) return [];

    const nfts: DeedNFTData[] = [];
    const maxTokens = Math.min(Number(totalSupply), 1000); // Limit to 1000 tokens

    // Process in batches
    const batchSize = 10;
    for (let i = 0; i < maxTokens; i += batchSize) {
      const batchPromises: Promise<void>[] = [];

      for (let j = i; j < Math.min(i + batchSize, maxTokens); j++) {
        batchPromises.push(
          (async () => {
            try {
              const tokenId = await contract.tokenByIndex(j);
              const tokenIdString = tokenId.toString();
              const owner = await contract.ownerOf(tokenId);

              // Only include if owned by the address
              if (owner.toLowerCase() !== address.toLowerCase()) {
                return;
              }

              // Get token URI
              const uri = await contract.tokenURI(tokenId).catch(() => '');

              // Get validation status
              let validatorAddress = ethers.ZeroAddress;
              try {
                const [isValidated, validator] = await contract.getValidationStatus(tokenId);
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
                const assetTypeBytes = await contract.getTraitValue(tokenId, assetTypeKey);
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
                const definitionBytes = await contract.getTraitValue(tokenId, definitionKey);
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
                const configurationBytes = await contract.getTraitValue(tokenId, configurationKey);
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
                token = await contract.token(tokenId).catch(() => ethers.ZeroAddress);
                salt = (await contract.salt(tokenId).catch(() => 0n)).toString();
              } catch (err) {
                // Silent error
              }

              nfts.push({
                tokenId: tokenIdString,
                owner,
                assetType,
                uri,
                definition,
                configuration,
                validatorAddress,
                token,
                salt,
                isMinted: true,
              });
            } catch (err) {
              // Skip this token
            }
          })()
        );
      }

      await Promise.all(batchPromises);
    }

    return nfts;
  } catch (error) {
    console.error(`Error fetching NFTs for ${address} on chain ${chainId}:`, error);
    return [];
  }
}
