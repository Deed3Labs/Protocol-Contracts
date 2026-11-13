# Phase 1 report: every audit finding fixed

Branch `audit/phase-1`, cut from `audit/materials` (`dev` @ `7eb5976` plus the audit docs and tests). Workstream 1A (ledger and credit) was done in the lead session. 1B (money peripherals, `audit/phase-1-1b`) and 1C (Deed track, `audit/phase-1-1c`) were done by two subagents and merged here. Nothing was deployed, no key was used, and no live network was touched.

Regression tests live under `test/audit/`. Abbreviations below: **AP** `AuditPoC.spec.ts`, **AP2** `AuditPoC2.spec.ts`, **AP3** `AuditPoC3.spec.ts`, **DP** `deep/DeepPoC.spec.ts`, **DP2** `deep/DeepPoC2.spec.ts`, **HK** `deep/HotKeys.spec.ts`, **LF** `deep/LowFindings.spec.ts`, **PR** `deep/PeripheralRegressions.spec.ts`, **DM/DL/SF/DD** `deed/DeedMetadata`, `DeedLifecycle`, `SubdivideFractionalize`, `DeedDeployAndMisc`. Every flipped proof is titled "(fixed)" or starts with its finding ID.

## 1. Findings

### Credit core (1A)

| ID | What changed | Files | Regression test |
| --- | --- | --- | --- |
| C-1 | A draw may pay only an active merchant or an admin-named system address. Revolving and term issuers check this and fail closed with no registry. With a registry set, the ledger also refuses member transfers to anyone else. A plain transfer mints only against the non-term part of the ceiling (`lockedAllocationOf`). `RevolvingIssuer` reverts when a draw cannot be placed in its tiers. `PayoutPool.redeem` serves only registered, active merchants and `REDEEMER_ROLE`/`FUNDER_ROLE` holders. | StableCredit, MutualCredit, CreditIssuer, RevolvingIssuer, TermIssuer, PayoutPool, ICreditIssuer, IStableCredit, IMerchantStatus (new) | AP "C-1a (fixed)…", "C-1b (fixed)…", "C-1c (fixed)…" |
| H-1 | A registered merchant's balance may go only to the payout pool (ledger rule), and redeem refuses inactive merchants. | StableCredit, PayoutPool | AP "H-1 (fixed)…" |
| M-1 | Offer credit follows the same recipient rule: spent at an active merchant, never sent to a wallet to redeem. | StableCredit | AP "M-1 (fixed)…" |
| H-2 | A compliant member's expired period rolls into a new one; it is never deleted. A drawable limit with no period is invalid (term lines are governed by their schedules and opt out). `setPeriodExpirationOf`, `setGraceLengthOf` and `updateCreditPeriod` may only extend. Unpausing an expired period restarts the deadline at the unpause, so lifting a pause is never a declared default. | CreditIssuer, RevolvingIssuer, TermIssuer | AP "H-2 (fixed)…" (two tests) |
| C-2 | A CLRUSD pledge is valued at `min(pledged, balance)` against a new admin-set `clrusdToken`, which fails closed when unset. A savings tier's headroom is capped at what the CLRUSD actually held backs (`backedHeadroomOf`), so both `_draw` and `settleCardSpend` check it at draw time. The pledge itself is not locked (DECISIONS #2). | CollateralRegistry, RevolvingIssuer | AP2 "C-2 (fixed)…" |
| X-1 | A cash refund never moves the member's obligation. The merchant's or co-op's shortfall becomes their own obligation. | StableCredit | DP "X-1 (fixed)…" |
| X-3 | No claim is minted to the pool for a refund shortfall, so nothing reaches the carry split. The shortfall is tracked as `refundReceivableOf[holder]`. | StableCredit, MutualCredit | DP "X-3 (fixed)…" |
| X-4 | Refund receivables are collected first out of whatever reaches the holder next: a sale minted by `originatePurchase` (netted), a transfer, or a repayment. They are never offered to an issuer. | StableCredit, MutualCredit | DP "X-4 (fixed)…", DP2 "X-4b (fixed)…" |
| X-5 | Withheld carry settles the member's residual on the ledger (directed, not offered to issuers). | StableCredit | DP "X-5 (fixed)…" |
| X-12 | Refunds are paid only from `memberFunded`, and the rest is owed. Capital is never reserved for refunds it cannot pay, and claims settle only from member money that no refund is waiting on. | PayoutPool | DP2 "X-12 (fixed)…" |
| X-13 | Plans track outstanding carry explicitly (`carryOutstandingOf`), and payments clear carry first. A partial refund re-fixes the schedule over what is left, carrying arrears in as due now. | TermIssuer | DP2 "X-13 (fixed)…" (two tests) |
| X-14 | `PlanRefundPaid.returned` is the net cash. | TermIssuer | DP "X-5 (fixed)…" |
| X-2 | The pool's need is `totalSupply + refundsOwed − memberFunded`. | StableCredit, IPayoutSink | DP "X-2 (fixed)…"; RepaymentRouting "does not count funder capital…" |
| X-8 | Treasury income excludes positions it carries. Carriers are synced to what they still hold before a split, and each share is capped at what is left. | PayoutPool | DP2 "X-8 (fixed)…" |
| X-20 | `drawForDueClaim` either pays the claim or reverts, borrowing nothing. | PayoutPool | DP2 "X-20 (fixed)…" |
| X-6 | A write-off is absorbed only by the defaulting issuer; every issuer is still told. | StableCredit | DP "X-6 (fixed)…" |
| H-4 (credit) | The plain operator role now passes no credit check. Credit powers are split into `CREDIT_LINES_ROLE` (lines, plans, periods, refunds), `CREDIT_LIMITS_ROLE` (term limits, tier capacity) and `CREDIT_SETTINGS_ROLE` (tiers, treasuries, settlers, caps); the admin passes all three. Daily caps cover capacity increases, term-limit increases and plan totals. `openPlan(PlanTerms, signature)` needs the member's EIP-712 signature (EIP-1271 accepted) over member, merchant, purchase, payout, rate, schedule, disclosure hash, nonce and deadline, and the merchant must be registered and active. `PayoutPool`'s money-routing setters (treasury, income recipient, lenders, bond vault) moved from OPERATOR to the admin. | AccessManager, IAccessManager, CreditIssuer, RevolvingIssuer, TermIssuer, OffersIssuer, PayoutPool | HK "H-4 (fixed)…" (four tests); LF "L-8 (fixed)…" |
| M-2 | `authorizeCardSpend` records the approved amount while the member is in good standing. `settleCardSpend` settles only up to that authorization, within per-purchase and per-day caps, and refuses defaulted members. | RevolvingIssuer | HK "M-2 (fixed)…" |
| L-1 | `_disableInitializers()` constructors on ClearCredit, RevolvingIssuer, TermIssuer, OffersIssuer and AssurancePool. | those | LF "L-1 (fixed)…" |
| L-2 | The ledger's `burn` and `burnFrom` revert. | StableCredit | LF "L-2 (fixed)…" |
| L-5 | `_repay` pulls the reserve token with `safeTransferFrom`. | StableCredit | covered by every repayment test |
| L-6 | `_requiredUnits` rounds up with `mulDiv`. | CollateralRegistry | AP2 (lock covers the draw) |
| L-7 | `TermIssuer` loops walk an open-plan index (`indexOpenPlans` rebuilds it after an upgrade). Refunds owed can be paid a page at a time (`payRefundsOwedUpTo`). Funders and carriers were already pruned. | TermIssuer, PayoutPool | LF "L-7 (fixed)…" (two tests) |
| L-8 | Zero-address checks on the ledger's access, assurance-pool, network-registry and merchant-registry setters and on `LimitCalculator.setIssuer`. Setters where zero means "off" are unchanged. | StableCredit, LimitCalculator | LF "L-8 (fixed)…" |
| X-11 | The carry index saturates at a billionfold instead of overflowing. | CarryIndex | DP2 "X-11 (fixed)…"; LF "X-11 (fixed)…" |
| L-3, L-4, L-9 | Operational, not code: rotate the committed fallback keys; run the suite with stripped revert strings before a mainnet deploy; survey mainnet role holders. Not changed here; listed under open items. | | |

