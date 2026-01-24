import { createClient, RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

let redisClient: RedisClientType | null = null;

/**
 * Get or create Redis client (singleton pattern)
 * Supports:
 * - REDIS_URL (for cloud providers like Upstash, Redis Cloud)
 * - REDIS_HOST + REDIS_PORT (for traditional Redis)
 */
export async function getRedisClient(): Promise<RedisClientType> {
  // If client exists and is connected, return it
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  // If client exists but is closed, clean it up
  if (redisClient && !redisClient.isOpen) {
    try {
      await redisClient.quit().catch(() => {});
    } catch (e) {
      // Ignore errors during cleanup
    }
    redisClient = null;
  }

  // Check if REDIS_URL is provided (common for cloud providers)
  const redisUrl = process.env.REDIS_URL;
  
  if (redisUrl) {
    // For Upstash and other cloud providers, ensure TLS is enabled
    // Upstash URLs are typically: redis://default:password@host:6379
    // But they require TLS, so we need to configure it properly
    let urlObj: URL;
    try {
      urlObj = new URL(redisUrl);
    } catch (e) {
      throw new Error(`Invalid REDIS_URL format: ${redisUrl}`);
    }
    
    const isSecure = urlObj.protocol === 'rediss:' || urlObj.port === '6380';
    const isUpstash = urlObj.hostname.includes('upstash.io');
    
    // Upstash requires TLS even with redis:// protocol
    // Convert redis:// to rediss:// for Upstash if needed
    let finalUrl = redisUrl;
    if (isUpstash && urlObj.protocol === 'redis:') {
      finalUrl = redisUrl.replace('redis://', 'rediss://');
      console.log('Upstash detected: Converting to TLS connection (rediss://)');
    }
    
    redisClient = createClient({
      url: finalUrl,
      socket: {
        // Enable TLS for Upstash and secure connections
        tls: isSecure || isUpstash,
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            console.error('Redis: Max reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          // Exponential backoff: 50ms, 100ms, 200ms, 400ms, etc.
          const delay = Math.min(50 * Math.pow(2, retries), 3000);
          if (retries < 3) { // Only log first few attempts
            console.log(`Redis: Reconnecting in ${delay}ms (attempt ${retries + 1})`);
          }
          return delay;
        },
        keepAlive: 30000, // Send keepalive every 30 seconds
      },
    });
  } else {
    // Fallback to individual host/port configuration
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    const db = parseInt(process.env.REDIS_DB || '0', 10);

    redisClient = createClient({
      socket: {
        host,
        port,
        tls: process.env.REDIS_TLS === 'true',
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            return new Error('Max reconnection attempts reached');
          }
          return Math.min(50 * Math.pow(2, retries), 3000);
        },
        keepAlive: 30000,
      },
      password,
      database: db,
    });
  }

  // Error handler - don't crash on errors, just log
  redisClient.on('error', (err) => {
    // Only log if it's not a connection error (those are handled by reconnect)
    if (!err.message.includes('Socket closed') && !err.message.includes('ECONNREFUSED')) {
      console.error('Redis Client Error:', err.message);
    }
  });

  redisClient.on('connect', () => {
    console.log('✅ Redis Client Connected');
  });

  redisClient.on('ready', () => {
    console.log('✅ Redis Client Ready');
  });

  redisClient.on('reconnecting', () => {
    console.log('🔄 Redis Client Reconnecting...');
  });

  redisClient.on('end', () => {
    console.log('⚠️ Redis Client Connection Ended');
  });

  // Connect with retry logic
  try {
    await redisClient.connect();
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    // Don't throw - let the app continue without Redis
    // The health check will show redis as disconnected
    throw error;
  }

  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Cache helper functions
 */
export class CacheService {
  private client: RedisClientType;

