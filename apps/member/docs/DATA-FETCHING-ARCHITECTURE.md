# Data Fetching Architecture

## Overview

This document explains all the different areas where data is being pulled, fetched, and requested, and why they are located in different parts of the codebase.

## Architecture Layers

```
┌───────────────────────────────────────────────────────────────┐
│                     FRONTEND (React)                          │
│   ┌──────────────┐  ┌──────────────┐  ┌─────────────┐         │
│   │   Hooks      │  │  Components  │  │  Contexts   │         │
│   │  (Data Fetch)│  │  (UI Layer)  │  │ (State Mgmt)│         │
│   └──────┬───────┘  └──────┬───────┘  └───────┬─────┘         │
│          │                 │                  │               │
│          └─────────────────┼──────────────────┘               │
│                            │                                  │
│                     ┌──────▼──────┐                           │
│                     │ apiClient.ts│                           │
│                     │ (HTTP Layer)│                           │
│                     └──────┬──────┘                           │
└────────────────────────────┼──────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   SERVER API    │
                    │   (Express)     │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼──────┐    ┌────────▼────────┐   ┌───────▼──────┐
│    Routes    │    │     Services    │   │  Background  │
│  (Endpoints) │    │   (Business     │   │     Jobs     │
│              │    │    Logic)       │   │              │
└──────┬───────┘    └────────┬────────┘   └───────┬──────┘
       │                     │                    │
       └─────────────────────┼────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼──────┐    ┌────────▼────────┐   ┌───────▼──────┐
│     Redis    │    │   Alchemy API   │   │   WebSocket  │
│    (Cache)   │    │   (Blockchain)  │   │  (Real-time) │
└──────────────┘    └─────────────────┘   └──────────────┘
```

---

## 1. Frontend Data Fetching

### Location: `app/src/`

#### A. React Hooks (`app/src/hooks/`)

**Purpose**: Reusable data fetching logic for React components

**Key Hooks**:

1. **`useMultichainBalances.ts`**
   - Fetches native token balances across multiple chains
   - Uses: Server API (`/api/balances/batch`) → Fallback to RPC
   - Why here: Component-level data fetching, manages loading states

2. **`useMultichainDeedNFTs.ts`**
   - Fetches T-Deed NFTs across chains
   - Uses: Server API (`/api/nfts/batch`) → Portfolio API → Fallback to contract calls
   - Why here: NFT-specific logic, handles metadata parsing

3. **`useMultichainActivity.ts`**
   - Fetches transaction history
   - Uses: Server API (`/api/transactions/batch`) → Fallback to RPC
   - Why here: Activity-specific formatting and filtering

4. **`usePricingData.ts`**
   - Fetches token prices
   - Uses: Server API (`/api/prices`) → Fallback to Uniswap/CoinGecko
   - Why here: Price-specific caching and formatting

5. **`usePortfolioHoldings.ts`**
   - Fetches complete portfolio (tokens + NFTs + cash)
   - Uses: Server API (`/api/token-balances/portfolio`)
   - Why here: Aggregates multiple data sources into unified format

**Why Hooks?**
- Reusability across components
- Manages React state (loading, error, data)
- Handles component lifecycle (cleanup on unmount)
- Provides consistent API for components

---

#### B. React Contexts (`app/src/context/`)

**Purpose**: Global state management and centralized data orchestration

**Key Contexts**:

1. **`PortfolioContext.tsx`**
   - Orchestrates all portfolio data fetching
   - Coordinates: balances + holdings + transactions
   - Uses dynamic intervals (5-60 min) for auto-refresh
   - Why here: Single source of truth for portfolio data, prevents duplicate requests

2. **`DeedNFTContext.tsx`**
   - Manages DeedNFT-specific state
   - Handles NFT metadata and validation
   - Why here: NFT-specific business logic, validation workflows

**Why Contexts?**
- Global state accessible to all components
- Prevents prop drilling
- Coordinates multiple data sources
- Manages refresh intervals and WebSocket updates

---

#### C. API Client (`app/src/utils/apiClient.ts`)

**Purpose**: Centralized HTTP client for server communication

