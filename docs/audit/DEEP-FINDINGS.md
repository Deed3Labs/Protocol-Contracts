# Deep pass: credit core, payout pool, bonds, lending and assurance

Repo: `deed3labs/protocol-contracts` @ `dev` 7eb5976 (solc 0.8.29 viaIR, OZ 4.9.6).
Scope: line-by-line review of BondVault, BurnerBond, BurnerBondDeposit, BondValuer, BondDiscountCurve, BondTraits, BurnerBondFactory, LendingPool, AssurancePool, AssuranceOracle, CarryIndex, ExposureMath and PayoutPool accounting. Also a seeded stateful fuzz of ClearCredit + RevolvingIssuer + TermIssuer + PayoutPool.

This report leaves out the first-pass issues C-1, C-2, H-1..H-4 and M-1..M-8. Where a finding here is a new consequence of one of them, it says so.

## Findings

| ID | Sev | Title | Location |
|---|---|---|---|
| X-1 | High | Refunding a paid plan also forgives the member's unrelated debt (double refund, phantom issuer principal) | StableCredit.sol:368-371 (`_takeBack` → `_transferObligation`) |
| X-2 | High | A pre-funded PayoutPool sends member repayments to the AssurancePool, so funders end up holding claims that no one owes | StableCredit.sol:591-595 (`_payoutPoolNeeds`), PayoutPool.sol:576-606 |
| X-3 | Medium | A refund shortfall is minted to the PayoutPool, is not tracked, and gets paid out as "carry" (counted twice) | StableCredit.sol:373, PayoutPool.sol:640-646 / 665-699 |
| X-4 | High | Merchant refund and reversal obligations never net: `originatePurchase` mints to the merchant, so it keeps redeeming while it owes | StableCredit.sol:213/217 (`_accrueCredit` = `_mint`), 284, 371-373; PayoutPool.sol:266 |
| X-5 | Medium | Carry withheld from a refund is never settled on the ledger, so the member pays it twice | StableCredit.sol:340-343, TermIssuer.sol:544 |
| X-6 | Medium | A write-off is absorbed by rate band across all issuers: a (permissionless) term default writes off revolving BOOST debt, and the reverse | StableCredit.sol:461-476 + 632-652; TermIssuer.sol:825 |
| X-7 | Medium | LendingPool queue: depositors front-run `absorbLoss` by queueing at the pre-loss price; an insolvent queue is paid from new deposits | LendingPool.sol:291-325, 365 |
| X-8 | Medium | `advancedOf[coopTreasury]` is never reduced when the treasury's claims are burned, so `distributeCarry` underflows (DoS) or over-pays the co-op | PayoutPool.sol:427, 601, 681-683, 878 |
| X-9 | Medium | AssurancePool books DAI/USDT deposits as USDC but `reimburse`/`lendTo*` pay only USDC, so `burnLostDebt` and the reserve backstop revert | AssurancePool.sol:486-503, 568-600, 616 |
| X-10 | Medium | Unbounded `faceDueWithin` loop runs on every RTD read; ~2,100 min-face bonds DoS the repayment path | BondVault.sol:174-190, 212; AssurancePool.sol:180 |
| X-11 | Low | `CarryIndex.rpow` overflows at the 50%/cycle cap after 131 cycles, after which every touch of the position reverts | CarryIndex.sol:78-95, 230 |
| X-12 | Medium | Refunds are paid from funder capital without reducing `capitalOf`, so the funder silently absorbs the refund | PayoutPool.sol:792-841 |
| X-13 | Medium | A refund's outcome depends on whether anyone materialised carry first: a stranger can turn a full refund into a term default | TermIssuer.sol:492-580, 722 |
| X-14 | Low | `PlanRefundPaid.returned` reports gross cash, before the carry withheld | TermIssuer.sol:550 |
| X-15 | Low | AssuranceOracle prices USDT, DAI and any registry "stablecoin" at a hard-coded $1, so a depegged coin deposits at par | AssuranceOracle.sol:154, 322 |
| X-16 | Low | Permissionless `rebalanceRTDPublic` reprices volatile reserves: drops come out of primary once excess is empty, rises go to (withdrawable) excess | AssurancePool.sol:821, 897-920 |
| X-17 | Low | `repayFromPayoutPool`/`repayFromBondVault` credit interest to `bufferOwed` and `lent*` as if it were principal | AssurancePool.sol:647, 701 |
| X-18 | Low | LendingPool earns interest as lump `safeTransfer`s, so a JIT deposit and withdraw captures it | PayoutPool.sol:479; LendingPool.sol:130 |
| X-19 | Low | `BurnerBondFactory.createCollection` is permissionless with caller-chosen name, symbol and URI, so the reserve-token collection can be squatted | BurnerBondFactory.sol:249 |
| X-20 | Info | A partly funded `drawForDueClaim` leaves borrowed cash idle; the next repayment repays the lender first, and the later payout hands the position to `coopTreasury` | PayoutPool.sol:389-445, 616-633, 902-933 |

