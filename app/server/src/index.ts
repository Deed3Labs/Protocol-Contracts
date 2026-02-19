import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import { getRedisClient, closeRedisConnection } from './config/redis.js';
import { closePostgresPool } from './config/postgres.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { requireAuth } from './middleware/auth.js';
import pricesRouter from './routes/prices.js';
import balancesRouter from './routes/balances.js';
import tokenBalancesRouter from './routes/tokenBalances.js';
import nftsRouter from './routes/nfts.js';
import transactionsRouter from './routes/transactions.js';
import stripeRouter from './routes/stripe.js';
import plaidRouter from './routes/plaid.js';
import bridgeRouter from './routes/bridge.js';
import { startPriceUpdater } from './jobs/priceUpdater.js';
import { websocketService } from './services/websocketService.js';
import { eventListenerService } from './services/eventListenerService.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT: number = parseInt(process.env.PORT || '3001', 10);

// Trust first proxy hop (Railway/Render/Nginx) so req.ip is accurate for rate limiting.
app.set('trust proxy', 1);

// Middleware
app.use(compression());

// CORS configuration - handle Vercel preview URLs and production
// IMPORTANT: CORS must be set up BEFORE routes
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : [];
    
    const allowVercelPreviews = process.env.ALLOW_VERCEL_PREVIEWS === 'true';
    const isVercelPreview = allowVercelPreviews && origin.endsWith('.vercel.app');
    
    // If no CORS_ORIGIN is set, default to compatibility mode (allow all origins).
    // Enable STRICT_CORS=true to force explicit CORS_ORIGIN configuration in production.
    if (allowedOrigins.length === 0) {
      const strictCors = process.env.STRICT_CORS === 'true';
      if (!strictCors) {
        console.warn(`[CORS] CORS_ORIGIN not set. Allowing origin: ${origin}`);
        return callback(null, true);
      }
      console.warn(`[CORS] Blocked origin because STRICT_CORS=true and CORS_ORIGIN is not configured: ${origin}`);
      return callback(new Error('CORS_ORIGIN is required when STRICT_CORS=true'));
    }
    
    // If '*' is specified, allow all origins
    if (allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    // Check if origin matches any allowed origin
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        // Handle wildcard patterns like https://*.vercel.app
        const pattern = allowed.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(origin);
      }
      return origin === allowed;
    });
    
    // Allow if explicitly allowed OR if preview URLs are explicitly enabled.
    if (isAllowed || isVercelPreview) {
      if (isVercelPreview) {
        console.log(`[CORS] Allowing Vercel preview URL: ${origin}`);
      }
      callback(null, true);
    } else {
      // Log the blocked origin for debugging
      console.warn(`[CORS] Blocked origin: ${origin}. Allowed: ${allowedOrigins.join(', ')}`);
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Reown-Project-Id', 'X-Appkit-Project-Id'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204,
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
// 404 and error handlers will be set up after routes

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

    // Public API routes (after rate limiter)
    app.use('/api/prices', pricesRouter);
    app.use('/api/balances', balancesRouter);
    app.use('/api/token-balances', tokenBalancesRouter); // Uses same service as balances (consolidated)
    app.use('/api/nfts', nftsRouter);
    app.use('/api/transactions', transactionsRouter);
    app.use('/api/stripe', requireAuth, stripeRouter);
    app.use('/api/plaid', requireAuth, plaidRouter);
    app.use('/api/bridge', requireAuth, bridgeRouter);
    
    console.log('✅ API routes registered:');
    console.log('  - /api/prices');
    console.log('  - /api/balances (native token balances)');
    console.log('  - /api/token-balances (ERC20 token balances - uses same service)');
    console.log('  - /api/nfts');
    console.log('  - /api/transactions');
    console.log('  - /api/stripe');
    console.log('  - /api/plaid');
    console.log('  - /api/bridge');

    // 404 handler (must be after all routes)
    app.use((req: express.Request, res: express.Response) => {
      res.status(404).json({
        error: 'Not found',
        message: `Route ${req.path} not found`,
      });
    });

    // Error handler (must be after all routes and 404 handler)
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Unhandled error:', err);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
      });
    });

    // Initialize WebSocket server
    websocketService.initialize(httpServer);

    // Initialize blockchain event listeners
    eventListenerService.initialize().catch((error) => {
      console.error('⚠️ Event listeners failed to start:', error);
    });

    // Start background jobs (non-blocking)
    startPriceUpdater().catch((error) => {
      console.error('⚠️ Background jobs failed to start:', error);
    });

    // Start HTTP server (Express + WebSocket)
    // Bind to 0.0.0.0 to accept connections from Railway/external hosts
    // IMPORTANT: Routes are registered BEFORE server starts listening
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 CORS enabled for: ${process.env.CORS_ORIGIN || 'all origins (*)'}`);
      console.log(`🌍 Listening on: 0.0.0.0:${PORT}`);
      console.log(`✅ All routes are ready to handle requests`);
      console.log(`✅ WebSocket server ready for real-time updates`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  eventListenerService.cleanup();
  websocketService.cleanup();
  await closeRedisConnection();
  await closePostgresPool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  eventListenerService.cleanup();
  websocketService.cleanup();
  await closeRedisConnection();
  await closePostgresPool();
  process.exit(0);
});

// Start server with error handling
startServer().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
