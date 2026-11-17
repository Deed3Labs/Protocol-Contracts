# Phase 2f plan: Earn (BondVault, BurnerBond, Yield Pool)

Read-only review and plan. No contract or test was changed. Branch `audit/phase-2f-earn-pool` with `dev` (Phases 2d and 2e) merged in.

Sources: `specs/earn-contract-requirements.md` (sections 1–10, 6A, tests 1–25), `specs/earn-glossary.md`, `specs/addendum-3-and-earn-2.md`, `specs/phase-2f-decisions.md`, `specs/addendum-4.md` (Earn §4A, test 26) with `specs/addendum-4-decisions.md` decision 15, and `PHASE-2E-REPORT.md`. Sizes come from a production build of this branch (`npx hardhat compile`, via-IR, runs 1, revert strings stripped).

## Summary

- **Sections:** 13 rows built, 16 partly built, 34 missing (section 1 below).
- **Acceptance tests 1–26:** 2 built (18, 19), 7 partly built, 17 missing.
- **No Yield Pool exists.** `LendingPool` is an ERC-4626 precursor: a claim queue, a kinked rate curve and a single-signer loss report. Its money model is different from the spec's. Borrowers (PayoutPool, the card settler) draw from it directly, interest arrives as cash and is streamed into the price, and the Liquidator can seize shares. It has no Share Value, Pool Interest accrual, Deployments, Holdback, FIFO fill or Suspension.
- **No Collateral Agent, Enforcement Notice, Reserve Shortfall, Funding Limit, offering cap, Equity Cushion pause, Successor path, buyback, `redeemAll`, Final Maturity or roll confirmation exists.**
- **Nothing in Earn is on mainnet.** Base mainnet holds ClaimEscrow, ClearUSD, Create2Deployer and ESADepositVault only, and none of them needs to change. Every Earn contract is on Base Sepolia only.
- **Eight large redesigns** need the owner's choice (section 2). **Seven conflicts** need a ruling (section 3).

## 1. Coverage

B = built, P = partly built, M = missing.

### Spec sections