  constructor(client: RedisClientType) {
    this.client = client;
  }

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      // Check if client is connected
      if (!this.client.isOpen) {
        return null;
      }
      const value = await this.client.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error: any) {
      // Silently fail if connection is closed (will retry on next request)
      if (error?.message?.includes('Socket closed') || error?.message?.includes('Connection')) {
        return null;
      }
      console.error(`Error getting cache key ${key}:`, error?.message || error);
      return null;
    }
  }

  /**
   * Set cached value with TTL
   */
  async set(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    try {
      // Check if client is connected
      if (!this.client.isOpen) {
        return;
      }
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (error: any) {
      // Silently fail if connection is closed (will retry on next request)
      if (error?.message?.includes('Socket closed') || error?.message?.includes('Connection')) {
        return;
      }
      console.error(`Error setting cache key ${key}:`, error?.message || error);
    }
  }

  /**
   * Delete cached value
   */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      console.error(`Error deleting cache key ${key}:`, error);
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Error checking cache key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get multiple keys
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await this.client.mGet(keys);
      return values.map((v) => (v ? (JSON.parse(v) as T) : null));
    } catch (error) {
      console.error(`Error getting multiple cache keys:`, error);
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple key-value pairs
   */
  async mset(
    keyValuePairs: Array<{ key: string; value: any; ttl?: number }>
  ): Promise<void> {
    try {
      const pipeline = this.client.multi();
      for (const { key, value, ttl = 300 } of keyValuePairs) {
        pipeline.setEx(key, ttl, JSON.stringify(value));
      }
      await pipeline.exec();
    } catch (error) {
      console.error(`Error setting multiple cache keys:`, error);
    }
  }

  /**
   * Increment a counter (useful for rate limiting)
   */
  async incr(key: string, ttlSeconds?: number): Promise<number> {
    try {
      // Check if client is connected
      if (!this.client.isOpen) {
        return 0; // Fail open for rate limiting
      }
      const count = await this.client.incr(key);
      if (ttlSeconds && count === 1) {
        // Set TTL only on first increment
        await this.client.expire(key, ttlSeconds);
      }
      return count;
    } catch (error: any) {
      // Fail open for rate limiting - allow request through if Redis is down
      if (error?.message?.includes('Socket closed') || error?.message?.includes('Connection')) {
        return 0;
      }
      console.error(`Error incrementing cache key ${key}:`, error?.message || error);
      return 0;
    }
  }

  /**
   * Get TTL for a key
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error(`Error getting TTL for key ${key}:`, error);
      return -1;
    }
  }
}

/**
 * Cache key generators
 */
export const CacheKeys = {
  // Token prices
  tokenPrice: (chainId: number, tokenAddress: string) =>
    `price:${chainId}:${tokenAddress.toLowerCase()}`,
  
  // Balances
  balance: (chainId: number, address: string) =>
    `balance:${chainId}:${address.toLowerCase()}`,
  
  tokenBalance: (chainId: number, address: string, tokenAddress: string) =>
    `token_balance:${chainId}:${address.toLowerCase()}:${tokenAddress.toLowerCase()}`,
  
  // NFTs
  nft: (chainId: number, contractAddress: string, tokenId: string) =>
    `nft:${chainId}:${contractAddress.toLowerCase()}:${tokenId}`,
  
  nftList: (chainId: number, address: string, contractAddress?: string) =>
    contractAddress
      ? `nft_list:${chainId}:${address.toLowerCase()}:${contractAddress.toLowerCase()}`
      : `nft_list:${chainId}:${address.toLowerCase()}`,
  
  // Transactions
  transactions: (chainId: number, address: string, limit: number) =>
    `transactions:${chainId}:${address.toLowerCase()}:${limit}`,
  
  // RPC calls
  rpcCall: (chainId: number, method: string, params: string) =>
    `rpc:${chainId}:${method}:${params}`,
  
  // Rate limiting
  rateLimit: (identifier: string, window: string) =>
    `ratelimit:${identifier}:${window}`,
};
