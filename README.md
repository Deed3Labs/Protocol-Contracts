# Deed Protocol

Deed Protocol is an open-source infrastructure stack for real-world asset tokenization, validation, credit issuance, and programmable settlement.

It ships as a full developer platform: smart contracts, deployment and upgrade tooling, frontend clients, backend APIs, and operational scripts in one repository.

> ⚠️ Status: Alpha (Developer Preview). Open-source and under active development. Smart contracts are unaudited and interfaces may change; do not use in production without independent security review and operational hardening.

## Protocol Scope

Deed Protocol provides:

- Asset tokenization via T-Deeds with validator-governed state and metadata
- Validator lifecycle management, fee routing, and agreement-aware validation workflows
- Asset structuring through subdivision (ERC-1155) and fractionalization (ERC-20)
- Credit primitives for credit lines, underwriting, compliance, and debt servicing
- Reserve and oracle infrastructure for pricing and risk controls
- BurnerBond issuance/redemption rails for discount-maturity bond instruments
- Claim escrow settlement for link-based payout and refund flows
- PWA-compatible frontend with installability, offline-aware caching, background sync, and notification support

## Developer Quickstart

### Contracts (repo root)

```bash
npm install
cp .env.example .env
npm run compile
npm run test
```

### Frontend (`app/`)

```bash
cd app
npm install
cp .env.example .env
npm run dev
```

### Backend (`app/server/`)

```bash
cd app/server
npm install
cp env.example .env
npm run dev
```

## Architecture

### Contract Layers

1. Asset Representation: T-Deeds, metadata rendering, validator + registry coordination
2. Asset Structuring: subdivision and fractionalization of underlying T-Deed assets
3. Capital Products: assurance pool/oracle and BurnerBond issuance + redemption
4. Credit System: stable/mutual credit lines, issuer policy, compliance and servicing
5. Settlement: claim escrow for sender lock, settler claim, and expiry refund paths

### Application Layers

1. Frontend (`app/`): wallet-connected UX for minting, portfolio, validation/admin, bonds, send/claim flows, and PWA delivery
2. Backend (`app/server/`): REST + websocket services for data aggregation, orchestration, notifications, and settlement support

## Credit System

The credit system is a first-class protocol component and not an external add-on.

- `StableCredit` + `MutualCredit`: credit-line-aware token accounting
- `CreditIssuer`: underwriting periods, compliance checks, default/write-off controls
- `CreditPool`: queued deposit/withdraw flows with discount-rate servicing
- `AccessManager`: admin/operator/member authority boundaries
- `AssurancePool` + `AssuranceOracle`: reserve and pricing inputs used in credit-related flows

This stack supports on-chain credit limits, debt tracking, repayments, and reserve-backed reimbursement mechanics.

## Smart Contract Module Map

### Core RWA Layer (`contracts/core`)

- `DeedNFT.sol`: upgradeable ERC-721 T-Deed token with trait storage and transfer policy controls
- `Validator.sol`: validation criteria, service fees, token whitelist, royalty config, and agreement handling
- `ValidatorRegistry.sol`: validator registration, status updates, and role propagation hooks
- `FundManager.sol`: validator fee accounting, commission routing, and compatible T-Deed registration
- `MetadataRenderer.sol`: trait-aware metadata generation, document and feature composition

### Asset Structuring (`contracts/extensions`, `contracts/core/factories`)

- `Subdivide.sol`: upgradeable ERC-1155 units for Land/Estate subdivision with unit-level validation
- `Fractionalize.sol`: asset lock/unlock + ERC-20 share issuance for T-Deed and subdivision assets
- `FractionToken.sol`: per-fraction ERC-20 token with wallet limits and pause controls
- `FractionTokenFactory.sol`: clone-based deployment factory for fraction tokens

### Bond + Assurance (`contracts/peripherals`, `contracts/core/factories`)

- `TokenRegistry.sol`: token registry, stablecoin metadata, chain mappings, fallback pricing
- `AssuranceOracle.sol`: Uniswap V3 pricing with registry fallback and RTD inputs
- `AssurancePool.sol`: primary/buffer/excess reserve accounting and conversion paths
- `BurnerBondFactory.sol`: collection factory + global bond parameter authority
- `BurnerBondDeposit.sol`: deposit processing and bond mint orchestration
- `BurnerBond.sol`: ERC-1155 bond collections with curve-based discount mechanics

### Credit Primitives (`contracts/core`, `contracts/extensions`, `contracts/peripherals`)

- `MutualCredit.sol`
- `StableCredit.sol`
- `CreditPool.sol`
- `CreditIssuer.sol`
- `AccessManager.sol`

### Settlement (`contracts/peripherals`)

- `ClaimEscrow.sol`: USDC escrow for transfer creation, claim settlement, and sender refunds

