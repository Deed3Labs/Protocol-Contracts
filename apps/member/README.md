# The member app

`@clear/member` — the consumer PWA. A member deposits USDC, watches savings and equity credits
accrue, draws on a credit line, sends money, taps a card, and approves charges raised at a merchant
counter. Deploys to `useclear.org` from root directory `apps/member`.

React 19 + Vite 7 + Tailwind 4, Radix primitives, React Router 7.

> This app was the Deed Protocol frontend before it was Clear. The T-Deed surface is still here —
> `DeedNFTContext`, the Mapbox asset map, the subdivide/fractionalize modals, the bond components —
> but it is no longer what the app is for, and none of it is routed from the nav.

---

## Quickstart

Requires **Node ≥ 20.19**. Run from the repo root so the workspace resolves `@clear/domain`.

```bash
npm install                              # repo root, installs the whole workspace
cp apps/member/.env.example apps/member/.env
npm run dev --workspace @clear/member    # http://localhost:5173
```

The app expects the API at `VITE_API_BASE_URL` (default `http://localhost:3001`). Run it alongside:

```bash
cd apps/api && npm run dev
```

Scripts, all from `apps/member`:

| | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b`, then `vite build`, then the secret scan |
| `npm run test` | `bun test src` — colocated `*.test.ts` next to what they cover |
| `npm run lint` | ESLint |
| `npm run scan:secrets` | `scripts/scanBundleSecrets.mjs` against `dist/` |

---

## Auth and wallets

**Privy, not Reown.** `src/AppKitProvider.tsx` keeps the old name and nothing else: it composes
`PrivyProvider` → `QueryClientProvider` → `WagmiProvider` (from `@privy-io/wagmi`) →
`SmartWalletsProvider` → `AppKitAuthProvider`.

- **Login is identity only** — email, SMS, Google, Apple, X, GitHub, Discord, Farcaster. An external
  wallet is not a login; members link one in-app. The Privy smart wallet is the primary wallet, and
  it is where funds live.
- **Embedded wallet** is created for users without one, with `showWalletUIs: false` — the embedded
  signer signs silently and the app's own Review screen is the confirmation. There is no Privy
  approve popup to design around.
- **Smart wallets** are ZeroDev Kernel accounts layered on the embedded EOA, enabled in the Privy
  dashboard. `useSmartWallets().client.sendTransaction({ calls })` batches and is sponsored by the
  per-chain paymaster registered there. That is what makes deposits and sends gasless.
- `wagmiConfig` and the `wagmiAdapter` shim are exported from the same file so `lib/{sendCalls,
  autopay,aa,gaslessMoney,lifi}.ts` keep working against `@wagmi/core` actions unchanged.

Wallet chains enabled for connection and `switchChain`: Base, Base Sepolia, Ethereum, Sepolia,
Arbitrum, Optimism, Polygon, Gnosis. The wide list exists for LI.FI routing — Clear itself only
operates on one chain at a time (below).

`ProtectedRoute` gates the authenticated shell; `useLogout` tears the session down.

### Which chain is live

`src/lib/clearNetwork.ts` decides by **hostname**, not by env:

```ts
export const IS_LIVE_APP = window.location.hostname === 'app.useclear.org';
export const ACTIVE_CHAIN_ID = IS_LIVE_APP ? 8453 : 84532;   // Base : Base Sepolia
```

Everything gasless — deposit, redeem, send — runs on `ACTIVE_CHAIN_ID`. Balances are filtered the
same way (`includeChainBalance`): the live app shows mainnet balances only, every other host shows
testnet only. Real funds stay off the demo and test funds stay off production without anyone
remembering to flip a variable.

---

## Routes

Defined in `src/App.tsx`. Pages live in `src/pages/app` and `src/pages/auth`.

### Signed in — inside `ProtectedRoute` → `AppShell`

| Route | Component | Screen |
|---|---|---|
| `/` | `HomeRoute` | Balance, limit, what is due |
| `/savings` | `SavingsRoute` | The ESA — deposit, redeem, equity credits, bonds |
| `/earn` | `EarnRoute` | Credit line, tiers, plans |
| `/send` | `SendRoute` | Send to a wallet, email or phone |
| `/activity` | `ActivityRoute` | Transactions across chain and linked banks |
| `/card` | `CardRoute` | The Clear card, controls, details |
| `/scan` | `ScanPage` | Camera, Clear codes |
| `/contacts` | `ContactsPage` | Directory and handles |
| `/partners` | `PartnersPage` | Where credit spends |
| `/assurance` | `AssurancePage` | Reserve |
| `/inbox` | `InboxRoute` | Alerts and XMTP threads |
| `/alerts` | — | Redirects to `/inbox`; the standalone page became its first tab |
| `/settings` | `SettingsRoute` | Not a nav item — reached from the avatar menu |
| `/learn/:topic` | `ExplainerPage` | In-app explainers |

### Outside the shell

| Route | Component | Why it is public |
|---|---|---|
| `/login` | `LoginRoute` | |
| `/onboarding` | `OnboardingRoute` | |
| `/s/:shop` | `CounterOnboardingRoute` | Signup started at a merchant counter. `?total=` carries the sale **for display only** — this route can never authorize a charge |
| `/c/:code` | `ChargeApprovalRoute` | The link in a charge alert. Outside the shell so an unauthenticated member signs in and comes back, rather than the shell bouncing them elsewhere. It brings its own `MemberProfileProvider`, because the shell's is not above it |
| `/claim/:token` | `ClaimFunds` | The recipient side of a send link. Needs no account |
| `/wallet-link` | `WalletLink` | Linking an external wallet |
| `/share` | `ShareTarget` | PWA share target |

Anything else redirects to `/login`.

Nav is six items on desktop and five on the mobile pill (`src/components/shell/navItems.ts`): Send
is the pill's action button rather than a tab, because sending is something you do, not somewhere
you go.

### Route container, then page

Screens come in pairs. `SavingsRoute.tsx` reads data — hooks, contexts, the API — and
`SavingsPage.tsx` renders what it is handed. The same split holds for Home, Earn, Send, Activity,
Card, Inbox, Settings, Login and charge approval. Every field falls back rather than blanking, so a
page never shows a zero it has not actually read.

---

## Source layout

```
src/
  AppKitProvider.tsx   Privy + wagmi + smart wallets, in that order
  App.tsx              routes
  pages/app            signed-in screens (Route container + Page pair)
  pages/auth           login, onboarding, counter onboarding, claim, wallet link
  components/shell     AppShell, TopNav, MobileTabBar, ProfileMenu, navItems
  components/clear     the money UI — balances, keypad, limit breakdown, card face, dialogs
  components/app-ui    app-level primitives
  components/ui        shadcn/Radix primitives
  components/          the Deed-era surface: DeedNFTMap, viewers, subdivide/fractionalize, bonds
  context/             Portfolio, Credit, Pay, Kyc, Bridge, Contacts, LinkedWallets, XMTP, …
  hooks/               data hooks — useClearBalances, useClearCard, usePlaid*, useWebSocket, …
  lib/                 the model: clearModel, creditMapping, earnMapping, cashflow, clearCode, …
  config/              networks, tokens, send, clientEnv
  utils/               apiClient, authSession, serviceWorker, rpcOptimizer, EIP5792Utils
  contracts/           committed ABI JSON, per network
