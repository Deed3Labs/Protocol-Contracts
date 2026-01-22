import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import { getRedisClient, closeRedisConnection } from './config/redis.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import pricesRouter from './routes/prices.js';
import balancesRouter from './routes/balances.js';
import nftsRouter from './routes/nfts.js';
import transactionsRouter from './routes/transactions.js';
import { startPriceUpdater } from './jobs/priceUpdater.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check (before rate limiter so it's always accessible)
app.get('/health', async (req: express.Request, res: express.Response) => {
  try {
    const redisClient = await getRedisClient();
    const isRedisConnected = redisClient.isOpen;

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
    // Initialize Redis connection
    await getRedisClient();
    console.log('✅ Redis connection established');

    // Set up rate limiter middleware
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
    const rateLimiterMiddleware = await rateLimiter(windowMs, maxRequests);
    
    // Add rate limiter to all API routes
    app.use('/api', rateLimiterMiddleware);

    // Set up API routes (after rate limiter)
    app.use('/api/prices', pricesRouter);
    app.use('/api/balances', balancesRouter);
    app.use('/api/nfts', nftsRouter);
    app.use('/api/transactions', transactionsRouter);

    // Start background jobs
    await startPriceUpdater();
    console.log('✅ Background jobs started');

    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
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

startServer();