## Standards And Patterns

- Token standards: ERC-721, ERC-1155, ERC-20, ERC-2981
- Upgradeability: UUPS proxies where applicable
- Security controls: RBAC, pausability, reentrancy protections
- Metadata model: trait-driven rendering with structured document and feature fields

## Repository Layout

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
├── scripts/               # Operational and maintenance scripts
├── test/                  # Hardhat test suites
├── docs/                  # Protocol, architecture, UX, and integration docs
├── app/                   # React + Vite frontend
│   └── server/            # Express + WebSocket backend
├── hardhat.config.ts
└── package.json
```

## Contract Tooling

### Test Commands

```bash
npm run test
npm run test:core
npm run test:coverage
npm run test:gas
```

### Deployment Commands

Core protocol deployment:

```bash
npx hardhat run deploy/deploy_all.ts --network base-sepolia
```

BurnerBond + assurance deployment:

```bash
npm run deploy:burner-bonds:sepolia
npm run deploy:burner-bonds:base
```

Deploy components individually:

```bash
npm run deploy:token-registry -- base-sepolia
npm run deploy:assurance-pool -- base-sepolia
npm run deploy:assurance-oracle -- base-sepolia
npm run deploy:burner-bond-factory -- base-sepolia
npx hardhat run deploy/11_deploy_ClaimEscrow.ts --network base-sepolia
```

Grant claim settler role:

```bash
npm run send:grant-settler:base-sepolia
npm run send:grant-settler:base
```

### Verification And Upgrades

```bash
npm run verify:deployments:sepolia
npm run verify:deployments -- base
npm run upgrade:check -- base-sepolia
npm run upgrade:execute -- base-sepolia
```

Deployment artifacts are written to `deployments/<network>/<Contract>.json`.

## Backend API Surface

Primary route groups mounted in `app/server/src/index.ts`:

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

## PWA Compatibility And Usage

The frontend in `app/` is configured as a Progressive Web App.

Implemented capabilities:

- Web app manifest (`app/public/manifest.json`) with standalone display modes, app icons, shortcuts, and share target configuration
- Service worker (`app/public/sw.js`) with cache strategies for static assets, images, API responses, and HTML fallback behavior
- Offline status UX via `OfflineIndicator` and queued-action sync messaging
- Install flow through `InstallPrompt` (`beforeinstallprompt` + `appinstalled` handling)
- PWA runtime initialization through `PWAInitializer` (periodic sync registration and notification permission requests)
- Periodic/background sync hooks for portfolio and price refresh where browser support exists

Usage:

1. Open the frontend in a PWA-capable browser (Chrome/Edge on desktop or Android recommended).
2. Install via the in-app prompt or browser install action.
3. Grant notification permission to enable real-time update notifications.
4. Reopen in standalone mode for app-like behavior.
5. When offline, use cached views; stateful or network-critical endpoints may remain limited until connectivity returns.

Developer notes:

- Service worker registration and messaging utilities live in `app/src/utils/serviceWorker.ts`.
- PWA entry wiring is mounted in `app/src/components/PWAInitializer.tsx` and `app/src/App.tsx`.
- Keep API caching rules conservative for highly stateful endpoints (e.g. Plaid routes already use network-only strategy in the service worker).

## Engineering Workflow

Recommended contributor flow:

1. Implement contract/app/backend changes in focused PRs
2. Run relevant tests (`npm run test`, targeted suites, and app/server checks)
3. Update docs for interface or workflow changes
4. Validate deployment/upgrade scripts when touching contract initialization or permissions
5. Verify security assumptions when changing roles, settlement, pricing, or reserve logic

## Testing Scope

Current repository tests include:

- Core T-Deed stack: `DeedNFT`, `Validator`, `ValidatorRegistry`, `FundManager`, `MetadataRenderer`
- Oracle behavior: `AssuranceOracle`
- Settlement behavior: `ClaimEscrow`

Test locations:

- `test/core`
- `test/peripherals`

## Documentation

- Protocol index: [`docs/README.md`](./docs/README.md)
- Deployment runbooks: [`deploy/README.md`](./deploy/README.md)
- Frontend docs: [`app/README.md`](./app/README.md)
- Backend docs: [`app/server/README.md`](./app/server/README.md)

## Security

- Critical flows use role-based access control, pause controls, and reentrancy protections
- Upgradeable modules require strict admin governance (multisig or equivalent)
- Validate oracle, token registry, credit policy, and settlement role assumptions before production use

## Contributing

Issues and pull requests are welcome. Keep changes scoped, include tests for behavior changes, and update documentation when interfaces or workflows move.

## License

Licensed under **AGPL-3.0**. See [`LICENSE`](./LICENSE).
