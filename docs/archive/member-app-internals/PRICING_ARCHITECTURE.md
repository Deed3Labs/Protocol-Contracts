# Price Fetching Architecture

## Overview

This document explains how prices are fetched for **tokens**, **native tokens**, and **NFTs**, and what runs on the **frontend** vs **backend**.

---

## 🏗️ Architecture Summary

### **Backend (Server) - Railway**
- ✅ All price fetching logic
- ✅ External API calls (Uniswap, Coinbase, CoinGecko, OpenSea)
- ✅ Redis caching
- ✅ Rate limiting

### **Frontend (Client) - Vercel**
- ✅ Makes API calls to backend
- ✅ Displays prices
- ❌ **NO direct external API calls** (except in dev mode)

---

## 📊 Price Fetching Flow

### 1. **Token Prices (ERC20 Tokens)**

#### Flow:
```
Frontend (Vercel)
  ↓
usePricingData() hook
  ↓
getTokenPrice() [apiClient.ts]
  ↓
GET /api/prices/:chainId/:tokenAddress [Server API - Railway]
  ↓
priceService.getTokenPrice()
  ↓
Try sources in order:
  1. Uniswap V3 (on-chain)
  2. Coinbase API
  3. CoinGecko API
  4. Ethereum mainnet fallback (if on other chain)
  ↓
Redis Cache (5 min TTL)
  ↓
Return price to frontend
```

#### Frontend Files:
- **`app/src/hooks/usePricingData.ts`**
  - React hook that calls server API
  - Used by components to get token prices
  - **Does NOT call external APIs directly** (only in dev mode)

- **`app/src/utils/apiClient.ts`**
  - `getTokenPrice(chainId, tokenAddress)` function
  - Makes HTTP request to `/api/prices/:chainId/:tokenAddress`

#### Backend Files:
- **`app/server/src/routes/prices.ts`**
  - Express route: `GET /api/prices/:chainId/:tokenAddress`
  - Checks Redis cache first
  - Calls `priceService.getTokenPrice()`
  - Caches result (5 min TTL)

- **`app/server/src/services/priceService.ts`**
  - `getTokenPrice()` - Main function
  - `getUniswapPrice()` - On-chain Uniswap V3 pools
  - `getCoinbasePrice()` - Coinbase API
  - `getCoinGeckoPrice()` - CoinGecko API
  - Ethereum mainnet fallback logic

#### Example:
```typescript
// Frontend
const { price } = usePricingData('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'); // USDC
// → Calls: GET /api/prices/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
// → Server fetches from Uniswap/Coinbase/CoinGecko
// → Returns: { price: 1.0 }
```

---

### 2. **Native Token Prices (ETH, POL, xDAI, etc.)**

#### Flow:
```
Frontend (Vercel)
  ↓
useMultichainBalances() hook
  ↓
getTokenPriceFromApi(chainId, wrappedAddress)
  ↓
GET /api/prices/:chainId/:wrappedAddress [Server API - Railway]
  ↓
priceService.getTokenPrice()
  ↓
Same sources as ERC20 tokens
  ↓
Returns native token price
```

#### Key Points:
- **Native tokens use wrapped addresses** for price fetching:
  - ETH → WETH (`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`)
  - POL → WPOL (`0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270`)
  - xDAI → WXDAI (`0xe91D153E0b41518A2Ce8Dd3D7944F8638934d2C8`)

- **Frontend mapping**: `app/src/hooks/usePricingData.ts` has `WETH_ADDRESSES` mapping

- **Backend mapping**: `app/server/src/services/priceService.ts` has `WETH_ADDRESSES` mapping

#### Frontend Files:
- **`app/src/hooks/useMultichainBalances.ts`**
  - Line 163: Gets native token wrapped address
  - Line 171: Calls `getTokenPriceFromApi()` for price
  - Calculates `balanceUSD = balance * price`

#### Backend Files:
- Same as token prices (`priceService.ts`)

#### Example:
```typescript
// Frontend
const balances = useMultichainBalances();
// For Base chain (8453):
// → Gets WETH address: 0x4200000000000000000000000000000000000006
// → Calls: GET /api/prices/8453/0x4200000000000000000000000000000000000006
// → Server returns ETH price
// → Calculates: balanceUSD = 1.5 ETH * $3000 = $4500
```

---

### 3. **NFT Prices (T-Deeds & General NFTs)**

#### Flow:
```
Frontend (Vercel)
  ↓
useMultichainDeedNFTs() hook
  ↓
getNFTs() [apiClient.ts]
  ↓
GET /api/nfts/:chainId/:address [Server API - Railway]
  ↓
nftService.getDeedNFTs() or getGeneralNFTs()
  ↓
Fetches NFTs from blockchain
  ↓
nftService calls priceService.getOpenSeaNFTPrice()
  ↓
OpenSea API v2
  ↓
Returns NFT with priceUSD field
```

#### Key Points:
- **NFT prices are fetched on the backend** during NFT fetching
- **OpenSea API is called server-side** (not from frontend)
- Prices are **optional** - if OpenSea fails, NFT still returns (without price)

#### Frontend Files:
- **`app/src/hooks/useMultichainDeedNFTs.ts`**
  - Calls `getNFTs()` from `apiClient.ts`
  - Receives NFTs with `priceUSD` field (if available)

- **`app/src/utils/apiClient.ts`**
  - `getNFTs(chainId, address, contractAddress)` function
  - Makes HTTP request to `/api/nfts/:chainId/:address`

