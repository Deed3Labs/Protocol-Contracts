import { getAlchemyRestUrl, getAlchemyApiKey } from '../utils/rpc.js';
import { websocketService } from './websocketService.js';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { computeUnitTracker } from '../utils/computeUnitTracker.js';

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
 * Calculate approximate block number from N days ago based on chain's average block time
 * This is used to limit transaction history queries and reduce Alchemy compute unit usage
 * 
 * OPTIMIZATION: Instead of scanning from block 0 (entire chain history), we limit to recent blocks.
 * This dramatically reduces Alchemy compute unit consumption.
 * 
 * @param chainId - Chain ID
 * @param daysAgo - Number of days to look back (default: 30 days)
 * @returns Hex string block number representing approximately N days ago
 */
function getRecentBlockNumber(chainId: number, daysAgo: number = 30): string {
  // Average block times (in seconds) for different chains
  const blockTimes: Record<number, number> = {
    1: 12,        // Ethereum: ~12 seconds per block
    8453: 2,      // Base: ~2 seconds per block
    137: 2,       // Polygon: ~2 seconds per block
    42161: 0.25,  // Arbitrum: ~0.25 seconds per block
    100: 5,       // Gnosis: ~5 seconds per block
    11155111: 12, // Ethereum Sepolia: ~12 seconds per block
    84532: 2,     // Base Sepolia: ~2 seconds per block
  };

  // Estimated current block numbers (as of Jan 2025, updated conservatively)
  // These are rough estimates - the actual number will be higher, but this ensures we get recent blocks
  const estimatedCurrentBlocks: Record<number, number> = {
    1: 21000000,      // Ethereum mainnet
    8453: 15000000,   // Base mainnet
    137: 65000000,    // Polygon mainnet
    42161: 250000000, // Arbitrum mainnet
    100: 32000000,    // Gnosis mainnet
    11155111: 8000000, // Ethereum Sepolia
    84532: 15000000,  // Base Sepolia
  };

  const blockTime = blockTimes[chainId] || 12; // Default to 12 seconds
  const estimatedCurrent = estimatedCurrentBlocks[chainId] || 20000000; // Default estimate
  
  // Calculate blocks in N days
  const secondsAgo = daysAgo * 24 * 60 * 60;
  const blocksAgo = Math.floor(secondsAgo / blockTime);
  
  // Calculate approximate block number from N days ago
  // Subtract blocksAgo from estimated current block
  const recentBlockNumber = Math.max(0, estimatedCurrent - blocksAgo);
  
  return `0x${recentBlockNumber.toString(16)}`;
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
  private activeChains: Map<string, Set<number>> = new Map(); // address -> Set<chainId> (chains with activity)
  private inactiveChainCount: Map<string, Map<number, number>> = new Map(); // address -> chainId -> consecutive no-activity checks

  /**
   * Start monitoring transfers for an address
   * Smart Chain Monitoring: Only monitors chains where user has activity
   * Initially monitors all chains, then stops monitoring inactive chains after 10 consecutive checks with no activity
   */
  async startMonitoring(address: string, initialChains?: number[]) {
    const normalizedAddress = address.toLowerCase();
    if (this.monitoringAddresses.has(normalizedAddress)) {
      return; // Already monitoring
    }

    this.monitoringAddresses.add(normalizedAddress);
    this.isRunning = true;

    // Supported chains for Alchemy Transfers API
    const supportedChains = initialChains || [1, 8453, 137, 42161, 100, 11155111, 84532];

    // Initialize active chains tracking
    this.activeChains.set(normalizedAddress, new Set(supportedChains));
    this.inactiveChainCount.set(normalizedAddress, new Map());

    // Start monitoring for each chain
    for (const chainId of supportedChains) {
      this.monitorChain(address, chainId);
    }

    console.log(`[TransfersService] Started monitoring transfers for ${address} on ${supportedChains.length} chains`);
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
    
    // Clear intervals for this address (all chains)
    const intervalsToDelete: string[] = [];
    for (const [key, interval] of this.monitoringIntervals.entries()) {
      if (key.startsWith(`${normalizedAddress}:`)) {
        clearInterval(interval);
        intervalsToDelete.push(key);
      }
    }
    intervalsToDelete.forEach(key => this.monitoringIntervals.delete(key));

    // Clear tracking data
    this.lastCheckedBlocks.delete(normalizedAddress);
    this.activeChains.delete(normalizedAddress);
    this.inactiveChainCount.delete(normalizedAddress);

    console.log(`[TransfersService] Stopped monitoring transfers for ${address}`);
  }

  /**
   * Monitor transfers for a specific address on a specific chain
   * OPTIMIZATION: Increased interval from 5 minutes to 10 minutes to further reduce Alchemy compute unit usage
   * Transactions don't change frequently, so checking every 10 minutes is sufficient
   */
  private monitorChain(address: string, chainId: number) {
    const normalizedAddress = address.toLowerCase();
    const intervalKey = `${normalizedAddress}:${chainId}`; // Include chainId in key for per-chain intervals

    // Check every 10 minutes for new transfers (optimized from 5 minutes)
    // This reduces API calls by 50% compared to 5-minute intervals
    const interval = setInterval(async () => {
      try {
        await this.checkTransfers(address, chainId);
      } catch (error) {
        console.error(`[TransfersService] Error checking transfers for ${address} on chain ${chainId}:`, error);
      }
    }, 10 * 60 * 1000); // 10 minutes (optimized from 5 minutes to reduce Alchemy compute units)

    this.monitoringIntervals.set(intervalKey, interval as unknown as number);

    // Initial check
    this.checkTransfers(address, chainId).catch(error => {
      console.error(`[TransfersService] Error in initial transfer check:`, error);
    });
  }

  /**
   * Check for new transfers for an address on a chain
   * Smart Chain Monitoring: Stops monitoring chains with no activity after 10 consecutive checks
   * Cache-First: Checks cache before making API calls
   */
  private async checkTransfers(address: string, chainId: number): Promise<void> {
    const normalizedAddress = address.toLowerCase();
    const alchemyRestUrl = getAlchemyRestUrl(chainId);
    const apiKey = getAlchemyApiKey();

    if (!alchemyRestUrl || !apiKey) {
      return; // Alchemy API not available for this chain
    }

    // Check if this chain is still active (smart chain monitoring)
    const activeChains = this.activeChains.get(normalizedAddress);
    if (activeChains && !activeChains.has(chainId)) {
      // Chain was marked inactive, skip check
      return;
    }

    try {
      // Cache-First Strategy: Check Redis cache for recent transfers
      const cacheService = await getRedisClient().then((client) => new CacheService(client));
      const cacheKey = `transfers:${chainId}:${normalizedAddress}`;
      const cached = await cacheService.get<{ transfers: any[]; blockNum: string; timestamp: number }>(cacheKey);
      
      // If cache is fresh (less than 1 minute old), use it
      if (cached && (Date.now() - cached.timestamp) < 60 * 1000) {
        // Cache hit - no API call needed
        return;
      }
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
          maxCount: 50, // Alchemy best practice: Keep batches under 50
          excludeZeroValue: false,
          category: categories,
        }
      );

      // Track compute units
      computeUnitTracker.logApiCall(
        'alchemy_getAssetTransfers',
        'fetchTransfers',
        { chainId, address: normalizedAddress, estimatedUnits: 40 }
      );

      // Cache the result
      if (transfers.length > 0) {
        await cacheService.set(
          cacheKey,
          { transfers, blockNum: transfers[transfers.length - 1].blockNum, timestamp: Date.now() },
          60 // 1 minute cache
        );
      }

      // Smart Chain Monitoring: Track activity
      if (transfers.length === 0) {
        // No activity - increment inactive count
        const inactiveCounts = this.inactiveChainCount.get(normalizedAddress) || new Map();
        const currentCount = inactiveCounts.get(chainId) || 0;
        inactiveCounts.set(chainId, currentCount + 1);
        this.inactiveChainCount.set(normalizedAddress, inactiveCounts);

        // Stop monitoring if inactive for 10 consecutive checks (100 minutes = ~1.67 hours)
        if (currentCount + 1 >= 10) {
          const active = this.activeChains.get(normalizedAddress);
          if (active) {
            active.delete(chainId);
            console.log(`[TransfersService] Stopped monitoring chain ${chainId} for ${address} (no activity)`);
            
            // Stop the interval for this chain
            const intervalKey = `${normalizedAddress}:${chainId}`;
            const interval = this.monitoringIntervals.get(intervalKey);
            if (interval) {
              clearInterval(interval);
              this.monitoringIntervals.delete(intervalKey);
            }
          }
        }
        return; // No new transfers
      } else {
        // Activity detected - reset inactive count and ensure chain is active
        const inactiveCounts = this.inactiveChainCount.get(normalizedAddress) || new Map();
        inactiveCounts.set(chainId, 0);
        this.inactiveChainCount.set(normalizedAddress, inactiveCounts);
        
        const active = this.activeChains.get(normalizedAddress);
        if (active) {
          active.add(chainId);
        }
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
      // Alchemy best practice: Keep batches under 50
      let maxCountNum: number = 50;
      if (options.maxCount !== undefined && options.maxCount !== null) {
        if (typeof options.maxCount === 'number') {
          // Cap at 50 per Alchemy best practices
          maxCountNum = options.maxCount > 0 ? Math.min(options.maxCount, 50) : 50;
        } else if (typeof options.maxCount === 'string') {
          // Handle string maxCount (defensive)
          const parsed = parseInt(options.maxCount, 10);
          maxCountNum = !isNaN(parsed) && parsed > 0 ? Math.min(parsed, 50) : 50;
        } else {
          console.warn(`[TransfersService] Invalid maxCount type: ${typeof options.maxCount}, using default 50`);
          maxCountNum = 50;
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
        withMetadata: true, // Request block timestamp metadata
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
          // Track compute units before making the call
          computeUnitTracker.logApiCall(
            'alchemy_getAssetTransfers',
            'fetchTransfers',
            { chainId, estimatedUnits: 40 }
          );

          const response = await fetch(alchemyRestUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept-Encoding': 'gzip', // Alchemy best practice: Use gzip compression
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
      // 'internal' category is only supported for ETH (1) and MATIC/Polygon (137) per Alchemy API
      const categories = ['external', 'erc20', 'erc721', 'erc1155'];
      // Only add 'internal' for Ethereum and Polygon
      if (chainId === 1 || chainId === 137) {
        categories.push('internal');
      }

      // OPTIMIZATION: Limit to last 30 days instead of scanning entire chain history
      // This dramatically reduces Alchemy compute unit usage
      // Calculate approximate block number from 30 days ago
      const recentBlockNumber = getRecentBlockNumber(chainId, 30);
      
      // Fetch transfers using Alchemy Transfers API
      // Using recent block number instead of '0x0' to reduce compute units
      const transfers = await this.fetchTransfers(chainId, address, {
        fromBlock: recentBlockNumber, // Use recent block instead of '0x0' to reduce compute units
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
