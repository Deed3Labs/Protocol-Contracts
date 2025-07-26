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
    },
  },
  // Sepolia
  11155111: {
    name: 'Sepolia',
    chainId: 11155111,
    rpcUrl: 'https://sepolia.infura.io/v3/your-project-id',
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

// Get contract address for a specific network
export const getContractAddressForNetwork = (chainId: number): string | null => {
  const network = networks[chainId as keyof typeof networks];
  return network?.contracts?.DeedNFT || null;
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