#### Backend Files:
- **`app/server/src/routes/nfts.ts`**
  - Express route: `GET /api/nfts/:chainId/:address`
  - Calls `nftService.getDeedNFTs()` or `getGeneralNFTs()`

- **`app/server/src/services/nftService.ts`**
  - `getDeedNFTs()` - Fetches T-Deeds, calls `getOpenSeaNFTPrice()` for pricing
  - `getGeneralNFTs()` - Fetches ERC721/ERC1155, calls `getOpenSeaNFTPrice()` for pricing

- **`app/server/src/services/priceService.ts`**
  - `getOpenSeaNFTPrice()` - Calls OpenSea API v2
  - Gets collection floor price
  - Converts native token price to USD

#### Example:
```typescript
// Frontend
const { nfts } = useMultichainDeedNFTs();
// → Calls: GET /api/nfts/84532/0x1234...
// → Server:
//   1. Fetches NFTs from blockchain
//   2. Calls OpenSea API for floor price
//   3. Returns: [{ tokenId: "1", priceUSD: 150.50, ... }]
```

---

## 🔑 Environment Variables

### **Railway (Backend Server)**

Add these environment variables to **Railway** (where your server runs):

```bash
# Required for NFT pricing
OPENSEA_API_KEY=your_opensea_api_key_here

# Optional (for better rate limits)
COINGECKO_API_KEY=your_coingecko_api_key_here

# Redis (for caching)
REDIS_URL=your_redis_url
# OR
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password

# RPC URLs (for blockchain calls)
ALCHEMY_API_KEY=your_alchemy_key
ETHEREUM_RPC_URL=...
BASE_RPC_URL=...
# etc.

# Cache TTLs (optional, defaults provided)
CACHE_TTL_PRICE=300  # 5 minutes
CACHE_TTL_NFT=600    # 10 minutes
```

### **Vercel (Frontend)**

Add these environment variables to **Vercel** (where your frontend runs):

```bash
# Required - points to your Railway server
VITE_API_BASE_URL=https://your-railway-app.railway.app

# No OpenSea API key needed here!
# Frontend doesn't call external APIs directly
```

---

## ❓ Where to Add OPENSEA_API_KEY?

### **Answer: Railway (Backend Server)**

**Why?**
- OpenSea API is called from `app/server/src/services/priceService.ts`
- This runs on the **server** (Railway), not the frontend (Vercel)
- The frontend never directly calls OpenSea

**Steps:**
1. Go to your Railway project dashboard
2. Navigate to your backend service
3. Go to "Variables" tab
4. Add: `OPENSEA_API_KEY=your_key_here`
5. Redeploy (or Railway auto-redeploys)

**Get OpenSea API Key:**
1. Go to https://docs.opensea.io/reference/api-overview
2. Sign up for OpenSea API access
3. Get your API key from the dashboard

---

## 📋 Summary Table

| Asset Type | Frontend | Backend | External APIs |
|------------|----------|---------|---------------|
| **ERC20 Tokens** | Calls server API | Fetches from Uniswap/Coinbase/CoinGecko | ✅ Uniswap, Coinbase, CoinGecko |
| **Native Tokens** | Calls server API (with wrapped address) | Same as ERC20 | ✅ Uniswap, Coinbase, CoinGecko |
| **NFTs (T-Deeds)** | Calls server API | Fetches NFTs + OpenSea for price | ✅ OpenSea API |
| **NFTs (General)** | Calls server API | Fetches NFTs + OpenSea for price | ✅ OpenSea API |

---

## 🔄 Caching Strategy

### **Token Prices**
- **Cache**: Redis (5 minutes TTL)
- **Key**: `price:{chainId}:{tokenAddress}`
- **Location**: Backend only

### **NFT Prices**
- **Cache**: Included in NFT data cache (10 minutes TTL)
- **Key**: `nft_list:{chainId}:{address}`
- **Location**: Backend only

### **Why Cache?**
- Reduces external API calls (rate limits)
- Faster response times
- Lower costs

---

## 🚨 Important Notes

1. **Frontend NEVER calls external APIs directly** (except in dev mode)
   - All external API calls go through the backend
   - This protects API keys and handles rate limiting

2. **OpenSea API Key goes to Railway, not Vercel**
   - Server-side only
   - Frontend doesn't need it

3. **Pricing is optional for NFTs**
   - If OpenSea fails, NFT still returns (without `priceUSD`)
   - Doesn't block NFT fetching

4. **Ethereum mainnet fallback**
   - If token price not found on current chain, tries Ethereum mainnet
   - Native tokens (POL, xDAI) use correct wrapped addresses to avoid confusion

5. **Stablecoins**
   - USDC, USDT, DAI default to $1.00
   - Checked before API calls (faster)

---

## 🔍 Debugging

### Check if prices are working:
```bash
# Test token price
curl https://your-railway-app.railway.app/api/prices/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# Test NFT with price
curl https://your-railway-app.railway.app/api/nfts/84532/0xYourAddress
```

### Check environment variables:
```bash
# On Railway, check Variables tab
# On Vercel, check Environment Variables
```

### Common Issues:
- **"Price not available"** → Check RPC URLs, API keys
- **"OpenSea API failed"** → Check `OPENSEA_API_KEY` in Railway
- **"Server API unavailable"** → Check `VITE_API_BASE_URL` in Vercel
