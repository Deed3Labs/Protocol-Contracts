import { getAlchemyRestUrl, getAlchemyApiKey } from '../utils/rpc.js';
import { websocketService } from './websocketService.js';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';

/**
 * Transfer types supported by Alchemy Transfers API
 * https://www.alchemy.com/docs/reference/transfers-api-quickstart
 */
export type TransferType = 
  | 'EXTERNAL'      // External ETH transfers
  | 'ERC20'         // ERC20 token transfers
  | 'ERC721'        // ERC721 NFT transfers
  | 'ERC1155'       // ERC1155 NFT transfers
  | 'INTERNAL';     // Internal ETH transfers

/**
 * Transfer data from Alchemy Transfers API
 */
export interface TransferData {
  blockNum: string;
  hash: string;
  from: string;
  to: string;
  value?: number;
  asset: string;
  category: TransferType;
  rawContract?: {
    address?: string;
    decimal?: string;
    symbol?: string;
  };
  metadata?: {
    blockTimestamp?: string;
  };
}

/**
 * Service for monitoring user transfers using Alchemy Transfers API
 * Provides better coverage than event listeners for all transfer types
 */
class TransfersService {
  private isRunning = false;
  private monitoringAddresses: Set<string> = new Set();
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastCheckedBlocks: Map<string, Map<number, string>> = new Map(); // address -> chainId -> blockNum

  /**
   * Start monitoring transfers for an address across all supported chains
   */
  async startMonitoring(address: string) {
    if (this.monitoringAddresses.has(address.toLowerCase())) {
      return; // Already monitoring
    }

    this.monitoringAddresses.add(address.toLowerCase());
    this.isRunning = true;

    // Supported chains for Alchemy Transfers API
    const supportedChains = [1, 8453, 137, 42161, 100, 11155111, 84532];

    // Start monitoring for each chain
    for (const chainId of supportedChains) {
      this.monitorChain(address, chainId);
    }

    console.log(`[TransfersService] Started monitoring transfers for ${address}`);
  }

  /**
   * Stop monitoring transfers for an address
   */
  stopMonitoring(address: string) {
    const normalizedAddress = address.toLowerCase();
    if (!this.monitoringAddresses.has(normalizedAddress)) {
      return;
    }

    this.monitoringAddresses.delete(normalizedAddress);
    
    // Clear intervals for this address
    const intervalKey = `${normalizedAddress}`;
    const interval = this.monitoringIntervals.get(intervalKey);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(intervalKey);
    }

    // Clear last checked blocks
    this.lastCheckedBlocks.delete(normalizedAddress);

