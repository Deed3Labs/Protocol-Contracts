# Deed Protocol Monorepo

Smart contracts, deployment tooling, frontend application, and backend services for the Deed Protocol.

> ⚠️ Beta notice: this codebase is under active development. Treat deployments as non-production unless your own security review and controls are in place.

## What This Repository Includes

This repository is no longer just a contracts package. It now contains:

- Smart contracts for RWA deed tokenization, validation, subdivision/fractionalization, assurance reserves, burner bonds, and claim escrow settlement
- Deployment and upgrade scripts for Base Sepolia/Base and other configured networks
- A React/Vite frontend in [`app/`](./app)
- An Express + WebSocket backend in [`app/server/`](./app/server)
- Tests, architecture documentation, and deployment runbooks

## Protocol Module Map

### 1. Core RWA Layer (`contracts/core`)

- `DeedNFT.sol`: upgradeable ERC-721 deed token with trait storage and validator integration
- `Validator.sol`: validation rules, operating agreement registry, service fees, and token whitelist integration
- `ValidatorRegistry.sol`: validator discovery, activation, and role synchronization
- `FundManager.sol`: validator fee accounting, commission routing, and token/deed compatibility controls
- `MetadataRenderer.sol`: trait-aware metadata rendering and structured document/feature/condition metadata

### 2. Asset Structuring Layer (`contracts/extensions`, `contracts/core/factories`)

- `Subdivide.sol`: upgradeable ERC-1155 subdivision units for Land/Estate deed assets
- `Fractionalize.sol`: locks deed/subdivision assets and mints fractional ERC-20 share systems
- `FractionToken.sol`: per-fraction ERC-20 token implementation
- `FractionTokenFactory.sol`: clone-based factory for fraction tokens

### 3. Bond + Assurance Layer (`contracts/peripherals`, `contracts/core/factories`)

- `TokenRegistry.sol`: token whitelist, metadata, chain mapping, and fallback pricing data
- `AssuranceOracle.sol`: price discovery (Uniswap V3 + registry fallback) and RTD target inputs
- `AssurancePool.sol`: reserve accounting across primary/buffer/excess balances
- `BurnerBondFactory.sol`: collection factory and global bond parameter authority
- `BurnerBondDeposit.sol`: deposit/processing pipeline for bond mint flows
- `BurnerBond.sol`: ERC-1155 bond collections with maturity-linked discount curves

### 4. Stable-Credit Primitives (`contracts/core`, `contracts/extensions`, `contracts/peripherals`)

- `MutualCredit.sol`, `StableCredit.sol`: credit-line-based ERC-20 credit mechanics
- `CreditPool.sol`: queue-based credit pool and discount servicing
- `CreditIssuer.sol`, `AccessManager.sol`: underwriting period logic and role model

### 5. Send/Claim Settlement (`contracts/peripherals`)

- `ClaimEscrow.sol`: USDC escrow for link-based claim settlement, settlement by authorized settler role, and expiry refunds

## Repository Structure

```text
.
├── contracts/
│   ├── core/
│   ├── extensions/
│   ├── peripherals/
│   ├── libraries/
│   └── mocks/
├── deploy/                # Deployment, upgrade, verification scripts
├── deployments/           # Saved deployed addresses + ABIs by network
├── scripts/               # Operational/maintenance scripts
├── test/                  # Hardhat tests
├── docs/                  # Protocol and UX docs
├── app/                   # Frontend (React + Vite)
│   └── server/            # Backend API + jobs + websocket services
├── hardhat.config.ts
└── package.json
```

## Requirements

- Node.js 18+ recommended
- npm
- Bun (required by `app/server` runtime scripts)
- Funded deployer account for live-network deployments

## Contracts Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Compile:

```bash
npm run compile
```

4. Run tests:

```bash
npm run test
```

## Contract Commands

### Testing

```bash
npm run test
npm run test:core
npm run test:coverage
npm run test:gas
```

### Deployments

Core protocol deployment (registry, renderer, validator, deed, fund manager, subdivision, fractionalization):

```bash
npx hardhat run deploy/deploy_all.ts --network base-sepolia
```

BurnerBond + assurance stack deployment:

```bash
npm run deploy:burner-bonds:sepolia
# or
npm run deploy:burner-bonds:base
```

Deploy individual bond/assurance components:

```bash
npm run deploy:token-registry -- base-sepolia
npm run deploy:assurance-pool -- base-sepolia
npm run deploy:assurance-oracle -- base-sepolia
npm run deploy:burner-bond-factory -- base-sepolia
```

Deploy claim escrow:

```bash
npx hardhat run deploy/11_deploy_ClaimEscrow.ts --network base-sepolia
```

Grant claim-settler role to backend relayer/service account:

```bash
npm run send:grant-settler:base-sepolia
# or
npm run send:grant-settler:base
```

### Verification and Upgrades

```bash
npm run verify:deployments:sepolia
npm run verify:deployments -- base

npm run upgrade:check -- base-sepolia
npm run upgrade:execute -- base-sepolia
```

Deployment outputs are written to `deployments/<network>/<Contract>.json`.

## Frontend (`app/`)

The frontend is a React + TypeScript + Vite application with portfolio flows, deed minting, exploration, validation/admin surfaces, bond pages, and send/claim routes.

Setup:

```bash
cd app
npm install
cp .env.example .env
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

Contract bindings consumed by the app live in `app/src/contracts/<network>/`.

## Backend (`app/server/`)

The backend provides REST APIs, websocket updates, background jobs, and send-funds orchestration (including claim escrow settlement integrations).

Setup:

```bash
cd app/server
npm install
cp env.example .env
```

Run:

```bash
npm run dev
```

Key API groups mounted in `app/server/src/index.ts`:

- `/api/prices`
- `/api/balances`
- `/api/token-balances`
- `/api/nfts`
- `/api/transactions`
- `/api/stripe`
- `/api/plaid`
- `/api/bridge`
- `/api/send`

Health endpoint:

```text
GET /health
```

## Test Coverage Snapshot

Current automated tests in this repository cover:

- Core deed stack: DeedNFT, Validator, ValidatorRegistry, FundManager, MetadataRenderer
- AssuranceOracle behavior
- ClaimEscrow flows

See `test/core` and `test/peripherals` for current suites.

## Documentation Index

- Protocol docs: [`docs/README.md`](./docs/README.md)
- Deployment docs: [`deploy/README.md`](./deploy/README.md)
- Frontend docs: [`app/README.md`](./app/README.md)
- Backend docs: [`app/server/README.md`](./app/server/README.md)

## Security Notes

- Contracts include access control, pausable/reentrancy guards, and upgrade patterns where applicable.
- The repository should still be treated as unaudited unless a specific release is accompanied by a formal audit report.
- Use multisig governance and strict key management for any production deployment.

## License

Licensed under **AGPL-3.0**. See [`LICENSE`](./LICENSE).