**Functions**:
- `getTokenPrice()` → `/api/prices/:chainId/:tokenAddress`
- `getBalance()` → `/api/balances/:chainId/:address`
- `getNFTs()` → `/api/nfts/:chainId/:address`
- `getTransactions()` → `/api/transactions/:chainId/:address`
- `getTokenBalancesBatch()` → `/api/token-balances/batch`
- `getPortfolio()` → `/api/portfolio/:address`

**Why Separate?**
- Single point for HTTP configuration (timeouts, error handling)
- Consistent request/response formatting
- Easy to swap backend implementations
- Handles authentication headers in one place

---

#### D. WebSocket Client (`app/src/hooks/useWebSocket.ts`)

**Purpose**: Real-time data updates via WebSocket

**Features**:
- Connects to server WebSocket
- Subscribes to: balances, NFTs, transactions, prices
- Receives push updates instead of polling

**Why Separate?**
- Different protocol (WebSocket vs HTTP)
- Persistent connection management
- Event-driven updates vs request/response

---

## 2. Backend API Layer

### Location: `app/server/src/routes/`

**Purpose**: HTTP REST API endpoints

**Routes**:

1. **`prices.ts`** → `/api/prices/:chainId/:tokenAddress`
   - Returns token prices
   - Checks Redis cache first
   - Falls back to Alchemy Prices API

2. **`balances.ts`** → `/api/balances/:chainId/:address`
   - Returns native token balances
   - Uses `balanceService.ts` for business logic

3. **`tokenBalances.ts`** → `/api/token-balances/:chainId/:userAddress/:tokenAddress`
   - Returns ERC20 token balances
   - Supports batch requests

4. **`nfts.ts`** → `/api/nfts/:chainId/:address`
   - Returns NFTs (T-Deeds or general)
   - Uses Portfolio API for efficiency

5. **`transactions.ts`** → `/api/transactions/:chainId/:address`
   - Returns transaction history
   - Uses Alchemy Transfers API

**Why Routes?**
- RESTful API design
- Request validation and parsing
- HTTP status codes and error handling
- Rate limiting middleware

---

## 3. Backend Services Layer

### Location: `app/server/src/services/`

**Purpose**: Business logic and data aggregation

**Services**:

1. **`balanceService.ts`**
   - Fetches balances from blockchain
   - Handles RPC calls with retries
   - Uses Alchemy API when available
   - Why here: Reusable across routes, handles complex logic

2. **`nftService.ts`**
   - Fetches NFTs from contracts
   - Parses metadata
   - Handles T-Deed vs general NFT logic
   - Why here: NFT-specific business rules

3. **`priceService.ts`**
   - Fetches token prices
   - Multiple sources: Alchemy → Uniswap → CoinGecko
   - Why here: Price aggregation logic

4. **`transfersService.ts`**
   - Monitors transfers using Alchemy Transfers API
   - Uses dynamic intervals (1-60 min)
   - Why here: Transfer monitoring logic, event processing

5. **`portfolioService.ts`**
   - Aggregates portfolio data
   - Uses Alchemy Portfolio API
   - Why here: Complex data aggregation

6. **`websocketService.ts`**
   - Manages WebSocket connections
   - Broadcasts updates to clients
   - Uses dynamic intervals for NFT polling (5-60 min)
   - Why here: Real-time communication logic

**Why Services?**
- Separation of concerns (routes vs business logic)
- Reusable across multiple routes
- Testable independently
- Handles complex data transformations

---

## 4. Background Jobs

### Location: `app/server/src/jobs/`

**Purpose**: Scheduled tasks and periodic updates

**Jobs**:

1. **`priceUpdater.ts`**
   - Updates token prices every 5-60 minutes (dynamic)
   - Pre-populates Redis cache
   - Why here: Background task, doesn't block API requests
   - Runs independently of user requests

**Why Background Jobs?**
- Pre-compute expensive operations
- Reduce API response times (cache warming)
- Scheduled tasks independent of user activity
- Reduces load on external APIs

---

## 5. Caching Layer

### Location: `app/server/src/config/redis.ts`

**Purpose**: Cache management for performance

**Cache Keys**:
- `balance:{chainId}:{address}` → TTL: 10s-600s
- `nft:{chainId}:{address}` → TTL: 600s-1800s
- `price:{chainId}:{tokenAddress}` → TTL: 300s
- `transaction:{chainId}:{address}` → TTL: 60s-300s

