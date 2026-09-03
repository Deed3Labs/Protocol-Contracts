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
      
      // req.ip is proxy-aware because app.set('trust proxy', 1) is enabled in index.ts.
      const identifier = req.ip || req.socket.remoteAddress || 'unknown';
      const scope = (process.env.RATE_LIMIT_SCOPE || 'path').trim().toLowerCase();
      const scopedIdentifier =
        scope === 'ip'
          ? identifier
          : `${identifier}:${req.method}:${(req.baseUrl || '')}${req.path || ''}`;
      const window = Math.floor(Date.now() / windowMs).toString();
      const key = CacheKeys.rateLimit(scopedIdentifier, window);

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