Counts: **0 Critical, 3 High, 9 Medium, 7 Low, 1 Info.**

---

### X-1 (High): Refunding a paid plan also forgives the member's unrelated debt
**What happens.** `repayRefund` → `_takeBack(member, merchant, share)`. If the merchant has already redeemed (`held == 0`), the code checks `creditBalanceOf(member) >= shortfall` and moves that much of the member's obligation onto the merchant (`_transferObligation`). The member's balance is one signed number, so it includes revolving debt and other plans. The refunded plan was already paid, so the "obligation" being moved belongs to something else. Then `payRefund` also pays the member the full cash refund. No issuer is told about the move.
**Impact.** For every refund of a paid purchase where the member carries other debt, the member gets `paid` in cash plus up to `merchantShare` of debt relief: 1,975 of value for a 1,000 purchase. The merchant gets an untracked obligation, which also never nets (see X-4). RevolvingIssuer still books the full principal and keeps charging carry on debt the ledger no longer holds (phantom principal). Invariant (ii) goes negative, and later repayments are misattributed. The member only needs the operator to process an ordinary refund.
**Proof.** `DeepPoC.spec.ts › X-1`. The fuzz also found it independently in seeds 2, 3, 4, 11 and 12 as `(ii) refund down` / `(iv) phantom principal`.
**Fix.** In `_takeBack`, never move the member's obligation when they are being repaid in cash. Always create the merchant's obligation against the pool (`_accrueCredit(holder, pool, shortfall)`) and track it (see X-3). If you keep a transfer path, limit it to the refunded plan's own outstanding principal, and only in `reversePurchase`.

### X-2 (High): A pre-funded PayoutPool sends member repayments past it
**What happens.** `_payoutPoolNeeds() = totalSupply − payoutPool.held()`, and `held()` includes funder capital, borrowed cash and refunds owed. With 20k of capital in the pool (as in production, via `fund_payout_pool.ts`), all repayments below 20k go to `assurancePool.depositRepayment`, so `memberFunded` stays 0. When the merchant redeems, `_placePosition` finds `memberFunded == 0` and "sells" the claim to the funder (`advancedOf[funder]`). But the member has already paid, so no one owes that claim and no repayment will ever reach the funder.
**Impact.** Every payout made while the pool is funded turns funder capital into a dead claim. The matching cash sits in AssurancePool primary/buffer, where funders cannot reach it. A funder that is not a ledger member cannot even redeem the claim. A funder that is a member (the treasury) just recycles its own capital. Unbacked supply grows with volume: invariant (i-b) breaks on every `repayCreditBalance`/`payPlan` in seed 4. External FUNDER_ROLE parties lose principal. The AssurancePool RTD is also overstated with funds that belong to funders.
**Proof.** `DeepPoC.spec.ts › X-2`: funder holds 975 claims against a member who owes 0, `idleCapitalOf = 19,025`, and `redeem` reverts. Fuzz seed 4: `(i-b) unbacked claims grew` on repayCreditBalance and payPlan.
**Fix.** Size the pool's need as `totalSupply − memberFunded − refundsOwed` (or simply `totalSupply − memberFunded`), not as `held`. Alternatively, when a repayment arrives and funder positions exist for that obligation, use it to buy the funder's position back (repay capital and burn).

