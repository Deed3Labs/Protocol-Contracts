# Protocol Server

Backend server with Redis caching for the Protocol Contracts application.

## Features

- **Redis Caching**: Shared cache for token prices, balances, NFTs, and transactions
- **Rate Limiting**: Redis-based rate limiting to protect external APIs
- **Background Jobs**: Automated price updates using cron jobs
- **RESTful API**: Clean API endpoints for frontend consumption

## Setup

### Prerequisites

- Node.js 18+ 
- Redis server (local or remote)

### Installation

```bash
cd server
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key variables:
- `PORT`: Server port (default: 3001)
- `REDIS_HOST`: Redis host (default: localhost)
- `REDIS_PORT`: Redis port (default: 6379)
- `REDIS_PASSWORD`: Redis password (if required)
- `CACHE_TTL_PRICE`: Cache TTL for prices in seconds (default: 300)

### Running Redis

**Local (Docker):**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**Local (Homebrew on macOS):**
```bash
brew install redis
brew services start redis
```

**Remote:** Use a Redis cloud service like Upstash, Redis Cloud, etc.

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

### Get Token Price
```
GET /api/prices/:chainId/:tokenAddress
```

Example:
```
GET /api/prices/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
```

Response:
```json
{
  "price": 2500.50,
  "cached": true,
  "timestamp": 1234567890
}
```

### Batch Get Prices
```
POST /api/prices/batch
```

Body:
```json
{
  "prices": [
    { "chainId": 1, "tokenAddress": "0x..." },
    { "chainId": 8453, "tokenAddress": "0x..." }
  ]
}
```

## Architecture

```
server/
├── src/
│   ├── config/
│   │   └── redis.ts          # Redis client and cache utilities
│   ├── middleware/
│   │   └── rateLimiter.ts     # Rate limiting middleware
│   ├── routes/
│   │   └── prices.ts          # Price API routes
│   ├── services/
│   │   └── priceService.ts    # Price fetching logic
│   ├── jobs/
│   │   └── priceUpdater.ts    # Background price update job
│   └── index.ts               # Express server setup
├── package.json
└── tsconfig.json
```

## Background Jobs

- **Price Updater**: Runs every 5 minutes to update popular token prices
  - WETH (Ethereum & Base)
  - USDC (Ethereum & Base)

## Cache Strategy

- **Token Prices**: 5 minutes TTL (configurable)
- **Balances**: 10 seconds TTL
- **NFTs**: 10 minutes TTL
- **Transactions**: 1 minute TTL
- **RPC Calls**: 5 seconds TTL

## Rate Limiting

- Default: 100 requests per minute per IP
- Configurable via environment variables
- Uses Redis for distributed rate limiting

## Next Steps

1. Add routes for balances, NFTs, and transactions
2. Implement WebSocket support for real-time updates
3. Add authentication/authorization
4. Set up monitoring and logging
5. Add database for persistent data storage
