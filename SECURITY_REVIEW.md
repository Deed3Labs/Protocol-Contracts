# Security & Integration Review (Initial Pass)

Date: 2026-02-18
Scope reviewed:
- Smart contracts (`contracts/`)
- Backend API server (`app/server/src`)
- Frontend API/SDK integration (`app/src`)

> This is a targeted code review and build/test sanity pass, **not** a full formal audit.

## Executive Summary

I found multiple high-risk issues that should be fixed before production use:

1. **Build-breaking smart-contract import bug** (project cannot compile as-is).
2. **Critical Plaid authorization/privacy gap**: Plaid data is keyed only by a user-supplied wallet address with no proof-of-wallet ownership.
3. **Plaid token persistence risk**: access tokens are stored in process memory and are lost on restart (availability/reliability issue).
4. **Over-broad CORS behavior**: all `*.vercel.app` origins are trusted regardless of configured allowlist.

API usage quality:
- **Alchemy**: generally efficient (batching + lightweight throttling + retries).
- **Plaid**: has good caching to reduce billable calls, but auth model is weak.
- **LI.FI**: reasonable integration; no obvious critical misuse seen in sampled files.
- **Bridge**: currently minimal/placeholder endpoint; not unsafe by itself but not hardened.

## Findings

### 1) Build-breaking contract import path (High)
- `contracts/core/factories/BurnerBondFactory.sol` imports `../interfaces/IBurnerBond.sol` and `../interfaces/IBurnerBondDeposit.sol`. In this repo, those interfaces live under `contracts/core/interfaces/burner-bond/`.
- The compile command fails because `contracts/core/interfaces/IBurnerBond.sol` does not exist.

**Impact**
- Prevents successful compilation/deployment from a clean checkout.
- Blocks CI reliability and downstream security tooling.

**Evidence**
- Source import lines: `contracts/core/factories/BurnerBondFactory.sol` lines 9-10.
- Compile output: `HH404` missing `contracts/core/interfaces/IBurnerBond.sol`.

**Recommendation**
- Fix import paths in `BurnerBondFactory.sol` to `../interfaces/burner-bond/...`.
- Add CI compile gate if missing.

---

### 2) Plaid endpoints trust arbitrary `walletAddress` values with no auth (Critical)
- Plaid data is keyed by `walletAddress.toLowerCase()` and stored in `accessTokenStore`.
- Endpoints like `/link-token`, `/exchange-token`, `/balances`, and `/disconnect` accept wallet address directly from request body/query and do not verify wallet ownership (e.g., signed nonce/session).

**Impact**
- Any caller who knows/guesses a wallet address can potentially:
  - query linked bank data for that wallet,
  - manipulate link/disconnect flow,
  - interfere with linked item state.
- This is a sensitive financial privacy/auth issue.

**Evidence**
- In-memory map and keying: `accessTokenStore` and comments in `plaid.ts` lines 35-41.
- Key derivation from unverified input: lines 86-99, 151-170, 227-236, 826-847.

**Recommendation**
- Require authenticated user session + wallet ownership proof (SIWE or signed challenge nonce).
- Authorize every Plaid read/write action against authenticated principal.
- Add audit logging for link/exchange/disconnect actions.

---

### 3) Plaid access tokens are in-memory only (Medium)
- Code comment explicitly says in-memory storage and advises replacing with Redis/DB.
- Restarting server drops all mappings.

**Impact**
- Reliability and support risk: users must relink after restarts/deploys.
- Operational inconsistency across multiple server instances.

**Evidence**
- `plaid.ts` lines 35-41.

**Recommendation**
- Move encrypted access-token storage to persistent store (DB + KMS/secret management).
- Use instance-safe storage and token lifecycle controls.

---

### 4) CORS allows all `*.vercel.app` origins (Medium)
- Server allows Vercel preview URLs unconditionally (`origin.endsWith('.vercel.app')`), even if not in explicit allowlist.

**Impact**
- Expands trusted browser origins beyond intended set.
- Increases exposure if any preview domain is compromised or misused.

**Evidence**
- `app/server/src/index.ts` lines 42-43 and 66-72.

**Recommendation**
- Restrict previews to explicit project preview domains or signed origin checks.
- Avoid blanket `*.vercel.app` trust in production.

## API Integration Efficiency Assessment

### Alchemy
**Status: Good (with room to tune)**
- Uses address-batch token pricing requests per network in `getAlchemyPricesBatch`.
- Uses lightweight per-chain/global throttling and retry wrappers in balance service.

Potential improvement:
- Expand cache hit ratios for hot token metadata/price paths if traffic grows.

### Plaid
**Status: Cost-efficient but security-weak**
- Good: Redis caching with route-specific TTLs reduces expensive Plaid calls.
- Weak: identity/auth model around walletAddress is insufficient for sensitive financial data.

### LI.FI
**Status: Acceptable in sampled code**
- SDK configured with wallet client + chain switching.
- No obvious critical misuse in reviewed files.

Potential improvement:
- Add quote/token metadata memoization to reduce repeated SDK token lookups under rapid UI interactions.

### Bridge
**Status: Minimal integration / placeholder**
- Endpoint currently builds URL from env base and request params, with placeholder for API-key flow.

Potential improvement:
- Add strict input validation and an authenticated flow if endpoint is intended for production funding orchestration.

## Commands Run

- `npm run compile`
- `rg -n "tx\.origin|delegatecall|selfdestruct|call\{|abi\.encodePacked\(|unchecked|reentr|onlyOwner|TODO|FIXME" contracts app/server/src -S`
- `rg -n "lifi|li\.fi|alchemy|infura|plaid|bridge" app/server/src app/src app/package.json app/server/package.json -S`

## Next Steps (Priority Order)

1. Fix contract import path + restore compile green state.
2. Implement authentication and wallet ownership verification for all Plaid endpoints.
3. Move Plaid token storage to encrypted persistent store.
4. Tighten CORS allowlist behavior for production.
5. Add integration tests covering Plaid auth boundaries and CORS policy.
