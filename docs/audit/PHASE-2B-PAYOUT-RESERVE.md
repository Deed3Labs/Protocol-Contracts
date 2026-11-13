# Phase 2B: payout order and the AssurancePool (addendum 12.10 and part of 12.11)

Branch `audit/phase-2b-payout-reserve`, from `audit/phase-2b-credit-agreements` (= `dev` with Phases 1 and 2). Nothing was deployed, no key was used, and no live network was touched.

## Scope, and the change of scope

The brief had two items: 12.10 (PayoutPool order and funding) and 12.11 (two separate reserves: the AssurancePool as Clear Lending Co.'s credit-loss reserve, plus a new Clear-owned `AssuranceReserve` for member Assurance grants).

Partway through, the owner replaced 12.11's separate reserve with a new section 13 ("Assurance Contracts"): the AssurancePool itself becomes a co-op-owned contract with compartments (CREDIT_BACKSTOP, MEMBER_ASSURANCE). That redesign waits on the owner's answers. So this branch:

- **Does** 12.10 in full (acceptance 27).
- **Does** remove the bond-principal path into the AssurancePool (section 13 restates it).
- **Does** make every redemption, payout and liquidation path leave the AssurancePool's balance alone, with tests.
- **Does not** build `AssuranceReserve`. It was written, never committed, and deleted. Nothing for it is in `deploy/`, the timelock handover or `UPGRADEABILITY.md`.
- **Does not** change `AssurancePool.sol` at all: no compartments, no grant payer, no change to its reserves, roles, lend or repay functions, or `depositRepayment`. An early draft removed its `lendToPayoutPool` and `lendToBondVault`; that was reverted with the scope change. The callers stop calling them instead (below).

### Approved overrides used

The owner approved two overrides of the compliance spec's "Do NOT change" list and DECISIONS #3:

1. **PayoutPool and its FIFO order** (and DECISIONS #3, "FIFO order, funding and the AssurancePool rule stay as they are"): overridden for 12.10. The order is now deadline first, then claim age. Funding changed too: `drawForDueClaim` no longer borrows from the AssurancePool.
2. **Bond principal into the AssurancePool**: `BurnerBondDeposit` → `assurancePool.depositTokenIntoExcess` removed.

No other "Do NOT change" item was touched. Removing the PayoutPool's and BondVault's draws on the AssurancePool *restores* the item "no redemption path touches AssurancePool". It does not change it.

## 12.10: PayoutPool pays by deadline, then claim age

### Design

- A claim's deadline is `dueBy` = time queued + `merchantRegistry.payoutWindowOf(merchant)`. This is the same `dueBy` the pool always stored.
- **One FIFO queue per payout window** (`windowQueue[window]`, cursor `windowHead[window]`). Inside one window every claim has the same window, so deadlines rise with claim id, and each queue's head is its earliest claim.
- **`queuedWindows`** lists the windows that have an unpaid claim. A window is added when its queue goes from empty to non-empty and removed (swap and pop) when it empties.
- **Picking the next claim** (`_head`) compares the heads only. The earliest `dueBy` wins; a tie goes to the lower claim id, which is the older claim. The cost is O(distinct windows queued at once), not O(claims).
- **The gas bound** is `MAX_QUEUED_WINDOWS = 16`. A redemption that would queue a 17th distinct window at once reverts with `PayoutPoolTooManyWindows`. This is a gas bound, not a business figure. The precedent is `AssurancePool.MAX_HELD_TOKENS` and `PayoutPool.DEFAULT_REFUND_PAGE`. Windows come from MerchantRegistry, and in practice there are two (net-14, net-30). Measured: `payNext` with all 16 windows queued costs about 500k gas in all, including paying the claim and placing the position.
- **Every payment path follows `_head`:**
  - a redemption is paid on the spot only if the new claim is the head and the pool can cover it;
  - `payNext` and `payQueue` stop at the first head the pool cannot cover, so a smaller claim due later never jumps it;
  - `drawForDueClaim` draws only for the head, once it is past its deadline, and re-reads the head after its external calls.
- **Nobody can move a claim.** `payNext` still takes no argument, and there is still no priority field.

### Views

| View | Status |
|---|---|
| `claimCount`, `claimAt`, `claimsOwnedBy`, `redeemableOf`, `queuedTotal`, `shortfall`, `canPayNext` | Unchanged signatures. `canPayNext` now asks about the deadline-order head. |
| `nextUnpaid()` | Was a public storage variable (the FIFO cursor); now a view with the same selector, returning the next claim in deadline order, or `claimCount()` when none. `apps/api` reads it (`services/command/credit.ts`) and keeps working. |
| `queuedWindowsList()` | New: the windows with claims queued. |
| `dueWithin(horizon, maxClaims)` | New, for the operator: the unpaid claims due within `horizon` seconds (overdue included), their total, and `short`, the cash the pool lacks to pay them after refunds owed to members. Claims due inside the horizon come before all others in payment order, so `short` is exactly what must arrive in time. There is no business-day calendar on chain: "two business days before the deadline" is the operator's horizon. |

### Funding

`drawForDueClaim` now draws from the yield pool, then the bond vault's deployable excess, then the treasury's allowance. It no longer draws from the AssurancePool. A claim those three cannot cover waits, and `dueWithin` says how much is missing. The `reserve` lender address is kept in storage, and `setLenders` still sets it, only so that a loan the AssurancePool made before this change can still be repaid (`_repayLenders` is unchanged). `DrewFromReserve` is no longer emitted; it is kept for decoding old logs.

### Storage (PayoutPool is on Base Sepolia only)

Append-only:

- The `nextUnpaid` slot is renamed `legacyNext` (private, annotated `@custom:oz-renamed-from nextUnpaid`). It stays where it was.
- Four new variables after `borrowedFromVault`: `windowQueue`, `windowHead`, `queuedWindows`, `legacyEnd`. `__gap` shrinks from 25 to 21, so the layout ends at the same slot.
- No `Claim` struct change.

**Upgrading a pool with claims already queued.** Claims queued before the upgrade are not in any window queue. They form a **legacy queue**: ids `legacyNext` to `legacyEnd - 1`. `legacyEnd` is set by the first redemption after the upgrade (to the claim count at that moment, plus one); until then, every existing claim counts as legacy. The legacy queue keeps the strict claim-age order those claims were promised under, and competes with the window queues through its head. So no migration call is needed and nothing is stranded. On a fresh deployment the first redemption sets `legacyEnd` to 1, and there is no legacy queue.

The storage check result is in "Numbers" below.

## 12.11 (as narrowed): the AssurancePool is untouched

### Where bond principal went, and where it goes now

`BurnerBondDeposit.makeDeposit` already sent principal to the BondVault. The leftover path was `processDeposit` / `batchProcessDeposits` → `_processDepositInternal`, which approved the AssurancePool and called `depositTokenIntoExcess`.

That path is now routed like `makeDeposit`: the principal goes to the BondVault, and the vault records the purchase (`recordPurchase`), so it is held against that bond's redemption. That is where principal belongs: the vault's redemption reserve is derived from what it owes.

In practice the path is unreachable, because `makeDeposit` processes every deposit in the same call. It is kept, not deleted, so the `IBurnerBondDeposit` interface is unchanged. `BurnerBondDeposit.assurancePool` stays as a recorded address that is never sent anything.

### Draws on the AssurancePool removed (callers only)

| Path | Before | Now |
|---|---|---|
| `PayoutPool.drawForDueClaim` (payout) | last resort: `reserve.lendToPayoutPool` | no reserve step |
| `BondVault._cover` (bond `settle` and `settleEarly`, i.e. redemption) | after the treasury: `assurancePool.lendToBondVault` | no reserve step; the vault plus the treasury, or revert |
| `BurnerBondDeposit._processDepositInternal` | principal into the AssurancePool's excess | principal into the BondVault |

`BondVault.repayReserve` and `_repayReserve` stay, so that a loan made before the change on Base Sepolia can come home. Nothing adds to `owedToReserve` any more.

**`AssurancePool.sol` is unchanged** (scope change). So its `lendToPayoutPool` and `lendToBondVault` still exist. They are callable only by the payout pool or bond vault the operator names, and neither contract calls them any more. That operator power is pre-existing and unchanged. Section 13's redesign should decide whether to remove the functions.

**Instruments (`withdrawalCallers`).** No contract calls `AssurancePool.withdraw` or `withdrawToken`, and no deploy script names a withdrawal caller. Nothing to remove; the role gating is untouched.

### Tests (`test/audit/compliance/ReserveUntouched.spec.ts`)

Each test fills the pool's primary, buffer and excess tiers. It then compares the pool's token balance and all three tiers before and after each path.

- **Bond principal:** `makeDeposit` puts the principal in the vault and nothing in the pool. `processDeposit` cannot reprocess a deposit.
- **Bond redemption:** a matured bond the vault cannot cover reverts rather than drawing on the pool, even with the pool named as the vault's backstop and holding excess and buffer. With a treasury allowance, it redeems from the vault and the treasury, and the pool is unchanged.
- **Payouts:** with the AssurancePool named as the payout pool's lender:
  - a queued redemption;
  - a past-due `drawForDueClaim` (reverts rather than borrows);
  - a member repayment routed to the payout pool;
  - `payNext`;
  - a funded on-the-spot redemption.

  None changes the pool.
- **Liquidation:** a permissionless `Liquidator.liquidate` of pledged savings, then the member's own CLRUSD redemption at the vault. Neither changes the pool.

## Existing tests changed, and why

| Test | Change |
|---|---|
| `test/peripherals/PayoutPool.spec.ts` "order is claim age, always" → "order is deadline, then claim age" | "pays the older claim first, whatever the terms" now asserts the newer net-14 claim is paid first (it is due sooner). "has no way to choose whose claim moves" now sees the net-14 claim move. "stops at the first claim it cannot cover" now pays the net-14 500 and stops at the net-30 1,000. New: equal deadlines pay oldest first, and a smaller claim does not jump. "works down the queue" is unchanged. |
| `test/core/PayoutLifecycle.spec.ts` "falls back to the reserve, out of excess and never the primary cover" | Now "never falls back to the reserve, even with excess to spare": the draw reverts, the reserve is unchanged, and `dueWithin` reports the overdue claim and the shortfall. |
| `test/core/PayoutLifecycle.spec.ts` "takes the treasury's money as capital, up to its allowance..." | The reserve used to lend the remainder. Now the draw reverts with the treasury short, and succeeds once the yield pool covers the rest; the reserve is unchanged. The describe heading says "never the reserve". |
| `test/core/BondBackstop.spec.ts` | "...then the reserve" → "...and never the reserve" (reverts until the treasury allows enough). "lends out of excess, then buffer..." → "never draws on the reserve's excess, buffer or primary cover". "pays the reserve back from new proceeds..." and "lets anyone pay the reserve back..." (both needed a loan the vault no longer takes) merged into "owes the reserve nothing...". "refuses with nothing moved when all three..." renamed for two sources. The RTD and `lendToBondVault` gating tests are unchanged. |

## New tests

- `test/audit/compliance/PayoutDeadline.spec.ts` (acceptance 27 and the 12.10 design):
  - at its deadline, a net-14 claim is drawn for and paid, while two older net-30 claims stay queued (under strict FIFO this reverted `ClaimNotDue`);
  - funding arriving early pays net-14 first, then net-30 oldest first;
  - a fresh claim is paid on the spot only if nothing is due before it;
  - `dueWithin` at two days before the deadline, including the shortfall and the list cap;
  - every existing view still works;
  - the window bound, with the gas of a full pick.
- `test/audit/compliance/ReserveUntouched.spec.ts` (above).

## Deviations and defaults

- **`MAX_QUEUED_WINDOWS = 16` is a constant**, as a gas bound. Every business figure (windows, caps) stays governed in MerchantRegistry.
- **The legacy queue is not re-sorted by deadline.** Claims queued before the upgrade keep claim-age order among themselves. That affects Base Sepolia only, and only until those claims are paid.

## Open questions for the owner

1. **Repayment surplus into the AssurancePool.** `StableCredit._routeRepayment` (unchanged) sends a repayment to the payout pool up to what it is owed, and anything above that to `AssurancePool.depositRepayment`. That covers liquidation proceeds too, since they settle through `repayCreditBalanceFor`. With a payout pool set, a surplus arises only when members' cash in the pool already covers every claim outstanding. Without one, all of it goes to the pool. So a liquidation *can* add to the AssurancePool in that edge case: it never draws, but it can deposit. Should section 13 send that surplus elsewhere? `depositRepayment` was left alone as instructed.
2. **Bond gap in the RTD.** `AssurancePool.bondExposure` still counts the bond vault's uncovered near-term maturities, though the pool no longer lends to the vault. Left unchanged, which can only over-reserve. Section 13 may want it removed.
3. **`lendToPayoutPool` / `lendToBondVault` on the AssurancePool** still exist (scope change). No contract calls them now; an operator who renamed the payout pool or bond vault to an EOA could still borrow excess and buffer, as before. Section 13 should decide whether to remove them.
4. **Member Assurance grants are paid off chain today.** `apps/api/src/services/assurance/claimStore.ts` records a claim, and a person marks it `paid` by hand, with `paid_cents` paid "into the member's cash account". No contract pays a grant, and the AssurancePool has no grant function. Section 13's MEMBER_ASSURANCE compartment is where an on-chain payer would go.

## Numbers

(Filled in at the end of the phase.)
