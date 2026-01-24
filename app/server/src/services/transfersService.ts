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
      const lastBlock = addressBlocks.get(chainId) || 'latest';

      // Fetch transfers using Alchemy Transfers API
      const transfers = await this.fetchTransfers(
        chainId,
        address,
        {
          fromBlock: lastBlock,
          toBlock: 'latest',
          maxCount: 100,
          excludeZeroValue: false,
          category: ['external', 'erc20', 'erc721', 'erc1155', 'internal'],
        }
      );

      if (transfers.length === 0) {
        return; // No new transfers
      }

      // Process new transfers
      for (const transfer of transfers) {
        await this.processTransfer(transfer, chainId, address);
      }

      // Update last checked block
      if (transfers.length > 0) {
        const latestBlock = transfers[transfers.length - 1].blockNum;
        if (!addressBlocks.has(chainId) || latestBlock > addressBlocks.get(chainId)!) {
          addressBlocks.set(chainId, latestBlock);
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
  private async fetchTransfers(
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
              category: options.category || ['external', 'erc20', 'erc721', 'erc1155', 'internal'],
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
    return this.fetchTransfers(chainId, address, {
      fromBlock: '0x0',
      toBlock: 'latest',
      maxCount: limit,
      excludeZeroValue: false,
      category: ['external', 'erc20', 'erc721', 'erc1155', 'internal'],
    });
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