### Money peripherals (1B)

| ID | What changed | Files | Regression test |
| --- | --- | --- | --- |
| H-3 | New `RELAYER_ROLE` covers only gasless deposit, gasless redeem, mandate execution and cancel-by-digest. Settings (`setAcceptedToken`, `setClrusd`) are `DEFAULT_ADMIN_ROLE`; no function accepts `OPERATOR_ROLE`. `cancelOwnMandate` lets the depositor cancel. | ESADepositVault | AP3 "H-3…"; PR "H-3…" |
| M-5 | A gasless deposit mints only to the depositor, or to a receiver named in the depositor's signed EIP-712 intent (`depositWithAuthorizationFor`). Redeem accepts EIP-1271 (`redeemWithSignature`). One accepted token at a time. | ESADepositVault | PR "M-5…" (two tests); AP3 |
| H-4 ClaimEscrow | A claim to a wallet needs a signature from the claim key the sender committed to, or from the sender. Old `claimToWallet` reverts. Claims only before expiry, refunds only after. | ClaimEscrow | PR three "H-4…" tests |
| H-4 SavingsIntent | Clone salt = `keccak256(userSalt, config)`. | SavingsIntentFactory | PR "H-4: the funded escrow address commits…" |
| H-4 LendingPool | `borrow` requires `to == borrowDestinationOf[msg.sender]`, plus a per-day cap (`setBorrower`). | LendingPool | PR "H-4: the card settler can borrow only…" |
| M-4 | `finalize` accepts `balance >= amount` and refunds the excess. | SavingsIntentEscrow | PR "M-4…" |
| M-6 | `seizeBond` needs the bond pledged and the holder in default. Naming a liquidator once bonds exist waits 7 days. | BurnerBond | PR "M-6…" (two tests) |
| M-8, X-17 | `repayFrom*` accept only the tracked borrower. Interest is split from principal, and only principal restores the buffer. | AssurancePool, BondVault | PR "M-8 / X-17…" (two tests) |
| X-7 | Queued withdrawals escrow shares and pay `min(value when queued, value at claim)`. | LendingPool | PR "X-7…" |
| X-18 | Untracked inflows (interest) stream into the share price over 7 days. The lead added a permissionless `syncInterest()` to start the stream. | LendingPool | PR "X-18…"; PayoutLifecycle |
| X-9 | The AssurancePool accepts the reserve token only. | AssurancePool | PR "X-9…" |
| X-15 | Only USDC is fixed at $1; other stablecoins are priced or refused. | AssuranceOracle | PR "X-15…" |
| X-16 | Repricing gains go back to the tier that took the loss. | AssurancePool | PR "X-16…" |
| X-10 | Face due is bucketed by maturity day in a Fenwick tree, and the minimum face rose to $500. | BondVault, BurnerBondFactory | PR "X-10…" |
| X-19 | `createCollection` is restricted to the owner or the unified deposit contract. | BurnerBondFactory | PR "X-19…" |
| M-3 | Both encumbrance reads record a last-known lock per holder. If the source reverts, CLRUSD holds that last-known lock (see section 4). LendingPool treats a holder with a non-zero record as fully locked. Others move freely, and an event fires. Seizure reverts when the source cannot be read. | ClearUSDUpgradeable, LendingPool | PR "M-3…" (two tests) |
| M-7 prep | `setClrusd` with its zero-supply guard, plus `scripts/migrate_vault_clrusd.ts`, which builds Safe batches and sends nothing (not run). | ESADepositVault, scripts | PR "M-7 prep…" |
| L-8 (peripherals) | Zero-address checks on `AssurancePool.setPayoutPool`, `setReserveToken` and `setAssuranceOracle`. | AssurancePool | PR M-8 test |

