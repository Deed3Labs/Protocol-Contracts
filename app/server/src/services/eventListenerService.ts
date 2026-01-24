import { ethers } from 'ethers';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { websocketService } from './websocketService.js';
import { getRpcUrl } from '../utils/rpc.js';
import { createRetryProvider } from '../utils/rpcRetry.js';
import { getContractAddress } from '../config/contracts.js';

/**
 * Service to listen for blockchain events and trigger real-time updates
 */
class EventListenerService {
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private isRunning = false;
  private restartTimeouts: Map<number, number> = new Map();

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

    // Initialize providers and listeners for each chain
    for (const chainId of this.SUPPORTED_CHAINS) {
      await this.initChain(chainId);
    }

    console.log('[EventListener] Event listeners initialized');
  }

  /**
   * Initialize a specific chain's provider and listeners
   */
  private async initChain(chainId: number) {
    try {
      const rpcUrl = getRpcUrl(chainId);
      if (!rpcUrl) {
        console.warn(`[EventListener] No RPC URL for chain ${chainId}, skipping`);
        return;
      }
      
      const provider = createRetryProvider(rpcUrl, chainId);
      
      // Handle provider errors (like "filter not found")
      provider.on('error', (error) => {
        console.error(`[EventListener] Provider error on chain ${chainId}:`, error.message);
        if (error.message.includes('filter not found') || error.message.includes('timeout') || error.message.includes('400')) {
          this.scheduleRestart(chainId);
        }
      });

      this.providers.set(chainId, provider);
      this.startTransferListener(chainId, provider);
      console.log(`[EventListener] Provider and listeners initialized for chain ${chainId}`);
    } catch (error) {
      console.error(`[EventListener] Failed to initialize chain ${chainId}:`, error);
      this.scheduleRestart(chainId);
    }
  }

  /**
   * Schedule a restart for a chain's listeners
   */
  private scheduleRestart(chainId: number) {
    if (!this.isRunning) return;

    if (this.restartTimeouts.has(chainId)) {
      clearTimeout(this.restartTimeouts.get(chainId));
    }

    console.log(`[EventListener] Scheduling restart for chain ${chainId} in 10s...`);
    const timeout = setTimeout(() => {
      this.restartTimeouts.delete(chainId);
      this.initChain(chainId);
    }, 10000);
    
    this.restartTimeouts.set(chainId, timeout as unknown as number);
  }

  /**
   * Listen for Transfer events on a specific chain
   */
  private startTransferListener(chainId: number, provider: ethers.JsonRpcProvider) {
    try {
      const transferTopic = ethers.id('Transfer(address,address,uint256)');
      
      // Get our protocol contract addresses for this chain
      const protocolContracts = new Set<string>();
      const deedNFT = getContractAddress(chainId, 'DeedNFT');
      if (deedNFT) protocolContracts.add(deedNFT.toLowerCase());
      
      if (protocolContracts.size === 0) {
        console.warn(`[EventListener] No protocol contracts for chain ${chainId}, skipping Transfer listener`);
        return;
      }

      const filter = {
        topics: [transferTopic],
        address: Array.from(protocolContracts)
      };

      console.log(`[EventListener] Starting Transfer listener for protocol contracts on chain ${chainId}`);
      
      provider.on(filter, async (log) => {
        try {
          const fromLower = ethers.dataSlice(log.topics[1], 12).toLowerCase();
          const toLower = ethers.dataSlice(log.topics[2], 12).toLowerCase();
          
          const from = ethers.getAddress(fromLower);
          const to = ethers.getAddress(toLower);

          await this.invalidateCacheForAddress(chainId, from);
          await this.invalidateCacheForAddress(chainId, to);
          
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
        } catch (error) {
          if (error instanceof Error && !error.message.includes('data out-of-bounds') && !error.message.includes('BUFFER_OVERRUN')) {
            console.warn(`[EventListener] Error processing Transfer event on chain ${chainId}:`, error.message);
          }
        }
      });
    } catch (error) {
      console.error(`[EventListener] Failed to start Transfer listener for chain ${chainId}:`, error);
      this.scheduleRestart(chainId);
    }
  }

  /**
   * Invalidate cache for an address after a transaction
   */
  private async invalidateCacheForAddress(chainId: number, address: string) {
    try {
      const cacheService = await getRedisClient().then((client) => new CacheService(client));
      
      const balanceKey = CacheKeys.balance(chainId, address.toLowerCase());
      await cacheService.del(balanceKey);
      
      const nftKey = CacheKeys.nftList(chainId, address.toLowerCase());
      await cacheService.del(nftKey);
      
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
    
    for (const timeout of this.restartTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.restartTimeouts.clear();

    for (const [chainId, provider] of this.providers.entries()) {
      try {
        provider.removeAllListeners();
        console.log(`[EventListener] Removed listeners for chain ${chainId}`);
      } catch (error) {
        console.error(`[EventListener] Error removing listeners for chain ${chainId}:`, error);
      }
    }
    
    this.providers.clear();
  }
}

// Singleton instance
export const eventListenerService = new EventListenerService();
