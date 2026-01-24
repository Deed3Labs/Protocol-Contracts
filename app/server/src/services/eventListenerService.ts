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
  private providers: Map<number, ethers.Provider> = new Map();
  private listeners: Map<number, any[]> = new Map();
  private isRunning = false;

  // Pre-define interfaces for performance and to handle different Transfer event formats
  private readonly erc721Interface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
  ]);
  private readonly erc20Interface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)'
  ]);

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
    const TESTNETS = [11155111, 84532];

    for (const [chainId, provider] of this.providers.entries()) {
      try {
        const transferTopic = ethers.id('Transfer(address,address,uint256)');
        const isTestnet = TESTNETS.includes(chainId);
        
        // Get our protocol contract addresses for this chain
        const protocolContracts = new Set<string>();
        const deedNFT = getContractAddress(chainId, 'DeedNFT');
        if (deedNFT) protocolContracts.add(deedNFT.toLowerCase());
        
        // On mainnets, ONLY listen to our protocol contracts to avoid overwhelming the server
        // On testnets, we can be broader as volume is low
        const filter: any = { topics: [transferTopic] };
        if (!isTestnet && protocolContracts.size > 0) {
          filter.address = Array.from(protocolContracts);
          console.log(`[EventListener] Scoped Transfer listener to protocol contracts on chain ${chainId}`);
        } else if (!isTestnet && protocolContracts.size === 0) {
          console.warn(`[EventListener] No protocol contracts for mainnet chain ${chainId}, skipping global listener`);
          continue;
        }

        provider.on(filter, async (log) => {
          try {
            // Early exit if this isn't a protocol contract AND it doesn't involve an active user
            const contractAddr = log.address.toLowerCase();
            const isProtocolContract = protocolContracts.has(contractAddr);
            
            // If it's not our contract, check if it's an active user
            // This prevents us from doing expensive parsing for random transfers on the network
            let activeAddresses: Set<string> | null = null;
            
            if (!isProtocolContract) {
              activeAddresses = websocketService.getActiveAddresses();
              // If we have no users online and it's not our contract, ignore
              if (activeAddresses.size === 0) return;
            }

            let from: string | undefined;
            let to: string | undefined;

            // Try to parse the log based on the number of topics
            if (log.topics.length === 4) {
              try {
                const parsed = this.erc721Interface.parseLog(log);
                if (parsed) {
                  from = parsed.args[0];
                  to = parsed.args[1];
                }
              } catch (e) {}
            } 
            
            if (!from && log.topics.length === 3) {
              try {
                const parsed = this.erc20Interface.parseLog(log);
                if (parsed) {
                  from = parsed.args[0];
                  to = parsed.args[1];
                }
              } catch (e) {}
            }

            // Fallback: raw address extraction
            if (!from && log.topics.length >= 3) {
              try {
                from = ethers.getAddress(ethers.dataSlice(log.topics[1], 12));
                to = ethers.getAddress(ethers.dataSlice(log.topics[2], 12));
              } catch (e) {}
            }

            if (from && to) {
              const fromLower = from.toLowerCase();
              const toLower = to.toLowerCase();

              // Only process if it involves our contract or an active user
              const isRelevant = isProtocolContract || 
                                (activeAddresses && (activeAddresses.has(fromLower) || activeAddresses.has(toLower)));

              if (!isRelevant) return;

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
            if (error instanceof Error && !error.message.includes('data out-of-bounds') && !error.message.includes('BUFFER_OVERRUN')) {
              console.warn(`[EventListener] Error processing Transfer event on chain ${chainId}:`, error.message);
            }
          }
        });

        if (isTestnet) {
          console.log(`[EventListener] Global Transfer listener started for testnet chain ${chainId}`);
        }
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