### Deed track (1C)

| ID | What changed | Files | Regression test |
| --- | --- | --- | --- |
| D-1 | On a validated deed the holder cannot change or remove `definition`, `operatingAgreement`, `configuration` or any required trait. The agreement changes only through `updateMetadata` to a registered name. | DeedNFT, Validator | DM "D-1…" |
| D-2 | No global editor key: `initialize` grants nothing and the renderer has no write power. Edits come only from the deed's own active validator or its signers (`ValidatorRegistry.isValidatorSigner`). | DeedNFT, ValidatorRegistry, MetadataRenderer | DM "D-2…" |
| D-3 | Subdivision admins cannot write `isValidated`, `validator`, `beneficiary` or `parentDeed`. Admin edits withdraw unit validation, and royalties go only to an active validator. | Subdivide | SF "D-3…" |
| D-4, D-5 | `burnForRedemption` (Fractionalize only) ignores `burnable` and pause; unlock compares against `totalSupply()`. | FractionToken, Fractionalize | SF "D-4…", "D-5…" |
| D-6 | Trait names are JSON-escaped. | MetadataRenderer | DM "D-6…" |
| D-7 | Only the deed's recorded validator updates its validation; the holder may reassign, which resets validation. | DeedNFT | DM "D-7…" |
| D-8 | IDs are never reused (`wasEverMinted`). Salted IDs are in [2^127, 2^128); sequential minting skips used IDs. | DeedNFT | DL "D-8…" |
| D-9, D-10 | Subdivide holds the parent while units exist. Admin rights follow the beneficial owner. | Subdivide | SF "D-9…", "D-10…" |
| D-11 | Legal records and documents are writable only by the deed's validator. Each change bumps `legalRecordVersion` and emits an event. | MetadataRenderer | DM "D-11…" |
| D-12 | Trait keys are tracked per token; burn no longer loops global keys. | DeedNFT | DM "D-12…" |
| D-13 | `FractionTokenFactory` renounces admin on new tokens. `deploy/deed_admin_handover.ts` moves every Deed role to `DEED_ADMIN`, and `deploy_all` requires `DEED_ADMIN` off local networks. | FractionTokenFactory, deploy | SF, DD "D-13…" |
| D-14 | An agreement passes only as an exact registered URI, or a registered/default/base URI plus this deed's ID. A failed check writes `false`. | Validator | DM "D-14…"; DD "D-23…" |
| D-15 | A holder's `updateMetadata` keeps the recorded validator. | DeedNFT | DM "D-15…" |
| D-16 | Per-payer fee cap `FundManager.setMaxFee`; 0 refuses every fee. | FundManager | DL "D-16…" |
| D-17 | Burn is never pausable; trait edits and validation are. Subdivide enforces its marketplace list and pause. | DeedNFT, Subdivide | DL "D-17…"; SF "D-17…" |
| D-18 | `approve(address(0))` works; the inert ICreatorToken surface is removed. | DeedNFT, Subdivide | DL "D-18…" |
| D-19 | Custody transfers keep the depositor as `beneficiary`. | DeedNFT, Subdivide | DL "D-19…" |
| D-20 | `_disableInitializers` constructors. | MetadataRenderer, FundManager | DL "D-20…" |
| D-21 | Fractionalize accepts subdivision units. | Fractionalize | SF "D-21…" |
| D-22 | `createValidator` deploys a working proxy and hands every role to the caller; it no longer self-registers. Deploy scripts 00–06 and `deploy_all` repaired. | ValidatorFactory, deploy | DL, DD "D-22…" |
| D-23 | FundManager: commission capped at 10% and fee-on-transfer tokens refused. Registry pruning. Renderer defaults to not validated. Dead Subdivide branches removed. | various | DD "D-23…" (four tests) |

