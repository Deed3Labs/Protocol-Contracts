export interface NetworkConfig {
  id: number;
  name: string;
  chainId: number;
  rpcUrl: string;
  alchemyUrl?: string; // Optional Alchemy endpoint
  infuraUrl?: string;  // Optional Infura endpoint
  blockExplorer: string;
  contractAddress: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

// Get Infura project ID from environment variable
// ⚠️ SECURITY NOTE: VITE_ prefixed variables are exposed to the browser
// Infura Project IDs are safe to expose, but you MUST:
// 1. Enable domain/origin restrictions in Infura dashboard
// 2. Enable rate limiting
// 3. Enable method allowlists
// 4. Never expose the Project Secret (only use Project ID)
// See docs/security-rpc-providers.md for details
const INFURA_PROJECT_ID = import.meta.env.VITE_INFURA_PROJECT_ID || '';

export const SUPPORTED_NETWORKS: NetworkConfig[] = [
  {
    id: 1,
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: INFURA_PROJECT_ID 
      ? `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}`
      : 'https://eth.llamarpc.com', // Fallback to public RPC
    alchemyUrl: import.meta.env.VITE_ALCHEMY_ETH_MAINNET,
    infuraUrl: import.meta.env.VITE_INFURA_ETH_MAINNET || (INFURA_PROJECT_ID ? `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}` : undefined),
    blockExplorer: 'https://etherscan.io',
    contractAddress: '0x0000000000000000000000000000000000000000', // Replace with actual address
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  {
    id: 8453,
    name: 'Base',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    alchemyUrl: import.meta.env.VITE_ALCHEMY_BASE_MAINNET,
    blockExplorer: 'https://basescan.org',
    contractAddress: '0x0000000000000000000000000000000000000000', // Replace with actual address
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  {
    id: 11155111,
    name: 'Sepolia',
    chainId: 11155111,
    rpcUrl: INFURA_PROJECT_ID 
      ? `https://sepolia.infura.io/v3/${INFURA_PROJECT_ID}`
      : 'https://sepolia.infura.io/v3/your-project-id', // Fallback placeholder
    alchemyUrl: import.meta.env.VITE_ALCHEMY_ETH_SEPOLIA,
    infuraUrl: import.meta.env.VITE_INFURA_ETH_SEPOLIA || (INFURA_PROJECT_ID ? `https://sepolia.infura.io/v3/${INFURA_PROJECT_ID}` : undefined),
    blockExplorer: 'https://sepolia.etherscan.io',
    contractAddress: '0x0000000000000000000000000000000000000000', // Replace with actual address
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  {
    id: 84532,
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    alchemyUrl: import.meta.env.VITE_ALCHEMY_BASE_SEPOLIA,
    blockExplorer: 'https://sepolia.basescan.org',
    contractAddress: '0x1a4e89225015200f70e5a06f766399a3de6e21E6',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  {
    id: 42161,
    name: 'Arbitrum One',
    chainId: 42161,
    rpcUrl: INFURA_PROJECT_ID 
      ? `https://arbitrum-mainnet.infura.io/v3/${INFURA_PROJECT_ID}`
      : 'https://arb1.arbitrum.io/rpc',
    alchemyUrl: import.meta.env.VITE_ALCHEMY_ARBITRUM_MAINNET,
    infuraUrl: import.meta.env.VITE_INFURA_ARBITRUM_MAINNET || (INFURA_PROJECT_ID ? `https://arbitrum-mainnet.infura.io/v3/${INFURA_PROJECT_ID}` : undefined),
    blockExplorer: 'https://arbiscan.io',
    contractAddress: '0x0000000000000000000000000000000000000000', // Replace with actual address
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  {
    id: 137,
    name: 'Polygon',
    chainId: 137,
    rpcUrl: INFURA_PROJECT_ID 
      ? `https://polygon-mainnet.infura.io/v3/${INFURA_PROJECT_ID}`
      : 'https://polygon-rpc.com',
    alchemyUrl: import.meta.env.VITE_ALCHEMY_POLYGON_MAINNET,
    infuraUrl: import.meta.env.VITE_INFURA_POLYGON_MAINNET || (INFURA_PROJECT_ID ? `https://polygon-mainnet.infura.io/v3/${INFURA_PROJECT_ID}` : undefined),
    blockExplorer: 'https://polygonscan.com',
    contractAddress: '0x0000000000000000000000000000000000000000', // Replace with actual address
    nativeCurrency: {
      name: 'POL',
      symbol: 'POL',
      decimals: 18,
    },
  },
  {
    id: 100,
    name: 'Gnosis',
    chainId: 100,
    rpcUrl: 'https://rpc.gnosischain.com',
    alchemyUrl: import.meta.env.VITE_ALCHEMY_GNOSIS_MAINNET,
    blockExplorer: 'https://gnosisscan.io',
    contractAddress: '0x0000000000000000000000000000000000000000', // Replace with actual address
    nativeCurrency: {
      name: 'xDAI',
      symbol: 'xDAI',
      decimals: 18,
    },
  },
];

// Network configuration with additional contract addresses
export const networks = {
  // Base Sepolia
  84532: {
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    blockExplorer: 'https://sepolia.basescan.org',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      DeedNFT: '0x1a4e89225015200f70e5a06f766399a3de6e21E6',
      Validator: '0x18C53C0D046f98322954f971c21125E4443c79b9',
      ValidatorRegistry: '0x979E6cC741A8481f96739A996D06EcFb9BA2bc91',
      FundManager: '0x73ea6B404E6B81E7Fe6B112605dD8661B52d401e',
      MetadataRenderer: '0xAc50869E89004aa25A8c1044195AC760A7FC48BE',
      Subdivide: '0x3c947D71cb1698dFd4D7551b87E17306865C923F',
      Fractionalize: '0xeC464847C664Cc208478adbe377f7Db19e199823',
      FractionTokenFactory: '0x3E513d3c3c2845B5cAc4FA5e21C0f7f80f9328dc',
    },
  },
  // Sepolia
  11155111: {
    name: 'Sepolia',
    chainId: 11155111,
    rpcUrl: INFURA_PROJECT_ID 
      ? `https://sepolia.infura.io/v3/${INFURA_PROJECT_ID}`
      : 'https://sepolia.infura.io/v3/your-project-id', // Fallback placeholder
    blockExplorer: 'https://sepolia.etherscan.io',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
      Validator: '0x0000000000000000000000000000000000000000', // Not deployed yet
      ValidatorRegistry: '0x0000000000000000000000000000000000000000', // Not deployed yet
      FundManager: '0x0000000000000000000000000000000000000000', // Not deployed yet
      MetadataRenderer: '0x0000000000000000000000000000000000000000', // Not deployed yet
    },
  },
  // Base Mainnet
  8453: {
    name: 'Base',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
      Validator: '0x0000000000000000000000000000000000000000', // Not deployed yet
      ValidatorRegistry: '0x0000000000000000000000000000000000000000', // Not deployed yet
      FundManager: '0x0000000000000000000000000000000000000000', // Not deployed yet
      MetadataRenderer: '0x0000000000000000000000000000000000000000', // Not deployed yet
    },
  },
  // Ethereum Mainnet
  1: {
    name: 'Ethereum',
    chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    blockExplorer: 'https://etherscan.io',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
      Validator: '0x0000000000000000000000000000000000000000', // Not deployed yet
      ValidatorRegistry: '0x0000000000000000000000000000000000000000', // Not deployed yet
      FundManager: '0x0000000000000000000000000000000000000000', // Not deployed yet
      MetadataRenderer: '0x0000000000000000000000000000000000000000', // Not deployed yet
    },
  },
  // Arbitrum One
  42161: {
    name: 'Arbitrum One',
    chainId: 42161,
    rpcUrl: INFURA_PROJECT_ID 
      ? `https://arbitrum-mainnet.infura.io/v3/${INFURA_PROJECT_ID}`
      : 'https://arb1.arbitrum.io/rpc',
    blockExplorer: 'https://arbiscan.io',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
      Validator: '0x0000000000000000000000000000000000000000', // Not deployed yet
      ValidatorRegistry: '0x0000000000000000000000000000000000000000', // Not deployed yet
      FundManager: '0x0000000000000000000000000000000000000000', // Not deployed yet
      MetadataRenderer: '0x0000000000000000000000000000000000000000', // Not deployed yet
    },
  },
  // Polygon
  137: {
    name: 'Polygon',
    chainId: 137,
    rpcUrl: INFURA_PROJECT_ID 
      ? `https://polygon-mainnet.infura.io/v3/${INFURA_PROJECT_ID}`
      : 'https://polygon-rpc.com',
    blockExplorer: 'https://polygonscan.com',
    nativeCurrency: {
      name: 'POL',
      symbol: 'POL',
      decimals: 18,
    },
    contracts: {
      DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
      Validator: '0x0000000000000000000000000000000000000000', // Not deployed yet
      ValidatorRegistry: '0x0000000000000000000000000000000000000000', // Not deployed yet
      FundManager: '0x0000000000000000000000000000000000000000', // Not deployed yet
      MetadataRenderer: '0x0000000000000000000000000000000000000000', // Not deployed yet
    },
  },
  // Gnosis
  100: {
    name: 'Gnosis',
    chainId: 100,
    rpcUrl: 'https://rpc.gnosischain.com',
    blockExplorer: 'https://gnosisscan.io',
    nativeCurrency: {
      name: 'xDAI',
      symbol: 'xDAI',
      decimals: 18,
    },
    contracts: {
      DeedNFT: '0x0000000000000000000000000000000000000000', // Not deployed yet
      Validator: '0x0000000000000000000000000000000000000000', // Not deployed yet
      ValidatorRegistry: '0x0000000000000000000000000000000000000000', // Not deployed yet
      FundManager: '0x0000000000000000000000000000000000000000', // Not deployed yet
      MetadataRenderer: '0x0000000000000000000000000000000000000000', // Not deployed yet
    },
  },
};

export const getNetworkByChainId = (chainId: number): NetworkConfig | undefined => {
  return SUPPORTED_NETWORKS.find(network => network.chainId === chainId);
};

export const isNetworkSupported = (chainId: number): boolean => {
  return SUPPORTED_NETWORKS.some(network => network.chainId === chainId);
};

export const getSupportedChainIds = (): number[] => {
  return SUPPORTED_NETWORKS.map(network => network.chainId);
};

// Get contract address for a specific network and contract
export const getContractAddressForNetwork = (chainId: number, contractName: string = 'DeedNFT'): string | null => {
  const network = networks[chainId as keyof typeof networks];
  return network?.contracts?.[contractName as keyof typeof network.contracts] || null;
};

// Get all supported network IDs
export const getSupportedNetworkIds = (): number[] => {
  return Object.keys(networks).map(Number);
};

// Get network info by chain ID
export const getNetworkInfo = (chainId: number) => {
  return networks[chainId as keyof typeof networks] || null;
};

// Get the best available RPC URL for a network
// Priority: Alchemy > Infura > Public RPC
// Alchemy is preferred by default because it has better free tier limits (300M compute units/month vs Infura's ~100k requests/day)
// Environment variables needed:
// - VITE_INFURA_PROJECT_ID: Your Infura project ID (used for Infura RPC URLs)
// - VITE_ALCHEMY_ETH_MAINNET, VITE_ALCHEMY_ETH_SEPOLIA, etc.: Alchemy API keys (optional)
// - VITE_INFURA_ETH_MAINNET, VITE_INFURA_ETH_SEPOLIA, etc.: Full Infura URLs (optional, overrides project ID)
export const getRpcUrlForNetwork = (chainId: number): string | null => {
  const network = getNetworkByChainId(chainId);
  if (!network) return null;

  // Priority: Alchemy > Infura > Public RPC
  // Alchemy is preferred (better free tier limits: 300M compute units/month vs Infura's ~100k requests/day)
  if (network.alchemyUrl) {
    return network.alchemyUrl;
  }
  // Only use Infura if Alchemy is not available
  if (network.infuraUrl) {
    return network.infuraUrl;
  }
  return network.rpcUrl;
};

// Get ABI path for a specific network and contract
export const getAbiPathForNetwork = (chainId: number, contractName: string): string => {
  const network = networks[chainId as keyof typeof networks];
  if (!network) {
    // Fallback to base-sepolia if network not found
    return `@/contracts/base-sepolia/${contractName}.json`;
  }

  // Map chain IDs to directory names
  const chainIdToDir: { [key: number]: string } = {
    84532: 'base-sepolia',
    11155111: 'sepolia',
    8453: 'base',
    1: 'ethereum',
    42161: 'arbitrum',
    137: 'polygon',
    100: 'gnosis',
  };

  const dirName = chainIdToDir[chainId];
  if (!dirName) {
    // Fallback to base-sepolia if no mapping found
    return `@/contracts/base-sepolia/${contractName}.json`;
  }

  return `@/contracts/${dirName}/${contractName}.json`;
};

// Check if a contract is deployed (non-zero address)
export const isContractDeployed = (address: string): boolean => {
  return address !== '0x0000000000000000000000000000000000000000' && address !== '';
};

// Check if DeedNFT contract is deployed for a specific network
export const isDeedNFTDeployed = (chainId: number): boolean => {
  const address = getContractAddressForNetwork(chainId);
  return address !== null && isContractDeployed(address);
};

// Get networks with deployed contracts
export const getDeployedNetworks = (): number[] => {
  return Object.keys(networks)
    .map(Number)
    .filter(chainId => isDeedNFTDeployed(chainId));
};

// Check if a network is supported and has deployed contracts
export const isNetworkSupportedAndDeployed = (chainId: number): boolean => {
  return isNetworkSupported(chainId) && isDeedNFTDeployed(chainId);
}; 