| # | Requirement | | Where it is today, or the gap |
|---|---|---|---|
| **§1** | **BurnerBond token** | | |
| 1 | Quantity 1 per id, ids never reused | B | `BurnerBond._issue` (counter), `setFirstBondId` |
| 2 | Per-token fields | P | Has `faceValue` (Maturity Amount), `maturityDate`, `issuedAt` and `holderOf`, and the registry knows if a bond is pledged. No series id, Issue Yield or paid amount. The opt-out deadline and auto-roll flag are replaced by §4A. |
| 3 | `accretedValue` compounding at the Issue Yield | P | `accretedValue` = `presentValueOf`, straight line from price to face (`BurnerBondBase._presentValue`) |
| 4 | Mint is atomic with the Purchase Price reaching the BondVault | B | `BurnerBondDeposit.makeDeposit` |
| 5 | Wallet Signature over a quote that expires after 15 minutes | M | The buyer passes face, maturity and discount, and the price comes from the discount curve |
| 6 | Purchase Price ≥ $250 (FIXED) | M | Only the factory's governed `minFaceValue`, which bounds face, not price |
| 7 | Funding Limit and `offeringCap` | M | — |
| 8 | No purchase during a Reserve Shortfall, the Equity Cushion pause or an Enforcement Notice (rolls excepted) | M | — |
| 9 | Refuse payment from Clear contracts | M | Any `msg.sender` pays |
| 10 | Allowlist (a): burn only on settlement, buyback, `payPledged`, `redeemAll` | B | Phase 2e (`_retire`, `rollBond`); buyback and `redeemAll` don't exist yet |
| 11 | Allowlist (b) same-Holder accounts and (c) Successor path | M | Unpledged bonds move freely to anyone |
| 12 | Allowlist (d): pledge leaves the token in place | B | `CollateralRegistry.pledgeItem`, `BurnerBondBase._beforeTokenTransfer` |
| 13 | No third-party operator approvals | M | ERC-1155 `setApprovalForAll` works |
| 14 | IV-01 §4.12 legend in metadata | M | — |
| **§2** | **BondVault reserve** | | |
| 15 | USDC only, per-bond and per-series totals | P | Per bond (`obligations`); no series |
| 16 | Glide schedule by time to maturity, 30% FIXED floor (raise only) | P | A flat `minReserveBps` of 30%, which `setReserveTerms` can lower to 20%. No glide schedule. |
| 17 | 100% of non-rolling bonds within 90 days (FIXED) | P | 100% of **every** bond due within `reserveWindow` (governed, set to 90 days at deploy), rolling or not. A Fenwick tree over daily maturity buckets (`faceDueWithin`). |
| 18 | Late opt-out counts at 100% in the same transaction | M | Becomes "withdrawing a confirmation" under §4A |
| 19 | `shortfallSince`, `ReserveShortfall`, blocks, `topUp` | M | Withdrawals are already capped at `deployableExcess`; nothing else |
| **§3** | **Deployable excess** | | |
| 20 | `withdrawExcess` only to the registered Clear Lending multisig, proposed and executed by different signers | M | `withdrawDeployable(amount, to)`: one `TREASURY_ROLE` key, any address. `lendToPayoutPool` is a second outflow (conflict C1). |
| 21 | Only while assets after the withdrawal ≥ `requiredReserve()` | B | `deployableExcess` |
| 22 | Not during an Enforcement Notice | M | — |
| 23 | Changing the destination takes a timelock and the Agent's co-signature | M | — |
| **§4** | **Maturity, roll, early exits** | | |
| 24 | `settle` is permissionless at maturity and pays and burns | B | `BurnerBondPledges.settle` (opted-out bonds) |
| 25 | `settle` for an unpledged bond when the vault is short | M | Reverts. Phase 2e built the shortfall record for pledged bonds only. |
| 26 | Pledged split (MB-05 §5.6) | B | Phase 2e: `settle`, `Liquidator.maturityToDebt`/`applyMaturityInstruction`, `BondVault.settlePledged`/`completeSettlement` (see conflict C3) |
| 27 | Roll under IV-01 §5.2 | P | Re-pledge built (`rollItem`). The rest differs: the Holder calls `rollBond`; the term is a fixed governed `rollTerm`; there is no Ladder, Roll Notice yield, nearest-shorter term, cent rounding or remainder |
| 28 | No Holder-callable early redemption | B | `redeemEarly` removed (Phase 2e) |
| 29 | `buyback(id, price, sig)` | M | — |
| 30 | `payPledged(id)` | B | Phase 2e |
| 31 | `redeemAll()` after a 30-day timelock and a two-person flag | M | — |
| **§4A** | **Roll by confirmation** | | |
| 32 | Roll Notice, `confirmRoll`, `withdrawRollConfirmation`, deadline rules, reserve | M | Auto-roll (`autoRollOptedOut`, `willAutoRoll`, `setAutoRollOptOut`) is still in place |
| **§5** | **Collateral Agent** | | |
| 33 | `enforce` / `releaseEnforcement` | M | — |
| 34 | `postDistribution` (ratable, Agent sets only the total) | M | — |
| 35 | `toCollateralAccount`, `withdrawCosts` (7 days, cap) | M | — |
| 36 | `approveChange`, `rotateAgentKey` (48 h), lost-key replacement | M | — |
| **§6** | **Yield Pool** | | |
| 37 | Eligible Smart Accounts only, attestation with `exemptionCode`, refuse Clear sources | M | Anyone deposits. No Earn eligibility attestation exists on chain. |
| 38 | $250 minimum, 10% holder cap | M | — |
| 39 | Subscriptions pause on a Reserve Shortfall, the Equity Cushion pause or a Suspension; withdrawals never pause | M | — |
| 40 | Virtual share offset; shares and assets rounded down | P | OpenZeppelin 4.9 ERC-4626 rounding, offset 0 |
| 41 | Share Value = Vault Cash + Deployed Balance + accrued Pool Interest; the views | P | `LendingPool.totalAssets` = cash + `totalBorrowed` − queued − unvested interest; `utilizationBps`, `availableCash`. No `shareValue`, `vaultCash`, `deployedBalance`, `fundingRate` or holdback views |
| 42 | `deploy` (two-person, one lending account, ≤ 90%, no queue or Suspension); `returnFunds` by anyone | M | `borrow` by `BORROWER_ROLE` to a stored destination within a daily cap; `repay` is permissionless |
| 43 | Pool Interest accrues per second at the Funding Rate | M | Interest is cash that arrives, streamed over 7 days (X-18) |
| 44 | `postAllowance` / `postLossCharge` (two-person, bounded, timestamped); no sweep or rescue | M | `absorbLoss` (one `LOSS_REPORTER_ROLE` key). No sweep exists, but `seizeShares` does |
| 45 | Rate model, bounds, R₀+S₁+S₂ ≤ 10%, 48 h / 30 days / one per quarter | P | The same kinked shape, per cycle, set by `OPERATOR_ROLE` with no bounds or notice |
| 46 | Transfer allowlist; IV-02 §8.4 legend | M | Free ERC-20 transfers except locked units; `LIQUIDATOR_ROLE` is exempt |
| **§6A** | **Loss Holdback** (record, release, maximum age, application, pledged shares) | M | — |
| **§7** | **Withdrawals and queue** | | |
| 48 | On demand only with no open request; `maxWithdraw`/`maxRedeem` return 0 while one is open | P | `maxWithdraw` is capped by free cash, not zeroed by an open queue |
| 49 | `redeemOrQueue` | M | — |
| 50 | FIFO; shares in escrow keep earning and bearing losses; fill at Share Value; `fillQueue`; incoming cash fills the queue first; cancellation | P | Escrowed requests exist (`requestWithdrawal`), but the owner claims in any order once cash is there, the claim is capped at its value when queued (X-7, conflict C4), and there is no cancel |
| 51 | Age of the oldest open request | M | — |
| 52 | Pledged shares redeem only as MB-05 releases them; enforcement joins the queue | P | The Liquidator seizes them (`seizeShares`), then redeems or queues in its own name (conflict C5) |
| **§8** | **Suspension** | M | — |
| **§9** | **Pledge module** | | |
| 54 | Advance rates stored per pledge (95% / 70%) | B | Phase 2e (`itemAdvanceBpsOf`, `advanceBpsOf`) |
| 55 | Bond pledge needs the signed Maturity Instruction; its hash is stored | B | Phase 2e (`pledgeItem`) |
| 56 | Raise after the timelock; lowering needs 30 days' notice and applies to new pledges only | P | Stored rates protect existing pledges. `setCollateralTerms` (`OPERATOR_ROLE`) has no notice rule |
| 57 | Bonds valued by `accretedValue` | B | `BondValuer` → `presentValueOf` (same figure; formula is row 3) |
| 58 | Pool shares valued by `previewRedeem(shares)` | M | `POOL_SHARE` is valued at `unitPrice` (1:1), not the pool's price |
| 59 | Positions exit only through MB-05 | P | Bonds: yes. Pool shares: seized (C5) |
| **§10** | **Changes and roles** | | |
| 60 | Upgrades: 7-day timelock, two people, Holder notice; Agent `approveChange` for BondVault | P | BondVault and LendingPool are under the credit timelock (7 days, `deploy/credit_timelock_handover.ts`); no Agent |
| 61 | Roles granted only by a Lending Board resolution (hash recorded) | M | Plain `grantRole` |
| 62 | Events rebuild the Register, queue, Share Value history, holdbacks and collateral report | P | Bond and vault events exist; nothing for the pool's new state |
| **Do NOT change** | No path between BondVault/Yield Pool and AssurancePool, Loss Reserve or ESA | B | BondVault's AssurancePool slot is retired; `ReserveUntouched.spec`, `Assurance.spec`. New contracts must keep this. |