```

`src/lib` is where the display rules live and where most of the unit tests point. It is the app's
half of the arithmetic; anything the merchant app must also agree on lives in `packages/domain`
instead.

---

## Talking to the API

`src/utils/apiClient.ts` is the one door. Every request carries:

- `Authorization: Bearer <Privy access token>` — from `getAccessToken()`
- `X-Wallet-Address: <active wallet>` — set by the auth provider on every account change, so the
  server can bind a request to the wallet actually connected rather than to whatever the token was
  minted for

`X-Reown-Project-Id` is still sent when `VITE_APPKIT_PROJECT_ID` is set. Nothing on the server reads
it — the API's auth is Privy JWT verification end to end — and both the header and the variable are
vestigial.

Live updates come over socket.io (`useWebSocket`) against the same host.

---

## Environment

`VITE_*` variables are compiled into the bundle that every visitor downloads. Two rules follow, and
both are enforced by tooling rather than by review.

**No provider secret is ever a `VITE_` var.** An Alchemy URL carries its key in the path, so setting
one publishes it. Ours was taken that way out of the deployed bundle and spent on chains we do not
support. The key belongs in the API's env as `ALCHEMY_API_KEY`; the browser uses public RPC and
anything needing the key goes through the API. `npm run build` runs `scripts/scanBundleSecrets.mjs`
over `dist/` and fails the build if a provider key reached it — a build gate, not a lint.

**Env vars are read by literal name, never by computed key.** Vite substitutes the literal text
`import.meta.env.VITE_FOO`; a dynamic `import.meta.env[key]` has no literal to match, so Vite
serialises the *whole* env object into the bundle instead. That is how the key leaked — three
chain-id-keyed helpers, none of which named `VITE_ALCHEMY_*` at all. `src/config/clientEnv.ts` is
the allowlist that closes it: a variable is reachable from the browser only if it is spelled out
there. Adding a chain means adding its lines by hand, and the tedium is the point.

The ones that matter day to day:

| Variable | |
|---|---|
| `VITE_PRIVY_APP_ID` | **Required.** Privy dashboard → App settings |
| `VITE_API_BASE_URL` | API origin; defaults to `http://localhost:3001` |
| `VITE_ZERODEV_PROJECT_ID` | Account abstraction / session keys |
| `VITE_MAPBOX_PUBLIC_TOKEN` | The asset map |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Card on-ramp |
| `VITE_VAPID_PUBLIC_KEY` | Web push |
| `VITE_INFURA_*` | Optional browser RPC. A project ID is public by design — restrict it by domain in the Infura dashboard. Never the project secret |
| `VITE_CLRUSD_*`, `VITE_ESA_VAULT_*`, `VITE_SEND_*` | Per-chain addresses, allowlisted in `clientEnv.ts` |
| `VITE_APPKIT_PROJECT_ID` | Vestigial — see above |