## 2. Existing tests changed, and why

- **Shared fixture** (`test/helpers/phase0-fixture.ts`):
  - names `counterparty` as a system recipient (C-1: a draw must pay a merchant or a named address);
  - grants the test operator the three credit roles (H-4);
  - deploys ClearCredit and AssurancePool behind proxies (L-1).
- **New helper** `test/helpers/plans.ts` signs plan terms as the member (H-4). Every `openPlan` call in the suites now goes through it. Suites that open plans wire a merchant registry into the ledger.
- **`RevolvingIssuer.spec`:**
  - over-ceiling spend now expects `RevolvingIssuerDrawUnplaced` (C-1);
  - card tests authorize before settling (M-2);
  - "all or nothing" refuses at authorization;
  - settler can't change settings: expects `CreditIssuerMissingRole`.
- **`SharedBalance.spec`:** merchant-to-member "undirected payments" became USDC repayments by the merchant, since Phase 1 has no member-to-member transfers (C-1). The issuer accounting under test is the same.
- **`TermIssuer.spec`:** a merchant "spending" its payout now redeems at a payout pool (H-1).
- **`PayoutPool.spec`:** "refuses a merchant with nothing owed" registers the merchant first (C-1 eligibility).
- **`PayoutLifecycle.spec`:**
  - refunds owed are paid by member money, not funder capital (X-12);
  - borrowers are configured with `setBorrower` (H-4);
  - yield-pool interest is read after the 7-day stream (X-18).
