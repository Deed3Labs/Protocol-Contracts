# Lithic Integration Spec

Banking and card layer for the Clear member app. Lithic **Program Managed** — Lithic and its partner bank handle sponsorship, KYC/KYB, AML/BSA, ledgering, card manufacturing and network connectivity. We control spend logic and business rules via API.

Docs: `https://docs.lithic.com` — read Financial Accounts, ACH, Auth Stream Access, Cards, and External Bank Accounts before writing code.

---

## 1. The money model — read this first

Two rails. Do not blur them.

| | Lives in | Card-spendable | Purpose |
|---|---|---|---|
| **Cash account** | Lithic routable Financial Account (USD) | Yes | Direct deposit lands, card spends |
| **USDC** | Member's Privy smart account | No | Transit only — normally $0 |
| **ESA** | CLRUSD on the smart account | No | Savings. Vests credits, collateralizes credit, feeds Earn |
| **Credit position** | StableCredit contracts | Drawn via card | Tiers, limits, cycles, carry cost |

**Fiat is for spending. Chain is for holding.**

### Authority
- **Lithic's ledger is authoritative for fiat balances.**
- **Our contracts are authoritative for CLRUSD, credits, tiers, and the stablecredit position.**
- Our own DB is a double-entry record of both, never a naive mirror of either. Drift between any two must raise an alert, never a silent correction.

### The member never onramps
A savings sweep is two movements that happen on different rails but present as one action:

1. **Fiat:** debit the member's Lithic Financial Account → credit the co-op's Lithic operating account. Book transfer inside one institution.
2. **Chain:** co-op treasury sends USDC from its own reserve to the member's smart account; the ESA contract mints CLRUSD.

No hosted widget, no redirect, no "buy crypto" language, no second KYC. The member moved money between their own accounts. The co-op replenishes its USDC reserve on a treasury schedule — that is an ops job, not a member flow, and is **out of scope for this integration**.

### Credit draws settle from float, not from chain
A card authorization resolves in ~200ms. CLRUSD cannot convert in that window. So:

- The co-op maintains a **settlement float** — a fiat pool in Lithic sized to expected credit draw.
- When a member draws savings-backed credit at a swipe, the float funds the fiat settlement and the on-chain ledger records the stablecredit issuance.
- Reconcile on a schedule, not per transaction.

---

## 2. Build order

Each step ships and is reviewed before the next begins.

### Step 0 — audit, then stop
Report on: secrets/env handling, the existing API and service layer, whether a job/queue system exists for webhooks, the DB layer, and where on-chain contract calls currently live. Then propose where the Lithic service boundary sits and how it talks to the chain layer. **Wait for my response before building.**

### Step 1 — client scaffold
Lithic client with sandbox/prod config, typed wrappers, and a local script that provisions a test member end to end. Sandbox only.

### Step 2 — account provisioning
On member signup:
- Create a Lithic `Account`
- Create a **ROUTABLE** `Financial Account` (virtual accounts are internal-transfer-only and will not receive direct deposit)
- Persist both tokens against the member record
- Surface routing + account number to the Account Details modal

### Step 3 — Auth Stream Access (the core)

Lithic sends a real-time authorization request; we approve or decline inside the timeout. Our logic is a **waterfall**: cash first, then credit tiers cheapest-first.

Draw order:
1. Cash account balance
2. Savings-backed (ESA collateral) — free
3. Asset-backed (bonds at 95% of present value, pool shares at 70%) — 0.65–0.75% per cycle
4. Income-backed (50% of estimated monthly deposit) — 1.5% per cycle
5. Clear Boost (opt-in, $500/$750) — 3% per cycle

Requirements:
- **The tier decision is a precomputed lookup, not a calculation.** Maintain a per-member `available_by_tier` snapshot, updated on every balance-changing event. The auth handler reads it; it never derives it.
- **Never block on an external call** inside the auth window — no chain reads, no Plaid, no HTTP.
- Idempotent by Lithic event ID.
- An approval that draws credit is a **credit issuance event**: record the tier drawn, start the carry-cost clock, decrement available room, and respond — atomically.
- Log every decision with the inputs that produced it. We will have to explain individual authorizations to members.
- Fail closed on timeout or internal error, and alert.

### Step 4 — ACH receipt (direct deposit)
Inbound ACH to a member's Financial Account. On receipt:
1. Credit their cash balance
2. **Settle any outstanding credit balance first** (this is how the equilibrium rule resolves itself — there is no "pay" button)
3. Apply their auto-save allocation, if configured

Receipts post immediately to available balance.

### Step 5 — ACH origination (pull)
Scheduled debits from a member's linked external bank for recurring ESA contributions.

- Configure a hold on ACH debits (Lithic default is 2 days, configurable 1–4).
- **A pulled deposit is not final on arrival.** Insufficient-funds returns come back in days; unauthorized-entry returns can come back for up to 60 days.
- **Do not let pulled funds count toward credit collateral until the return window closes.** Sweeping them into the ESA early would collateralize a credit line with money that can be clawed back.
- Handle every return code; a return must reverse cleanly through both ledgers.

### Step 6 — external bank accounts
Link and verify via micro-deposit (`POST /external_bank_accounts` with `verification_method: MICRO_DEPOSIT`) or Plaid. Needed for Step 5.

### Step 7 — savings sweep
The two-rail operation from §1. Implement as a **saga with explicit states**, not a transaction:

`initiated → fiat_debited → usdc_sent → clrusd_minted → complete`

- If it fails after `fiat_debited`, the member lands in **"ready to allocate"** — USDC on their smart account, not yet in the ESA. This state must be visible and recoverable, with actions to retry allocation, move to Earn, or return to cash.
- Sweeps should **batch** where possible. Fifty members sweeping on payday is one treasury conversion, not fifty.
- The credit vesting clock starts at **CLRUSD mint**, not at fiat debit. Show the member the vest date from the mint.

### Step 8 — cards
Virtual first (works for e-commerce immediately), physical after. Freeze/unfreeze, spend limits, and controls: contactless, online payments, ATM, international.

**Do not build for Colossus yet.** It is a later dual-applet addition to the physical card program; reissuing plastic is acceptable.

---

## 3. Reconciliation

Run continuously, alert on drift, never auto-correct:

| Invariant | Check |
|---|---|
| Vault solvency | Lithic cash held for members = sum of member cash balances |
| ESA backing | Co-op fiat received from sweeps = CLRUSD minted |
| Credit issuance | On-chain stablecredit outstanding = sum of tier draws in our ledger |
| Float adequacy | Settlement float ≥ savings-backed credit drawn but not yet reconciled |

---

## 4. Constraints

- Sandbox only. No production keys in code or committed config.
- All webhook handlers verify signatures and are idempotent by event ID.
- Money movement is double-entry in our records.
- Integration tests against sandbox for every flow — especially ASA approve, ASA decline, ACH return, and a sweep that fails mid-saga.
- **Ask before making any decision that changes the money model rather than the plumbing.**

---

## 5. Open questions — flag, don't decide

1. Does the member's smart account hold CLRUSD directly, or does the co-op custody it with position tracked in contract state? Direct is honest to self-custody; custodied is far simpler for lost-device recovery.
2. Should "back to cash" from the ready-to-allocate state be instant (co-op eats conversion timing) or queued?
