# The Assurance fee payer

What Clear Lending pays into the co-op's Assurance Pool (`AssurancePoolV2`), how the API works it
out and pays it, and what the people who sign do. The rules are IV-03 Part 7 (7.3 the loss order,
7.5 the payment order, Step 5) and Part 8 (8.2 Available Coverage, 8.3 the fee, 8.7 advances and
repayment); the pool is [`AssurancePool.sol`](../../contracts/peripherals/AssurancePool.sol) and its
reserve is described in [`reserve.md`](../protocol/reserve.md).

**Off by default.** Nothing runs until the new pool's address is set, and nothing is ever sent until
`ASSURANCE_FEE_PAYER_ENABLED=1`. On Base Sepolia the pool is not deployed yet.

## What it does

The job is [`apps/api/src/jobs/assuranceFeePayer.ts`](../../apps/api/src/jobs/assuranceFeePayer.ts).
It runs hourly and when the API starts.

1. **Reads the pool once a UTC day:** `availableCoverage()`, `backstopBalance()`, `backstopFloor()`
   and `coverageCap()`, kept in `command.assurance_snapshots` (migration 0077). A day the job missed
   is filled by its next run with what it reads then, and marked *filled*. Days before the first
   reading count as zero, so turn the reading on (set the pool address) the day the pool is
   deployed.
2. **Works out each month's Credit Enhancement Fee** once the month has ended: 8% a year on average
   daily Available Coverage, actual/365.

   `fee = Σ(daily availableCoverage) × ASSURANCE_FEE_BPS / 10,000 / 365`

   in USDC base units, rounded down once. A leap year is not special: February 29th is one more day
   at 1/365. Each month's fee is recorded once (a unique index), with its basis: the days in the
   month, the days read, filled and at zero, the sum and the average. A fee that rounds to nothing is
   recorded as *nothing due*.
3. **Pays what is owed, oldest month first,** once the CL Fees wallet holds it. From the CDP wallet
   `cl-fees-base-sepolia` it sends `USDC.approve(pool, amount)` for exactly the amount, then
   `pool.deposit(tag, amount)`: `CREDIT_ENHANCEMENT_FEE` for the fee, `RECOVERY` for Spread
   Repayments and recoveries (all of it to the Credit Backstop). Before sending it checks that the
   wallet is the configured CL Fees address, that `payerTags` allows it that tag, and that nothing
   of the wallet's is still pending, and it dry-runs each call (`eth_call` and `eth_estimateGas`).
   It waits for each receipt and records both hashes.

**Never more than recorded, never twice.** An item is claimed into *sending* by one guarded update,
so a second run (or a second API instance) finds nothing to claim. The deposit's hash is written the
moment CDP returns it, and CDP is given an idempotency key per item and attempt. After a restart, an
item caught *sending* is settled from the chain before anything is sent again: its deposit receipt
if the hash is known; otherwise it waits while the wallet has anything pending, then reads the
allowance and looks for a USDC transfer from the wallet to the pool since the first attempt. Found:
paid, with that hash. The allowance still there: only the deposit is sent. Neither: the approve did
not land, so it starts again (an approve sets the allowance, it never adds to it).

**It stops on any surprise.** A revert, a dry run that would revert, a payer the pool does not
allow, or a deposit that succeeded without moving the amount puts the item at *stopped* (`failed`)
and nothing more is paid until a person looks and presses **Retry after checking** in Command Center
(a second person approves it). The retry first looks on chain for a deposit since the item's first
attempt, so one that did land is recorded, not paid again. Each stop is emailed to `OPS_ALERT_EMAIL`,
the payout keeper's channel, once. A pool that cannot be read three passes in a row is alerted too.
Logs name addresses only, never a key.

## The monthly loop

