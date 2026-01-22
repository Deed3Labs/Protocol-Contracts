# Production Setup Guide for Vercel + Redis

## The Problem

- **Vercel** only hosts your **frontend** (static files)
- **Redis** needs to run on a **separate server** (not on your laptop!)
- Your **Node.js server** also needs to be deployed separately

## Solution Architecture

```
┌─────────────┐
│   Vercel    │  ← Frontend (React app)
│  (Frontend) │
└──────┬──────┘
       │
       │ API calls
       ▼
┌─────────────┐
│   Railway   │  ← Backend server (Express)
│  (Server)   │
└──────┬──────┘
       │
       │ Cache queries
       ▼
┌─────────────┐
│   Upstash   │  ← Redis (Cloud database)
│   (Redis)   │
└─────────────┘
```

## Step-by-Step Setup

### 1. Create Cloud Redis (Upstash - Free Tier)

1. Go to https://upstash.com/
2. Sign up (free account)
3. Click "Create Database"
4. Choose:
   - **Name**: `protocol-redis`
   - **Type**: Regional (or Global)
   - **Region**: Choose closest to your users
5. Click "Create"
6. **Copy the connection details:**
   - You'll see a `REDIS_URL` like: `redis://default:xxxxx@xxxxx.upstash.io:6379`
   - **Save this!**

### 2. Deploy Server to Railway (Free Tier)

1. Go to https://railway.app/
2. Sign up with GitHub
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your repository
6. **Important**: Set root directory to `app/server`
7. Railway will auto-detect Node.js
8. Add environment variables in Railway dashboard:

```bash
# Redis (from Upstash)
REDIS_URL=redis://default:xxxxx@xxxxx.upstash.io:6379

# Server
PORT=3001
NODE_ENV=production

# CORS (your Vercel domain)
CORS_ORIGIN=https://your-app.vercel.app

# Optional: Cache TTLs
CACHE_TTL_PRICE=300
CACHE_TTL_BALANCE=10
CACHE_TTL_NFT=600
CACHE_TTL_TRANSACTION=60
```

9. Railway will deploy automatically
10. **Copy your Railway URL** (e.g., `https://your-app.railway.app`)

### 3. Update Vercel Environment Variables

1. Go to Vercel Dashboard
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Add:
   ```
   VITE_API_BASE_URL=https://your-app.railway.app
   ```
5. **Important**: Make sure to select "Production", "Preview", and "Development"
6. Click "Save"
7. **Redeploy** your Vercel app

### 4. Test Everything

1. **Test server health:**
   ```bash
   curl https://your-app.railway.app/health
   ```
   Should return: `{"status":"ok","redis":"connected"}`

2. **Test API:**
   ```bash
   curl https://your-app.railway.app/api/prices/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
   ```

3. **Test frontend:**
   - Open your Vercel app
   - Check browser console for API calls
   - Should see requests to your Railway server

## Alternative: Render (Instead of Railway)

1. Go to https://render.com/
2. Create "Web Service"
3. Connect GitHub repo
4. Set:
   - **Root Directory**: `app/server`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
5. Add same environment variables
6. Deploy

## Cost Breakdown

- **Upstash Redis**: Free tier = 10,000 commands/day, 256MB
- **Railway**: $5/month free credit (usually enough)
- **Vercel**: Free tier (generous limits)
- **Total**: ~$0-5/month for small apps

## Troubleshooting

### Server can't connect to Redis
- Check `REDIS_URL` is correct
- Verify Upstash database is active
- Check Railway logs: `railway logs`

### CORS errors
- Ensure `CORS_ORIGIN` matches your Vercel domain exactly
- Include `https://` protocol
- No trailing slash

### Frontend can't reach server
- Verify `VITE_API_BASE_URL` is set in Vercel
- Check server is running: visit Railway dashboard
- Check browser console for errors

### Redis connection string format
Upstash provides: `redis://default:password@host:port`
- This works directly with our config
- No need to parse it manually

## Quick Commands

```bash
# Check Railway deployment
railway status

# View logs
railway logs

# Set environment variable
railway variables set REDIS_URL=redis://...

# Redeploy
railway up
```

## Next Steps

1. ✅ Set up Upstash Redis
2. ✅ Deploy server to Railway
3. ✅ Update Vercel environment variables
4. ✅ Test everything
5. 🎉 Your app is now production-ready!

## Important Notes

- **Your laptop Redis is only for local development**
- **Production uses cloud Redis** (Upstash)
- **Server runs 24/7 on Railway** (not your laptop)
- **Frontend on Vercel** calls your Railway server
- **Everything works even when your laptop is closed!**
