interface EthereumProvider {
  isMetaMask?: boolean;
  request?: (args: { method: string; params?: any[] | Record<string, any> }) => Promise<any>;
  // Add more properties as needed
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export {}; 