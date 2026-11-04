# Going live: environments, providers, webhooks

What decides whether a running copy of Clear moves test money or real money, what each outside
provider needs from the API's environment, and the webhook endpoints the API exposes. API
variables are in [`apps/api/env.example`](../../apps/api/env.example) unless marked otherwise; the
apps' are in their own `.env.example`. Who decides that a deployment goes live is in
[Governance](../governance/README.md).

## There is no single switch

**The code has no one "environment" setting.** The chain is chosen in one place, each provider by
its own variable or by the mode of its key, and the Command Center per section. A deployment is
live only when every setting below is on its live side; one left on a sandbox makes a deployment
that is part test, part real.

Unless stated otherwise, a provider whose key is not set is off: its routes answer that it is not
configured.

### `NODE_ENV`

Neither the Dockerfile nor `railway.json` sets it. **Set `NODE_ENV=production` on every deployed
environment**: an unset value counts as production for some checks and not for others.

| Check | Treats as production |
|---|---|
| `SEND_OTP_BYPASS_ENABLED` | Anything but `development` or `test`, unset included: the bypass is ignored |
| `SEND_SKIP_ESCROW_TX_VERIFICATION` | `production` only: unset still lets the skip through |
| `PAY_SECRETS_KEY`, `REWARDS_TOKEN_SECRET` | `production` only: missing, it refuses; otherwise it makes a key for this process alone, so nothing it signs outlives a restart |
| Postgres TLS | `production` turns it on, unless `POSTGRES_SSL_MODE` or the URL's `sslmode` says otherwise |
| Error responses | `development` only: the redacted error goes back to the caller |

### The chain