### X-3 (Medium): A refund shortfall minted to the pool is counted as carry
**What happens.** When the member owes less than the shortfall, `_takeBack` mints the merchant's new obligation as a claim to `payoutPool` (`_accrueCredit(holder, payoutPool, shortfall)`). PayoutPool does not record this (it is not `inFlight`, `advancedOf[pool]` or `carryEarned`), so `distributableCarry()` reports it. Then the permissionless `distributeCarry()` hands it to carriers (funders, lenders through `carryEarned`) or to `coopTreasury`.
**Impact.** The pool's IOU for the refund it fronted becomes someone's redeemable income. The same merchant obligation now backs both the member's `refundsOwed` and this new claim. In fuzz seeds 2, 11 and 12, `payRefundsOwed` grows the unbacked-claim gap by exactly the refund.
**Proof.** `DeepPoC.spec.ts › X-3`: `distributableCarry == 975` immediately after the refund, and the co-op receives it after `distributeCarry`.
**Fix.** Track the refund receivable (e.g. `refundReceivable += shortfall`) and exclude it from `distributableCarry`. When repayments refill the pool, settle (burn) it against them.

### X-4 (High): Merchant refund and reversal obligations never net
**What happens.** `reversePurchase` (merchant already redeemed) and `_takeBack` leave the merchant with `creditBalance > 0`. The code and comments rely on "credits reaching a party with an obligation burn against it (`_afterTransfer`)". But term sales and card settlements reach the merchant through `originatePurchase → _accrueCredit → _mint`, which never runs `_afterTransfer`. `redeemableOf = balanceOf`, so the merchant keeps redeeming every new sale in full. Only a revolving draw by `transfer` to the merchant nets, which the fuzz shows as `(ii-m) … @draw → 0`.
**Impact.** Each refund after payout is a straight loss to the pool: the member is refunded and the merchant is never debited. A merchant colluding with a member (buy, pay, refund, repeat) drains the pool by the payout per cycle. The obligation is also tracked by no issuer: it accrues nothing and cannot be defaulted. For a merchant that has a revolving line, the untracked balance makes `inCompliance` false. That freezes it at grace (blocking revolving payments *to* it) and eventually revokes it, with a write-off of 0.
**Proof.** `DeepPoC.spec.ts › X-4` (the merchant is paid twice and the obligation stays at 975) and `DeepPoC2.spec.ts › X-4b` (the `reversePurchase` path).
**Fix.** In `originatePurchase` (and the `_accrueCredit` used for merchant payouts), first burn the recipient's existing obligation: `repay = min(creditBalance[merchant], payout)`, then mint `payout − repay`. Alternatively, have `redeem` subtract `creditBalanceOf(merchant)`.

### X-5 (Medium): Withheld carry is charged twice
**What happens.** `repayRefund` pays out `paid − carryWithheld`. Its comment says the withheld part is "settled against the member's balance", but no code does this. `closePlanForRefund` then closes the plan with the carry left on the ledger as residual.
**Impact.** The member loses the carry from the cash and still owes it. In the PoC: 3.86 USDC withheld and 3.86 USDC still owed. It shows in invariant (ii) as `refund up` in every refund-heavy seed.
**Proof.** `DeepPoC.spec.ts › X-5`.
**Fix.** Settle `carryWithheld` against the member: route that part as a repayment (`_systemTransfer(address(this), member, withheld)` funded by the withheld cash), or simply don't withhold it.

### X-6 (Medium): A write-off is spread across issuers by rate band
**What happens.** `writeOffCreditLine` uses `_systemTransfer`, which calls `_settleRepayment`. That offers the written-off amount to every issuer, dearest rate band first. When `TermIssuer.declareDefault` writes off a 150 bps plan, the revolving BOOST tier (300 bps) absorbs it first. TermIssuer `_onDefault` then zeroes the plans anyway. The reverse also happens: a revolving default (`expireCreditPeriod`) offers its write-off to term plans priced above the cheaper revolving tiers. Those plans count it as `repaid`, which clears arrears.
**Impact.** In the PoC, 1,045 of live revolving debt becomes an untracked ledger residual. It accrues no carry, appears in `residualCarryOf`, and is invisible to the later revolving default sizing (`totalDrawnOf`), so it never enters `lostDebt`. Meanwhile the revolving headroom looks free again. `declareDefault` is permissionless. The fuzz shows `(ii) declareDefault up` in every seed where a default happened.
**Proof.** `DeepPoC.spec.ts › X-6`.
**Fix.** Do not call `_settleRepayment` for write-offs. Have the defaulting issuer clear its own positions (it already does), or pass a "directed" flag so that only the calling issuer absorbs.