    console.log(`[TransfersService] Stopped monitoring transfers for ${address}`);
  }

  /**
   * Monitor transfers for a specific address on a specific chain
   */
  private monitorChain(address: string, chainId: number) {
    const normalizedAddress = address.toLowerCase();
    const intervalKey = `${normalizedAddress}`;

    // Check every 30 seconds for new transfers
    const interval = setInterval(async () => {
      try {
        await this.checkTransfers(address, chainId);
      } catch (error) {
        console.error(`[TransfersService] Error checking transfers for ${address} on chain ${chainId}:`, error);
      }
    }, 30000); // 30 seconds

    this.monitoringIntervals.set(intervalKey, interval);

    // Initial check
    this.checkTransfers(address, chainId).catch(error => {
      console.error(`[TransfersService] Error in initial transfer check:`, error);
    });
  }

  /**
   * Check for new transfers for an address on a chain
   */
  private async checkTransfers(address: string, chainId: number): Promise<void> {
    const normalizedAddress = address.toLowerCase();
    const alchemyRestUrl = getAlchemyRestUrl(chainId);
    const apiKey = getAlchemyApiKey();

    if (!alchemyRestUrl || !apiKey) {
      return; // Alchemy API not available for this chain
    }

    try {
      // Get last checked block for this address/chain
      const addressBlocks = this.lastCheckedBlocks.get(normalizedAddress) || new Map();
      let lastBlock = addressBlocks.get(chainId) || 'latest';
      
      // Ensure block number is in hex format if it's not 'latest'
      // Alchemy expects hex strings (0x...) or 'latest', not decimal numbers
      if (lastBlock !== 'latest' && !lastBlock.startsWith('0x')) {
        // Convert decimal to hex if needed
        const blockNum = parseInt(lastBlock, 10);
        if (!isNaN(blockNum)) {
          lastBlock = `0x${blockNum.toString(16)}`;
        } else {
          lastBlock = 'latest'; // Fallback to latest if invalid
        }
      }

      // Determine categories based on chain support
      // 'internal' category is only supported for Ethereum (1) and Polygon (137)
      const categories = ['external', 'erc20', 'erc721', 'erc1155'];
      if (chainId === 1 || chainId === 137) {
        categories.push('internal');
      }

      // Fetch transfers using Alchemy Transfers API
      const transfers = await this.fetchTransfers(
        chainId,
        address,
        {
          fromBlock: lastBlock,
          toBlock: 'latest',
          maxCount: 100,
          excludeZeroValue: false,
          category: categories,
        }
      );

      if (transfers.length === 0) {
        return; // No new transfers
      }

      // Process new transfers
      for (const transfer of transfers) {
        await this.processTransfer(transfer, chainId, address);
      }

      // Update last checked block (ensure it's a hex string)
      if (transfers.length > 0) {
        const latestBlock = transfers[transfers.length - 1].blockNum;
        // Alchemy returns blockNum as hex string (e.g., "0x12345")
        // Ensure it's properly formatted as hex
        const latestBlockHex = latestBlock.startsWith('0x') 
          ? latestBlock 
          : `0x${parseInt(latestBlock, 10).toString(16)}`;
        
        const currentBlock = addressBlocks.get(chainId);
        const currentBlockHex = currentBlock && currentBlock !== 'latest' && !currentBlock.startsWith('0x')
          ? `0x${parseInt(currentBlock, 10).toString(16)}`
          : currentBlock || '0x0';
        
        // Compare block numbers (convert to number for comparison)
        const latestBlockNum = parseInt(latestBlockHex, 16);
        const currentBlockNum = currentBlockHex === 'latest' ? 0 : parseInt(currentBlockHex, 16);
        
        if (!addressBlocks.has(chainId) || latestBlockNum > currentBlockNum) {
          addressBlocks.set(chainId, latestBlockHex);
          this.lastCheckedBlocks.set(normalizedAddress, addressBlocks);
        }
      }
    } catch (error) {
      console.error(`[TransfersService] Error fetching transfers:`, error);
    }
  }

  /**
   * Fetch transfers using Alchemy Transfers API
   * https://www.alchemy.com/docs/reference/transfers-api-quickstart
   */
  async fetchTransfers(
    chainId: number,
    address: string,
    options: {
      fromBlock?: string;
      toBlock?: string;
      maxCount?: number;
      excludeZeroValue?: boolean;
      category?: string[];
      pageKey?: string;
    } = {}
  ): Promise<TransferData[]> {
    const alchemyRestUrl = getAlchemyRestUrl(chainId);
    const apiKey = getAlchemyApiKey();

    if (!alchemyRestUrl || !apiKey) {
      return [];
    }

    try {
      const response = await fetch(alchemyRestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'alchemy_getAssetTransfers',
          params: [
            {
              fromBlock: options.fromBlock || 'latest',
              toBlock: options.toBlock || 'latest',
              fromAddress: address,
              maxCount: options.maxCount || 100,
              excludeZeroValue: options.excludeZeroValue ?? false,
              category: options.category || ['external', 'erc20', 'erc721', 'erc1155'],
              pageKey: options.pageKey,
            },
          ],
        }),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as {
        result?: {
          transfers?: Array<{
            blockNum: string;
            hash: string;
            from: string;
            to: string;
            value?: number;
            asset: string;
            category: string;
            rawContract?: {
              address?: string;
              decimal?: string;
              symbol?: string;
            };
            metadata?: {
              blockTimestamp?: string;
            };
          }>;
          pageKey?: string;
        };
        error?: {
          message?: string;
        };
      };

      if (data.error) {
        console.error(`[TransfersService] Alchemy API error:`, data.error.message);
        return [];
      }

      const transfers = data.result?.transfers || [];
      return transfers.map(t => ({
        blockNum: t.blockNum,
        hash: t.hash,
        from: t.from,
        to: t.to,
        value: t.value,
        asset: t.asset,
        category: t.category.toUpperCase() as TransferType,
        rawContract: t.rawContract,
        metadata: t.metadata,
      }));
    } catch (error) {
      console.error(`[TransfersService] Error fetching transfers from Alchemy:`, error);
      return [];
    }
  }

  /**
   * Process a transfer and trigger notifications/cache invalidation
   */
  private async processTransfer(
    transfer: TransferData,
    chainId: number,
    monitoredAddress: string
  ): Promise<void> {
    const normalizedAddress = monitoredAddress.toLowerCase();
    const fromLower = transfer.from.toLowerCase();
    const toLower = transfer.to.toLowerCase();

    // Check if this transfer involves the monitored address
    const isRelevant = fromLower === normalizedAddress || toLower === normalizedAddress;
    if (!isRelevant) {
      return;
    }

    // Invalidate cache for affected addresses
    await this.invalidateCacheForAddress(chainId, transfer.from);
    if (transfer.from !== transfer.to) {
      await this.invalidateCacheForAddress(chainId, transfer.to);
    }

    // Broadcast WebSocket notifications
    const isIncoming = toLower === normalizedAddress;
    const isOutgoing = fromLower === normalizedAddress;

    if (isIncoming) {
      await websocketService.broadcastToAddress(transfer.to, 'transfer_received', {
        chainId,
        transfer,
        type: 'incoming',
        timestamp: Date.now(),
      });
    }

    if (isOutgoing) {
      await websocketService.broadcastToAddress(transfer.from, 'transfer_sent', {
        chainId,
        transfer,
        type: 'outgoing',
        timestamp: Date.now(),
      });
    }

    // Also send a general balance update
    await websocketService.broadcastToAddress(transfer.from, 'balance_update', {
      chainId,
      address: transfer.from,
      timestamp: Date.now(),
    });

    if (transfer.from !== transfer.to) {
      await websocketService.broadcastToAddress(transfer.to, 'balance_update', {
        chainId,
        address: transfer.to,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Invalidate cache for an address after a transfer
   */
  private async invalidateCacheForAddress(chainId: number, address: string): Promise<void> {
    try {
      const cacheService = await getRedisClient().then((client) => new CacheService(client));
      
      const balanceKey = CacheKeys.balance(chainId, address.toLowerCase());
      await cacheService.del(balanceKey);
      
      const nftKey = CacheKeys.nftList(chainId, address.toLowerCase());
      await cacheService.del(nftKey);
      
      const txKey = CacheKeys.transactions(chainId, address.toLowerCase(), 20);
      await cacheService.del(txKey);
    } catch (error) {
      console.error(`[TransfersService] Error invalidating cache:`, error);
    }
  }

  /**
   * Get historical transfers for an address
   * Useful for initial load or activity history
   */
  async getHistoricalTransfers(
    chainId: number,
    address: string,
    limit: number = 50
  ): Promise<TransferData[]> {
    // Determine categories based on chain support
    // 'internal' category is only supported for Ethereum (1) and Polygon (137)
    const categories = ['external', 'erc20', 'erc721', 'erc1155'];
    if (chainId === 1 || chainId === 137) {
      categories.push('internal');
    }

    return this.fetchTransfers(chainId, address, {
      fromBlock: '0x0',
      toBlock: 'latest',
      maxCount: limit,
      excludeZeroValue: false,
      category: categories,
    });
  }

  /**
   * Get transactions for an address on a chain (formatted for REST API)
   * Converts transfers to TransactionData format for backward compatibility
   * This is used by routes/transactions.ts
   */
  async getTransactions(
    chainId: number,
    address: string,
    limit: number = 20
  ): Promise<Array<{
    id: string;
    type: string;
    assetSymbol: string;
    amount: number;
    currency: string;
    date: string;
    status: string;
    hash: string;
    from?: string;
    to?: string;
    timestamp: number;
  }>> {
    try {
      // Determine categories based on chain support
      // 'internal' category is only supported for Ethereum (1) and Polygon (137)
      const categories = ['external', 'erc20', 'erc721', 'erc1155'];
      if (chainId === 1 || chainId === 137) {
        categories.push('internal');
      }

      // Fetch transfers using Alchemy Transfers API
      const transfers = await this.fetchTransfers(chainId, address, {
        fromBlock: '0x0',
        toBlock: 'latest',
        maxCount: limit * 2, // Get more than needed to filter and sort
        excludeZeroValue: false,
        category: categories,
      });

      if (transfers.length === 0) {
        return [];
      }

      // Convert Alchemy transfers to TransactionData format
      const transactions = transfers
        .map(transfer => {
          try {
            // Determine transaction type (must match WalletTransaction type)
            // Valid types: 'buy' | 'sell' | 'deposit' | 'withdraw' | 'mint' | 'trade' | 'transfer' | 'contract'
            let type: 'buy' | 'sell' | 'deposit' | 'withdraw' | 'mint' | 'trade' | 'transfer' | 'contract' = 'transfer';
            const isFromAddress = transfer.from.toLowerCase() === address.toLowerCase();
            const isToAddress = transfer.to.toLowerCase() === address.toLowerCase();
            const value = transfer.value || 0;

            if (isFromAddress && value > 0) {
              type = 'withdraw';
            } else if (isToAddress && value > 0) {
              type = 'deposit';
            } else if (transfer.category === 'ERC721' || transfer.category === 'ERC1155') {
              // NFT transfers - use 'mint' for incoming, 'transfer' for outgoing
              type = isToAddress ? 'mint' : 'transfer';
            } else if (transfer.category === 'ERC20') {
              // Token transfers - use 'trade' for swaps, 'transfer' for simple transfers
              type = 'transfer';
            } else if (transfer.category === 'INTERNAL') {
              type = 'contract';
            } else if (transfer.category === 'EXTERNAL') {
              // External ETH transfers
              if (isFromAddress && value > 0) {
                type = 'withdraw';
              } else if (isToAddress && value > 0) {
                type = 'deposit';
              } else {
                type = 'transfer';
              }
            }

            // Get asset symbol
            let assetSymbol = 'ETH';
            let currency = 'ETH';
            if (transfer.rawContract?.symbol) {
              assetSymbol = transfer.rawContract.symbol;
              currency = transfer.rawContract.symbol;
            } else if (transfer.category === 'ERC20' || transfer.category === 'ERC721' || transfer.category === 'ERC1155') {
              assetSymbol = transfer.asset || 'TOKEN';
              currency = transfer.asset || 'TOKEN';
            }

            // Get timestamp
            const timestamp = transfer.metadata?.blockTimestamp 
              ? new Date(transfer.metadata.blockTimestamp).getTime()
              : Date.now();

            return {
              id: `${chainId}-${transfer.hash}`,
              type,
              assetSymbol,
              amount: value,
              currency,
              date: new Date(timestamp).toISOString(),
              status: 'completed', // Alchemy only returns confirmed transfers
              hash: transfer.hash,
              from: transfer.from,
              to: transfer.to,
              timestamp,
            };
          } catch (error) {
            console.error(`[TransfersService] Error converting transfer:`, error);
            return null;
          }
        })
        .filter((tx): tx is NonNullable<typeof tx> => tx !== null);

      // Sort by timestamp (newest first) and limit
      transactions.sort((a, b) => b.timestamp - a.timestamp);
      return transactions.slice(0, limit);
    } catch (error) {
      console.error(`[TransfersService] Error fetching transactions for ${address} on chain ${chainId}:`, error);
      return [];
    }
  }

  /**
   * Cleanup all monitoring
   */
  cleanup() {
    this.isRunning = false;
    
    for (const interval of this.monitoringIntervals.values()) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();
    this.monitoringAddresses.clear();
    this.lastCheckedBlocks.clear();
  }
}

// Singleton instance
export const transfersService = new TransfersService();
