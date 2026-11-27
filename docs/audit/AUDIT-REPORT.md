# Clear Protocol Security Audit — Protocol-Contracts (dev @ 7eb5976)

Nov 12, 2026 · @KyngKai909

## Summary and launch verdict

**Verdict: on mainnet, do not open member credit lines, process refunds after a merchant has been paid, or mint real-property deeds yet.** Three review passes found 2 Critical and 12 High issues. 13 of those 14 are proven with tests that run against the real contracts. The root causes sit in a small number of functions, so fixing them is contained work, but it touches the ledger's core paths and needs a re-review.

Onboarding your first merchant is still the lowest-risk step, with two conditions. First, C-1's redemption fix must be in. Second, until X-1, X-2 and X-4 are fixed, handle refunds off-chain and don't pre-fund the PayoutPool from outside capital. **The savings vault already live on Base needs one urgent check today** (H-3): if its operator role sits on a server hot key, that key alone can drain every member's savings.

What is solid: the ledger's three-party mint and its netting checks, the repayment waterfall, carry accrual, the AssurancePool's withdrawal lockdown (the old "anyone can withdraw" bug from the fork is fixed), the TWAP-based oracle, and the encumbrance lock on CLRUSD itself. The codebase is unusually well commented, and all 763 of the project's own tests pass.

| Severity | Credit core | Refunds, payouts, bonds, pools | Deed track | Total |
| --- | --- | --- | --- | --- |
| Critical | 2 | 0 | 0 | 2 |
| High | 4 | 3 | 5 | 12 |
| Medium | 7 | 9 | 8 | 24 |
| Low | 10 | 7 | 8 | 25 |
| Info | 0 | 1 | 2 | 3 |

## Scope and method

Reviewed `Deed3Labs/Protocol-Contracts`, branch `dev` at commit `7eb5976` (10 Nov 2026), compiled with solc 0.8.29, viaIR, OpenZeppelin 4.9.6.

**In scope, everything the credit launch and the live savings rails depend on:**

- Ledger: `StableCredit`, `MutualCredit`, `ClearCredit`
- Issuers: `CreditIssuer`, `RevolvingIssuer`, `TermIssuer`, `OffersIssuer`
- Registries and limits: `AccessManager`, `MembershipRegistry`, `NetworkRegistry`, `MerchantRegistry`, `CollateralRegistry`, `LimitCalculator`
- Money: `PayoutPool`, `AssurancePool`, `AssuranceOracle`, `LendingPool`, `Liquidator`, `BondVault`, `BurnerBond` and `BurnerBondDeposit`
- Live on Base mainnet: `ClearUSD`, `ESADepositVault`, `ClaimEscrow`; plus `ClearUSDUpgradeable` and `SavingsIntentFactory` / `SavingsIntentEscrow`
- Deploy scripts `20`–`24` and the role map in `docs/governance/on-chain-authority.md`

**Added in a second round:** the whole Deed track (`DeedNFT`, `Validator`, `ValidatorRegistry`, `MetadataRenderer`, `FundManager`, `FractionToken`, `Subdivide`, `Fractionalize`, both factories). **Still out of scope:** `CreditPool`, the apps and API (read only to confirm how contracts are called), and the CCIP pool.

**Method:**

1. Line-by-line manual review of every in-scope contract, focused on who can move value and under what conditions.
2. Two further independent reviewers: one audited the Deed track; one did a deeper pass on refunds, payouts, bonds and pools. I re-checked every High they reported against the code.
3. A randomized stateful test of the credit core: 2,100 shuffled actions across seven seeds, checking after every step that debt, supply, positions and payouts reconcile.
4. Static analysis with Slither 0.11, run per contract (the build's line-rewriting preprocessor breaks Slither's whole-project mode). Every high and medium result was triaged by hand; none added a new exploitable issue.
5. The project's own suite: **763 passing, 0 failing.**
6. 53 audit tests in total: exploit proofs that pass while their bug exists, plus the invariant runs (see the Proofs section).
7. A separate verification pass on the first-round findings that had no proof test. It confirmed every one and lowered a few severities; the report reflects that.

## Findings at a glance

