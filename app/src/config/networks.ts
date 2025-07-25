export interface NetworkConfig {
  id: number;
  name: string;
  chainId: number;
  rpcUrl: string;
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
    id: 84532,
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
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