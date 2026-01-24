import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';
import { getBalance } from './balanceService.js';
import { getDeedNFTs } from './nftService.js';
import { getTransactions } from './transactionService.js';
import { getUniswapPrice, getCoinbasePrice, getCoinGeckoPrice } from './priceService.js';

interface ClientSubscription {
  address: string;
  chainIds: number[];
  subscriptions: string[]; // 'balances', 'nfts', 'transactions', 'prices'
}

class WebSocketService {
  private io: SocketIOServer | null = null;
  private clients: Map<string, ClientSubscription> = new Map();
  private priceUpdateInterval: NodeJS.Timeout | null = null;

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
        
        // Send initial data
        await this.sendInitialData(socket, address, chainIds, subscriptions);
      });

      // Unsubscribe
      socket.on('unsubscribe', () => {
        this.clients.delete(socket.id);
        console.log(`[WebSocket] Client ${socket.id} unsubscribed`);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
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
   */
  private startPeriodicUpdates() {
    // Update every 30 seconds
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

          if (subscription.subscriptions.includes('nfts')) {
            const nfts = await this.fetchNFTs(
              subscription.address,
              subscription.chainIds,
              cacheService
            );
            socket.emit('nfts', nfts);
          }

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
    }, 30000); // 30 seconds

    // Update prices every 1 minute
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
    }, 60000); // 1 minute
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
            const cacheTTL = parseInt(process.env.CACHE_TTL_BALANCE || '10', 10);
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
          const cacheTTL = parseInt(process.env.CACHE_TTL_NFT || '600', 10);
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
          const result = await getTransactions(chainId, address, 20);
          const cacheTTL = parseInt(process.env.CACHE_TTL_TRANSACTION || '60', 10);
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
          // Fetch fresh price
          let price: number | null = null;
          
          try {
            price = await getUniswapPrice(chainId, tokenAddress);
          } catch (error) {
            try {
              price = await getCoinbasePrice(chainId, tokenAddress);
            } catch (error) {
              try {
                price = await getCoinGeckoPrice(chainId, tokenAddress);
              } catch (error) {
                console.error(`Error fetching price for ${tokenAddress}:`, error);
              }
            }
          }
          
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