- **`RepaymentRouting.spec`:**
  - "stops at what is actually owed" encoded X-2 (it counted funder capital as funding). It became "does not count funder capital as members' money (audit X-2)".
  - The overflow-to-reserve half of the old test is covered by the routing tests that run without a payout pool.
- **`OffersIssuer.spec`:** unauthorized grants expect `CreditIssuerMissingRole`.
- **`Liquidator`, `LimitCalculator`, `AssetBackedTier`, `BondCollateral`, `ClearUSDUpgradeable` specs:** set `clrusdToken` on the registry (C-2), grant the calculator `CREDIT_LIMITS_ROLE` (H-4), and deploy issuers behind proxies (L-1). `BondCollateral` clears leftover carry in USDC instead of a member-to-member draw (C-1).
- **`AssetBackedDefault.spec`:** `setBorrower` (H-4).
- **Removed deep proofs:** X-7, X-9 and X-10 were dropped from DP and DP2; 1B's flipped versions are in PR.
- **1B's and 1C's own test changes** are listed in their sections of `PHASE-1-PROGRESS.md` and in the branch history (`audit/phase-1-1b`, `audit/phase-1-1c`).

## 3. Deviations from the plan, and section 7 defaults used

**Section 7 defaults used:**
- **Who signs a term plan:** the member, by EIP-712 over member, merchant, purchase, payout, rate, cycle, installments, installment length and disclosure hash, plus nonce and deadline. The operator submits.
- **Card settlement vs DFAL 10a:** settlement only up to an authorization recorded at approval, with per-purchase and per-day caps. **Flagged for counsel:** the settler key both records and settles authorizations, so the caps are what bound it.

