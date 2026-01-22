import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import { getRedisClient, closeRedisConnection } from './config/redis.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import pricesRouter from './routes/prices.js';
import balancesRouter from './routes/balances.js';
import tokenBalancesRouter from './routes/tokenBalances.js';
import nftsRouter from './routes/nfts.js';
import transactionsRouter from './routes/transactions.js';
import { startPriceUpdater } from './jobs/priceUpdater.js';

dotenv.config();

const app = express();
const PORT: number = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(compression());

// CORS configuration - handle Vercel preview URLs
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : ['*'];
    
    // If '*' is specified, allow all origins
    if (allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    // Check if origin matches any allowed origin
    // Also allow Vercel preview URLs (pattern: *.vercel.app)
    const isVercelPreview = origin.endsWith('.vercel.app');
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        // Handle wildcard patterns like https://*.vercel.app
        const pattern = allowed.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(origin);
      }
      return origin === allowed;
    });
    
    if (isAllowed || isVercelPreview) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check (before rate limiter so it's always accessible)
app.get('/health', async (req: express.Request, res: express.Response) => {
  try {
    let isRedisConnected = false;
    try {
      const redisClient = await getRedisClient();
      isRedisConnected = redisClient.isOpen;
    } catch (redisError) {
      // Redis connection failed, but server is still running
      console.error('Redis health check failed:', redisError);
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      redis: isRedisConnected ? 'connected' : 'disconnected',
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// API Routes will be set up in startServer after rate limiter is initialized

// 404 handler
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.path} not found`,
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
  });
});

// Start server
async function startServer() {
  try {
    // Try to initialize Redis connection (non-blocking)
    getRedisClient()
      .then(() => {
        console.log('✅ Redis connection established');
      })
      .catch((error) => {
        console.error('⚠️ Redis connection failed (server will continue without cache):', error);
      });

    // Set up rate limiter middleware (will work even if Redis fails)
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
    const rateLimiterMiddleware = await rateLimiter(windowMs, maxRequests);
    
    // Add rate limiter to all API routes
    app.use('/api', rateLimiterMiddleware);

    // Set up API routes (after rate limiter)
    app.use('/api/prices', pricesRouter);
    app.use('/api/balances', balancesRouter);
    app.use('/api/token-balances', tokenBalancesRouter);
    app.use('/api/nfts', nftsRouter);
    app.use('/api/transactions', transactionsRouter);

    // Start background jobs (non-blocking)
    startPriceUpdater().catch((error) => {
      console.error('⚠️ Background jobs failed to start:', error);
    });

    // Start Express server
    // Bind to 0.0.0.0 to accept connections from Railway/external hosts
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 CORS enabled for: ${process.env.CORS_ORIGIN || 'all origins (*)'}`);
      console.log(`🌍 Listening on: 0.0.0.0:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await closeRedisConnection();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await closeRedisConnection();
  process.exit(0);
});

// Start server with error handling
startServer().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