| When | Who | What |
|---|---|---|
| Every day | the job | Reads the pool's Available Coverage |
| The 1st | the job | Records last month's fee, *due* |
| After Steps 1–4 of 7.5 are met | a Command person with Propose in Money | **Propose funding** on the fee (Money, Pools, AssurancePool, Assurance fees). Command saves a Transaction Builder batch: `USDC.transfer(CL Fees wallet, amount)` from CL Operating, exactly the amount. The item is *funding proposed* |
| Then | Clear Lending's two signers | Sign that batch for CL Operating in the Safe app. **This is the one human approval, and Step 5's confirmation** |
| Within the hour | the job | Sees the CL Fees wallet hold the amount (*funded*), approves and deposits it (*paid*), with links to both transactions |
| When there is Spread or a recovery | an admin (Approve in Money) | Enters a **Spread Repayment** or a **Recovery** (the Credit Backstop's share) for a month, with a note and evidence. It goes the same way: propose funding, sign, paid by the job, under `RECOVERY` |
| Monthly | an admin (Approve in Money) | Enters the month's card interchange; Command proposes 25% of it to the Clear Treasury Safe (below) |
| Monthly | the pool's two signers | Post the floor figures (`setFloorInputs`). The card reminds when they are more than 31 days old |

**Advances outstanding** are every draw the pool has released (`drawAt` for each of `drawCount()`,
status Released) less the Spread Repayments and recoveries paid. A Spread Repayment or recovery can
never be entered above the advances outstanding less what is already entered and not yet paid; the
card warns as it is typed and the API refuses it. (Past the advances, a recovery belongs to Clear
Lending's Loss Reserve, not the pool: 7.3.)

## How funding reaches CL Operating

Command's own Safe flow (Build, Safe: `/safe/prepare` and `/safe/propose`) proposes to one Safe, the
Ops Safe in `COMMAND_SAFE_ADDRESS`, and takes the first signature from a Command person whose linked
wallet is one of that Safe's owners. **CL Operating cannot use it:** it is a nested Safe whose only
owner is the Clear Lending Safe, a contract, so no person's wallet is an owner, an ordinary signature
can never satisfy it, and the Safe Transaction Service refuses a proposal from a sender who is not an
owner or delegate. So **Propose funding** saves the batch as a file and links to the Transaction
Builder on CL Operating:

1. Open the link (or the Safe app, CL Operating `0xfAFf1081F77bF528bA21eea590f251a755bCdf65`,
   Apps, Transaction Builder) and drop in the batch file.
2. Check the one call: USDC `transfer` to the CL Fees wallet
   `0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd`, for the amount the card shows.
3. Create it. The Safe app signs a nested Safe through its owner: the Clear Lending Safe's owners
   approve CL Operating's transaction (2 of 2), and it is executed.

Building the batch again replaces it; the amount is always the recorded one.

## Interchange (the co-op treasury's, 25% policy)

Clear Lending does not pay interchange; the co-op does, from the Clear Treasury Safe
`0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50`. The API has no interchange revenue records yet (no
Lithic interchange feed), so an admin enters the month's card interchange and Command works out
`x = interchange × ASSURANCE_INTERCHANGE_BPS / 10,000`, rounded down. Command proposes
`USDC.approve(pool, x)` then `pool.deposit(INTERCHANGE, x)` as one batch. When the Ops Safe
Command proposes to (`COMMAND_SAFE_ADDRESS`) is the Clear Treasury Safe, it goes through Command's
own flow (Build, Safe: build it, sign it, and the other owners sign in the Safe app); the batch file
is on the card as well, for the Safe app's Transaction Builder. Its owners sign; nothing is
automatic. One per month.

## Railway variables (the API)

| Variable | Value | |
|---|---|---|
| `ASSURANCE_POOL_V2_84532` | the new pool's address, once deployed | Turns on the daily reading and the monthly fee. Not `ASSURANCE_POOL_84532`: that still names the Phase 1 reserve the Money page reads |
| `ASSURANCE_FEE_PAYER_ENABLED` | `1` | Lets the job send the approve and deposit. Leave it off until the pool's payers are set and a first funding is signed |
| `ASSURANCE_FEE_PAYER_CDP_ACCOUNT_NAME` | `cl-fees-base-sepolia` | The CL Fees CDP wallet, found by name (never created). A `_84532` suffix wins over the plain name |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` | the CDP project the relayers use | Read under these names, or the relayers' `SAVINGS_CDP_*` and `SEND_CDP_*` names, so nothing new is needed if those are set |
| `ASSURANCE_FEE_BPS` | `800` (default) | The fee a year in basis points |
| `ASSURANCE_INTERCHANGE_BPS` | `2500` (default) | The co-op's interchange share |
| `OPS_ALERT_EMAIL` | `ops@useclear.org` | Where stops are emailed (already in the owner's checklist) |
| `PROVIDER_MONEY` | `live` | The card's live data; with `seed` it shows sample figures |

The addresses settled on Base Sepolia are defaults and need no variable: the CL Fees wallet
(`ASSURANCE_CL_FEES_ADDRESS`), CL Operating (`ASSURANCE_CL_OPERATING_ADDRESS`), the Clear Lending Safe
(`ASSURANCE_CLEAR_LENDING_SAFE`) and the Clear Treasury Safe (`ASSURANCE_TREASURY_SAFE`), each with an
optional `_<chain>` suffix. The chain is `ASSURANCE_CHAIN_ID`, else `SAVINGS_DEFAULT_CHAIN_ID`, else
84532. For local development only, `ASSURANCE_FEE_PAYER_MODE=local_key` with
`ASSURANCE_FEE_PAYER_PRIVATE_KEY` signs with a key instead of CDP.

The CL Fees wallet must be an allowlisted payer for `CREDIT_ENHANCEMENT_FEE | RECOVERY` (the signing
plan sets it) and hold a little ETH for gas (the owner's checklist, step 3). CL Operating cannot be a
payer: it is the pool's draw address.

## What the humans sign

- **Clear Lending's two signers**, each month and for each Spread Repayment or recovery: CL
  Operating's one `USDC.transfer` to the CL Fees wallet, through the Clear Lending Safe. Signing it is
  the confirmation that Steps 1–4 of 7.5 are met and Step 5 may pay.
- **The Clear Treasury Safe's owners**, monthly: the interchange batch, `approve` and
  `deposit(INTERCHANGE, x)`.
- **The pool's two signers**, monthly: `setFloorInputs`.
- **A second Command person**, only to resume paying after a stop.

Nobody signs the approve and deposit: the CL Fees wallet does, for exactly what was funded.