**Why Redis?**
- Fast in-memory storage
- Reduces blockchain RPC calls
- Shared cache across all server instances
- Configurable TTLs per data type

---

## 6. Data Flow Examples

### Example 1: Fetching Token Balance

```
User Action (Component)
    ↓
useMultichainBalances Hook
    ↓
apiClient.getBalance()
    ↓
HTTP GET /api/balances/:chainId/:address
    ↓
balances.ts Route
    ↓
Check Redis Cache
    ├─ Cache Hit → Return immediately
    └─ Cache Miss → balanceService.getBalance()
                        ↓
                    RPC Call / Alchemy API
                        ↓
                    Cache result in Redis
                        ↓
                    Return to client
```

### Example 2: Real-time NFT Update

```
Background: priceUpdater Job
    ↓
Updates price in Redis
    ↓
websocketService.broadcastPriceUpdate()
    ↓
WebSocket emits 'price_update' event
    ↓
Frontend: useWebSocket hook receives event
    ↓
PortfolioContext handles event
    ↓
refreshBalances() called
    ↓
UI updates automatically
```

### Example 3: Dynamic Interval Adjustment

```
System monitors conditions:
- Active connections: 10 users
- Error rate: 5%
- Cache hit rate: 80%
- Data changes: 2 per minute
    ↓
DynamicIntervalManager calculates:
- More users → shorter interval (5 min)
- High cache hits → longer interval (30 min)
- Frequent changes → shorter interval (10 min)
    ↓
Final interval: 10 minutes
    ↓
Next update scheduled in 10 min
```

---

## Why Different Locations?

### 1. **Separation of Concerns**
- **Frontend**: UI state, user interactions, component lifecycle
- **Backend Routes**: HTTP protocol, request/response handling
- **Backend Services**: Business logic, data transformations
- **Background Jobs**: Scheduled tasks, cache warming

### 2. **Reusability**
- Hooks can be used by multiple components
- Services can be used by multiple routes
- API client provides consistent interface

### 3. **Performance**
- Frontend hooks manage loading states (UX)
- Backend services handle caching (performance)
- Background jobs pre-compute data (efficiency)

### 4. **Scalability**
- Routes can scale horizontally (stateless)
- Services can be extracted to microservices
- Background jobs run independently

### 5. **Maintainability**
- Clear boundaries between layers
- Easy to test each layer independently
- Changes in one layer don't affect others

---

## Current Polling/Request Locations

### Frontend (Dynamic Intervals: 5-60 minutes)
1. **PortfolioContext.tsx** - Portfolio auto-refresh
   - Interval: 5-60 min (dynamic)
   - Conditions: WebSocket status, user activity, data changes

### Backend (Dynamic Intervals: 5-60 minutes)
1. **priceUpdater.ts** - Price updates
   - Interval: 5-60 min (dynamic)
   - Conditions: Active connections, error rates, cache hits

2. **websocketService.ts** - NFT polling
   - Interval: 5-60 min (dynamic)
   - Conditions: Active connections, NFT changes, cache performance

3. **transfersService.ts** - Transfer monitoring
   - Interval: 1-60 min (dynamic)
   - Conditions: Active connections, transfer frequency

### Fixed Intervals (Not Dynamic)
1. **websocketService.ts** - Balance/Transaction updates
   - Interval: 30 seconds (fixed)
   - Why: Lightweight, real-time critical

2. **websocketService.ts** - Price updates
   - Interval: 1 minute (fixed)
   - Why: Prices change frequently

---

## Summary

The data fetching architecture is organized into layers:

1. **Frontend Hooks** → User-facing data fetching with React state
2. **API Client** → HTTP communication layer
3. **Backend Routes** → REST API endpoints
4. **Backend Services** → Business logic and data aggregation
5. **Background Jobs** → Scheduled tasks and cache warming
6. **WebSocket Service** → Real-time push updates
7. **Redis Cache** → Performance optimization

Each layer has a specific responsibility, making the system:
- **Maintainable**: Clear boundaries
- **Scalable**: Independent scaling
- **Performant**: Caching and optimization
- **Flexible**: Easy to modify individual layers