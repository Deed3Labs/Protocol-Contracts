import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getBalance } from './balanceService.js';
import { getDeedNFTs } from './nftService.js';
import { getTokenPrice } from './priceService.js';
import { transfersService } from './transfersService.js';
import { getClrUsdAddressesByChain } from '../config/contracts.js';

interface ClientSubscription {
  address: string;
  chainIds: number[];
  subscriptions: string[]; // 'balances', 'nfts', 'transactions', 'prices'
}

class WebSocketService {
  private io: SocketIOServer | null = null;
  private clients: Map<string, ClientSubscription> = new Map();
  private priceUpdateInterval: number | null = null;

  /**
   * Initialize WebSocket server
   */
  initialize(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN?.split(',') || '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.io.on('connection', (socket: Socket) => {
      console.log(`[WebSocket] Client connected: ${socket.id}`);

      // Subscribe to updates
      socket.on('subscribe', async (data: { address: string; chainIds?: number[]; subscriptions?: string[] }) => {
        const { address, chainIds = [], subscriptions = ['balances', 'nfts', 'transactions'] } = data;
        
        this.clients.set(socket.id, {
          address: address.toLowerCase(),
          chainIds: chainIds.length > 0 ? chainIds : [1, 8453, 100, 11155111], // Default chains
          subscriptions,
        });

        console.log(`[WebSocket] Client ${socket.id} subscribed to ${address} on chains ${chainIds.join(', ')}`);
        
        // OPTIMIZATION: Only monitor chains the user actually uses, not all 7 chains
        // This dramatically reduces Alchemy compute unit usage
        // Start monitoring transfers for this address (using Alchemy Transfers API)
        // Pass the actual chainIds the user is subscribed to, not all chains
        const chainsToMonitor = chainIds.length > 0 ? chainIds : [1, 8453, 100, 11155111]; // Use subscribed chains or defaults
        transfersService.startMonitoring(address, chainsToMonitor).catch(error => {
          console.error(`[WebSocket] Failed to start transfer monitoring for ${address}:`, error);
        });
        
        // Send initial data
        await this.sendInitialData(socket, address, chainIds, subscriptions);
      });

      // Unsubscribe
      socket.on('unsubscribe', () => {
        const subscription = this.clients.get(socket.id);
        if (subscription) {
          // Check if any other clients are monitoring this address
          const otherClientsMonitoring = Array.from(this.clients.values())
            .some(sub => sub.address === subscription.address && sub !== subscription);
          
          // Only stop monitoring if no other clients are monitoring this address
          if (!otherClientsMonitoring) {
            transfersService.stopMonitoring(subscription.address);
          }
        }
        
        this.clients.delete(socket.id);
        console.log(`[WebSocket] Client ${socket.id} unsubscribed`);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        const subscription = this.clients.get(socket.id);
        if (subscription) {
          // Check if any other clients are monitoring this address
          const otherClientsMonitoring = Array.from(this.clients.values())
            .some(sub => sub.address === subscription.address && sub !== subscription);
          
          // Only stop monitoring if no other clients are monitoring this address
          if (!otherClientsMonitoring) {
            transfersService.stopMonitoring(subscription.address);
          }
        }
        
        this.clients.delete(socket.id);
        console.log(`[WebSocket] Client disconnected: ${socket.id}`);
      });
    });

    // Start periodic updates
    this.startPeriodicUpdates();

    console.log('✅ WebSocket server initialized');
  }

  /**
   * Send initial data to newly connected client
   */
  private async sendInitialData(
    socket: Socket,
    address: string,
    chainIds: number[],
    subscriptions: string[]
  ) {
    try {
      const cacheService = await getRedisClient().then((client) => new CacheService(client));

      if (subscriptions.includes('balances')) {
        const balances = await this.fetchBalances(address, chainIds, cacheService);
        socket.emit('balances', balances);
      }

      if (subscriptions.includes('nfts')) {
        const nfts = await this.fetchNFTs(address, chainIds, cacheService);
        socket.emit('nfts', nfts);
      }

      if (subscriptions.includes('transactions')) {
        const transactions = await this.fetchTransactions(address, chainIds, cacheService);
        socket.emit('transactions', transactions);
      }

      if (subscriptions.includes('prices')) {
        const prices = await this.fetchPrices(chainIds, cacheService);
        socket.emit('prices', prices);
      }
    } catch (error) {
      console.error('[WebSocket] Error sending initial data:', error);
    }
  }

  /**
   * Start periodic updates for all connected clients
   * Optimized: Increased intervals to reduce Alchemy compute unit usage
   * - Balances/transactions: 2 minutes (was 30 seconds)
   * - NFTs: 5 minutes (already optimized)
   * - Prices: 5 minutes (was 1 minute)
   */
  private startPeriodicUpdates() {
    // OPTIMIZATION: Increased intervals to reduce Alchemy compute unit usage
    // Update balances every 5 minutes (optimized from 2 minutes)
    setInterval(async () => {
      if (!this.io || this.clients.size === 0) return;

      const cacheService = await getRedisClient().then((client) => new CacheService(client));

      for (const [socketId, subscription] of this.clients.entries()) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket || !socket.connected) {
          this.clients.delete(socketId);
          continue;
        }

        try {
          if (subscription.subscriptions.includes('balances')) {
            const balances = await this.fetchBalances(
              subscription.address,
              subscription.chainIds,
              cacheService
            );
            socket.emit('balances', balances);
          }
        } catch (error) {
          console.error(`[WebSocket] Error updating client ${socketId}:`, error);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes for balances (optimized from 2 minutes)

    // Update transactions every 10 minutes (optimized from 2 minutes)
    // Transactions change less frequently than balances, so we can poll less often
    setInterval(async () => {
      if (!this.io || this.clients.size === 0) return;

      const cacheService = await getRedisClient().then((client) => new CacheService(client));

      for (const [socketId, subscription] of this.clients.entries()) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket || !socket.connected) {
          this.clients.delete(socketId);
          continue;
        }

        try {
          if (subscription.subscriptions.includes('transactions')) {
            const transactions = await this.fetchTransactions(
              subscription.address,
              subscription.chainIds,
              cacheService
            );
            socket.emit('transactions', transactions);
          }
        } catch (error) {
          console.error(`[WebSocket] Error updating client ${socketId}:`, error);
        }
      }
    }, 10 * 60 * 1000); // 10 minutes for transactions (optimized from 2 minutes to reduce Alchemy compute units)

    // Update NFTs every 5 minutes (reduced from 30 seconds to save Alchemy compute units)
    // NFTs change less frequently and are expensive to fetch
    setInterval(async () => {
      if (!this.io || this.clients.size === 0) return;

      const cacheService = await getRedisClient().then((client) => new CacheService(client));

      for (const [socketId, subscription] of this.clients.entries()) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket || !socket.connected) {
          this.clients.delete(socketId);
          continue;
        }

        try {
          if (subscription.subscriptions.includes('nfts')) {
            const nfts = await this.fetchNFTs(
              subscription.address,
              subscription.chainIds,
              cacheService
            );
            socket.emit('nfts', nfts);
          }
        } catch (error) {
          console.error(`[WebSocket] Error updating NFTs for client ${socketId}:`, error);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes for NFTs

    // Update prices every 5 minutes (optimized from 1 minute to reduce Alchemy compute units)
    this.priceUpdateInterval = setInterval(async () => {
      if (!this.io || this.clients.size === 0) return;

      const cacheService = await getRedisClient().then((client) => new CacheService(client));
      const allChainIds = new Set<number>();
      
      for (const subscription of this.clients.values()) {
        subscription.chainIds.forEach(chainId => allChainIds.add(chainId));
      }

      if (allChainIds.size > 0) {
        const prices = await this.fetchPrices(Array.from(allChainIds), cacheService);
        
        // Broadcast to all clients subscribed to prices
        for (const [socketId, subscription] of this.clients.entries()) {
          if (subscription.subscriptions.includes('prices')) {
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket && socket.connected) {
              socket.emit('prices', prices);
            }
          }
        }
      }
    }, 5 * 60 * 1000) as unknown as number; // 5 minutes (optimized from 1 minute to reduce Alchemy compute units)
  }

  /**
   * Fetch balances for address across chains
   */
  private async fetchBalances(
    address: string,
    chainIds: number[],
    cacheService: CacheService
  ) {
    const balances = [];
    
    for (const chainId of chainIds) {
      try {
        const cacheKey = CacheKeys.balance(chainId, address);
        const cached = await cacheService.get<{ balance: string; balanceWei: string; timestamp: number }>(cacheKey);
        
        if (cached) {
          balances.push({
            chainId,
            balance: cached.balance,
            balanceWei: cached.balanceWei,
            cached: true,
            timestamp: cached.timestamp,
          });
        } else {
          const result = await getBalance(chainId, address);
          if (result) {
            // OPTIMIZATION: Increased cache TTL to 5 minutes (300s) to align with WebSocket balance update interval
            const cacheTTL = parseInt(process.env.CACHE_TTL_BALANCE || '300', 10);
            await cacheService.set(
              cacheKey,
              { balance: result.balance, balanceWei: result.balanceWei, timestamp: Date.now() },
              cacheTTL
            );
            balances.push({
              chainId,
              balance: result.balance,
              balanceWei: result.balanceWei,
              cached: false,
              timestamp: Date.now(),
            });
          }
        }
      } catch (error) {
        console.error(`[WebSocket] Error fetching balance for chain ${chainId}:`, error);
      }
    }
    
    return balances;
  }

  /**
   * Fetch NFTs for address across chains
   */
  private async fetchNFTs(
    address: string,
    chainIds: number[],
    cacheService: CacheService
  ) {
    const nfts = [];
    
    for (const chainId of chainIds) {
      try {
        const cacheKey = CacheKeys.nftList(chainId, address);
        const cached = await cacheService.get<{ nfts: any[]; timestamp: number }>(cacheKey);
        
        if (cached) {
          nfts.push({
            chainId,
            nfts: cached.nfts,
            cached: true,
            timestamp: cached.timestamp,
          });
        } else {
          const result = await getDeedNFTs(chainId, address);
          const cacheTTL = parseInt(process.env.CACHE_TTL_NFT || '1800', 10);
          await cacheService.set(
            cacheKey,
            { nfts: result, timestamp: Date.now() },
            cacheTTL
          );
          nfts.push({
            chainId,
            nfts: result,
            cached: false,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        console.error(`[WebSocket] Error fetching NFTs for chain ${chainId}:`, error);
      }
    }
    
    return nfts;
  }

  /**
   * Fetch transactions for address across chains
   */
  private async fetchTransactions(
    address: string,
    chainIds: number[],
    cacheService: CacheService
  ) {
    const transactions = [];
    
    for (const chainId of chainIds) {
      try {
        const cacheKey = CacheKeys.transactions(chainId, address, 20);
        const cached = await cacheService.get<{ transactions: any[]; timestamp: number }>(cacheKey);
        
        if (cached) {
          transactions.push({
            chainId,
            transactions: cached.transactions,
            cached: true,
            timestamp: cached.timestamp,
          });
        } else {
          const result = await transfersService.getTransactions(chainId, address, 20);
          // OPTIMIZATION: Increased cache TTL to 10 minutes (600s) to align with refresh intervals
          // This matches the transaction update interval and reduces Alchemy compute unit usage
          const cacheTTL = parseInt(process.env.CACHE_TTL_TRANSACTION || '600', 10);
          await cacheService.set(
            cacheKey,
            { transactions: result, timestamp: Date.now() },
            cacheTTL
          );
          transactions.push({
            chainId,
            transactions: result,
            cached: false,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        console.error(`[WebSocket] Error fetching transactions for chain ${chainId}:`, error);
      }
    }
    
    return transactions;
  }

  /**
   * Fetch prices for tokens on specified chains
   */
  private async fetchPrices(chainIds: number[], cacheService: CacheService) {
    // Popular tokens to fetch prices for
    const tokens = [
      { chainId: 1, tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }, // WETH
      { chainId: 8453, tokenAddress: '0x4200000000000000000000000000000000000006' }, // WETH Base
      { chainId: 1, tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, // USDC
      { chainId: 8453, tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }, // USDC Base
      ...getClrUsdAddressesByChain(),
    ];

    const prices = [];
    
    for (const { chainId, tokenAddress } of tokens) {
      if (!chainIds.includes(chainId)) continue;
      
      try {
        const cacheKey = CacheKeys.tokenPrice(chainId, tokenAddress);
        const cached = await cacheService.get<{ price: number; timestamp: number }>(cacheKey);
        
        if (cached) {
          prices.push({
            chainId,
            tokenAddress,
            price: cached.price,
            cached: true,
            timestamp: cached.timestamp,
          });
        } else {
          // Fetch fresh price using Alchemy Prices API
          const price = await getTokenPrice(chainId, tokenAddress);
          
          if (price && price > 0) {
            const cacheTTL = parseInt(process.env.CACHE_TTL_PRICE || '300', 10);
            await cacheService.set(
              cacheKey,
              { price, timestamp: Date.now() },
              cacheTTL
            );
            prices.push({
              chainId,
              tokenAddress,
              price,
              cached: false,
              timestamp: Date.now(),
            });
          }
        }
      } catch (error) {
        console.error(`[WebSocket] Error fetching price for ${tokenAddress}:`, error);
      }
    }
    
    return prices;
  }

  /**
   * Broadcast update to specific address (for event-driven updates)
   */
  async broadcastToAddress(address: string, event: string, data: any) {
    if (!this.io) return;

    for (const [socketId, subscription] of this.clients.entries()) {
      if (subscription.address.toLowerCase() === address.toLowerCase()) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
          socket.emit(event, data);
        }
      }
    }
  }

  /**
   * Broadcast price update to all clients
   */
  async broadcastPriceUpdate(chainId: number, tokenAddress: string, price: number) {
    if (!this.io) return;

    const data = {
      chainId,
      tokenAddress,
      price,
      timestamp: Date.now(),
    };

    this.io.emit('price_update', data);
  }

  /**
   * Get all unique addresses currently connected
   */
  getActiveAddresses(): Set<string> {
    const addresses = new Set<string>();
    for (const subscription of this.clients.values()) {
      addresses.add(subscription.address.toLowerCase());
    }
    return addresses;
  }

  /**
   * Cleanup
   */
  cleanup() {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }
    if (this.io) {
      this.io.close();
    }
  }
}

// Singleton instance
export const websocketService = new WebSocketService();
