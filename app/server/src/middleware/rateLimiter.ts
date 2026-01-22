import { Request, Response, NextFunction } from 'express';
import { getRedisClient, CacheService, CacheKeys } from '../config/redis.js';

const cacheServicePromise = getRedisClient().then((client) => new CacheService(client));

/**
 * Rate limiter middleware using Redis
 */
export async function rateLimiter(
  windowMs: number = 60000,
  maxRequests: number = 100
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cacheService = await cacheServicePromise;
      
      // Use IP address or user identifier
      // Handle x-forwarded-for which can be string or string[]
      const forwardedFor = req.headers['x-forwarded-for'];
      const forwardedIp = Array.isArray(forwardedFor) 
        ? forwardedFor[0] 
        : typeof forwardedFor === 'string' 
          ? forwardedFor.split(',')[0].trim() 
          : null;
      const identifier = req.ip || forwardedIp || 'unknown';
      const window = Math.floor(Date.now() / windowMs).toString();
      const key = CacheKeys.rateLimit(identifier, window);

      const count = await cacheService.incr(key, Math.ceil(windowMs / 1000));

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count).toString());
      res.setHeader('X-RateLimit-Reset', ((Math.floor(Date.now() / windowMs) + 1) * windowMs).toString());

      if (count > maxRequests) {
        return res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
          retryAfter: windowMs / 1000,
        });
      }

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      // On Redis error, allow request through (fail open)
      next();
    }
  };
}

/**
 * Per-endpoint rate limiter
 */
export function createRateLimiter(
  windowMs: number = 60000,
  maxRequests: number = 100
) {
  return rateLimiter(windowMs, maxRequests);
}
