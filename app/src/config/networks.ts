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

export const SUPPORTED_NETWORKS: NetworkConfig[] = [
  {
    id: 1,
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: 'https://mainnet.infura.io/v3/your-project-id',
    alchemyUrl: import.meta.env.VITE_ALCHEMY_ETH_MAINNET,
    infuraUrl: import.meta.env.VITE_INFURA_ETH_MAINNET,
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
    rpcUrl: 'https://sepolia.infura.io/v3/your-project-id',
    alchemyUrl: import.meta.env.VITE_ALCHEMY_ETH_SEPOLIA,
    infuraUrl: import.meta.env.VITE_INFURA_ETH_SEPOLIA,
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
];

export const getNetworkByChainId = (chainId: number): NetworkConfig | undefined => {
  return SUPPORTED_NETWORKS.find(network => network.chainId === chainId);
};

export const isNetworkSupported = (chainId: number): boolean => {
  return SUPPORTED_NETWORKS.some(network => network.chainId === chainId);
};

export const getSupportedChainIds = (): number[] => {
  return SUPPORTED_NETWORKS.map(network => network.chainId);
};

export const getContractAddressForNetwork = (chainId: number): string | null => {
  const network = getNetworkByChainId(chainId);
  return network?.contractAddress || null;
};

// Get the best available RPC URL for a network
export const getRpcUrlForNetwork = (chainId: number, preferAlchemy = false): string | null => {
  const network = getNetworkByChainId(chainId);
  if (!network) return null;
  
  // Priority: Alchemy > Infura > Public RPC
  if (preferAlchemy && network.alchemyUrl) {
    return network.alchemyUrl;
  }
  if (network.infuraUrl) {
    return network.infuraUrl;
  }
  return network.rpcUrl;
};

// Get the correct ABI path for a network
export const getAbiPathForNetwork = (chainId: number, contractName: string): string => {
  const network = getNetworkByChainId(chainId);
  if (!network) {
    // Fallback to base-sepolia if network not found
    return `@/contracts/base-sepolia/${contractName}.json`;
  }
  
  // Map chain IDs to folder names
  const networkFolders: { [key: number]: string } = {
    1: 'ethereum', // Ethereum Mainnet
    8453: 'base', // Base
    11155111: 'sepolia', // Sepolia
    84532: 'base-sepolia', // Base Sepolia
  };
  
  const folder = networkFolders[chainId] || 'base-sepolia';
  return `@/contracts/${folder}/${contractName}.json`;
}; 