| ID | Severity | Finding | Where | Blocks launch |
| --- | --- | --- | --- | --- |
| C-1 | Critical | Any credit line can be turned into USDC at par, and term-limit debt can be drawn with no plan and never defaulted | `PayoutPool.redeem`, `CreditIssuer._validateCreditTransaction`, `TermIssuer.setTermLimit` | Yes |
| C-2 | Critical | Savings-backed credit can be drawn after the savings are withdrawn; the reserve still counts it as covered | `CollateralRegistry`, `LimitCalculator`, `RevolvingIssuer._draw` | Yes |
| H-1 | High | A deactivated merchant gets paid anyway by moving its balance to another wallet | `PayoutPool.redeem` | Yes |
| H-2 | High | Anyone can delete a compliant member's credit period; the line then never expires or defaults | `CreditIssuer.syncCreditPeriod`, `expireCreditPeriod` | Yes |
| H-3 | High | The savings relayer's hot key can drain the live mainnet ESA vault by accepting a fake token | `ESADepositVault.setAcceptedToken` | Check today |
| H-4 | High | Other hot keys reach far beyond their jobs: credit operator, card settler, send relayer, savings-intent settler | `TermIssuer.openPlan`, `LendingPool.borrow`, `ClaimEscrow`, `SavingsIntentFactory` | Yes |
| M-1 | Medium | Welcome-offer credit can be cashed out at the PayoutPool | `OffersIssuer` | With C-1 fix |
| M-2 | Medium | Card settlement ignores frozen, defaulted and expired members, and has no amount cap | `RevolvingIssuer.settleCardSpend` | No |
| M-3 | Medium | Collateral locks fail open when the registry reverts | `ClearUSDUpgradeable`, `LendingPool` | No |
| M-4 | Medium | A one-wei donation blocks any savings intent until it expires | `SavingsIntentEscrow.finalize` | No |
| M-5 | Medium | Relayer chooses who receives a gasless deposit; multi-token 1:1 redemption | `ESADepositVault` | No |
| M-6 | Medium | The bond collection's owner can seize and redeem any holder's bond | `BurnerBond.setLiquidator`, `seizeBond` | Before bonds |
| M-7 | Medium | Mainnet CLRUSD has no lock or seize, so savings-backed liquidation cannot work there yet | `ClearUSD` (Base) | Yes |
| M-8 | Low | Lender repayment functions are open to anyone and desync the lenders' books | `AssurancePool`, `BondVault` `repayFrom*` | No |
| L-1 – L-9 | Low / Info | Initializers, burnable ledger, committed API keys, stripped revert strings, rounding, unbounded loops, unverified mainnet roles | Various | No |

This table covers the credit core. The refund, payout, bond and pool findings (X-1 to X-20) and the Deed findings (D-1 to D-23) have their own sections and tables further down.

## Critical findings

### C-1 — Credit lines turn into cash, and term debt can be made uncollectable

**What happens.** Three things combine:

1. **Members can send ledger credit to anyone.** `StableCredit._transfer` only requires the *sender* to be a member. `RevolvingIssuer` and `TermIssuer` inherit `CreditIssuer._validateCreditTransaction`, which never checks who receives. A member with a limit can `transfer()` the ledger token straight to any address, minting debt as they go.
2. **The PayoutPool pays any positive holder.** `redeem()` refuses only a merchant that is *registered and inactive*. An address that was never registered passes, and `MerchantRegistry.payoutWindowOf` even gives it the default window. If the pool is funded it pays at once; if not, `drawForDueClaim()` (permissionless) pulls the money from the LendingPool, BondVault, the treasury's allowance and the AssurancePool once the window passes.
3. **A term limit is spendable without a plan.** `TermIssuer.setTermLimit` adds the limit to the member's ledger ceiling but opens no credit period and no plan. A plain transfer draws against it. No plan means no schedule, no carry and no arrears, so `declareDefault` reverts forever and `inDefault` is always false.

**Impact.** A member with an unsecured (income or Boost) line or a term limit, plus any second member wallet (a partner, a friend, or their own merchant account), turns the whole limit into USDC at par. With a term limit, the member does not even need the cash-out: paying any registered merchant by plain transfer creates debt the protocol can never schedule, charge carry on or default. Loss per member equals their limit; nothing on chain stops it.

