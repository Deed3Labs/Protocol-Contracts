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
  uniqueId: string;
  hash: string;
  from: string | null;
  to: string | null;
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
  private monitoringIntervals: Map<string, number> = new Map();
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

    this.monitoringIntervals.set(intervalKey, interval as unknown as number);

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
      // Note: lastCheckedBlocks stores block numbers as strings (hex or 'latest')
      if (lastBlock !== 'latest') {
        if (lastBlock.startsWith('0x')) {
          // Already hex, validate it's a valid hex number
          const blockNum = parseInt(lastBlock, 16);
          if (isNaN(blockNum) || blockNum < 0) {
            console.warn(`[TransfersService] Invalid hex block number stored: ${lastBlock}, using 'latest'`);
            lastBlock = 'latest'; // Invalid hex, fallback
          } else {
            // Normalize to lowercase hex
            lastBlock = lastBlock.toLowerCase();
          }
        } else {
          // Try parsing as decimal string (defensive: handle if somehow stored incorrectly)
          const blockNum = parseInt(lastBlock, 10);
          if (!isNaN(blockNum) && blockNum >= 0) {
            lastBlock = `0x${blockNum.toString(16)}`;
          } else {
            console.warn(`[TransfersService] Invalid block number format stored: ${lastBlock}, using 'latest'`);
            lastBlock = 'latest'; // Invalid, fallback
          }
        }
      }

      // Determine categories based on chain support
      // 'internal' category is only supported for Ethereum (1), Polygon (137), Arbitrum (42161), Optimism (10), and Base (8453)
      const categories = ['external', 'erc20', 'erc721', 'erc1155'];
      // Alchemy supports internal transfers on these chains
      // Reducing strictness to match observed errors: limiting strictly to ETH (1) and Polygon (137) as per error message
      if (chainId === 1 || chainId === 137) {
        categories.push('internal');
      }

      // Fetch transfers using Alchemy Transfers API
      // We fetch both incoming and outgoing transfers by making two requests
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
        // Ensure it's properly formatted as hex string
        // Note: blockNum is typed as string in TransferData interface
        let latestBlockHex: string;
        if (latestBlock.startsWith('0x')) {
          // Validate hex string
          const blockNum = parseInt(latestBlock, 16);
          if (!isNaN(blockNum) && blockNum >= 0) {
            latestBlockHex = latestBlock.toLowerCase(); // Normalize to lowercase
          } else {
            console.warn(`[TransfersService] Invalid hex block number from Alchemy: ${latestBlock}`);
            return; // Skip update if invalid
          }
        } else {
          // Try parsing as decimal string (defensive programming in case API returns unexpected format)
          const blockNum = parseInt(latestBlock, 10);
          if (!isNaN(blockNum) && blockNum >= 0) {
            latestBlockHex = `0x${blockNum.toString(16)}`;
          } else {
            console.warn(`[TransfersService] Invalid block number format from Alchemy: ${latestBlock}`);
            return; // Skip update if invalid
          }
        }
        
        // Get current block and normalize to hex
        // Note: lastCheckedBlocks stores block numbers as strings (hex or 'latest')
        const currentBlock = addressBlocks.get(chainId);
        let currentBlockHex: string;
        if (!currentBlock || currentBlock === 'latest') {
          currentBlockHex = '0x0';
        } else if (currentBlock.startsWith('0x')) {
          currentBlockHex = currentBlock.toLowerCase();
        } else {
          // Defensive: handle decimal string if somehow stored incorrectly
          const blockNum = parseInt(currentBlock, 10);
          if (!isNaN(blockNum) && blockNum >= 0) {
            currentBlockHex = `0x${blockNum.toString(16)}`;
          } else {
            currentBlockHex = '0x0';
          }
        }
        
        // Compare block numbers (convert to number for comparison)
        const latestBlockNum = parseInt(latestBlockHex, 16);
        const currentBlockNum = parseInt(currentBlockHex, 16);
        
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
      // Validate and normalize block parameters
      // Alchemy expects hex strings (0x...) or 'latest' for block numbers
      // CRITICAL: Never pass numbers - always convert to hex strings
      let fromBlock: string = 'latest';
      let toBlock: string = 'latest';
      
      // Normalize fromBlock - handle all possible input types
      if (options.fromBlock !== undefined && options.fromBlock !== null) {
        if (typeof options.fromBlock === 'string') {
          const trimmed = options.fromBlock.trim();
          if (trimmed === 'latest' || trimmed === 'earliest' || trimmed === 'pending') {
            fromBlock = trimmed;
          } else if (trimmed.startsWith('0x')) {
            // Validate hex string
            const blockNum = parseInt(trimmed, 16);
            if (!isNaN(blockNum) && blockNum >= 0) {
              fromBlock = trimmed.toLowerCase();
            } else {
              console.warn(`[TransfersService] Invalid hex fromBlock: ${trimmed}, using 'latest'`);
              fromBlock = 'latest';
            }
          } else {
            // Try to convert decimal string to hex
            const blockNum = parseInt(trimmed, 10);
            if (!isNaN(blockNum) && blockNum >= 0) {
              fromBlock = `0x${blockNum.toString(16)}`;
            } else {
              console.warn(`[TransfersService] Invalid fromBlock format: ${trimmed}, using 'latest'`);
              fromBlock = 'latest';
            }
          }
        } else if (typeof options.fromBlock === 'number') {
          // Convert number to hex string
          const blockNum: number = Number(options.fromBlock);
          if (!isNaN(blockNum) && blockNum >= 0 && isFinite(blockNum)) {
            fromBlock = `0x${Math.floor(blockNum).toString(16)}`;
          } else {
            console.warn(`[TransfersService] Invalid fromBlock number: ${blockNum}, using 'latest'`);
            fromBlock = 'latest';
          }
        } else {
          console.warn(`[TransfersService] Invalid fromBlock type: ${typeof options.fromBlock}, using 'latest'`);
          fromBlock = 'latest';
        }
      }
      
      // Normalize toBlock - handle all possible input types
      if (options.toBlock !== undefined && options.toBlock !== null) {
        if (typeof options.toBlock === 'string') {
          const trimmed = options.toBlock.trim();
          if (trimmed === 'latest' || trimmed === 'earliest' || trimmed === 'pending') {
            toBlock = trimmed;
          } else if (trimmed.startsWith('0x')) {
            // Validate hex string
            const blockNum = parseInt(trimmed, 16);
            if (!isNaN(blockNum) && blockNum >= 0) {
              toBlock = trimmed.toLowerCase();
            } else {
              console.warn(`[TransfersService] Invalid hex toBlock: ${trimmed}, using 'latest'`);
              toBlock = 'latest';
            }
          } else {
            // Try to convert decimal string to hex
            const blockNum = parseInt(trimmed, 10);
            if (!isNaN(blockNum) && blockNum >= 0) {
              toBlock = `0x${blockNum.toString(16)}`;
            } else {
              console.warn(`[TransfersService] Invalid toBlock format: ${trimmed}, using 'latest'`);
              toBlock = 'latest';
            }
          }
        } else if (typeof options.toBlock === 'number') {
          // Convert number to hex string
          const blockNum: number = Number(options.toBlock);
          if (!isNaN(blockNum) && blockNum >= 0 && isFinite(blockNum)) {
            toBlock = `0x${Math.floor(blockNum).toString(16)}`;
          } else {
            console.warn(`[TransfersService] Invalid toBlock number: ${blockNum}, using 'latest'`);
            toBlock = 'latest';
          }
        } else {
          console.warn(`[TransfersService] Invalid toBlock type: ${typeof options.toBlock}, using 'latest'`);
          toBlock = 'latest';
        }
      }
      
      // Ensure maxCount is a number (not a string) for internal logic
      let maxCountNum: number = 100;
      if (options.maxCount !== undefined && options.maxCount !== null) {
        if (typeof options.maxCount === 'number') {
          maxCountNum = options.maxCount > 0 ? options.maxCount : 100;
        } else if (typeof options.maxCount === 'string') {
          // Handle string maxCount (defensive)
          const parsed = parseInt(options.maxCount, 10);
          maxCountNum = !isNaN(parsed) && parsed > 0 ? parsed : 100;
        } else {
          console.warn(`[TransfersService] Invalid maxCount type: ${typeof options.maxCount}, using default 100`);
          maxCountNum = 100;
        }
      }
      
      // Convert maxCount to hex string for Alchemy API
      const maxCountHex = `0x${maxCountNum.toString(16)}`;
      
      // Final validation: ensure fromBlock and toBlock are strings (never numbers)
      if (typeof fromBlock !== 'string') {
        console.error(`[TransfersService] CRITICAL: fromBlock is not a string: ${typeof fromBlock}, value: ${fromBlock}`);
        fromBlock = 'latest';
      }
      if (typeof toBlock !== 'string') {
        console.error(`[TransfersService] CRITICAL: toBlock is not a string: ${typeof toBlock}, value: ${toBlock}`);
        toBlock = 'latest';
      }
      
      // Prepare base params
      const baseParams = {
        fromBlock: String(fromBlock), // Explicit string conversion
        toBlock: String(toBlock), // Explicit string conversion
        maxCount: maxCountHex, // Hex string
        excludeZeroValue: options.excludeZeroValue ?? false,
        category: options.category || ['external', 'erc20', 'erc721', 'erc1155'],
        pageKey: options.pageKey,
        withMetadata: true,
      };

      // We need to fetch both incoming and outgoing transfers
      // Alchemy doesn't support OR logic for fromAddress/toAddress in a single request
      const requests = [
        { ...baseParams, fromAddress: address },
        { ...baseParams, toAddress: address }
      ];
      
      const responses = await Promise.all(requests.map(async (params) => {
        const requestBody = {
          id: 1,
          jsonrpc: '2.0',
          method: 'alchemy_getAssetTransfers',
          params: [params],
        };

        try {
          const response = await fetch(alchemyRestUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            return [];
          }

          const data = await response.json() as {
            result?: {
              transfers?: Array<{
                blockNum: string;
                uniqueId: string;
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

          return data.result?.transfers || [];
        } catch (error) {
          console.error(`[TransfersService] Error fetching transfers subset:`, error);
          return [];
        }
      }));

      // Merge and deduplicate transfers
      // We use a Map keyed by uniqueId (or fallback) to deduplicate self-transfers or overlaps
      const uniqueTransfers = new Map<string, any>();
      
      // Combine results from both requests
      const allTransfers = [...responses[0], ...responses[1]];
      
      for (const t of allTransfers) {
        // Use uniqueId from Alchemy if available, otherwise construct a unique key
        const key = t.uniqueId || `${t.hash}-${t.category}-${t.value}-${t.asset}`;
        uniqueTransfers.set(key, t);
      }
      
      // Convert back to array and sort by block number
      const transfers = Array.from(uniqueTransfers.values());
      
      transfers.sort((a, b) => {
        const blockA = parseInt(a.blockNum, 16);
        const blockB = parseInt(b.blockNum, 16);
        return blockA - blockB;
      });

      return transfers.map(t => ({
        blockNum: t.blockNum,
        uniqueId: t.uniqueId,
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
    const fromLower = transfer.from ? transfer.from.toLowerCase() : '';
    const toLower = transfer.to ? transfer.to.toLowerCase() : '';

    // Check if this transfer involves the monitored address
    const isRelevant = fromLower === normalizedAddress || toLower === normalizedAddress;
    if (!isRelevant) {
      return;
    }

    // Invalidate cache for affected addresses
    if (transfer.from) {
      await this.invalidateCacheForAddress(chainId, transfer.from);
    }
    if (transfer.to && transfer.from !== transfer.to) {
      await this.invalidateCacheForAddress(chainId, transfer.to);
    }

    // Broadcast WebSocket notifications
    const isIncoming = toLower === normalizedAddress;
    const isOutgoing = fromLower === normalizedAddress;

    if (isIncoming && transfer.to) {
      await websocketService.broadcastToAddress(transfer.to, 'transfer_received', {
        chainId,
        transfer,
        type: 'incoming',
        timestamp: Date.now(),
      });
    }

    if (isOutgoing && transfer.from) {
      await websocketService.broadcastToAddress(transfer.from, 'transfer_sent', {
        chainId,
        transfer,
        type: 'outgoing',
        timestamp: Date.now(),
      });
    }

    // Also send a general balance update
    if (transfer.from) {
      await websocketService.broadcastToAddress(transfer.from, 'balance_update', {
        chainId,
        address: transfer.from,
        timestamp: Date.now(),
      });
    }

    if (transfer.to && transfer.from !== transfer.to) {
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
      // 'internal' category is only supported for Ethereum (1), Polygon (137), Arbitrum (42161), Optimism (10), and Base (8453)
      // Note: Some RPC providers might limit this further, so we'll be defensive
      // Update: It seems our Alchemy plan or specific endpoints might restrict this further for some chains
      const categories = ['external', 'erc20', 'erc721', 'erc1155'];
      
      // Alchemy supports internal transfers on these chains
      // Reducing strictness to match observed errors: limiting strictly to ETH (1) and Polygon (137) as per error message
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
    from?: string | null;
    to?: string | null;
    timestamp: number;
  }>> {
    try {
      // Determine categories based on chain support
      // 'internal' category is only supported for Ethereum (1), Polygon (137), Arbitrum (42161), Optimism (10), and Base (8453)
      const categories = ['external', 'erc20', 'erc721', 'erc1155'];
      // Alchemy supports internal transfers on these chains
      if (chainId === 1 || chainId === 137 || chainId === 42161 || chainId === 10 || chainId === 8453) {
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
            const fromLower = transfer.from ? transfer.from.toLowerCase() : '';
            const toLower = transfer.to ? transfer.to.toLowerCase() : '';
            const isFromAddress = fromLower === address.toLowerCase();
            const isToAddress = toLower === address.toLowerCase();
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