Totals: 13 B, 16 P, 34 M.

### Acceptance tests

| Test | | Notes |
|---|---|---|
| 1 Reserve example | P | The flat 30% floor gives $750 and $1,517.57 for a bond more than 90 days out, but there is no test, and withdrawals go to any address |
| 2 Late opt-out | M | Rewritten for §4A (withdrawing a confirmation) |
| 3 Multisig only, distinct signers | M | |
| 4 $249.99, Clear source, stale quote | M | |
| 5 Transfers outside the allowlist | P | Only pledged bonds are blocked |
| 6 `settle` and the roll formula | P | `settle` is built; the roll formula differs |
| 7 No early redemption; buyback rules | P | First half built and tested |
| 8 Enforcement and ratable distribution | M | |
| 9 Agent key limits, `withdrawCosts` | M | |
| 10 Upgrade needs `approveChange` and 7 days; Agent cannot stop `settle` | M | |
| 11 Funding Rate figures, bounds, notice | P | Same curve shape in LendingPool; per-cycle units, no bounds or notice |
| 12 `deploy` limits | M | |
| 13 Queue | M | |
| 14 Suspension | M | |
| 15 `postAllowance` / loss charge | M | |
| 16 Lowering a pool rate; roll re-pledges | P | Both halves tested in Phase 2e (`PledgedBonds.spec`); no 30-day notice |
| 17 No path in or out (fuzz) | P | Covers today's contracts; must extend to the new ones |
| 18 `payPledged` | B | `PledgedBonds.spec` |
| 19 Pledged maturity split | B | `PledgedBonds.spec` (its "auto-roll off" becomes "unconfirmed") |
| 20–25 Holdback, invariants, interest, pledge valuation, exemption tag and Equity Cushion, holdback age | M (6) | |
| 26 Roll by confirmation | M | |

Totals: 2 B, 7 P, 17 M.

## 2. Large redesigns

Sizes are rough runtime bytes against EIP-170's 24,576. "Deployed" means Base Sepolia unless a line says otherwise.

### R1. Collateral Agent and Enforcement Notice (§5, tests 8–10)

- **What:**
  - An outside key (bank or trust company). It can stop every BondVault outflow (`enforce`) and post ratable distributions, costs and transfers to the collateral account.
  - It co-signs every BondVault upgrade, role, parameter and destination change.
  - Its key rotates after 48 hours. A lost key is replaced with a 7-day timelock that recorded Required-Holder directions can block.
- **Why large:**
  - It adds a new outside role with a veto over BondVault governance.
  - It changes who controls an upgradeable contract (today the credit timelock alone).
  - It needs a ratable distribution across every outstanding bond, valued at Accreted Value at the enforcement time.
  - IV-10 Exhibit A, which the spec says to "implement exactly", is not in the repo.
- **Options:**
  - (a) Everything inside BondVault.
  - (b) A new `CollateralAgent` contract that holds the enforcement state, notices, the cost timer and cap, key rotation and change approvals, with BondVault reading it on every outflow and in `_authorizeUpgrade` and its setters.
  - Distribution: (i) push to every bond in one call, which won't scale; (ii) pull. With pull, a permissionless batched snapshot at `enforce` fixes each bond's amount due, each round raises a per-dollar ratio, and each bond claims to its Holder's account and burns when paid in full.
- **Recommendation:** (b) with pull distribution (ii). The Agent passes only a total, and per-bond amounts come from the snapshot (test 8). While enforcement is on, `settle`, `payPledged`, `completeSettlement`, `withdrawExcess`, buyback, purchases and rolls revert. Before building, get Exhibit A (Parts 1–3) into `specs/`.
- **Size:**
  - New `CollateralAgent`: about 7–9 KB.
  - BondVault: +4–6 KB (it has 12,688 bytes of headroom).
  - BurnerBond: a check in the purchase and roll paths, about 0.3 KB, placed in its module.
  - Changes the deployed BondVault (append-only storage).

### R2. BondVault reserve schedule, 90-day 100% reserve and Reserve Shortfall (§2, §4A reserve, tests 1–2)

- **What:**
  - `requiredReserve` = the greater of (a) a glide schedule by time to maturity, with a 30% FIXED floor that can only be raised, and (b) 100% of bonds due within 90 days (FIXED) except confirmed bonds that can roll.
  - A computed shortfall with `shortfallSince`, `ReserveShortfall` and `topUp`, blocking purchases (not rolls) and withdrawals.
