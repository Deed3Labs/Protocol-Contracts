// EIP-5792 Wallet Capabilities and RPC Methods
// Based on https://eips.ethereum.org/EIPS/eip-5792 and AppKit documentation

export const EIP_5792_RPC_METHODS = {
  GET_CAPABILITIES: 'wallet_getCapabilities',
  SEND_CALLS: 'wallet_sendCalls',
  GET_CALLS_STATUS: 'wallet_getCallsStatus'
} as const;

export const WALLET_CAPABILITIES = {
  ATOMIC: 'atomic',
  BATCH: 'batch'
} as const;

export interface WalletCapabilities {
  atomic?: 'supported' | 'ready' | 'unsupported';
  batch?: 'supported' | 'ready' | 'unsupported';
  [key: string]: any;
}

export interface CallRequest {
  to: string;
  value?: string;
  data?: string;
}

export interface SendCallsRequest {
  from: string;
  chainId: string;
  calls: CallRequest[];
  atomicRequired?: boolean;
}

export interface SendCallsResponse {
  batchId: string;
}

export interface CallReceipt {
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
  status: string;
  blockHash: string;
  blockNumber: string;
  gasUsed: string;
  transactionHash: string;
}

export interface GetCallsStatusResponse {
  chainId: string;
  id: string;
  status: number;
  atomic: boolean;
  receipts: CallReceipt[];
}

export class EIP5792Utils {
  /**
   * Check if wallet supports EIP-5792 capabilities
   */
  static async getWalletCapabilities(provider: any): Promise<WalletCapabilities | null> {
    try {
      const capabilities = await provider.request({
        method: EIP_5792_RPC_METHODS.GET_CAPABILITIES,
        params: []
      });
      return capabilities;
    } catch (error) {
      console.warn('Wallet does not support EIP-5792 capabilities:', error);
      return null;
    }
  }

  /**
   * Check if wallet supports atomic batch transactions
   */
  static async supportsAtomicBatch(provider: any): Promise<boolean> {
    const capabilities = await this.getWalletCapabilities(provider);
    return capabilities?.atomic === 'supported';
  }

  /**
   * Execute a single call using EIP-5792 if supported, otherwise fallback to eth_call
   */
  static async executeCall(
    provider: any,
    contractAddress: string,
    data: string,
    from?: string
  ): Promise<string> {
    const capabilities = await this.getWalletCapabilities(provider);
    
    if (capabilities?.atomic === 'supported') {
      // Use EIP-5792 wallet_sendCalls for atomic execution
      const calls: CallRequest[] = [{
        to: contractAddress,
        data
      }];

      const request: SendCallsRequest = {
        from: from || await this.getAccountAddress(provider),
        chainId: await this.getChainId(provider),
        calls,
        atomicRequired: true
      };

      const response: SendCallsResponse = await provider.request({
        method: EIP_5792_RPC_METHODS.SEND_CALLS,
        params: [request]
      });

      // Wait for the call to complete
      const status = await this.waitForCallsStatus(provider, response.batchId);
      
      if (status.receipts.length > 0 && status.receipts[0].status === '0x1') {
        return status.receipts[0].logs[0]?.data || '0x';
      } else {
        throw new Error('Call failed or returned error status');
      }
    } else {
      // Fallback to standard eth_call
      return await provider.request({
        method: 'eth_call',
        params: [{
          to: contractAddress,
          data
        }, 'latest']
      });
    }
  }

  /**
   * Execute multiple calls atomically using EIP-5792
   */
  static async executeBatchCalls(
    provider: any,
    calls: CallRequest[],
    from?: string
  ): Promise<GetCallsStatusResponse> {
    const capabilities = await this.getWalletCapabilities(provider);
    
    if (capabilities?.atomic !== 'supported') {
      throw new Error('Wallet does not support atomic batch transactions');
    }

    const request: SendCallsRequest = {
      from: from || await this.getAccountAddress(provider),
      chainId: await this.getChainId(provider),
      calls,
      atomicRequired: true
    };

    const response: SendCallsResponse = await provider.request({
      method: EIP_5792_RPC_METHODS.SEND_CALLS,
      params: [request]
    });

    return await this.waitForCallsStatus(provider, response.batchId);
  }

  /**
   * Wait for calls status to be available
   */
  static async waitForCallsStatus(
    provider: any,
    batchId: string,
    maxAttempts: number = 30,
    delayMs: number = 1000
  ): Promise<GetCallsStatusResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const status = await provider.request({
          method: EIP_5792_RPC_METHODS.GET_CALLS_STATUS,
          params: [batchId]
        });

        if (status.status === 200) {
          return status;
        }
      } catch (error) {
        console.warn(`Attempt ${attempt + 1}: Status not ready yet:`, error);
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    throw new Error('Timeout waiting for calls status');
  }

  /**
   * Get account address from provider
   */
  static async getAccountAddress(provider: any): Promise<string> {
    const accounts = await provider.request({
      method: 'eth_accounts',
      params: []
    });
    return accounts[0];
  }

  /**
   * Get chain ID from provider
   */
  static async getChainId(provider: any): Promise<string> {
    const chainId = await provider.request({
      method: 'eth_chainId',
      params: []
    });
    return chainId;
  }

  /**
   * Check if provider supports EIP-5792
   */
  static async isEIP5792Supported(provider: any): Promise<boolean> {
    try {
      const capabilities = await this.getWalletCapabilities(provider);
      return capabilities !== null;
    } catch {
      return false;
    }
  }
} 