**Deviations:**
- **C-1 placement.** The draw-recipient check is in the issuers, as planned, and fails closed. The ledger also enforces the rule for positive balances (offer credit, merchant balances), but only once a merchant registry is set, because it cannot tell a merchant apart without one. A positive balance sent to a wallet that cannot redeem has not become cash, so this half fails open until deploy/22 wires the registry.
- **Redeem eligibility (DECISIONS #3).** "Named co-op addresses" are `REDEEMER_ROLE` holders (named by the admin) plus `FUNDER_ROLE` holders, who must be able to redeem positions they paid for. The co-op treasury needs `REDEEMER_ROLE`; deploy/22 grants it.
- **X-3.** The plan said to track the refund as a pool receivable. Instead no claim is minted at all: the refund cash came out of member money that stood behind other claims, so the merchant's new obligation backs those claims, and a second claim would count the money twice. The receivable is tracked per holder on the ledger (`refundReceivableOf`, `refundReceivables`).
- **X-2.** Need = `totalSupply + refundsOwed − memberFunded`. Refunds owed are added, not subtracted, because only member money may pay them.
- **Steps 4 and 5 landed together**, because the refund path could not be tested without X-2's routing.
- **Daily caps.** A cap of zero means "not set" and limits nothing, which keeps existing deployments and test fixtures working. deploy/20 always sets real caps: $50k/day for new capacity, term limits and plans, and $2,500 per card purchase with $25k/day. All are env-overridable.
- **`openPlan` ABI change.** It now takes `(PlanTerms, bytes signature)`. The API that opens plans must collect the member's signature.
- **Bytecode size.** A production build (revert strings stripped) put RevolvingIssuer at 24,864 bytes and TermIssuer at 29,313, over EIP-170 (the audited sizes were 20,728 and 23,181). Fixes:
  - CreditIssuer's modifiers call out-of-line functions instead of being inlined into every function. This removed most of the growth.
  - TermIssuer was split. `TermIssuerBase` holds all storage, in the same slots and order, plus shared internals. `TermIssuerExtension` holds `closePlanForRefund`, `setSplit`, `collectForMember`, `repayWrittenOff`, `reinstate` and `payResidualCarry`. TermIssuer forwards those selectors by delegatecall to an extension its own constructor creates and pins immutably. The ABI and layout are unchanged, and no setter can repoint it.
  - Final sizes from a Hardhat production build (revert strings stripped): RevolvingIssuer 21,809, TermIssuer 23,197, ClearCredit 22,837, BurnerBond 24,224, MetadataRenderer 23,912, DeedNFT 24,546, Subdivide 24,564; TermIssuerExtension about 17.4 KB.
  - **Every contract is now under 24,576 bytes**, including `ValidatorFactory`, which was over the limit at `7eb5976` (26,026) and which 1C rebuilt. DeedNFT and Subdivide have 30 and 12 bytes of headroom.
- **M-3** was in the plan's step 8 but lives in 1B's files, so 1B did it.
- **1B:** settings sit under the vault's existing `DEFAULT_ADMIN_ROLE` rather than a new settings role. Timelocks are Phase 2 (DECISIONS #10). ClaimEscrow uses a committed claim key rather than a revealed secret, which can be front-run.
- **1C:** some fixes moved location to fit the size limit. The fee cap is in FundManager; the renderer has no write path at all; the inert transfer-validator surface was removed rather than documented.

## 4. Conflicts (rule 3)

- **M-3 vs DECISIONS #2 / DFAL 10a.** 1B's fix froze a pledger's whole CLRUSD balance while the encumbrance source was unreadable. That is a lock wider than the drawn credit, the kind of control power DECISIONS #2 avoids. The lead took the more conservative option: during an outage CLRUSD keeps the holder's **last recorded lock and no more**.
  - The record can lag a later draw. The credit side should call `ClearUSDUpgradeable.syncEncumbrance(member)` after each draw on savings; this is an open item, not yet wired.
  - LendingPool shares keep 1B's full lock, since they are not CLRUSD. Counsel should confirm either way.
- **"Do NOT change" list.** Nothing on the list was changed, apart from the approved `PayoutPool.redeem` eligibility (DECISIONS #3): the three-party mint, FIFO order, no redemption path through the AssurancePool, cheapest-first draw and dearest-first repayment, RTD, the AssurancePool role gating, and a member's set of issuers. Funding the pool and the AssurancePool rule are untouched. Repayment *routing* to the pool changed (X-2), which sizes how much reaches the pool, not its order.
- **No admin power was widened.** New setters are admin-only, or narrow an existing operator power: `setMerchantRegistry`, `setSystemRecipient`, `setClrusdToken`, the daily caps, `setBorrower`, and the PayoutPool settings moving from OPERATOR to admin.

## 5. Open questions for the owner

1. **API changes needed before mainnet:** plans need member signatures. Card spend needs `authorizeCardSpend` at approval. ClaimEscrow needs claim keys and signed claims. SavingsIntent uses the new `predictIntentAddress(salt, config)`. Gasless deposits to a third party need a signed intent.
2. **Daily cap values:** are $50k/day for new capacity, term limits and plans, and $2,500 per card purchase with $25k/day, the right starting points?
3. **Counsel:** card settlement within caps (section 3), and the CLRUSD outage lock (section 4).
4. **`syncEncumbrance` after savings draws:** wire it into the credit side, or run it from the API?
5. **From 1B:**
   - Is the $500 minimum bond face right?
   - Should `BurnerBond.setEncumbranceSource` and `setDefaultSource` also be timelocked?
   - How should legacy bonds be unwound now that `scripts/unwind_legacy_bonds.ts` cannot seize from holders not in default?
   - ClaimEscrow transfers created before the upgrade need the sender's signature to reach a wallet.
   - Should `claimToPayoutTreasury` also need a signature?
6. **From 1C:**
   - Should `ValidatorFactory.createValidator` stay permissionless?
   - DeedNFT and Subdivide have almost no size headroom; Phase 3 needs a module split, like the one TermIssuer now has.
   - Deeds on Base Sepolia from before the upgrade lack per-token key sets; a fresh deployment is cleanest.
7. **Operational items (L-3, L-4, L-9):**
   - Rotate or remove the fallback Alchemy and Etherscan keys in `hardhat.config.ts`.
   - Run the suite against a stripped build before the mainnet deploy.
   - Read the mainnet role holders (`hasRole`) before handover.
8. The credit contracts on Base Sepolia hold pre-fix state (for example plans opened without signatures and open plans not in the new index). A fresh deployment is cleaner than an upgrade; if upgrading, run `indexOpenPlans` per member.

## 6. Numbers

**Tests:**
- Before: full suite 816 passing, including 53 audit tests.
- After: full suite **856 passing, 0 failing** (with `FUZZ_STEPS=60` for the invariant file; the default 300-step run is below).
- All runs compile with `KEEP_REVERT_STRINGS=true`, because a plain `hardhat compile` strips revert strings and `revertedWith` assertions then fail.

**Invariant fuzz (`CreditInvariants.spec`, default 300 steps, all seven seeds plus both path tests): 9 passing.** At 300 steps (the same held at 60 during development):
- (i-b), every claim backed, held in every seed. It broke in five seeds at `7eb5976`.
- (ii) breaks only as **"refund up"** (seeds 2, 11, 12 and 5), with seed 2 also showing "repayment down" as that residual is paid off. This is justified: a refund that reverses a plan the member still owes leaves the carry they accrued as residual on the ledger, by design. It is readable through `TermIssuer.residualCarryOf` and payable with `payResidualCarry`. The audited breaks are gone: C-1 overdraw, X-1 phantom principal, X-6 write-off, and X-5 double carry.
- (i), supply equal to Σ obligations, cannot hold by design, as the audit noted.

**Slither** (per contract, solc 0.8.29 via-IR, informational/optimization/low excluded, compared with `7eb5976`). No new real High or Medium. New entries:
- `TermIssuer*` **"uninitialized-state" Highs:** artefacts of the split. Slither analyses each half alone, and every flagged variable is written by the other half through the shared storage.
- **Extension reentrancy and strict-equality hits:** the audited `TermIssuer.*` findings under new contract names.
- **Benign strict equalities:** `== 0` early returns in `headroomOf`, `collateralValueOf`, `withdrawCoopIncome` and `payRefundsOwedUpTo`.
- **`StableCredit._writeOffTransfer`:** reentrancy-no-eth and unused-return, the same pattern the audited `writeOffCreditLine` had, now calling only the registered issuer.
- **Removed:** two baseline findings (`StableCredit._repay` unchecked transfer, fixed by L-5; `_requiredUnits` divide-before-multiply, fixed by L-6).
- **1B:** three deliberate `incorrect-equality` instances (day-index comparisons and a "not bucketed" check).
- **1C:** three triaged false positives (string-concatenation equality; the fee-on-transfer balance check inside a `nonReentrant` function).

**Storage layout:**
- **Live on Base:** `ESADepositVault` (against both recorded implementations) and `ClaimEscrow` were checked against `.openzeppelin/base.json` with `@openzeppelin/upgrades-core`: **OK**.
- **Base Sepolia contracts:** every upgradeable contract touched was compared with its `7eb5976` layout and is **append-only**. Checked: ClearCredit, RevolvingIssuer, TermIssuer (including the base/extension split), OffersIssuer, PayoutPool, CollateralRegistry, AccessManager, LimitCalculator, MerchantRegistry, LendingPool, AssurancePool, BondVault, DeedNFT, Subdivide, Fractionalize, MetadataRenderer, FundManager, Validator and ValidatorRegistry.
- **Not upgradeable, so redeployed:** SavingsIntentFactory/Escrow and BurnerBondFactory.

**Deploy scripts (written, not run):**
- **deploy/20:** CLRUSD token, credit roles and daily caps.
- **deploy/22:** merchant registry on the ledger, the treasury's `REDEEMER_ROLE`, and borrower destinations.
- **deploy/13 and `scripts/grant_relayer_roles.ts`:** grant `RELAYER_ROLE`.
- **1C:** `deploy_all` repaired, plus `deploy/deed_admin_handover.ts`.
- **Spec:** `test/deploy/CreditCore.deploy.spec.ts` passes.
- **Live vault upgrade:** must be one `upgradeToAndCall(impl, setAcceptedToken(USDC, true))`, followed by the role swap.