- **Why large:**
  - It reshapes storage in a deployed upgradeable contract.
  - It replaces earlier-phase behaviour: a governed window, a floor that can drop to 20%, and 100% on everything near term. The spec reserves less for confirmed bonds and more at the floor.
  - Roll eligibility can change for many bonds at once (a holder made ineligible, a term withdrawn).
- **Options:**
  - Glide as (a) a continuous function, which can't be summed cheaply, or (b) governed step bands summed with the existing Fenwick tree: Σ band ratio × face due in that band.
  - Confirmed bonds: (a) iterate them, or (b) a second Fenwick tree of "confirmed and rollable" face. One tree per offered term lets a withdrawn term drop out at once. A per-holder list of confirmed bonds lets the ineligible flag move them in the same transaction.
- **Recommendation:** Step bands (raise-only, floor 30% as a constant), a constant 90-day window, and a second tree per term plus the per-holder list. The shortfall is computed in views and recorded by any state-changing call or a permissionless `pokeReserve`; time alone can create one, so it can't depend on a write. Track the two-Business-Day cure off chain from `shortfallSince`.
- **Size:** BondVault +3–5 KB. Changes the deployed BondVault (append-only).

### R3. Yield Pool vault with Pool Shares, Share Value, Holdback, Queue and Suspension (§6, §6A, §7, §8; tests 11–15, 20–25)

- **What:** A new ERC-4626 money model:
  - Deployments to one lending account, by two people;
  - Pool Interest that accrues per second on the Deployed Balance at the Funding Rate (owed by Clear Lending, a receivable inside Share Value);
  - two-person allowance and loss postings;
  - a Loss Holdback ledger with batched release, application and age release;
  - a strict FIFO queue that fills at Share Value;
  - Suspension with reason codes, expiry and renewal rules;
  - eligibility with `exemptionCode`, a holder cap and a transfer allowlist.
- **Why large:**
  - It is a new contract and new roles (CCO, treasurer, valuation proposer and approver).
  - It replaces how `LendingPool` is funded and paid: PayoutPool and the card settler borrow from it directly, and carry on unsecured tiers can be routed to it.
  - It touches PayoutPool's funding (conflict C1) and the Liquidator's pool-share paths (C5).
  - It is too big for one contract.
- **Options:**
  - (a) Upgrade `LendingPool` in place: storage reshape, every existing borrower and queue path changes, and X-7 and X-18 are undone.
  - (b) A new `YieldPool`, with `LendingPool` wound down on testnet (no mainnet funds) and the `POOL_SHARE` kind pointed at the new pool.
- **Recommendation:** (b), split in two:
  - `YieldPool`: ERC-4626 core, subscriptions, FIFO queue, `redeemOrQueue`, `fillQueue`, `deploy` / `returnFunds`, interest accrual, rate model, Suspension, transfer policy hook.
  - `YieldPoolValuation`: a delegatecall module pinned at construction like the issuer modules, holding `postAllowance`, `postLossCharge`, `releaseHoldbacks`, `applyHoldbacks` and the holdback ledger.

  Wiring:
  - **Pledged shares** exit only through an enforcement redemption on the pool: shares stay in the Holder's name, join the queue, proceeds go to the pledge module and the holdback goes to the Holder.
  - **PayoutPool's yield-pool leg** is turned off by configuration (`setYieldPool(0)`, no code change). Clear Lending funds the PayoutPool from what it receives as Deployments.
  - **Tier carry** stays with Clear Lending's treasury. Pool Interest is paid into the pool by `returnFunds`.
- **Size:**
  - New `YieldPool`: about 18–21 KB.
  - New `YieldPoolValuation`: about 8–10 KB.
  - `LendingPool` is retired, not changed.
  - PayoutPool: configuration only.

### R4. Compounding `accretedValue` and yield-based pricing (§1)

- **What:** `accretedValue` = Maturity Amount ÷ (1 + Issue Yield)^(days ÷ 365), rounded so the Holder never loses more than a cent. That needs an Issue Yield stored per bond, and a Purchase Price taken from a signed quote at that yield instead of the discount curve.
- **Why large:** Every value that depends on it changes:
  - `payPledged`'s amount;
  - bond collateral values and limits (`BondValuer`, `advancedValueOf`);
  - the maturity split's `limitWithout`;
  - the reserve glide.

  It is listed here because it changes Phase 2e's straight-line rule. The code change itself is moderate. BurnerBond is a clone with no proxy, so new storage means a new collection, as in Phase 2e.
- **Options:** (a) A general `exp`/`ln` fixed-point library. (b) A per-bond daily factor (1 + y)^(1/365) computed once at mint, then raised to the number of days by repeated squaring.
- **Recommendation:** (b), with WAD precision and the result rounded up, checked against an exact reference in tests, with the rounding documented. `BondDiscountCurve` remains for display only, or is retired.
- **Size:** about 1.5–2 KB of library code in the bond module. No deployed proxy changes; a new collection goes out through `scripts/redeploy_bonds.ts`.

### R5. `buyback` and `redeemAll` (§4)

- **What:**
  - `buyback(id, price, sig)`: the Holder's signature, price ≤ Accreted Value, paid from outside the vault, blocked during a shortfall or enforcement. The vault drops the obligation and pays nothing.
  - `redeemAll()`: a two-person wind-down or illegality flag, then 30 days, then every bond pays its Accreted Value.