### X-7 (Medium): LendingPool queue front-running and insolvency
`requestWithdrawal` burns shares and fixes `assets` at today's price, with no cash needed. A depositor who sees a default coming (`declareDefault` and period expiry are public) queues before `absorbLoss`, and the remaining holders take all of the loss. In the PoC, B's 1,000 goes to 0 and A gets 1,000 back. `claimWithdrawal` only checks raw cash, so an insolvent queue (where `totalAssets` is floored at 0) is paid out of new deposits.
**Proof.** `DeepPoC.spec.ts › X-7`.
**Fix.** Socialise losses onto queued requests: store shares and price them at claim time, or pro-rate unclaimed queued assets inside `absorbLoss`.

### X-8 (Medium): Stale `advancedOf[coopTreasury]` breaks the carry split
The treasury becomes a funder through `drawForDueClaim` (capital). Its positions sit in the same balance as its fee income, and `withdrawCoopIncome` burns them (`settleClaim(coopTreasury)`) without reducing `advancedOf`. `distributeCarry` then computes `share = carry × advancedOf / float` with `advancedOf > float`, so `left -= share` underflows and distribution reverts until supply grows. Once it grows, the co-op receives carry that belongs to other carriers, including lenders through `carryEarned`.
**Proof.** `DeepPoC2.spec.ts › X-8` (panic 0x11).
**Fix.** Reduce `advancedOf`/`advancedTotal` whenever a carrier's claim is settled or transferred. Also cap `share` at `left`.

### X-9 (Medium): The multi-token reserve is booked in reserve-token units but pays only USDC
`depositToken*`, which is permissionless, credits `primary/buffer/excess[reserveToken]` at the oracle quote while holding DAI or USDT. `reimburse`, `lendToPayoutPool`, `lendToBondVault` and `withdraw` only `safeTransfer(reserveToken)`. Once USDC on hand is less than the accounted reserves, `burnLostDebt` reverts. `drawForDueClaim` (reserve leg) and BondVault `_cover` also revert as a whole.
**Proof.** `DeepPoC2.spec.ts › X-9`: 10k DAI in primary, and `burnLostDebt(1,000)` reverts with "transfer amount exceeds balance". It succeeds once USDC is present.
**Fix.** Track balances per token and pay out through `_withdrawEquivalentValue`, or convert non-reserve deposits to the reserve token on entry.

### X-10 (Medium): Unbounded bond loop on the repayment path
`faceDueWithin` walks every outstanding bond. It is reached from `bondExposure → _exposureInReserve → RTD/neededReserves`, which runs on every `depositRepayment` (and so every member repayment whose remainder reaches the reserve), plus `lendToPayoutPool`, `lendToBondVault`, `deployableExcess`, `_repayReserve` and `withdrawDeployable`. Measured cost is about 7,982 gas per bond. `makeDeposit` is open to anyone at the $100 minimum face. About 2,100 bonds ($210k, recoverable with yield) exceed a 16.7M per-tx cap; about 3,750 exceed a 30M block.
**Proof.** `DeepPoC2.spec.ts › X-10` (gas growth measurement).
**Fix.** Keep running sums bucketed by maturity (or a sorted maturity queue with a cursor), and raise the minimum face.

### X-11 (Low): `rpow` overflow
At `ratePerCycle = 5000` (the allowed cap), `currentIndex` overflows after 131 cycles. After that, every `_materialiseCarry`, and so every transfer involving the member, reverts permanently. At 300 bps the limit is about 1,797 cycles. Proof: `DeepPoC2.spec.ts › X-11`. Fix: lower the cap, or saturate the index.

### X-12 (Medium): Refunds are paid from funder capital
`payRefund` and `payRefundsOwed` pay from `held()` and only decrement `memberFunded`. When the cash is funder capital (the normal state under X-2), `capitalOf` is left unchanged and the funder quietly loses the refund. In the PoC, `capitalOf = 4,025` but only 3,025 is withdrawable, plus a dead 975 claim. Fuzz seed 4: `(iii-b) held < memberFunded + capital` after a refund.
**Proof.** `DeepPoC2.spec.ts › X-12`.
**Fix.** Pay refunds only from `memberFunded` (queue the rest), or reduce capital in FIFO order and record the funder as holder of the refund receivable.

