# Production Deployment Guide

## Overview

Since Vercel only hosts frontend applications, you need to:
1. Deploy the server separately (Railway, Render, Fly.io, etc.)
2. Use a cloud Redis service (Upstash, Redis Cloud, etc.)
3. Update frontend environment variables

## Step 1: Set Up Cloud Redis

### Option A: Upstash (Recommended - Free Tier Available)

1. Go to [Upstash](https://upstash.com/) and sign up
2. Create a new Redis database
3. Choose a region close to your users
4. Copy the connection details:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### Option B: Redis Cloud

1. Go to [Redis Cloud](https://redis.com/try-free/)
2. Create a free account
3. Create a new database
4. Copy connection details:
   - Host
   - Port
   - Password

### Option C: AWS ElastiCache / Other Cloud Providers

Use your preferred cloud provider's Redis service.

## Step 2: Deploy Server

### Option A: Railway (Recommended - Easy Setup)

1. Go to [Railway](https://railway.app/)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Set root directory to `app/server`
6. Add environment variables:
   ```
   PORT=3001
   NODE_ENV=production
   REDIS_HOST=<your-redis-host>
   REDIS_PORT=6379
   REDIS_PASSWORD=<your-redis-password>
   REDIS_DB=0
   CORS_ORIGIN=https://your-vercel-app.vercel.app
   ```
7. Railway will auto-detect Node.js and deploy
8. Copy the deployment URL (e.g., `https://your-server.railway.app`)

### Option B: Render

1. Go to [Render](https://render.com/)
2. Create a new "Web Service"
3. Connect your GitHub repo
4. Set:
   - Root Directory: `app/server`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
5. Add environment variables (same as Railway)
6. Deploy

### Option C: Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. In `app/server`, run: `fly launch`
3. Follow prompts
4. Set environment variables: `fly secrets set KEY=value`
5. Deploy: `fly deploy`

## Step 3: Update Server Configuration

Update `app/server/src/config/redis.ts` to support Upstash REST API if using Upstash:

```typescript
// For Upstash REST API (if using Upstash)
if (process.env.UPSTASH_REDIS_REST_URL) {
  // Use Upstash REST client
  // See: https://docs.upstash.com/redis/sdks/redis-ts/getstarted
}
```

Or use standard Redis connection for other providers.

## Step 4: Update Frontend Environment Variables

In your Vercel project:

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   ```
   VITE_API_BASE_URL=https://your-server.railway.app
   ```
3. Redeploy your frontend

Or add to `app/.env.production`:
```
VITE_API_BASE_URL=https://your-server.railway.app
```

## Step 5: Update Server Environment Variables

In your server deployment (Railway/Render/etc.):

```
# Redis Configuration
REDIS_HOST=your-redis-host.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
# OR for Upstash REST API:
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Server Configuration
PORT=3001
NODE_ENV=production

# CORS
CORS_ORIGIN=https://your-vercel-app.vercel.app

# Alchemy API Key (RECOMMENDED - prevents RPC 522 errors)
# Get your free API key at: https://dashboard.alchemy.com/
# This automatically uses Alchemy for all supported chains (Ethereum, Base, Sepolia, etc.)
ALCHEMY_API_KEY=your_alchemy_api_key_here

# Optional: Override specific RPC URLs (only if you want custom URLs)
# If ALCHEMY_API_KEY is set, these are optional
# SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
# BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Cache TTLs (in seconds)
CACHE_TTL_PRICE=300
CACHE_TTL_BALANCE=10
CACHE_TTL_NFT=600
CACHE_TTL_TRANSACTION=600  # 10 minutes - increased to align with refresh intervals and reduce Alchemy compute unit usage
```

## Quick Start with Upstash + Railway

1. **Create Upstash Redis:**
   ```bash
   # Go to upstash.com, create database, copy credentials
   ```

2. **Deploy to Railway:**
   ```bash
   # Install Railway CLI
   npm i -g @railway/cli
   
   # Login
   railway login
   
   # In app/server directory
   cd app/server
   railway init
   railway up
   
   # Set environment variables
   railway variables set REDIS_HOST=your-host.upstash.io
   railway variables set REDIS_PASSWORD=your-password
   railway variables set CORS_ORIGIN=https://your-app.vercel.app
   ```

3. **Get Railway URL:**
   ```bash
   railway domain
   # Copy the URL (e.g., https://your-app.railway.app)
   ```

4. **Update Vercel:**
   - Add `VITE_API_BASE_URL=https://your-app.railway.app` to Vercel environment variables
   - Redeploy

## Testing

1. Check server health: `https://your-server.railway.app/health`
2. Should return: `{ status: 'ok', redis: 'connected' }`
3. Test API: `https://your-server.railway.app/api/prices/1/0x...`

## Cost Estimates

- **Upstash Free Tier:** 10,000 commands/day, 256MB storage
- **Railway Free Tier:** $5 credit/month (usually enough for small apps)
- **Render Free Tier:** 750 hours/month (sleeps after inactivity)

## Monitoring

- Railway: Built-in logs and metrics
- Upstash: Dashboard shows usage and performance
- Add error tracking: Sentry, LogRocket, etc.

## Troubleshooting

### Server won't connect to Redis
- Check Redis credentials
- Verify Redis allows connections from your server IP
- Check firewall/security groups

### CORS errors
- Ensure `CORS_ORIGIN` matches your Vercel domain exactly
- Include protocol: `https://your-app.vercel.app`

### Frontend can't reach server
- Verify `VITE_API_BASE_URL` is set correctly
- Check server is running: `curl https://your-server.railway.app/health`
- Check browser console for errors
