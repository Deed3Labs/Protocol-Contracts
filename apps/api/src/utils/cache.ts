import { CacheService, getRedisClient } from '../config/redis.js';

let cacheServicePromise: Promise<CacheService | null> | null = null;

/**
 * Returns a cache service when Redis is available, otherwise null.
 * This keeps API routes functional when Redis is temporarily unavailable.
 */
export async function getCacheServiceSafe(): Promise<CacheService | null> {
  if (cacheServicePromise !== null) {
    return cacheServicePromise;
  }

  cacheServicePromise = getRedisClient()
    .then((client) => new CacheService(client))
    .catch((error) => {
      console.warn('Redis unavailable - continuing without cache');
      return null;
    });

  return cacheServicePromise;
}
