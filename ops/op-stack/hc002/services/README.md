# HC-002 Service Layer (Explorer + Faucet + Bridge UI)

This directory adds developer-facing services on top of the running Clear Testnet runtime.

## Services

Host bundle endpoints (default `http://127.0.0.1:8077`):

1. Explorer UI: `/explorer`
2. Faucet UI/API: `/faucet` and `/faucet/drip`
3. Bridge UI: `/bridge`

## Commands

From repo root:

```bash
npm run hc002:services:init
npm run hc002:services:start
npm run hc002:services:status
npm run hc002:services:stop
```

## Preconditions

1. Runtime stack is up:
   - `npm run hc002:runtime:start`
2. Node is available in this repo environment.

## Faucet API

1. Health:
   - `GET /faucet/health`
2. Drip:
   - `POST /faucet/drip`
   - body: `{ "address": "0x..." }`