### X-13 (Medium): A refund depends on the order of `materialiseCarry`
`closePlanForRefund` measures `carry` as "principalOutstanding before vs. after materialising here". If anyone has called the public `materialiseCarry(planId)` first, the carry looks like principal. The full refund then leaves the plan open over that carry, still on the original 4×257 schedule. The member is immediately "behind" (no new plans), and after two installments anyone can call `declareDefault`, which suspends their term credit. Without the prior call, the same refund closes the plan.
**Proof.** `DeepPoC2.spec.ts › X-13` runs both orders from one snapshot.
**Fix.** Track materialised carry per plan explicitly (`carryMaterialised`), use `principal − repaidPrincipal` as the refundable base, and re-fix the schedule (or close the plan) after any refund.

### X-14 to X-20 (Low / Info), found by inspection
- **X-14:** `emit PlanRefundPaid(planId, cash, withheld)` puts the gross amount in the `returned` field. Off-chain reconciliation over-reports by the carry withheld (seen in X-5).
- **X-15:** `_isStablecoin` returns 1e18 for USDT, DAI and registry stablecoins. Combined with permissionless `depositToken*`, a depegged coin enters the reserves at par.
- **X-16:** `_updateReserveValues` takes losses from excess, then buffer, then primary, but books gains to excess only. With a volatile whitelisted asset and an empty excess, anyone calling `rebalanceRTDPublic` ratchets value out of primary into withdrawable excess (bounded by the 30-minute TWAP).
- **X-17:** `repayFromPayoutPool` treats an interest payment (PayoutPool `_repayLenders` sends it to the same function) as principal. It reduces `lentToPayoutPool` and restores buffer first, which misstates what is still owed.
- **X-18:** Interest reaches LendingPool as one `safeTransfer`, so `totalAssets` jumps. Deposit and withdraw around a repayment captures it. A trailing or streamed interest accrual would fix it.
- **X-19:** Anyone can call `createCollection(reserveToken, symbol, name, uri)` before the first deposit. The collection's name, symbol and description are then fixed for good (only the URI can be reset by the owner).
- **X-20:** If `drawForDueClaim` draws only part of the shortfall, the borrowed cash sits idle. `_payoutPoolNeeds` counts it as held, so part of the next repayment bypasses the pool, and `_repayLenders` returns the lender's principal before anything else. When the claim is eventually paid, that cash is unattributed, and `_placePosition` gives the credits to `coopTreasury`, a position on a member who has already paid.

Checked and **not** reportable:
- The BondValuer duplicate-id double count is prevented by `itemPledged`.
- Redeeming a pledged bond is blocked by `BondVault.settle`'s encumbrance check (but only while something is drawn, which is the same pattern as C-2).
- BondDiscountCurve's `max < min` underflow is prevented by the factory.
- ERC-4626 inflation is mitigated by OZ 4.9.6 virtual shares.
- `_systemTransfer` computes `burned` before notifying issuers, but `_repay` caps the amount at the pre-materialisation balance, so the attribution stays consistent. The fuzz never showed drift on `repayCreditBalance`.

---

## Invariant results

Harness: `test/audit/deep/fuzz-engine.ts`, a seeded mulberry32 generator. Actors: 3 members (revolving INCOME 1,500 + BOOST 500, term limit 2,000), 2 registered merchants, a co-op treasury with a 50k allowance, and a funder. Actions:
- draw by transfer
- openPlan (rate 0/65/150/300, 1/2/4 installments)
- payPlan
- repayCreditBalance
- warp (≤ 20 days)
- materialiseCarry (revolving and term)
- redeem
- payQueue
- closePlanForRefund (partial or full)
- distributeCarry
- withdrawCoopIncome
- payRefundsOwed
- drawForDueClaim
- declareDefault

Each step's change in every invariant is attributed to the action that caused it. Raw data is in `/home/claude/audit-work/fuzz/*.json`.