- **Why large:** It isn't: there is no new role beyond the two-person flag, and the bond module has room.
- **Recommendation:** Build both in the bond module (BurnerBondPledges has 14,959 bytes of headroom).
  - Under `redeemAll`, a permissionless `redeemUnderWindDown(id)` pays one bond at a time, since one call can't pay them all.
  - A pledged bond goes through the same Maturity Instruction split as `settle`, with Accreted Value in place of the Maturity Amount. **Owner to confirm**; the spec doesn't say.
- **Size:** +2–3 KB in the module; +0.5 KB in BondVault (`retireUnpaid`).

### R6. Final Maturity (IV-02; §6A "Final Maturity run-off")

- **What:** The 20th anniversary of the Initial Closing. The spec only names a "run-off" redemption. It doesn't say how the run-off works.
- **Recommendation:**
  - Record `initialClosing` at the first subscription (set once).
  - From `initialClosing + 20 years`, subscriptions and `deploy` revert, and a permissionless `requestRunOff(holder)` queues all of a Holder's shares in FIFO order, under the normal holdback rules.
  - **Owner to confirm** FIFO against pro rata for the run-off.
- **Size:** about 1 KB in `YieldPool`.

### R7. Funding Limit, offering cap, Equity Cushion pause and the shared Earn controls (§1, §6, test 24)