`.env.example` still lists the Reown-era names and has not caught up with the Privy migration; treat
this table as the current list.

---

## PWA

Installable, and the install is the intended way to run it.

- **Manifest** — `public/manifest.json`: `standalone`/`fullscreen`, `navigate-existing` launch
  handling, shortcuts (Scan to pay, and others), share target.
- **Service worker** — `public/sw.js`, per-route cache strategies. Stateful endpoints such as Plaid
  are network-only; keep new API caching rules conservative for anything that moves money.
- **Offline** — `OfflineIndicator` surfaces connection state; `useOffline` and `useRefreshOnResume`
  drive what re-reads when the app comes back.
- **Install** — `lib/installPrompt.ts` registers the `beforeinstallprompt` listener at *import*
  time, because the event fires once, early, and browsers do not replay it; a component that
  starts listening on mount has already missed it. `PwaInstallTakeover` is the first-visit
  full-screen prompt, with a manual Add to Home Screen path for Safari, which has no one-click
  install. `useInstallMode` reports how the app is running.
- **Sync** — background and periodic sync are registered for two tags only, `sync-portfolio` and
  `sync-prices`: they refresh data, they do not replay queued writes.
- **Runtime** — `PWAInitializer` registers that sync and requests notification permission.
  Registration helpers are in `src/utils/serviceWorker.ts`.

---

## Further reading

- Root [`README.md`](../../README.md) — the monorepo, the contracts, the deployed addresses
- [`docs/ux/clear-app-design-spec.md`](../../docs/ux/clear-app-design-spec.md) — the nav and screens
  this app is built to
- [`docs/reference/clear-app-reference-screens.html`](../../docs/reference/clear-app-reference-screens.html)
  — static reference screens
- [`docs/ux/clear-onboarding-plan.md`](../../docs/ux/clear-onboarding-plan.md) — the onboarding flow
- [`apps/api/README.md`](../api/README.md) — the API this app talks to
- `docs/` in this directory — data-fetching, caching and pricing architecture notes

---

## License

Proprietary — all rights reserved. See [`NOTICE.md`](../../NOTICE.md) for how the licenses split
across this repository, and why no application code may import Solidity source from `contracts/`.