**Proof.** `test/audit/AuditPoC.spec.ts`: C-1a (term limit of $5,000 cashed out, still not defaultable after two years), C-1b (revolving INCOME/BOOST line of $3,000 cashed out through an unregistered wallet, paid instantly), C-1c (empty pool; claim paid after 30 days from the treasury's allowance).

**Fix.**

- In Phase 1, member-to-member transfers should not exist. Override `_validateCreditTransaction` in both issuers to allow a draw only when the recipient is an active merchant in `MerchantRegistry` or a named system address (co-op treasury, card settlement account, PayoutPool). Phase 2 P2P can relax this behind a flag.
- `PayoutPool.redeem`: require `isRegistered && isActive`, plus an explicit allowlist for co-op addresses. Unregistered holders should not be able to redeem at all.
- Split the ceiling in two. `MutualCredit._beforeTransfer` (plain transfers) should mint only against a *transferable* limit made of revolving allocations. Term allocations count only toward the total that `originatePurchase` checks. Then the only way to use a term limit is `openPlan`, which always creates a schedule.
- In `RevolvingIssuer._syncCreditPositions`, revert when `_draw` cannot place the whole shortfall. The code's comment says this "cannot happen"; with a term limit on the same member it does, and the unplaced debt is untracked.
- Add an invariant test: after any sequence of calls, every unit of a member's ledger debt is attributed to a tier or a plan.

### C-2 — Savings-backed credit without the savings

**What happens.** A savings tier's capacity comes from `CollateralRegistry.pledgedOf`, a number an operator script writes from the member's CLRUSD balance. The CLRUSD lock (`encumberedOf`) is computed from what is *drawn*, not what is pledged, so savings are fully withdrawable until the member draws. Nothing at draw time checks the member still holds the CLRUSD.

**Sequence.** Member deposits $3,000 → sync script pledges $3,000 → `pushCapacities` gives a $3,000 savings tier → member redeems or moves all $3,000 CLRUSD (nothing drawn, so nothing locked) → member draws the $3,000 savings tier.

**Impact.** The member keeps their $3,000 and spends $3,000 of credit. `exposureOf` still reports zero because the stale pledge is counted as collateral, so the AssurancePool reserves nothing against it, and `Liquidator.liquidate` finds nothing to seize. This is single-actor and needs no accomplice. It is also the product the plan says needs no capital, so it is the first one you would switch on.

**Proof.** `test/audit/AuditPoC2.spec.ts` (C-2): exposure 0, needed reserves 0, CLRUSD balance 0, debt $3,000.

**Fix.** Value savings collateral by what the member actually holds, at the moment of the draw. Concretely:

- `collateralValueOf` for the CLRUSD kind should use `min(pledgedOf, clrusd.balanceOf(member))`.
- Before drawing a SAVINGS tier, `RevolvingIssuer._draw` (and `settleCardSpend`) should check that the member's free CLRUSD covers the new draw, and refuse otherwise.
- Better still, make the pledge real: once a savings tier has capacity, lock pledged CLRUSD at the token, not only drawn CLRUSD. Releasing a pledge then requires lowering capacity first, which is the order the design intends.

## High findings

### H-1 — Deactivating a merchant does not stop their payout

`PayoutPool.redeem` checks the caller's own registry status. A merchant you switch off with `setActive(false)` moves its positive balance to any other member wallet and redeems from there: same money, no check. Deactivation is the lever you would pull on a merchant you suspect of fraud, so it has to hold.

**Proof.** `AuditPoC.spec.ts` H-1: deactivated merchant refused, fresh wallet paid $975.

**Fix.** Same as C-1: only registered, active merchants (and named co-op addresses) redeem. Also have the issuers refuse transfers *out* of a merchant to anyone other than the PayoutPool, so a payable cannot be handed to someone else.

### H-2 — Anyone can switch off a member's credit period

`syncCreditPeriod(member)` is public. Once a compliant member's period and grace have run out, calling it runs `expireCreditPeriod`, which **deletes** the period. With no period, `_validateCreditTransaction` waves every draw through (`!inInitializedPeriod → true`), and `inDefault` can never be true again. Your renewer job (`creditPeriodService.renewExpiredPeriods`) skips any wallet whose period is empty ("not this job's business"), so it never comes back.

**Impact.** A member watches their own expiry, calls `syncCreditPeriod` on themselves before the hourly renewer, then draws the whole line and never repays. The same happens by accident whenever the member's first transaction after expiry lands before the renewer runs. The renewer's own comments say this already occurs on testnet.

**Proof.** `AuditPoC.spec.ts` H-2: after deletion, $2,000 drawn and held a year; not in default, not frozen, still a member.

**Fix.** Never leave a member with a limit and no period. In `expireCreditPeriod`, when the member is compliant, roll straight into a new period of `cycleLength()` instead of deleting. Separately, treat "limit > 0 and no period" as *invalid* in `_validateCreditTransaction`, not valid.

### H-3 — The savings relayer key can drain the live ESA vault

`ESADepositVault.setAcceptedToken` is gated by `OPERATOR_ROLE`, which `docs/governance/on-chain-authority.md` gives to the savings relayer: a key on the API server that signs gasless deposits. Whoever holds that key accepts a worthless 6-decimal token, deposits it 1:1, mints CLRUSD and redeems it for the vault's USDC. Every member's savings are gone in three transactions.

**Proof.** `AuditPoC3.spec.ts` H-3: $50,000 of members' USDC redeemed against a fake token; vault left at zero.

**This contract is live on Base mainnet (`0x0CfE…a1C1`).** Today, check who holds `OPERATOR_ROLE` and `DEFAULT_ADMIN_ROLE` there. If either is a server key, pause the vault or move the role before anything else.

**Fix.** Split the role. Accepting a token is a settings change and belongs to the Safe, behind a timelock. The relayer keeps only a `RELAYER_ROLE` for `depositWithAuthorization`, `redeemWithAuthorization` and `executeMandateDeposit`. While you are there, `cancelMandate` should also be callable by the depositor.

### H-4 — The other hot keys can each move far more money than their job needs

Each of these keys lives on the API server, so each is one leak away from loss. None of the attacks needs a contract bug, only the key.

| Key | What it can do today | Fix |
| --- | --- | --- |
| Credit operator (`AccessManager` OPERATOR) | `setTermLimit` on any address, `openPlan` with an attacker as merchant and `payout = purchase`, `grantMember` the attacker, then redeem at the PayoutPool (or name itself as the merchant, since operators already count as members), which in turn drains LendingPool cash, BondVault excess, the treasury allowance and AssurancePool excess and buffer | Per-function roles; daily caps on new limits and plan totals; plan merchants must be registered and active |
| Card settler | `LendingPool.borrow(amount, to)` to **any** `to`; `settleCardSpend` against any member up to their headroom | Fixed `to` (the card float) stored on the pool; per-day borrow cap; per-member settle cap tied to the off-chain authorisation |
| Send relayer (`ClaimEscrow` SETTLER, live on mainnet) | `claimToWallet(id, anyWallet)` for every open escrow | Bind the recipient at claim time to a signature from the recipient or a hashed claim secret |
| Savings-intent settler | The escrow address depends only on `salt`, so the settler chooses `receiver`, `vault` and `depositor` when it settles, and `finalize` approves that arbitrary `vault` | Derive the salt from `keccak256(userSalt, config)` so the funded address commits to the config |

Keep the 2-of-N Safe for every admin and settings role, and put a timelock on upgrades.

## Medium findings

**M-1 — Welcome offers can be cashed out.** `OffersIssuer.grant` gives a member positive ledger credit meant to be spent at a merchant. Through the open redemption in C-1, the member redeems it at the PayoutPool for USDC instead. Each new membership becomes a cash coupon. The treasury's allowance refills the offers line, by design, when `settle()` runs. *Fix:* the C-1 fixes close it; also block transfers of offer credit to anything but an active merchant.

**M-2 — Card settlement ignores the member's standing.** `RevolvingIssuer.settleCardSpend` is capped by tier headroom and the ledger ceiling, and a processed default zeroes capacity so it reverts. But it does not check whether the member is frozen, in a default not yet processed, revoked or past their period, and it has no per-transaction cap of its own. Clearing a legitimately approved authorisation after a freeze is reasonable, but the contract cannot tell that apart from a key settling invented purchases. *Fix:* record the authorisation (ref and amount) on chain at approval, and settle only up to it; refuse members in default.

**M-3 — Collateral locks fail open.** `ClearUSDUpgradeable._encumberedOf` and `LendingPool.encumberedOf` catch any revert from the registry and return 0, which unlocks every member's collateral. The comments choose this on purpose, to avoid freezing everyone. The risk is a bad registry upgrade or misconfiguration quietly releasing all collateral, with no on-chain sign. It may also be triggerable on purpose by sending just enough gas for the registry call to run out (untested). *Fix:* fail closed for holders with drawn credit, or at least emit an event and have monitoring alert when the source reverts.

**M-4 — A one-wei donation blocks any savings intent.** `SavingsIntentEscrow.finalize` requires `balance == amount` exactly. Anyone can send 1 unit of the token to a predicted escrow address, and the member's deposit then waits for expiry and a refund. *Fix:* require `balance >= amount`, use `amount`, and refund the excess.

**M-5 — Vault gaps around the relayer and tokens.** In `depositWithAuthorization`, the member signs the USDC authorisation but not the CLRUSD `receiver`, so the relayer picks who gets the CLRUSD. `redeemWithAuthorization` accepts only ECDSA signatures, so smart wallets (EIP-1271) cannot use it, unlike mandates. And every accepted token redeems 1:1 for every other, so accepting a second stablecoin would let anyone swap a depegged one for USDC. *Fix:* deposit through a signed intent that names the receiver; use `SignatureChecker` for redeem; redeem only in the token deposited, or keep USDC the only accepted token.

**M-6 — The bond collection's owner holds every bond.** `BurnerBond.seizeBond` takes any bond from any holder with no check against encumbrance or default, and `setLiquidator` lets the owner name itself. `scripts/unwind_legacy_bonds.ts` does exactly that. Bondholders are outside capital; one key can redeem all their bonds early at present value. *Fix:* bound `seizeBond` by `isItemEncumbered` and a default check, as `ClearUSDUpgradeable.seize` does, and timelock `setLiquidator`.

**M-7 — Mainnet CLRUSD cannot enforce or seize collateral.** Base mainnet runs the original `ClearUSD` (`0xa7a2…6583`), which has no encumbrance lock and no `seize`. Until the vault is moved to `ClearUSDUpgradeable`, savings-backed credit on mainnet is unsecured and `Liquidator` cannot run. `setClrusd` only works once the old supply is zero, and the deployed Base vault predates that function, so it needs a UUPS upgrade first. Nothing in the credit stack is on Base yet, so this is a readiness item, but it gates savings-backed credit there. *Fix:* deploy `ClearUSDUpgradeable`, migrate, re-point the vault, then switch on credit.

**M-8 — Lender repayment functions are open to anyone.** `AssurancePool.repayFromPayoutPool`, `repayFromBondVault` and `BondVault.repayFromPayoutPool` accept any caller. A third-party payment decrements `lentToPayoutPool` and its buffer-owed counter while the PayoutPool's own `borrowedFrom*` stays the same. The pool later repays again, the surplus lands in excess (the spendable tier), and the two ledgers disagree. *Fix:* restrict each to the borrower it tracks. Rated Low on review: the caller pays real tokens, so no one loses money; the harm is two sets of books that disagree.

## Low and informational findings

| ID | Finding | Fix |
| --- | --- | --- |
| L-1 | `ClearCredit`, `RevolvingIssuer`, `TermIssuer` and `OffersIssuer` have no constructor calling `_disableInitializers()`, so anyone can initialise the bare implementations. OZ 4.9's `onlyProxy` stops this reaching the proxy. | Add the constructor, as the other contracts already do |
| L-2 | The ledger inherits `ERC20Burnable`, so any holder can `burn` a claim. Supply then no longer matches obligations, which the PayoutPool and RTD both read. | Override `burn` and `burnFrom` to revert |
| L-3 | `hardhat.config.ts` commits fallback Alchemy and Etherscan keys in a public repo. They look like Scaffold-ETH's public defaults rather than yours; if they are yours, rotate them. | Rotate both; drop the fallbacks |
| L-4 | Production builds strip revert strings, so the deployed bytecode is not the bytecode the tests ran. | Run the suite once with `KEEP_REVERT_STRINGS=false` against custom errors before each mainnet deploy |
| L-5 | `StableCredit._repay` calls `transferFrom` on the reserve token without SafeERC20. Fine for USDC, unsafe for a token that returns false. | Use `safeTransferFrom` |
| L-6 | `CollateralRegistry._requiredUnits` divides before multiplying and rounds down, so the lock can sit a few units below what is drawn. | Round up with `Math.mulDiv(…, Rounding.Up)` |
| L-7 | `memberPlans`, `funders`, `carriers` and `refundees` only grow or are walked in full on hot paths (`totalPrincipalOf`, `totalArrearsOf`, `payRefundsOwed`). A heavy user's calls get more expensive every plan and could eventually hit the block gas limit. | Keep open plans in a separate set; page the queue walks |
| L-8 | 15 setters lack zero-address checks (Slither), e.g. `PayoutPool.setLenders`, `AssurancePool.setPayoutPool`. | Add checks where zero is not a valid "off" value |
| L-9 | Role holders on Base mainnet could not be read from this environment (no RPC access). | Run `scripts/command/safe-handover.ts` in survey mode against `base` (it reads only the Base Sepolia list today, so point it at the Base records), or call hasRole on Basescan |

## Deep pass: refunds, payouts, bonds and pools

**Refunds and merchant payouts are the weakest area outside the credit-line issues: 3 High, 9 Medium, 7 Low, 1 Info.** A second reviewer did a line-by-line pass of the contracts the first pass covered lightly. It also ran a randomized stateful test: 2,100 shuffled actions, checking after each step that debt, supply and payouts still reconcile. Every High has a passing proof test, and I confirmed each against the code.

### X-1 (High) — Refunding a paid plan also forgives the member's other debt

`repayRefund` calls `_takeBack` for the merchant's share. When the merchant has already redeemed, `_takeBack` moves the member's obligation onto the merchant (`StableCredit.sol:368-371`). But the refunded plan was already paid, so the obligation it moves belongs to the member's *other* debt (their revolving line or another plan). The member is then also paid the full refund in cash. No issuer is told, so the revolving line keeps charging carry on principal the ledger no longer holds.

**Impact.** In the proof, a $1,000 purchase returns $1,975 of value. All it needs is an ordinary refund processed after the merchant has cashed out, for a member who carries any other balance. **Fix:** never move the member's obligation during a cash refund; create the merchant's obligation against the pool and track it (see X-3).

### X-2 (High) — A funded PayoutPool sends member repayments past it

The ledger decides how much of each repayment the pool needs as `totalSupply − payoutPool.held()` (`StableCredit.sol:591-595`). `held()` includes funders' capital. So once the pool is pre-funded, which is exactly what `fund_payout_pool.ts` does, member repayments go straight to the AssurancePool. When a merchant then redeems, the pool "sells" the claim to the funder. The member has already paid, so nobody owes that claim and no repayment will ever reach the funder.

**Impact.** Every payout made while the pool is funded turns funder capital into a dead claim. Meanwhile the cash sits in the AssurancePool, where it also overstates the reserve ratio. **Fix:** size the need as `totalSupply − memberFunded` (or `− memberFunded − refundsOwed`), not as cash held.

### X-4 (High) — A merchant's refund debt is never collected

After a refund, a merchant who has already redeemed carries an obligation. The code relies on the next incoming credits burning against it. But term-plan and card sales reach the merchant through `originatePurchase → _mint`, which never runs that netting step. `redeemableOf` is just `balanceOf`, so the merchant keeps redeeming every new sale in full.

**Impact.** Each refund after payout is a straight loss to the pool. A merchant and member working together (buy, pay, refund, repeat) drain it by the payout each round. The obligation is tracked by no issuer, so it never accrues and can't be defaulted. **Fix:** in `originatePurchase`, burn the recipient's existing obligation before minting, or have `redeem` subtract `creditBalanceOf(merchant)`.

### Medium, Low and Info

| ID | Sev | Finding | Fix |
| --- | --- | --- | --- |
| X-3 | Medium | A refund shortfall minted to the PayoutPool is untracked, so `distributeCarry` hands it out as carry | Track it as a refund receivable; exclude it from carry |
| X-5 | Medium | Carry withheld from a refund is never settled on the ledger, so the member pays it twice | Settle the withheld part as a repayment, or don't withhold |
| X-6 | Medium | A write-off is absorbed by rate band across issuers: a permissionless term default wipes revolving Boost debt into an untracked residual, and vice versa | Write-offs must not go through `_settleRepayment` |
| X-7 | Medium | LendingPool depositors can queue at the pre-loss price just before `absorbLoss`; an insolvent queue is paid from new deposits | Price queued requests at claim time, or pro-rate losses onto them |
| X-8 | Medium | `advancedOf[coopTreasury]` never shrinks when the treasury's claims are burned, so `distributeCarry` reverts or overpays the co-op | Reduce `advancedOf` on every settle; cap each share |
| X-9 | Medium | AssurancePool books DAI/USDT deposits as USDC but pays out only USDC, so `burnLostDebt` and the reserve backstop revert | Per-token balances, or convert on entry |
| X-10 | Medium | `faceDueWithin` loops every bond on each RTD read; about 2,100 minimum-face bonds block the repayment path | Bucket bonds by maturity; raise the minimum face |
| X-12 | Medium | Refunds are paid from funder capital without reducing `capitalOf`, so funders silently absorb them | Pay refunds from member money only, or debit capital |
| X-13 | Medium | A refund's result depends on whether anyone called `materialiseCarry` first; a stranger can turn a full refund into a later term default | Track materialised carry per plan; re-fix the schedule after refunds |
| X-11 | Low | `CarryIndex.rpow` overflows after 131 cycles at the 50%/cycle cap, bricking the position | Lower the cap or saturate the index |
| X-14 | Low | `PlanRefundPaid` reports gross cash, not cash after withheld carry | Emit the net amount |
| X-15 | Low | The oracle prices USDT, DAI and registry stablecoins at a fixed $1, so a depegged coin deposits at par | Price them, or accept USDC only |
| X-16 | Low | Public rebalancing books price drops against primary but gains into withdrawable excess | Book gains back to the tier that lost |
| X-17 | Low | `repayFrom*` treat interest as principal | Split interest from principal |
| X-18 | Low | LendingPool interest arrives as lump sums that a just-in-time deposit can capture | Stream interest into share price |
| X-19 | Low | `BurnerBondFactory.createCollection` is permissionless, so the reserve-token collection's name can be squatted | Gate it |
| X-20 | Info | A partly funded `drawForDueClaim` leaves borrowed cash idle and later hands the position to the treasury | Draw all-or-nothing |

**Checked and fine:** BondValuer double-counting, redeeming a pledged bond while drawn, curve underflow, ERC-4626 share inflation (OZ virtual shares), and carry-on-carry. Carry matches to the wei whether it is written to the ledger daily or never.

**Invariant results.** Ledger debt equals the sum of positions only until a refund or default. It breaks five ways: the known C-1 overdraw, X-1, X-4, X-5 and X-6. Every claim being backed by a debt or member cash fails while the pool is pre-funded (X-2) and after refunds (X-3, X-12).

## Deed track

**Do not mint a deed for real property until D-1 to D-3 are fixed: 5 High, 8 Medium, 8 Low, 2 Info.** Scope: `DeedNFT`, `Validator`, `ValidatorRegistry`, `MetadataRenderer`, `FundManager`, `FractionToken`, `Subdivide`, `Fractionalize`, both factories, and the deploy wiring. Every High has a passing proof test, and I confirmed each against the code. Several issues already appear in the Deed docs' known-limitations list; they keep their severity because the trust agreement will depend on them.

### D-1 (High) — A holder can rewrite a validated deed and it stays validated

`setTrait` and `removeTrait` (`DeedNFT.sol:652-736`) let the holder change or delete any trait except `isValidated`, `validator` and `beneficiary`. That includes `legalDescription`, `parcelNumber`, `definition` and `operatingAgreement`. Neither resets `isValidated`, and `setTrait` skips the registered-agreement check that `updateMetadata` applies. **Impact:** after validation, the holder swaps the legal description or points the agreement anywhere, and the token still reads "validated". **Fix:** make the asset type's required traits, `definition` and `operatingAgreement` validator-only after validation, or reset validation on any holder write to them.

### D-2 (High) — One key can edit every deed

`initialize` grants the global `VALIDATOR_ROLE` to the deployer wallet (`DeedNFT.sol:140`), and `setMetadataRenderer` grants it to the renderer (`:316`). `_checkValidatorOrOwner` accepts that role for any token (`:238-243`). Neither address is a registered validator, so the registry never revokes them. **Impact:** the deployer key, or the renderer after its owner upgrades it, rewrites any deed's definition, legal description and asset type, and each deed still reads validated. **Fix:** scope editing to the deed's own validator; don't grant the role in `initialize`; give the renderer a narrow role for display fields only.

### D-3 (High) — A subdivision's admin can forge unit validation

`setUnitTrait` and `setUnitTraitFlexible` (`Subdivide.sol:702-720, 843-899`) accept any key, including `isValidated`, `validator`, `beneficiary` and `parentDeed`. `royaltyInfo` pays whatever the `validator` trait names. The collection admin is whoever created the subdivision and never follows the deed's owner (D-10). **Impact:** units marked validated with no validator, royalties sent to the admin's own contract, and the original creator keeps this power after selling the deed. **Fix:** reserve the same keys DeedNFT reserves plus `parentDeed`; derive admin rights from the deed's current owner.

### D-4 and D-5 (High) — A fractionalized deed can be locked in Fractionalize forever

- **D-4:** for a non-burnable fraction, `unlockAsset` must burn all shares through `FractionToken.burnFrom`, which requires `burnable`. Once any share exists, the deed can never come out, even for a 100% holder.
- **D-5:** for a burnable fraction, any holder can burn one share with `FractionToken.burn`. That lowers supply but not `activeShares`, and unlock requires holding exactly `activeShares`, so nobody ever can.

**Fix:** burn through a Fractionalize-only path that ignores `burnable`; remove the public `burn`, or compare against `totalSupply()`.

### Medium, Low and Info

| ID | Sev | Finding |
| --- | --- | --- |
| D-6 | Medium | Trait names aren't JSON-escaped in the renderer, so an unvalidated deed's tokenURI can show "Valid", the validated image and any name |
| D-7 | Medium | Any active validator can overwrite another validator's verdict on a deed and take its royalties |
| D-8 | Medium | Burned IDs can be re-minted and inherit the old recorded documents and a live subdivision; a salted ID landing on a future sequential ID permanently breaks sequential minting |
| D-9 | Medium | Subdivide never takes custody of the parent, so the parent can be sold or burned with units outstanding |
| D-10 | Medium | The subdivision admin isn't tied to who owns the deed |
| D-11 | Medium | The holder (and the renderer's owner) can delete recorded restrictions and documents, such as a recorded deed of trust |
| D-12 | Medium | Any holder can grow the global trait-key list, which permanently raises every deed's burn and tokenURI cost (burn went from 336k to 1.09M gas after 150 keys) |
| D-13 | Medium | Single-key admin and upgrade powers over DeedNFT, Subdivide, Fractionalize, the fraction factory and the renderer; `deploy_all` leaves all of them with the deployer |
| D-14 | Low | Agreement URIs are matched by substring, so `https://evil/x?<registered URI>` passes |
| D-15 | Low | A holder's `updateMetadata` sets validator to zero, which breaks `royaltyInfo` and later edits |
| D-16 | Low | The validator's fee manager can raise the mint fee under a standing approval; `mintAsset` has no max fee |
| D-17 | Low | Pause blocks burning but not transfers or `setTrait`; Subdivide's pause and marketplace list aren't enforced |
| D-18 | Low | `approve(address(0))` reverts; ICreatorToken is advertised but the stored transfer validator is never called |
| D-19 | Low | `beneficiary` is overwritten with custody contracts like Fractionalize |
| D-20 | Low | MetadataRenderer and FundManager implementations can be initialised by anyone |
| D-21 | Low | Subdivision units can't be fractionalized |
| D-22 | Info | `ValidatorFactory.createValidator` always reverts; deploy scripts 03 and 04 are broken; `deploy_all` leaves gaps |
| D-23 | Info | Smaller items: FundManager allows 100% commission at init, missing registry pruning, renderer defaults to validated |

### Trust agreement v5: what the code does today

| # | Brief's assumption | Status |
| --- | --- | --- |
| 1 | Burning deletes traits and emits only the token ID | Confirmed. It also leaves renderer documents and any subdivision behind (D-8) |
| 2 | IDs are cut to 9 digits and burned IDs can be re-minted | Confirmed |
| 3 | Any validator can edit any deed; holders can rewrite `definition` | Partly. Validator *contracts* can't edit metadata, but any active validator can overwrite another's verdict (D-7). The edit power sits with the deployer and renderer keys (D-2). Holders rewrite `definition` with no validation reset (D-1) |
| 4 | Agreement link = validator base URI + token ID, and the validator can change it | Partly. It comes from `defaultOperatingAgreementUri`, not `baseUri`, and changing it affects only future mints. Holders can still rewrite an existing deed's link with `setTrait` |
| 5 | Transfers overwrite `beneficiary` with the recipient | Confirmed, including transfers into Fractionalize or escrow |
| 6 | Burn is pausable; single-admin UUPS upgrades | Confirmed. No admin function transfers a deed directly, but an upgrade, a fake registry or a renderer swap can change any deed |
| 7 | Subdivide mints units while the parent stays free | Confirmed |
| 8 | The ERC721-C transfer validator is never called | Confirmed; only the "!mkt" marketplace check runs |

## Launch checklist, in fix order

**Today, before anything else:**

- [ ] Read `hasRole(OPERATOR_ROLE, …)` and `hasRole(DEFAULT_ADMIN_ROLE, …)` on the mainnet ESA vault and ClaimEscrow, and `MINTER_ROLE` on mainnet CLRUSD. Any server key holding a settings or admin role: pause the vault and move the role to the Safe (H-3, H-4).

**Before the first member gets a credit line:**

- [ ] C-1: restrict draw recipients to active merchants and system addresses; close `PayoutPool.redeem` to unregistered holders; split transferable and term ceilings
- [ ] C-2: value savings collateral at the member's real CLRUSD balance and check it at draw (decided: no pledge lock)
- [ ] H-1: covered by the C-1 redemption fix, plus no transfers out of a merchant except to the PayoutPool
- [ ] H-2: roll compliant periods forward instead of deleting them; refuse draws with a limit and no period
- [ ] H-4: split operator roles per function; fixed destination and caps on `LendingPool.borrow`; caps on new limits and plans
- [ ] X-6: write-offs must not be absorbed across issuers (any member with both a revolving line and a term plan is exposed)
- [ ] M-7: deploy `ClearUSDUpgradeable` on Base (after a UUPS upgrade of the vault that adds `setClrusd`), migrate, re-point the vault
- [ ] Re-run the full suite plus all audit tests; each proof should now **fail** — then flip their assertions so they stay as regression tests

**Before the first merchant is paid out:**

- [ ] Register the merchant with explicit terms; confirm `redeem` refuses an unregistered wallet
- [ ] X-2: size the pool's need from member money, not cash held, before anyone pre-funds the PayoutPool
- [ ] X-1, X-3, X-4, X-5, X-12, X-13: fix the refund path before processing any on-chain refund after a payout. Until then, refund off-chain
- [ ] X-8: fix carry distribution before the treasury ever funds a claim through `drawForDueClaim`

**Before bonds or the lending pool take outside money:**

- [ ] M-6, X-7, X-9, X-10, X-11, X-15 to X-19, and the M-8 accounting fix

**Before minting any deed for real property:**

- [ ] D-1, D-2, D-3: lock validated legal fields, remove the global edit key, reserve subdivision keys
- [ ] D-4, D-5: make every fraction unlockable
- [ ] D-6 to D-13: escaping, per-deed validator authority, no ID reuse, subdivision custody, protected legal records, bounded trait keys, multisig and timelock
- [ ] The trust agreement v5 changes, built on top of the fixes above (decisions recorded with the specs)

**Can follow launch:** the remaining Medium, Low and Info items in all three sections.

After the fixes, have the changed code re-reviewed before mainnet. The fixes touch the ledger's core transfer path, which is where new bugs are most likely.

## Proof-of-concept tests

Seven tests, in three files sent alongside this report, that **pass while the bug exists**. They use the production contracts (`ClearCredit`, the real issuers, registries and pools behind UUPS proxies) and the repo's own Phase 0 fixture. Nothing is mocked except USDC.

| Test | File | Shows |
| --- | --- | --- |
| C-1a | `AuditPoC.spec.ts` | $5,000 term limit cashed out; not defaultable after 730 days |
| C-1b | `AuditPoC.spec.ts` | $3,000 income and Boost line cashed out instantly via an unregistered wallet |
| C-1c | `AuditPoC.spec.ts` | Empty pool still pays $2,000 after 30 days from the treasury allowance |
| C-2 | `AuditPoC2.spec.ts` | $3,000 savings tier drawn with zero CLRUSD; exposure and needed reserves both 0 |
| H-1 | `AuditPoC.spec.ts` | Deactivated merchant's $975 paid out through another wallet |
| H-2 | `AuditPoC.spec.ts` | Period deleted by a third party; $2,000 held a year with no default |
| H-3 | `AuditPoC3.spec.ts` | $50,000 of vault USDC redeemed against a fake token |

**The second round added 46 more tests**, all passing on commit `7eb5976`:

| Folder | Files | Tests | Covers |
| --- | --- | --- | --- |
| `test/audit/deed/` | `DeedMetadata`, `DeedLifecycle`, `SubdivideFractionalize` (+ `fixture.ts`) | 22 | D-1 to D-22 except D-13, which is shown by code reading |
| `test/audit/deep/` | `DeepPoC`, `DeepPoC2` | 15 | X-1 to X-13, plus X-4b and one observation test |
| `test/audit/deep/` | `CreditInvariants` (+ `fuzz-engine.ts`, `deep-setup.ts`) | 9 | Seven seeded 300-step random runs, a 120-day deterministic path and an A/B order test |

The whole `test/audit/` folder is sent alongside this report as one archive. Unpack it into the repo and run:

```bash
npx hardhat test test/audit/*.spec.ts test/audit/deed/*.spec.ts test/audit/deep/*.spec.ts
```

Result on commit `7eb5976`: 53 passing. After the fixes, each exploit proof should fail at the step its fix blocks.

## Limitations

This audit was done by AI reviewers: one lead and two independent reviewers, in a single session. A paid firm would usually put two or three people on a codebase this size (about 23,000 lines in scope) for several weeks. Treat it as a strong first pass, not a guarantee, and budget for a human audit firm before significant member money is at stake.

- **No live-chain checks.** This environment could not reach Base RPC, so who holds each role on mainnet is unverified (L-9).
- **Not run:** line coverage, a fork rehearsal against the live deployment, and fuzzing beyond the credit core. The invariant suite should keep running in CI and be extended to the Deed track.
- **Off-chain controls not audited.** Card authorisation, the credit-period renewer, pledge sync and the relayers were read only to understand how they call the contracts. Several findings (C-2, H-2, M-2) may be partly covered by off-chain checks; I did not confirm this, and the contracts should not rely on them.
- **Economic and legal design** (rates, haircuts, RTD target, CFL and DFAL compliance) was taken as given. The review asked whether the code does what the design says, not whether the numbers or the legal reading are right.
- **The fixes and the two new specs are a large change.** Every fix touches a core path, so have the changed code re-reviewed before mainnet.
