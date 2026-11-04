# Lithic integration

Lithic is the banking and card rail for the member app. Clear uses Lithic's **Program Managed**
model: Lithic and its partner bank handle sponsorship, KYC, AML/BSA, ledgering, card manufacture
and network connectivity. Clear sets spend logic and business rules through Lithic's API.

The code is in [`apps/api/src/services/lithic`](../../../apps/api/src/services/lithic/), the
routes in `apps/api/src/routes/lithic*.ts`. Nothing inside the Lithic service talks to the chain:
the two rails meet only in the savings sweep, card settlement and the reconciler. Environment
variables and webhook secrets are in [Going live → Lithic](../../operators/going-live.md#lithic).
Lithic's own reference is at `https://docs.lithic.com`.

---

## 1. The money model

Two rails, kept apart.

| | Lives in | Card-spendable | Purpose |
|---|---|---|---|
| **Cash account** | A routable Lithic Financial Account (USD) | Yes | Direct deposit lands here; the card spends from it |
| **USDC** | The member's smart wallet | No | Transit only, normally $0.00 |
| **ESA** | CLRUSD on the member's smart wallet | No | Savings, and the collateral for savings-backed credit |
| **Credit position** | The credit contracts (`RevolvingIssuer` on the `ClearCredit` ledger) | Drawn by the card | Tiers, limits, carry |

**Fiat is for spending. The chain is for holding.**

### Which record is authoritative

- **Lithic's ledger** is authoritative for fiat balances.
- **The contracts** are authoritative for CLRUSD, tiers and the credit position.
- **The API's own database** keeps a double-entry record of both (`lithic_ledger_entries`), never
  a plain mirror of either. Drift between any two raises an alert and is never corrected
  automatically ([Reconciliation](#3-reconciliation)).

### The savings sweep travels the member's own accounts

Moving cash into savings is one member action over two rails that cannot be made atomic:

1. **Fiat:** an ACH push from the member's Lithic cash account to the member's own Bridge account.
2. **Conversion:** Bridge converts the dollars and delivers USDC to the member's smart wallet.
3. **Chain:** the member signs an ESA deposit, the API relays it, and the vault mints CLRUSD.

No co-op account holds the money at any point, and the member is never sent to a hosted widget or
asked for a second KYC. The USDC and the CLRUSD minted from it are in the member's own wallet.

### Card credit is issued on chain at settlement

A card authorisation is answered in milliseconds, so it is decided off chain from a precomputed
snapshot ([Card authorisations](#card-authorisations)). When the purchase settles, the credit part
of it is drawn on the `RevolvingIssuer` with `settleCardSpend`, which fills the tiers cheapest first
and starts carry. The cash part is the member's own money and is not issued as credit
([`cardSettlementService.ts`](../../../apps/api/src/services/chain/cardSettlementService.ts)).

- **Once per purchase.** The reference is the hashed Lithic transaction token, and the issuer
  refuses a second settlement of the same reference.
- **Every attempt is recorded.** After five failures a purchase is marked `needs_review` rather
  than retried.
- **The chain's split wins.** Once issued, the pending hold stops being shown, so a purchase is
  never counted twice.
- **Refunds after settlement** give the difference back with `reverseCardSpend`. A purchase under
  an open dispute is held off the chain and accrues no carry.

---

## 2. How each flow works

### Account provisioning

`POST /api/lithic/account` provisions a member's Lithic account and financial accounts.
`GET /api/lithic/account` returns the provisioning state, and the routing and account numbers once
they exist. The wallet always comes from the verified session, never from the request.

- **It runs on request, not at signup.** Lithic's KYC needs date of birth, a government id and a
  street address. The member record does not hold them (Bridge collects them through its own hosted
  flow), so the route takes them in the body and rejects a request with the list of what is missing.
- **The workflow is `KYC_BASIC`** by default: Lithic runs KYC. The service also supports
  `KYC_EXEMPT` and `KYC_BYO`.
- **Idempotency is Clear's.** Lithic does not deduplicate account-holder creation, so provisioning
  checks the API's own store first, then Lithic by the external id stamped on every account holder.
- **Only a routable account is shown.** Deposit numbers come from a `ROUTABLE` financial account;
  the service never falls back to a non-routable one.

### Card authorisations

Lithic's Auth Stream Access (ASA) asks, in real time, whether to approve each authorisation. The
API answers at `/api/webhooks/lithic/auth-stream`, mounted before the rate limiter so a busy minute
cannot decline a card.

The decision is a **waterfall**: cash first, then credit tiers cheapest first
([`authDecision.ts`](../../../apps/api/src/services/lithic/authDecision.ts)). The order is fixed.

| Order | Source | Limit ([`tierLimits.ts`](../../../apps/api/src/services/lithic/tierLimits.ts)) | Carry |
|---|---|---|---|
| 1 | Cash | The Lithic cash balance | None |
| 2 | Savings-backed | 100% of the member's CLRUSD | None |
| 3 | Asset-backed | 95% of bonds at present value, plus 70% of the lending pool position | 0.65–0.75% per cycle |
| 4 | Income-backed | 50% of the estimated monthly deposit | 1.5% per cycle |
| 5 | Clear Boost | A fixed opt-in amount; $0.00 until taken up | 3% per cycle |

When the on-chain `LimitCalculator` can be read, its savings and asset ceilings replace the
arithmetic above, so the API and the contracts give the same answer.

Rules the handler keeps:

- **A precomputed lookup.** Each card has an `available_by_tier` snapshot, rewritten on every event
  that changes a balance. The handler reads one row; it never derives availability.
- **No outside calls** inside the authorisation window: no chain reads, no Plaid, no HTTP.
- **Idempotent** by Lithic's transaction token.
- **All or nothing.** If the full amount cannot be funded, the authorisation is declined; partial
  approvals are not offered. A paused card declines with `CARD_PAUSED`.
- **Fail closed.** Any error, unknown card or unverifiable signature declines.
- **Every decision is logged** with the inputs that produced it.

When money is given back (a void, a refund, a clearing below the authorisation), the most expensive
tier is released first. When a clearing lands above its authorisation, the extra is drawn through
the same waterfall and any shortfall is recorded rather than discarded.

### Card events and direct deposit

`/api/webhooks/lithic` receives Lithic's asynchronous events, signed with Standard Webhooks.

- **Card events** (`card_transaction`) reconcile a draw the auth stream already made: voids,
  reversals and clearings for a different amount. The charge itself is never replayed.
- **Direct deposit.** A settled inbound `payment_transaction` is an ACH credit to the member's cash
  account. The API records it double-entry, **settles any outstanding credit first**, applies the
  member's auto-save rule to what is left, and rewrites the member's snapshot. Deposits to a Bridge
  virtual account go through the same service
  ([`depositReceiptService.ts`](../../../apps/api/src/services/deposits/depositReceiptService.ts)),
  idempotent by rail and external id.
- **ACH returns** are handled explicitly and reversed through both ledgers.

### Pulling from an outside bank

The services for linking an outside bank and debiting it are in
[`bankAccountService.ts`](../../../apps/api/src/services/lithic/bankAccountService.ts) and
[`achOriginationService.ts`](../../../apps/api/src/services/lithic/achOriginationService.ts):

- **Linking** uses `MICRO_DEPOSIT` by default; `PLAID` and `PRENOTE` are also accepted.
- **A pull** is a Lithic `COLLECTION`, with an SEC code (`WEB` for an in-app authorisation, `PPD`,
  or `CCD` for a business account) and Lithic's availability hold of 1–4 days (Lithic's default is
  2).
- **Pulled money is not collateral until its return window closes**: 60 days for consumer debits
  (`PPD`, `WEB`), which carry unauthorised-entry returns, and 5 days for `CCD`. Until then it is
  recorded as pending and kept out of the snapshot. An hourly job releases it when the window
  passes; a return reverses it.

### The savings sweep

`POST /api/sweeps` starts a sweep. The caller supplies the sweep id, so a double tap, a retried
request and a rule that fires twice all describe the same sweep. Sweeps that share a `batchKey`
are grouped.

| State | Waiting on |
|---|---|
| `initiated` | The API, to push the fiat from Lithic to the member's Bridge account (the sweep id is the idempotency token) |
| `fiat_debited` | ACH and Bridge. Bridge's webhook advances it when the USDC lands; nothing retries it, because a retry would push the money twice |
| `ready_to_allocate` | The member. The USDC is in their wallet; `POST /api/sweeps/:id/allocate` relays their signed ESA deposit |
| `clrusd_minted` | The API, to close the sweep |
| `complete` | Nothing |

A sweep whose USDC has already reached the member's wallet is never marked `failed`; it stays at
`ready_to_allocate`. A runner moves sweeps forward every minute.
`GET`, `PUT` and `DELETE /api/sweeps/auto-save` manage the member's auto-save rule.

### Cards

Routes are under `/api/lithic/cards`
([`lithicCards.ts`](../../../apps/api/src/routes/lithicCards.ts)).

- **Virtual cards** are usable as soon as they are issued. **Physical cards** need
  `LITHIC_CARD_PRODUCT_ID`, and are activated on arrival.
- **Controls:** freeze and unfreeze, and a spend limit. Unfreezing and changing the limit need a
  recent step-up.
- **Full card numbers never reach the API.** The member's browser shows them in Lithic's embedded
  frame; the API only issues the short-lived URL for it, after a step-up.
- **A new card gets a snapshot before it can be used**, so its first authorisation is not declined
  for lack of one.
- Every route takes the wallet from the session and checks that the card belongs to it.

---

## 3. Reconciliation

An hourly job compares the books with the rails
([`reconcileService.ts`](../../../apps/api/src/services/reconciliation/reconcileService.ts)). It
reads and alerts; it never writes.

| Check | Compares |
|---|---|
| Vault solvency | Lithic cash held for members against the sum of member cash balances |
| ESA backing | USDC held by the ESA vault against CLRUSD in circulation |
| Sweep completion | Fiat pushed out for completed sweeps against the CLRUSD those sweeps minted |
| Credit issuance | Card credit the ledger says is settled on chain against what the issuer holds |
| Float adequacy | The settlement float against savings-backed credit drawn but not yet reconciled |

Money compares exactly, with one cent of tolerance for unit conversion. **A figure that cannot be
read reports `unavailable`, never `ok`**, and a run is healthy only when every check was evaluated
and passed.

---

## 4. Rules for changes

- **Sandbox is the default.** Production takes both `LITHIC_ENV=production` and
  `LITHIC_ALLOW_PRODUCTION=true`. No production keys in code or committed config.
- **Every webhook handler verifies its signature** and is idempotent by event or transaction id.
- **Money movement is double-entry** in the API's records.
- **Test against the sandbox.** `bun run lithic:test` runs the service tests; the
  `lithic:verify-*` scripts in `apps/api/package.json` exercise provisioning, the auth stream and
  cards against Lithic's sandbox.

---

## 5. Known limitations

- **A program without financial accounts.** When the Lithic program exposes no financial accounts,
  cards work but direct deposit and ACH do not, and vault solvency reports `unavailable`.
- **No route links or debits an outside bank.** The services above are not exposed through the API
  yet.
- **Clear Boost is not available yet.** Nothing sets a Boost limit, so the tier is always $0.00.
- **There is no funded settlement float account**, so float adequacy reports `unavailable`.
- **From `ready_to_allocate`, the API offers one action:** allocating the USDC into the ESA.
- **The spend limit has no caller.** `POST /api/lithic/cards/:token/spend-limit` (step-up,
  `MONTHLY` unless a `duration` is given) and the member app's `setCardSpendLimit` exist, but no
  screen calls them. The Card page's limits, controls and **Replace this card** are fixtures that
  Lithic never sees ([Developers → Known limitations](../README.md#member-app)).