- **What:**
  - Purchases are refused above the Funding Limit (Lending Co.'s borrowing limit for the fiscal year, set by the Holdings Board) or `offeringCap` ($1,000,000).
  - A two-person Equity Cushion pause stops bond purchases and pool subscriptions, but not rolls or withdrawals.
- **Why large:**
  - The rules are shared by the bonds and the pool, so they need a new shared contract and new roles.
  - The chain can't see Lending Co.'s other borrowings.
- **Options:**
  - (a) Copy the fields into BurnerBondDeposit and YieldPool.
  - (b) A new `EarnControls` contract that both read. It would hold: Equity Cushion pause, Funding Limit (with Board resolution hash), offering caps, the eligibility-attestation signer and `exemptionCode` check, the list of Clear contracts refused as payers, the holder-ineligible flag, the Ladder (terms and yields; whether a term is offered), Successor approvals (two-person plus evidence hash), the same-Holder check (`MembershipRegistry.getMemberByWallet`), and role grants that need a resolution hash.
- **Recommendation:** (b).
  - Measure the Funding Limit on chain as Σ outstanding Maturity Amounts plus Pool Assets plus open holdbacks.
  - Count `offeringCap` as cumulative Purchase Price of new purchases, rolls excluded.
  - Leave the Equity Cushion measure (L-01 §8.6A) off chain: the chain holds only the two-person pause.
  - **Owner to confirm** the two measures.
- **Size:** New `EarnControls` about 10–12 KB (UUPS). It keeps BurnerBond (1,282 bytes of headroom) and the factory's creation code (2,677 bytes of headroom) from growing.

### R8. Earn governance (§3, §10)

- **What:**
  - A 7-day timelock with Holder notice for BondVault and Yield Pool upgrades.
  - The Agent's co-signature on BondVault changes (R1).
  - A 2-of-N Clear Lending multisig as the only excess destination, with propose and execute by different addresses.
  - Role grants only with a Board resolution hash.
- **Why large:** It changes owner decision DECISIONS #10, under which these contracts sit under the credit timelock (conflict C6).
- **Recommendation:**
  - A separate Earn timelock: the same code, 7 days, a Clear Lending Safe as proposer. This follows Phase 2d's vault-timelock pattern.
  - Override `grantRole` on the Earn contracts to require a recorded resolution hash.
  - Run the two-person rules on chain with propose/approve pairs, as the issuers already do.
  - "No upgrade may lower the floor, widen an outflow…" cannot be enforced by code beyond constants and the Agent's co-signature. Say so in the report.
- **Size:** A deploy script, about +1 KB per contract for the `grantRole` override, and no new contract beyond the timelock instance.

### Not large, but worth naming

- **Transfer allowlist** (§1 b, c and the no-operator rule; §6 transfers): one policy check in `EarnControls` read by both token hooks, with `setApprovalForAll` made to revert. BurnerBond adds about 0.4 KB.
- **Purchase by quote** (`BurnerBondDeposit.purchase(quote, sig)`): about +2–3 KB.
- **The factory's creation code** (46,475 of 49,152) holds both implementations. Pass prebuilt implementations to its constructor, as the pledge module already is, so bond growth no longer counts against it.
- **`BurnerBond.setEncumbranceSource`** is instant and `onlyOwner`. A source that reports every bond as pledged would freeze every bond. Put it behind the same delay as `setLiquidator`.

## 3. Conflicts

| # | Conflict | Recommendation |
|---|---|---|
| C1 | **BondVault outflows vs §3.** `withdrawDeployable(amount, to)` sends to any address, and `lendToPayoutPool` lends excess to PayoutPool. §3 allows excess out only to the registered multisig. PayoutPool's `drawForDueClaim` draws from the yield pool and then the bond vault, and DECISIONS #3 and the compliance spec's "Do NOT change" keep PayoutPool's funding as it is. | Remove `lendToPayoutPool`, keeping `repayFromPayoutPool` until any open loan is repaid. Once PayoutPool's `borrowedFromVault` and `borrowedFromYield` are zero (it skips repayment to a zeroed lender), turn its vault and yield-pool legs off by configuration (`setBondVault(0)`, `setYieldPool(0)`), so PayoutPool's code, FIFO and AssurancePool rule are untouched. Its treasury leg funds claims, and Clear Lending refills the treasury from excess withdrawn under §3. **Needs the owner's OK**, because it changes how PayoutPool is funded. |
| C2 | **Missed cycle takes pool shares** (Phase 2e owner decision 1, `Liquidator.settleExcess`) vs MB-05 §6.1 ("may enforce against Collateral only in two cases": default after notice and cure, or a Shortfall after its wait) and Earn §7 ("Pledged shares redeem only as far as MB-05 releases them"). Phase 2e already used §6.1 to stop missed cycles taking bonds. | Stop taking pool shares on a missed cycle too, and keep the 12.12 excess lock so they stay pledged. If the owner keeps the decision, it must use the pool's queued enforcement redemption, not seizure (C5). Counsel to confirm. |
| C3 | **The pledged split's `toDebt` leaves the BondVault** (Phase 2e: USDC goes to the Liquidator so the ledger can record the repayment), where §4 says it "stays in the BondVault … leaves only as deployable excess". `payPledged` (`settleEarly`) is also a vault outflow, and §5 says enforcement stops every outflow except distributions. | Keep Phase 2e's design. The alternative is a non-cash repayment in RevolvingIssuer, which has 163 bytes of headroom in its extension and is owned by 2g. Treat these as named outflows that go only to the Holder's own debt. Block `settle`, `payPledged` and `completeSettlement` while an Enforcement Notice is in effect. |
| C4 | **Audit X-7** (a queued request is capped at its value when queued) vs §7 ("queued shares … keep earning and bearing losses; fill price = Share Value at fill"). | Follow the spec in the new pool. X-7's concern, a leaver escaping a loss, is still met: the fill is priced at fill and the loss holdback applies. |
| C5 | **Pool-share seizure** (`LendingPool.seizeShares`, `LIQUIDATOR_ROLE`'s transfer exemption, `Liquidator._takeShares`) vs "no Clear key can move or freeze an Earn position", MB-05 §7.3(b) ("redeemed through the vault's ordinary redemption … wait in the queue") and §6 transfers. | No seizure in the new pool. An enforcement redemption burns the Holder's own shares through the queue, sends the proceeds to the pledge module and records any holdback to the Holder (§6A, test 23). |
| C6 | **DECISIONS #10** (credit and savings contracts under the credit timelock) vs §10 (Agent co-signature for BondVault, Board-resolution role grants, Holder notice). | A separate Earn timelock (R8), as Phase 2d did for the ESA vault. |
| C7 | **Earlier reserve and pricing behaviour:** `setReserveTerms` (window and floor governed, floor down to 20%), 100% of every near-term bond, straight-line Present Value (Phase 2e judgement call 4), the discount-curve price, and the Holder-only `rollBond`. | Replace each as R2, R4 and section 5 describe. All are expected by the spec. They are listed because each one changes behaviour that is built and tested. |

No conflict with a 2e pledge rule beyond C3. The default order (`BOND`, `POOL_SHARE`, `BOOST`, `INCOME`) is "the module's order", which the spec leaves to the module. The stored advance rates and the Maturity Instruction stay as built. Nothing touches ESADepositVault or ClaimEscrow.

## 4. The two Phase 2e items

### Pledge-to-plan link

The text:

- MB-05 §6.1(a): enforcement on "a Default under MB-06 Section 13.7(a) of a **Plan that this Agreement secures**".
- MB-05 §7.3(a): a pledged bond's payment "may be applied only to the **Secured Obligations it secures**".
- IV-01 §4.9(c): applied "only … to the **Holder's obligations secured under MB-05**, in the order MB-05 Article 7 sets".
- 12.14: the trigger "reaches only **Earn collateral pledged to secure plans** (never CLRUSD)".

What it means: MB-05 is one agreement, and the link it describes is at the plan level ("a Plan that this Agreement secures"). Nothing quoted ties a particular pledge to a particular plan. "Earn collateral pledged to secure plans (never CLRUSD)" separates kinds of collateral (Earn, not Savings), not individual pledges. The definition of "Secured Obligations" and MB-05 Article 7 are not in the repo, so this reading needs counsel's confirmation.

**Recommendation:** no per-pledge link. Every Earn position pledged under MB-05 secures all of the member's Secured Obligations: asset-backed revolving debt and every plan secured by the member's `SecurePlan` signature (Phase 2e). Keep it as built for bonds. Record the reading in the report, and ask counsel for MB-05's "Secured Obligations" and Article 7 order.

### Pool shares for a secured-plan default

- Today a 12.14 default reaches bonds only, because the Liquidator's pool-share paths settle tiers and TermIssuer has none.
- **Recommendation:** a new `PoolShareEnforcer` (the pledge module's pool-share side). It takes over every pool-share path from the Liquidator: default, 12.14, the 72-hour Shortfall, and the missed-cycle excess if C2 keeps it.
  - On a recorded 12.14 default (`securedPlans(planId).defaultedAt`, `owedOn`), it asks the Yield Pool to redeem, as an enforcement redemption, only as many of the Holder's pledged shares as the defaulted plans still need after any bond payments. Shares are counted with `previewWithdraw` on the holdback-net price, and the Liquidation Hold and any 2g pause are checked first.
  - When the queue fills them, the proceeds pay the defaulted plans oldest first through `payPlan`, and the surplus goes to the Holder.
  - **Order:** bonds first (paid at once at Present Value with no holdback), then pool shares, measured again after each payment (MB-05 §7.3(c)). **Owner to confirm**, since MB-05 Article 7 is not in the repo.
  - Moving the pool-share paths out shrinks the Liquidator (759 bytes of headroom today) instead of growing it.
  - Size: new contract about 6–8 KB; the Liquidator about −3 to −4 KB.

## 5. Bond roll by confirmation (decision 15)

It replaces auto-roll. To change:

1. **Remove** `autoRollOptedOut`, `willAutoRoll`, `setAutoRollOptOut`, `AutoRollOptOutSet` and the Holder-only `rollBond`. BurnerBond is a clone, so the storage can be reshaped in a new collection.
2. **Store per bond:** `rollNoticeHash`, `rollDeadline`, `rollConfirmed` (default false), plus the noticed roll term and roll yield (point 7).
3. **`postRollNotice(id, noticeHash, rollDeadline)`:**
   - A new notice role in `EarnControls`, once per bond.
   - Reverts later than `maturity − 20 days` (FIXED).
   - `rollDeadline` must be in the future and no later than end of day Pacific seven calendar days before maturity (`PacificCalendar.endOfDay` on the local date of `maturity − 7 days`).
   - The fifth-Business-Day rule stays off chain.
4. **`confirmRoll(id, noticeHash, sig)`:**
   - EIP-712 `ConfirmRoll(uint256 bondId, bytes32 noticeHash, uint256 nonce, uint256 deadline)`, checked against `holderOf[id]` with `SignatureChecker` (EIP-1271 for the smart account).
   - Only after the notice, before `rollDeadline`, with a matching hash.
   - One signature covers one id; a batch call takes arrays of single-id signatures.
   - `withdrawRollConfirmation(id)`: `msg.sender == holderOf[id]`, before the deadline.
   - At and after the deadline the flag is frozen.
   - "Root key only, never a session key" can't be told apart on chain through EIP-1271. It rests on the autopay session key's call policy (decision 12) and the Privy real-device test.
5. **`settle(id)`**, permissionless at maturity:
   - Not confirmed, or confirmed but holder-ineligible or term withdrawn: pay out. An unpledged bond pays in full; a pledged one through Phase 2e's split. A short vault records the rest (row 25).
   - Confirmed and able to roll: roll. No USDC leaves the vault, the replacement starts unconfirmed and is re-pledged (`rollItem`), and the cent remainder goes to the Holder.
   - BurnerBondPledges' check `!autoRollOptedOut[bondId]` becomes "no effective confirmation".
6. **Reserve:** 100% of every bond due within 90 days except confirmed bonds that can roll (R2's second tree). `confirmRoll`, `withdrawRollConfirmation`, the holder-ineligible flag and term withdrawal each update the BondVault in the same transaction.
7. **Roll terms (IV-01 §5.2):**
   - Same term, or the nearest shorter offered term.
   - The yield is the Roll Notice yield, or any higher Ladder yield.
   - New Maturity Amount = old ÷ new price per dollar, rounded down to the cent.

   A hash alone can't tell the contract the noticed yield. **Recommendation:** `postRollNotice` also records the roll term and yield (two more arguments than the spec's signature), and the Ladder lives in `EarnControls`. Owner to confirm.
8. **Tests:**
   - Test 26 is new. Test 2 is rewritten for withdrawing a confirmation, and test 19's "auto-roll off" becomes "unconfirmed".
   - `BurnerBond.spec`, `BondCollateral.spec` and `PledgedBonds.spec` move off `setAutoRollOptOut` and `rollBond`.
9. **App:** `apps/member/src/lib/sendCalls.ts` and `apps/api/src/services/chain/earnReader.ts` still use auto-roll (section 7).

## 6. Build plan

**Ownership while 2g runs.** Until 2g merges, 2g owns RevolvingIssuer\*, TermIssuer\*, the Liquidator, BurnerBond\* (with BurnerBondDeposit and BurnerBondFactory), BondVault and CollateralRegistry. 2g's decisions 6 (pauses stop `payPledged`; paused time extends the 72-hour clock) and 21 (Earn pledge, roll and settlement events carry member and amount) touch these files.

### Stage 1: now, in parallel with 2g (new files only)

| Agent | Owns | Builds | Tests |
|---|---|---|---|
| A: Yield Pool | `contracts/peripherals/YieldPool.sol`, `YieldPoolValuation.sol`, their interfaces, `test/earn/YieldPool*.spec.ts`, a new deploy script | R3 and R6: subscriptions with attestation and `exemptionCode`, holder cap, $250, FIFO queue, `redeemOrQueue`, `fillQueue`, cancellation, `deploy`/`returnFunds`, per-second Pool Interest, the rate model with bounds and notice, Suspension, Holdback (6A), enforcement redemption, Final Maturity | 11–15, 20–25, the pool half of 5 and 17 |
| B: Earn controls and Agent | `contracts/peripherals/EarnControls.sol`, `CollateralAgent.sol`, `contracts/libraries/Accretion.sol`, harnesses, `deploy/earn_timelock_handover.ts`, their tests | R7, R8, the R1 contract (standalone), R4's library, the Ladder, holder-ineligible flags, Successor approvals, transfer policy | 24 (pause half), 9 (Agent-only half), library checks for R4 |

The interface between them is `IEarnControls`, owned by B and agreed first. A works against a mock until B's contract lands.

### Stage 2: after 2g merges

| Agent | Owns | Builds | Tests |
|---|---|---|---|
| A: Bonds | BurnerBondBase, BurnerBond, BurnerBondPledges (`.v2`), BurnerBondDeposit, BurnerBondFactory, BondValuer, BondDiscountCurve, `scripts/redeploy_bonds.ts`, deploy 10 and 23 | Issue Yield and compounding (R4), purchase by quote, $250, caps and pauses, the transfer allowlist and no operators, roll by confirmation (section 5), `buyback`/`redeemAll` (R5), per-bond paid amount and series, legend, factory taking prebuilt implementations, `setEncumbranceSource` delay | 4, 5, 6, 7, 26; updates to 18 and 19 |
| B: Vault and enforcement | BondVault, CollateralRegistry, the Liquidator, a new `PoolShareEnforcer`, LimitCalculator if needed, deploy 22 and 25, PayoutPool and LendingPool configuration | R2, §3 `withdrawExcess` and C1, R1's vault hooks and pull distribution, the unpledged settlement shortfall, buyback retirement, the confirmed-roll tree, pool-share valuation by `previewRedeem`, the rate-lowering notice, the pool-share paths moved out of the Liquidator, 12.14 pool shares (section 4) | 1, 2, 3, 8, 10, 16, 17, 23 (pledge half) |

The interface between them is `IBondVaultSettlement`, with new calls for the confirmed-roll reserve, buyback retirement and distributions. B owns it, and it is agreed on the first day of the stage.

### Stage 3: one agent

Deploy scripts end to end, full suite, sizes, OpenZeppelin storage reports (BondVault, CollateralRegistry and the Liquidator against `.openzeppelin/base-sepolia.json`), Slither, regenerated fingerprints and contract docs, and `PHASE-2F-REPORT.md`.

### Size risks

| Contract | Headroom now | Plan |
|---|---|---|
| Liquidator | 759 | Add nothing. Moving the pool-share paths to `PoolShareEnforcer` frees about 3–4 KB. 2g's pause checks land here first. |
| RevolvingIssuerExtension | 163 | Not touched by 2f. C3 keeps Phase 2e's cash repayment so nothing new is needed here. |
| TermIssuer | 567 | Not touched. 12.14 pool shares use the existing `payPlan`, `owedOn` and `securedPlans`. |
| BurnerBond | 1,282 | Only forwards and a policy call. Logic goes in BurnerBondPledges (14,959). |
| BurnerBondFactory creation code | 2,677 (of 49,152) | Take prebuilt implementations as constructor arguments. |
| BondVault | 12,688 | R1 + R2 + §3 come to about 8–11 KB, which fits. If it doesn't, the distribution code moves to `CollateralAgent`. |
| YieldPool | new | Split in two from the start (R3). |
| CollateralRegistry | 8,980 | About +1.5 KB. |

## 7. Off chain, or the app's job

- **Eligibility and exemption.** The 506(c), 506(b) and 147A decision is the app's eligibility step. On chain there is only the signed attestation and the `exemptionCode` tag, which no logic reads.
- **Business Days.** The two-Business-Day Reserve Shortfall cure is measured from `shortfallSince`. The fifth Business Day for `rollDeadline` is computed off chain; the contract checks only the 7-calendar-day limit. Clear Lending's 2-Business-Day surplus payment under IV-01 §4.9(c) is met on chain by paying at once.
- **The queue's 30-day and 90-day rules** (IV-02 §6.4), from the oldest-request age the pool exposes.
- **Measures the chain can't see:** the Equity Cushion (L-01 §8.6A) and Lending Co.'s non-Earn borrowing under the Funding Limit. Only the two-person pause and the posted limit, with its resolution hash, are on chain.
- **Documents behind hashes:** Board resolutions, Required-Holder directions, the Agent's instructions, cost statements, evidence for Suspensions and postings, Roll Notices, Successor proof (W.S. 34.1-8-402), the W-9 and the indemnity.
- **Holder notices** of upgrades and rate cuts, and the legend text. The contracts carry a URI or hash.
- **The app:**
  - remove auto-roll (`sendCalls.ts`, `earnReader.ts`);
  - a per-bond "Roll" confirmation screen signed by the root key, with the session-key policy excluding `confirmRoll` (decision 12);
  - "Take $X now, queue the rest";
  - holdback and queue views;
  - `shareValue` in place of `navPerShare`;
  - the Ladder and quote screens;
  - indexing of the new events.
- **Before launch:** the Privy EIP-1271 real-device test (decision 15). Get IV-10 Exhibit A, MB-05's "Secured Obligations" definition and MB-05 Article 7 into `specs/`.
- **ELPA (Addendum 3):** no contract and nothing on chain before Redemption (owner decision). The Deed v5 check (ROFR-exempt Redemption transfer, the beneficiary as Owner-Trustee, the ROFR on later transfers) is a report-only item for gate G4, after 2e and 2f. It is not part of this build.

## 8. Ambiguities for the owner

1. Funding Limit and `offeringCap` measures (R7).
2. A pledged bond under `redeemAll` (R5).
3. Distributions on a pledged bond during enforcement: the spec says Holder's account only. Confirm that the pledge is then released.
4. Final Maturity run-off order (R6).
5. Bonds before pool shares on a plan default (section 4).
6. Roll Notice yield and term on chain (section 5, point 7).
7. Whether the 10% holder cap counts per wallet or per member across linked accounts. Recommendation: per member.
8. Who holds the Roll Notice role and the holder-ineligible flag. Recommendation: two different Clear Lending roles in `EarnControls`.
