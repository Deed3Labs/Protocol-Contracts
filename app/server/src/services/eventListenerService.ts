import { ethers } from 'ethers';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { websocketService } from './websocketService.js';
import { getRpcUrl } from '../utils/rpc.js';
import { createRetryProvider } from '../utils/rpcRetry.js';

/**
 * Service to listen for blockchain events and trigger real-time updates
 */
class EventListenerService {
  private providers: Map<number, ethers.Provider> = new Map();
  private listeners: Map<number, any[]> = new Map();
  private isRunning = false;

  // Supported chain IDs
  private readonly SUPPORTED_CHAINS = [1, 8453, 100, 11155111, 84532, 42161, 137];

  /**
   * Initialize event listeners for all supported chains
   */
  async initialize() {
    if (this.isRunning) {
      console.log('[EventListener] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[EventListener] Initializing blockchain event listeners...');

    // Initialize providers for each chain
    for (const chainId of this.SUPPORTED_CHAINS) {
      try {
        const rpcUrl = getRpcUrl(chainId);
        if (!rpcUrl) {
          console.warn(`[EventListener] No RPC URL for chain ${chainId}, skipping`);
          continue;
        }
        
        const provider = createRetryProvider(rpcUrl, chainId);
        this.providers.set(chainId, provider);
        console.log(`[EventListener] Provider initialized for chain ${chainId}`);
      } catch (error) {
        console.error(`[EventListener] Failed to initialize provider for chain ${chainId}:`, error);
      }
    }

    // Start listening for Transfer events (affects balances and NFTs)
    this.startTransferListeners();

    console.log('[EventListener] Event listeners initialized');
  }

  /**
   * Listen for Transfer events on ERC20 and ERC721 contracts
   */
  private startTransferListeners() {
    for (const [chainId, provider] of this.providers.entries()) {
      try {
        // Listen for Transfer events (ERC20 and ERC721)
        const transferTopic = ethers.id('Transfer(address,address,uint256)');
        
        provider.on({
          topics: [transferTopic]
        }, async (log) => {
          try {
            // Parse the event
            const iface = new ethers.Interface([
              'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
            ]);
            
            const parsed = iface.parseLog({
              topics: log.topics,
              data: log.data
            });

            if (parsed) {
              const from = parsed.args[0];
              const to = parsed.args[1];
              
              // Invalidate cache for affected addresses
              await this.invalidateCacheForAddress(chainId, from);
              await this.invalidateCacheForAddress(chainId, to);
              
              // Broadcast update via WebSocket
              await websocketService.broadcastToAddress(from, 'balance_update', {
                chainId,
                address: from,
                timestamp: Date.now()
              });
              
              await websocketService.broadcastToAddress(to, 'balance_update', {
                chainId,
                address: to,
                timestamp: Date.now()
              });
            }
          } catch (error) {
            // Ignore parsing errors
            console.warn(`[EventListener] Error parsing Transfer event:`, error);
          }
        });

        console.log(`[EventListener] Transfer listener started for chain ${chainId}`);
      } catch (error) {
        console.error(`[EventListener] Failed to start Transfer listener for chain ${chainId}:`, error);
      }
    }
  }

  /**
   * Invalidate cache for an address after a transaction
   */
  private async invalidateCacheForAddress(chainId: number, address: string) {
    try {
      const cacheService = await getRedisClient().then((client) => new CacheService(client));
      
      // Invalidate balance cache
      const balanceKey = CacheKeys.balance(chainId, address.toLowerCase());
      await cacheService.del(balanceKey);
      
      // Invalidate NFT cache
      const nftKey = CacheKeys.nftList(chainId, address.toLowerCase());
      await cacheService.del(nftKey);
      
      // Invalidate transaction cache
      const txKey = CacheKeys.transactions(chainId, address.toLowerCase(), 20);
      await cacheService.del(txKey);
      
      console.log(`[EventListener] Cache invalidated for ${address} on chain ${chainId}`);
    } catch (error) {
      console.error(`[EventListener] Error invalidating cache:`, error);
    }
  }

  /**
   * Cleanup all listeners
   */
  cleanup() {
    this.isRunning = false;
    
    for (const [chainId, provider] of this.providers.entries()) {
      try {
        provider.removeAllListeners();
        console.log(`[EventListener] Removed listeners for chain ${chainId}`);
      } catch (error) {
        console.error(`[EventListener] Error removing listeners for chain ${chainId}:`, error);
      }
    }
    
    this.providers.clear();
    this.listeners.clear();
  }
}

// Singleton instance
export const eventListenerService = new EventListenerService();