Runs: 7 random runs × 300 steps = 2,100 steps (seeds 1-3 empty pool; 11-12 with one member who stops paying; 4 with a pre-funded pool; 5 with overdraw allowed). Plus 2 × 300 for the A/B path test, and a deterministic 120-day path test.

| Invariant | Result |
|---|---|
| (i) `totalSupply == Σ creditBalanceOf` (incl. the ledger's line) | **Cannot hold by design.** A repayment moves the obligation onto the ledger's own line, which only `burnLostDebt` ever reduces, and the paid claim is then burned (`settleClaim`, `_takeBack`). Drift appears only on redeem, payQueue, drawForDueClaim, withdrawCoopIncome (settlement) and refund (`_takeBack` burn). **Zero drift on draw, openPlan, payPlan, repayCreditBalance, warp, materialise and declareDefault** (asserted in seeds 1-3). Minimal repro: openPlan(1000) → payPlan(1000) → merchant redeem(975): supply falls 975, and the ledger line keeps 1000 forever. |
| (i-b) every claim is backed by an obligation, by `memberFunded` or by `lostDebt` (the meaningful replacement for (i)) | **Breaks.** (a) Every repayment while the pool is funded: seed 4, X-2. (b) Refunds / payRefundsOwed: seeds 2, 3, 11, 12, X-3/X-12. Held in seeds 1 and 5 (no refund after payout). |
| (ii) `creditBalanceOf(m) == rev.totalPrincipalOf + term.totalPrincipalOf` (+ residual) | **Breaks in five ways.** (1) `draw` beyond revolving headroom: known C-1, seed 5 only. (2) `declareDefault` up: X-6, seeds 2/3/4/5/11/12. (3) `refund` up: carry residual from X-5, plus 1-2 wei at refund close-out (seeds 3, 11, 12). (4) `refund` down, negative (phantom issuer principal): X-1, seeds 2/3/4/11/12. (5) Merchants get untracked obligations from refunds: X-4/X-4b, every refund-after-payout. `repayCreditBalance` only reduces existing residuals and never creates one. Minimal repros: X-1, X-5, X-6 PoCs. |
| (iii) PayoutPool `held ≥ refundsOwed (+ payable claims)` | `held ≥ refundsOwed` **does not hold, by design**: refunds become IOUs when the pool is short (seeds 1/2/3/4/12). Claims are still protected: `canPayNext ⇒ payNext` succeeds, `_payable` excludes refundsOwed, `inFlight == queuedTotal` held throughout, and pool credits ≥ `inFlight + advancedOf[pool] + carryEarned` held throughout. **New break:** `held ≥ memberFunded + Σ capitalOf` fails after refunds (seed 4, X-12). |
| (iv) no incorrect carry-on-carry | **Holds for the index itself.** Materialising daily vs. never gives the same ledger, revolving and term figures to the wei (deterministic test, 120 days with payments and draws). No carry is booked in the same block as a draw. **Breaks around it:** (a) after an X-1 refund, carry keeps accruing on phantom revolving principal the ledger no longer holds (seeds 2/3/4/11/12); (b) a refund's result depends on whether carry was materialised first (X-13). The random A/B run differs at the end (max 21.1 USDC) because amount bounds depend on state, and refunds go through X-13. |

## Test files and pass counts

All tests are run with `npx hardhat test <file> --no-compile`.

| File | Contents | Result |
|---|---|---|
| `test/audit/deep/deep-setup.ts` | shared wiring (core + MerchantRegistry + PayoutPool + actors) | n/a |
| `test/audit/deep/fuzz-engine.ts` | stateful fuzzer and invariant attribution | n/a |
| `test/audit/deep/DeepPoC.spec.ts` | X-1, X-2, X-3, X-4, X-5, X-6, X-7 (titles match these IDs) | 7 passing |
| `test/audit/deep/DeepPoC2.spec.ts` | X-8, X-9, X-10, X-11, X-12, X-13, X-4b, plus one observation test (no same-block carry on draw) | 8 passing |
| `test/audit/deep/CreditInvariants.spec.ts` | 7 seeded runs (300 steps each, `FUZZ_STEPS` overrides), the deterministic path test, and the A/B path test | 9 passing |

Total: **24 passing** (about 55 s). No files outside `test/audit/deep/` and `/home/claude/audit-work/` were touched.