| Where | Decides by | Values |
|---|---|---|
| API | `ACTIVE_CHAIN_ID`, else `SEND_DEFAULT_CHAIN_ID` | `8453` (Base) when neither is set; `84532` for Base Sepolia |
| API balances | `DATA_CHAIN_IDS` | The active chain alone unless widened ([Deploying the server](./api-deploy.md#environment-flags)) |
| Member app | Its hostname, not a variable ([`clearNetwork.ts`](../../apps/member/src/lib/clearNetwork.ts)) | The live hostname is Base and shows mainnet balances only; every other host is Base Sepolia and shows testnet only |
| Merchant app | `VITE_MEMBER_APP_URL` | Where a scanned charge code opens. It must be the member app on the same chain as the counter's API |
| Rewards app | `VITE_CLEAR_NETWORK` | `mainnet`, or testnet for anything else |
| Command Center | Fixed | Reads Base Sepolia: the only address book in [`packages/command-types`](../../packages/command-types/src/chain/) |

Contract addresses are per chain: `CLRUSD_<chainId>`, `ESA_VAULT_<chainId>`, the `*_84532`
addresses the credit services read, `SEND_CLAIM_ESCROW_ADDRESS_<chainId>` and the savings relayer's
`SAVINGS_*_<chainId>`. Where they come from is [Deploying the contracts](./deploying-contracts.md).

### Builds and deploys

- **Vercel** always builds an app's production deployment. A preview builds only for a pull
  request, or on `dev`, whose previews are deployed like production; and even then it is skipped
  when nothing that app builds from changed since its last deployment, or when the commit message
  says `[skip preview]` ([`scripts/vercel-ignore.sh`](../../scripts/vercel-ignore.sh), called from
  each app's `vercel.json`).
- **Railway** rebuilds the API only when a path in
  [`apps/api/railway.json`](../../apps/api/railway.json)'s `watchPatterns` changed: the API, the
  packages it links, and its Docker and Railway files.
- **The browser apps bake their variables in at build time** (`VITE_*`). Changing one means a new
  build, and anything with that prefix is public ([Setting up](../developers/setup.md#environment)).

### Cross-origin

`CORS_ORIGIN` lists the origins allowed to call the API. `STRICT_CORS=true` refuses anything not
listed; without it the API allows every origin. `ALLOW_VERCEL_PREVIEWS=true` also admits Vercel
preview hosts. The public `/v1` API has its own CORS, per shop.

The installed merchant app (Capacitor) calls the API from `capacitor://localhost` on iOS and
`https://localhost` on Android. With `STRICT_CORS=true`, add both to `CORS_ORIGIN`
([Setting up → The installed merchant app](../developers/setup.md#the-installed-merchant-app)).

## Providers

Each provider's sandbox and live sides, the variable that chooses between them, and what else it
needs.

| Provider | What it does here | Sandbox or live chosen by |
|---|---|---|
| Bridge | KYC and KYB, virtual accounts, deposits, withdrawals, Send payouts | `BRIDGE_ENV` |
| Lithic | Cards, card authorisations, ACH | `LITHIC_ENV` and `LITHIC_ALLOW_PRODUCTION` |
| Plaid | Bank linking and balances, member and merchant | `PLAID_ENV` |
| Stripe | Membership billing, merchant Connect accounts, Terminal readers, Pay with Clear cards, Send payouts | The key's mode |
| Coinbase Onramp | Buying and selling USDC by card | `RAMP_SANDBOX` |
| Onramper | The other on-ramp | The key's mode |
| Coinbase CDP | The Send and savings relayers' wallets | The network each relayer is told |
| Privy | Sign-in, merchant organisation wallets | Which Privy app the ids name |
| Resend, Twilio | Email; texts | No sandbox in the code |
| Umami | Visits, read back by the Command Center | No sandbox in the code |

### Bridge

`BRIDGE_API_KEY` is the live key. **`BRIDGE_ENV=sandbox` swaps the sandbox in at start-up**, before
anything reads Bridge's settings ([`bridgeEnv.ts`](../../apps/api/src/config/bridgeEnv.ts)):
`BRIDGE_SANDBOX_API_KEY` becomes the key, the base URL becomes Bridge's sandbox, and
`BRIDGE_SANDBOX_WEBHOOK_PUBLIC_KEY`, when set, replaces the webhook keys. With `BRIDGE_ENV=sandbox`
and no sandbox key, Bridge is left unconfigured rather than pointed at live.

It also needs `BRIDGE_WEBHOOK_PUBLIC_KEY` (below), and `BRIDGE_ONBOARDING_REDIRECT_URI` for where
hosted KYC returns. Send's fiat payouts use Bridge when `SEND_PAYOUT_PROVIDER` is `bridge_only` or
`stripe_bridge_jit`; it is `mock` until then, and the `SEND_BRIDGE_*` variables shape those
transfers.

**Bank withdrawals** are `POST /api/withdraw/:wallet`
([`withdraw.ts`](../../apps/api/src/routes/withdraw.ts)): USDC on Base is off-ramped by Bridge to a
bank account the member linked with Plaid, after a step-up. `rail` is `ach` (standard) or
`ach_same_day`, which charges Clear's fee through Bridge's `developer_fee_percent`:
`BRIDGE_INSTANT_WITHDRAW_FEE_PERCENT`, 1 when unset (not in `env.example`). It needs Bridge and
Plaid both configured, and a Bridge customer for the member's verified email; otherwise it answers
`503` with `notConfigured`. The response carries a
Bridge deposit address: the client must send the USDC there, or the transfer stays
`awaiting_funds`. **No member-app screen reaches this route**
([Developers → Known limitations](../developers/README.md#member-app)).

### Lithic

**Sandbox is the default, and production takes two variables:** `LITHIC_ENV=production` and
`LITHIC_ALLOW_PRODUCTION=true`. Naming production without the second refuses to talk to Lithic at
all. Nothing Lithic runs until `LITHIC_API_KEY` is set. Issuing a card also needs
`LITHIC_CARD_PRODUCT_ID`. Settling card spend on chain signs with `CARD_SETTLER_PRIVATE_KEY`; which
wallet holds which role is in [On-chain authority](../governance/on-chain-authority.md).

The integration in full: [Lithic](../developers/integrations/lithic.md).

### Plaid

`PLAID_ENV=production` uses Plaid's production; anything else uses its sandbox. It needs
`PLAID_CLIENT_ID` and `PLAID_SECRET` for that environment, `PLAID_REDIRECT_URI` (also allowed in
Plaid's dashboard) for OAuth banks, and `PLAID_TOKEN_MASTER_KEY` or `PLAID_TOKEN_KEYRING_JSON`:
linked banks' tokens are stored encrypted, and without a key they cannot be stored.

### Stripe

**One key, `STRIPE_SECRET_KEY`, and its prefix is the mode**: `sk_live_` or `rk_live_` is live,
anything else is test. Everything Stripe follows it:

- `STRIPE_PUBLISHABLE_KEY` is used only when its mode matches.
- A Connect endpoint receives both live and test events; an event in the other mode is recorded and
  not acted on.
- A Pay with Clear session in test mode is never offered a card on a live key.

Membership billing also needs `STRIPE_YEARLY_MEMBERSHIP_PRICE_ID` and
`STRIPE_LIFETIME_MEMBERSHIP_PRICE_ID`, from the same Stripe account and mode as the key, and the
registry it writes to: `MEMBERSHIP_REGISTRY_ADDRESS`, `MEMBERSHIP_RPC_URL`, `MEMBERSHIP_CHAIN_ID`.
Connect onboarding returns to `MERCHANT_APP_URL`. Terminal readers have no variables of their own.

`SHOP_STRIPE_SECRET_KEY` is a different account: the website shop's, where hardware deposits are
taken. The merchant app reads reservations from it and refunds there. Unset, the hardware-orders
routes answer `503` `not_configured` and the merchant app says hardware orders aren't connected yet.

### Coinbase Onramp and Onramper

`RAMP_PROVIDER` picks one: `coinbase` when unset, or `onramper`. Bank deposits are not here; they
are Bridge.

- **Coinbase:** `CDP_ONRAMP_API_KEY_ID` and `CDP_ONRAMP_API_KEY_SECRET` (falling back to the Send
  relayer's CDP keys, then `CDP_API_KEY_*`). `RAMP_SANDBOX=true` marks every order as a sandbox
  order: it always succeeds and no card is charged. Leave it unset on a live deployment.
- **Onramper:** `ONRAMPER_API_KEY`, whose prefix is its mode (`pk_test_` or `pk_prod_`).

### The relayers

The relayers submit gasless Send and savings transactions.

| | Mode | Signs with |
|---|---|---|
| Send | `SEND_RELAYER_MODE`: `local_key` (default), `managed_webhook` or `cdp_server_wallet` | `SEND_RELAYER_PRIVATE_KEY`; an outside signer at `SEND_RELAYER_MANAGED_SIGNER_URL`; or a CDP server wallet from `SEND_CDP_*` |
| Savings | `SAVINGS_RELAYER_MODE`, else Send's: `local_key` or `cdp_server_wallet` (default) | `SAVINGS_RELAYER_PRIVATE_KEY`, or a CDP server wallet from `SAVINGS_CDP_*` |

**A CDP wallet signs on the network it is told** (`SEND_CDP_NETWORK_<chainId>`,
`SAVINGS_CDP_NETWORK_<chainId>`, or the unsuffixed fallback). A network that does not match the
chain, such as `base` for chain `84532`, stops the transaction
([`cdpNetworkGuard.ts`](../../apps/api/src/services/cdpNetworkGuard.ts)).

**Two Send defaults suit development only:**

- **`SEND_RELAYER_ALLOW_SIMULATION`**: `true` unless set. When the relayer is misconfigured, it
  returns a simulated transaction hash instead of failing. Set it to `false` live.
- **`SEND_RELAYER_REQUIRE_RECEIPT_CONFIRMATION`**: `true` unless set. Leave it on.

### Privy

`PRIVY_APP_ID` (or `VITE_PRIVY_APP_ID`) and `PRIVY_APP_SECRET` verify sign-ins; the apps'
`VITE_PRIVY_APP_ID` must name the same app. There is no test switch in the code: an environment is
whichever Privy app these name, and each app's allowed origins are set in Privy's dashboard.
Merchant organisation wallets also need `PRIVY_AUTHORIZATION_PRIVATE_KEY` (its public half,
`PRIVY_AUTHORIZATION_PUBLIC_KEY`, is registered as a signer on each), and gas sponsorship switched
on in Privy's dashboard for the chain in use. Without the private key, a merchant withdrawal is
recorded as a request and says so.

### Email and texts

- **Email** goes by Resend whenever `RESEND_API_KEY` is set, from `RESEND_FROM` on a domain verified
  in Resend. The Command Center's invites use it too.
- **Texts** follow `SEND_NOTIFICATION_PROVIDER`: `mock` (the default, logs and sends nothing),
  `twilio`, or `generic_webhook` (posts to `SEND_NOTIFICATION_WEBHOOK_URL`). Twilio needs
  `SEND_TWILIO_ACCOUNT_SID`, `SEND_TWILIO_AUTH_TOKEN`, and a messaging service or a from number.
  Receipts, Send claims and Clear Terminal's table-ready and order-ready texts all go this way.
- **Push** needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`, with the member app's
  `VITE_VAPID_PUBLIC_KEY` the same public key; without them push is skipped.

### Analytics

The member and merchant apps load Umami from `VITE_UMAMI_SRC` and `VITE_UMAMI_WEBSITE_ID`, and only
on their live hostnames. The API reads visits back for the Command Center with `UMAMI_API_URL`,
`UMAMI_USERNAME`, `UMAMI_PASSWORD` and the site ids (`UMAMI_WEBSITE_ID`, `UMAMI_MEMBER_WEBSITE_ID`,
`UMAMI_MERCHANT_WEBSITE_ID`).

### Off until set

Some features stay inert until a variable names them, so a deployment can go live without them:
`CLEAR_FEE_COLLECTION_ADDRESS` (collecting Clear's fee from a shop's wallet; until set, fees are
billed and wait as due), `PROTOCOL_EVENT_LISTENER` and `PORTFOLIO_SNAPSHOTS`
([Deploying the server](./api-deploy.md#environment-flags)). Also:

| Variable | Without it |
|---|---|
| `VERCEL_TOKEN` and `VERCEL_REWARDS_PROJECT_ID`, with `VERCEL_TEAM_ID` when the project is a team's (not in `env.example`) | A shop's custom domain is saved as `pending` and never added to Vercel or verified ([`vercel.ts`](../../apps/api/src/services/merchant/rewards/vercel.ts)) |
| `SHOP_STRIPE_SECRET_KEY` | Hardware orders can't be listed ([Stripe](#stripe)) |
| `AUTO_TERM_LIMITS` (not in `env.example`) | The automatic split-plan limit runs on Base Sepolia (`84532`) only. `on` runs it on any chain; any other value turns it off everywhere ([`termLimitService.ts`](../../apps/api/src/services/credit/termLimitService.ts)). The rule's figures are proposals not yet signed off ([Governance → Parameters](../governance/parameters.md)) |

## Webhooks

**Every webhook route is public and checks a signature over the raw request body.** The API keeps
the raw bytes of every JSON request for this. Give each provider `https://<api-host>` followed by
the path.

| Path | From | Checks | Secret |
|---|---|---|---|
| `/api/webhooks/bridge` | Bridge: deposits into virtual accounts, withdrawals | `X-Webhook-Signature`: RSA-SHA256 over the timestamp and body, against Bridge's public key; older than 5 minutes is refused (`SEND_BRIDGE_WEBHOOK_MAX_AGE_SECONDS`) | `BRIDGE_WEBHOOK_PUBLIC_KEY`; `BRIDGE_WEBHOOK_PUBLIC_KEYS` for rotation |
| `/api/webhooks/lithic` | Lithic: ACH, returns, card events, card shipped | Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) | `LITHIC_WEBHOOK_SECRET` |
| `/api/webhooks/lithic/auth-stream` | Lithic: approve or decline a card authorisation | Standard Webhooks | `LITHIC_ASA_SECRET`, else `LITHIC_WEBHOOK_SECRET` |
| `/api/stripe/webhooks/membership` | Stripe: membership checkouts, subscriptions, invoices | `Stripe-Signature` | `STRIPE_MEMBERSHIP_WEBHOOK_SECRET`, else `STRIPE_WEBHOOK_SECRET` |
| `/api/stripe/webhooks/connect` | Stripe: events from shops' connected accounts | `Stripe-Signature` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| `/api/webhooks/coinbase-ramp` | Coinbase: on-ramp and off-ramp transactions | `X-Hook0-Signature`: HMAC-SHA256 over the timestamp and body; older than 5 minutes is refused | `CDP_RAMP_WEBHOOK_SECRET` |
| `/api/webhooks/onramper` | Onramper: on-ramp transactions | HMAC-SHA256 of the body | `ONRAMPER_WEBHOOK_SECRET`, `ONRAMPER_WEBHOOK_SECRET_PROD`: either matches |
| `/api/send/webhooks/bridge-transfer` | Bridge: Send payout transfers | Bridge's signature when a Send public key is set, else a shared secret in `X-Send-Bridge-Webhook-Secret` | `SEND_BRIDGE_WEBHOOK_PUBLIC_KEY(S)`, or `SEND_BRIDGE_WEBHOOK_SECRET` |
| `/api/send/webhooks/payout` | The payout provider in `generic_webhook` mode | `X-Send-Webhook-Secret` equals the secret | `SEND_PAYOUT_WEBHOOK_SECRET` |
| `/api/command/webhooks/plaid` | Plaid: the Command Center's bank link | `Plaid-Verification`: an ES256 JWT, signed with Plaid's key, issued within 5 minutes, carrying the body's SHA-256 | None: the key is fetched from Plaid |

**What a route does when its secret is not set differs, and three accept unsigned requests.** Set
every secret on a live deployment.

| Secret not set | Routes |
|---|---|
| Every request refused | Bridge, Lithic, both Stripe routes, Send's `bridge-transfer` |
| Every card authorisation declined | The auth stream (it answers `SUSPECTED_FRAUD`) |
| **Every request accepted, unchecked** | Coinbase, Onramper, Send's `payout` |

The Command Center's Plaid webhook is registered with Plaid from `COMMAND_PLAID_WEBHOOK_URL`, and
only for the sandbox link it makes ([The Command Center's live switches](./command-center-live-switches.md)).

The API has no route for Twilio's delivery callbacks: `SEND_TWILIO_STATUS_CALLBACK_URL` is passed to
Twilio as it is.

### Webhooks Clear sends

Pay with Clear sends shops' own servers signed events (`Clear-Signature`), retried for 3 days. That
is a shop's integration, documented for developers: [Webhooks](../../apps/member/public/docs/webhooks.md).
