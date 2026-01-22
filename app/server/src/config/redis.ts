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
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  // Check if REDIS_URL is provided (common for cloud providers)
  const redisUrl = process.env.REDIS_URL;
  
  if (redisUrl) {
    // Parse Redis URL (format: redis://[:password@]host[:port][/database])
    // or rediss:// for TLS
    redisClient = createClient({
      url: redisUrl,
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
        // Enable TLS if using cloud providers that require it
        tls: process.env.REDIS_TLS === 'true',
      },
      password,
      database: db,
    });
  }

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  redisClient.on('connect', () => {
    console.log('✅ Redis Client Connected');
  });

  redisClient.on('disconnect', () => {
    console.log('⚠️ Redis Client Disconnected');
  });

  await redisClient.connect();

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
      const value = await this.client.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      console.error(`Error getting cache key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set cached value with TTL
   */
  async set(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    try {
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.error(`Error setting cache key ${key}:`, error);
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
      const count = await this.client.incr(key);
      if (ttlSeconds && count === 1) {
        // Set TTL only on first increment
        await this.client.expire(key, ttlSeconds);
      }
      return count;
    } catch (error) {
      console.error(`Error incrementing cache key ${key}:`, error);
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
  
  nftList: (chainId: number, address: string) =>
    `nft_list:${chainId}:${address.toLowerCase()}`,
  
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
