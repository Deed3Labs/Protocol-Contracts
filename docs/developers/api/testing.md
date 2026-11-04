# Testing the API

Two kinds of check: the unit tests, which need no running server, and a smoke test that calls a
running API over HTTP. Both run from `apps/api`.

## Unit tests

```bash
cd apps/api
bun test src
```

Changes to the API also need the member app's tests, because some of them read API source
([Setting up → Before you push](../setup.md#before-you-push)).

## Smoke test

[`test-api.ts`](../../../apps/api/test-api.ts) calls the health, price, balance, token-balance and
transaction endpoints, singly and in batches, and reports each as passed or failed. It calls
`http://localhost:3001` unless `API_BASE_URL` is set.

```bash
cd apps/api
bun run dev          # in one terminal
bun run test         # in another: runs bun test-api.ts
```

## Calling endpoints by hand

The examples use chain `1` (Ethereum) and well-known mainnet addresses, as the smoke test does. Any
chain the API's RPC provider serves works the same way.

### Health

```bash
curl http://localhost:3001/health
```

```json
{"status":"ok","timestamp":"…","redis":"connected"}
```

`redis` is `disconnected` when Redis is not reachable; the API still answers.

### Token price

```bash
curl http://localhost:3001/api/prices/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
```

```json
{"price":…,"cached":false,"timestamp":…}
```

### Native balance

```bash
curl http://localhost:3001/api/balances/1/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

```json
{"balance":"…","balanceWei":"…","balanceUSD":0,"cached":false,"timestamp":…}
```

`balanceUSD` is always `0`; the client multiplies by the current price.

### Token balance

```bash
curl http://localhost:3001/api/token-balances/1/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

### Transactions

```bash
curl "http://localhost:3001/api/transactions/1/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045?limit=5"
```

```json
{"transactions":[…],"cached":false,"timestamp":…}
```

## Caching

With Redis connected, the second identical request within the cache window returns
`"cached": true`. The windows are set by `CACHE_TTL_PRICE` (300 seconds by default),
`CACHE_TTL_BALANCE` and `CACHE_TTL_TRANSACTION` (600 seconds each). Without Redis, every response is
`"cached": false`.

## Common problems

| Symptom | Check |
|---|---|
| No response | The server is running (`curl <api-host>/health`), and its logs on the host |
| CORS errors in the browser | The app's origin is in `CORS_ORIGIN` ([Going live → Cross-origin](../../operators/going-live.md#cross-origin)) |
| `redis: "disconnected"` | `REDIS_URL`, or `REDIS_HOST` and `REDIS_PORT`, point at a running Redis ([Redis for the API](./local-redis.md)) |
| Routes answer `503` | `DATABASE_URL` is not set; routes backed by the member store need Postgres |
