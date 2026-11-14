# Phase 2e, the bond half: pledged bonds (Earn addendum, founder answer G)

Branch `audit/phase-2e-pledged-bonds`, cut from `audit/phase-2e-calendar-cycles` with `dev` (Phase 2d) merged in. The credit half folds this file into the Phase 2e report and merges the branch. The brief is the "EARN ADDENDUM — pledged bonds" section of [`specs/addendum-2.md`](./specs/addendum-2.md), its tests 18 and 19, and founder answer G, with IV-01 §4.9 and MB-05 from [`specs/addendum-2-references.md`](./specs/addendum-2-references.md).

**Answer G, in one line:** a pledged bond is no longer taken and redeemed by the Liquidator. It is paid under its own pledge payment term (`payPledged`). At maturity, `settle` splits it under the Holder's Maturity Instruction.

## 1. What changed

| Item | Status | Where |
|---|---|---|
| §1 allowlist (a): a bond burns only on settlement, buyback, `payPledged` or `redeemAll` | Done for what exists. A bond burns only in `redeemBond`/`batchRedeemBonds`, `settle`, `payPledged` and `rollBond` (a roll is a settlement into a new bond). `redeemEarly` is gone, and no function takes a bond to burn elsewhere. A test pins the full list of state-changing functions. `buyback` and `redeemAll` are Phase 2f's. | `BurnerBondBase._retire`, `BurnerBond`, `BurnerBondPledges` |
| §4 `payPledged(id)` (IV-01 §4.9) | Done | `BurnerBondPledges.payPledged`, `Liquidator.pledgePaymentDue` / `applyPledgePayment`, `BondVault.settleEarly` |
| §4 `settle(id)`, pledged bond that does not roll | Done, with one open sub-case (section 4, conflict 1) | `BurnerBondPledges.settle`, `Liquidator.maturityToDebt` / `applyMaturityInstruction`, `BondVault.settlePledged` / `completeSettlement` |
| §9 advance rates stored per pledge (95% of Present Value, 70% of Pool Share Value) | Done | `CollateralRegistry` (`itemAdvanceBpsOf`, `advanceBpsOf`, `advancedValueOf`), `LimitCalculator.capacityOf`, `Liquidator` gaps |
| §9 a bond pledge needs the Holder's signature over the Maturity Instruction, hash stored | Done | `CollateralRegistry.pledgeItem`, `PLEDGE_ITEM_TYPEHASH`, `maturityInstructionOf` |
| §9 pledged positions exit only through MB-05 | Done for bonds (no transfer, no `redeemBond`, no seize: only `settle` and `payPledged`). The pool-share path is unchanged. | `BurnerBondBase._beforeTokenTransfer`, `BurnerBond._redeem` |
| Liquidator: remove the bond seize-and-redeem path | Done. `IEarnBonds.seizeBond`/`redeemEarly`, `_realizeBonds`, `_redeemBond`, `mayTakeBond`, `onERC1155Received` are gone. So are the bond legs of `settleExcess` and `settleShortfall`. The pool-share paths are unchanged except that gaps use stored rates. | `Liquidator` |
| Earn tests 18 and 19, regressions | Done: `test/audit/compliance/PledgedBonds.spec.ts` (18 tests) | |

### BurnerBond: a module split

BurnerBond had 408 bytes of headroom, and the factory carries its creation code (46,956 of 49,152). So the bond is now in three parts:

- **`BurnerBondBase`**: the storage, the shared internals (`_presentValue`, `_isPledged`, `_retire`), and the transfer hook.
- **`BurnerBond`**: unchanged in what it does, apart from the items below.
- **`BurnerBondPledges`**: a delegatecall module where `payPledged` and `settle` run.

The module follows the issuer pattern. The implementation's constructor takes its address, checks `extensionKind() == keccak256("BurnerBondPledges.v1")`, and pins it as an immutable. A clone runs its implementation's code, so every collection gets the same module, and no role can swap it. `BurnerBondFactory` takes the module as a third constructor argument. `deploy/bondModules.ts` (`deployBondFactory`, `deployBondPledges`) deploys it for scripts and tests.

BurnerBond is a clone, not upgradeable, so its storage could be reshaped. It drops `defaultSource` and `settlementGate`, and adds `holderOf` (who holds each bond, kept by the transfer hook), because `payPledged` and `settle` take only an id. Existing collections keep the code they were made with: the Base Sepolia collection, and the legacy one, still have `seizeBond`/`redeemEarly`. A new factory and collection go through `scripts/redeploy_bonds.ts`.

Removed from BurnerBond: `seizeBond`, `redeemEarly`, `setDefaultSource`, `setSettlementGate`, the liquidator's transfer exemption, and `rollBond`'s refusal to roll for the liquidator. Added:

- `accretedValue(id)`, which equals `presentValueOf` (section 3, call 5);
- `payPledged(uint256)` and `settle(uint256)`;
- `pledges()`;
- the events `PledgePaid(id, holder, amount, toDebt, toHolder)` and `PledgedMaturitySplit(id, toDebt, toHolder)`;
- the errors `BurnerBondPledged`, `BurnerBondNotPledgePayable` and `BurnerBondNotSettleable`.

`setLiquidator` keeps its 7-day delay (audit M-6). The address it names is now the pledge module's enforcement side.

### `payPledged(id)`

1. **Who may call it, and when.** Anyone may call it. It reverts unless all of these hold:
   - the bond exists, is unredeemed, and its holder has it pledged in the registry;
   - the collection's `liquidator` (the Liquidator) answers `pledgePaymentDue(holder, id)` with `due`.
2. **What `pledgePaymentDue` checks.** It reads only chain state:
   - the bond is pledged and held;
   - no Liquidation Hold is active;
   - with one of the member's issuers that the Liquidator trusts, either:
     - **(a)** the issuer's computed default holds: `inDefault || hasDefaultedOnCurrentLine`, exactly the views the credit half keeps (its `PHASE-2E-PROGRESS.md` interface note). The need is then the member's debt with that issuer in `BOND`, `POOL_SHARE`, `BOOST` and `INCOME`; or
     - **(b)** a shortfall notice exists and is at least `shortfallWait` old (72 hours or more), and the bond gap is still open. The need is then the bond value whose payment closes the gap.
   - The bond is the one the module requests for that need: the smallest pledged, held bond that covers it, else the largest (MB-05 §7.3(c)).
3. **What it pays.** It pays `accretedValue(id)` in that block, in full: `BondVault.settleEarly` pays the Liquidator exactly that, or reverts. Nothing partial.
4. **Where the money goes.** The Liquidator's `applyPledgePayment` (only `earnBonds` may call it) settles the tiers with `settleFromCollateral`:
   - on a shortfall, the `BOND` tier only;
   - on a default, `BOND`, then `POOL_SHARE`, then `BOOST`, then `INCOME`;
   - never `SAVINGS`.

   It sends the surplus in USDC to the holder, and clears the shortfall notice once both gaps are closed.
5. **The end.** The collection releases the pledge (`CollateralRegistry.releaseRetiredItem`, `ITEM_ROLLER_ROLE`, which the collection already holds for rolls) and the bond burns, all in one transaction.

### `settle(id)` and the Maturity Instruction

1. **Who may call it, and when.** Anyone, for a matured, unredeemed bond whose holder opted out of rolling. A bond that rolls is rolled by `rollBond`.
2. **An unpledged bond** pays its face value to its holder (`BondVault.settle`), as `redeemBond` does.
3. **A pledged bond is split.** The split is `toDebt = min(face, max(0, drawn − limitWithout))`, from `Liquidator.maturityToDebt`:
   - `drawn` is the holder's `BOND`-tier principal with their trusted issuers;
   - `limitWithout` is `CollateralRegistry.advancedValueOf(holder, BOND, id)`, which values the holder's other pledged bonds at their stored rates.

   `toHolder` is the rest. No argument or role supplies any part of either.
4. **How it is paid.** `BondVault.settlePledged` pays `toDebt` first, in full, to the Liquidator. `applyMaturityInstruction` (only `earnBonds`) applies it to the `BOND` tier as the holder's own instruction (MB-05 §7.9), so a Liquidation Hold does not stop it. Anything the tier no longer owes goes to the holder.
5. **If the vault is short.** The holder gets what the vault and the treasury can pay of `toHolder` now. The remainder is recorded against the bond:
   - `settlementOwed` and `settlementPayee` hold it, and `SettlementShortfall` is emitted;
   - it is reserved in `requiredReserve` ahead of any deployable excess;
   - anyone can trigger the payment with `completeSettlement(id)`, which pays the recorded holder only.

   Nothing is locked or held for the holder, and there is no "Pledged Proceeds" state.
6. **The end.** The pledge releases, the bond burns, and `PledgedMaturitySplit(id, toDebt, toHolder)` is emitted.

`redeemBond` refuses a pledged bond (`BurnerBondPledged`): a pledged bond pays out only through `settle`.

### §9: stored advance rates and the Maturity Instruction

**Item pledges.**
- `pledgeItem(member, kind, itemId, maturityInstruction, deadline, signature)` takes the member's EIP-712 signature over `PledgeItem(address member, bytes32 kind, uint256 itemId, bytes32 maturityInstruction, uint256 nonce, uint256 deadline)`.
- A zero instruction reverts `CollateralRegistryNoMaturityInstruction`.
- The registry stores the hash (`maturityInstructionOf`) and the kind's `haircutBps` at that moment (`itemAdvanceBpsOf`), and emits `ItemPledgeTerms`.
- A roll carries both to the replacement. A release or seizure clears them.

**Amount pledges** (pool shares) store a units-weighted rate (`advanceBpsOf`, `PledgeAdvanceRate`). A pledge made before this upgrade has no stored rate and reads the kind's rate.

**Where the stored rates are used.**
- `CollateralRegistry.advancedValueOf(member, kind, exclude)`, which now gives `LimitCalculator.capacityOf`;
- the Liquidator's gap and closing amount;
- the pool-share lock (`_requiredUnits` for every kind but CLRUSD's);
- the pledged maturity split.

**Not changed.** The CLRUSD lock and savings capacity keep the kind's fixed terms (spec 10a). `exposureOf`, the AssurancePool's measure, keeps the governed kind rate.

`pledgeDigest(member, kind, amount, deadline)` and `pledgeItemDigest(member, kind, itemId, maturityInstruction, deadline)` replace the old `pledgeDigest(…, bool item)`, which nothing called.

### BondVault (UUPS, Base Sepolia)

- Adds `settlePledged`, `completeSettlement`, and three appended slots: `settlementOwed`, `settlementPayee` and `totalSettlementOwed`. The `__gap` goes from 33 to 30.
- `_cover` now runs on `_coverUpTo`.
- `requiredReserve` adds `totalSettlementOwed`.
- `settleEarly` stays. Its only caller is now a collection's `payPledged`, and the legacy collection's `redeemEarly` still needs it.

### Other callers updated

| File | Change |
|---|---|
| `deploy/10`, `deploy/22`, `deploy/deploy_burner_bonds.ts`, `scripts/redeploy_bonds.ts` | The factory is deployed with its module. `redeploy_bonds.ts` signs the new `PledgeItem`. |
| `deploy/25_wire_Compliance.ts` | No longer calls `setDefaultSource`/`setSettlementGate`. It proposes `setLiquidator(Liquidator)` on the collection, which applies after the delay once bonds exist. |
| `scripts/unwind_legacy_bonds.ts` | Uses an inline ABI for the legacy collection, which still has `seizeBond`/`redeemEarly`. |
| `apps/api/src/services/command/onchain.ts` | Command's bond list closes a bond on `PledgePaid` and `PledgedMaturitySplit` too. |
| `contracts/mocks/MockCollateralSignals.sol` | Adds `isItemPledged`, `setItemPledged` and `releaseRetiredItem`. |

## 2. Tests

**New:** `test/audit/compliance/PledgedBonds.spec.ts`, 18 tests.

- **Earn test 18**, with the spec's figures.
  - A qualifying default with debt $500 against an Accreted Value of $950 puts exactly $500 to the debt and $450 to the Holder. The vault pays $950, the Liquidator keeps nothing, the caller gets nothing, the bond burns and its pledge is released.
  - It reverts on an unpledged bond, with no recorded enforcement condition, on a Shortfall at 72 hours less one second, and before the cure date (no computed default).
  - A 72-hour Shortfall pays only the bond tier.
  - Only the requested bond is payable, and none after the need is met.
  - The default order is followed, and Savings is never touched.
  - No call pays less: `payPledged` takes only the id. A vault that cannot pay the whole Accreted Value reverts rather than paying less. Neither the admin nor a stranger can call `settleEarly`, `settlePledged`, `applyPledgePayment` or `applyMaturityInstruction`. A Liquidation Hold stops it.
- **Earn test 19**, with the spec's figures (Maturity Amount $1,000; a second pledged bond with Present Value $500 and Collateral Value $475; auto-roll off).
  - Drawn $1,200: a random caller's `settle` emits `PledgedMaturitySplit(id, 725, 275)`, applies $725 and pays $275 with no lock. The pledge is released and the bond burned.
  - Drawn $400: (0, 1,000).
  - Drawn $1,600: (1,000, 0). The $125 left above the limit gets a `ShortfallNoticed` of $125, and after 72 hours the second bond's `payPledged`.
  - Vault short at $800: $725 is still applied, $75 is paid, `SettlementShortfall` records $200, and `completeSettlement` pays it later, to the Holder only.
  - No caller changes the split, and lowering the bond rate after pledging changes nothing.
- **§9:** without a Maturity Instruction the pledge reverts; a signature over a different instruction, or by someone else, reverts; 95% and the hash are stored; 70% for pool shares; rates are kept through a governed change; pool rates blend; a roll keeps the terms.
- **§1 (a) and the module:**
  - the exact list of BurnerBond's state-changing functions;
  - the module rejects direct calls;
  - an implementation with a module of the wrong kind cannot be deployed.

**Changed:**

| File | Change and reason |
|---|---|
| `peripherals/BurnerBond.spec.ts` | The seize/redeem-early tests become tests that the path is gone (no `seizeBond`, `redeemEarly`, `setDefaultSource` or `setSettlementGate` in the ABI, and the selectors revert). Also new: nobody, the liquidator included, can move a pledged bond; `payPledged` refuses an unpledged bond; `settle` pays an opted-out bond to its holder whoever calls; a pledged bond rolls for its holder only. |
| `peripherals/BondCollateral.spec.ts` | A pledged bond does not move even with nothing drawn; it moves once released. Redeeming refuses with `BurnerBondPledged` (was the vault's `BondVaultBondPledged`), and pays once released. "Still lets the co-op take it" becomes "nobody takes it". The valuer's not-held rule is checked directly, because a pledged bond can no longer be moved away to test it. |
| `audit/compliance/Section12Liquidator.spec.ts` | The stack grants the collection `ITEM_ROLLER_ROLE` instead of naming a settlement gate. "Takes pool shares first, then the smallest bond…" becomes "takes pool shares only: a missed cycle never reaches a pledged bond". The shortfall test closes the pool gap with `settleShortfall` and the bond gap with the bond's `payPledged`. The `mayTakeBond` checks are replaced by its absence. |
| `audit/deep/PeripheralRegressions.spec.ts` | The M-6 `seizeBond` test becomes "superseded by answer G: no `seizeBond`, and the liquidator cannot move a pledged bond in default". The liquidator-delay test is kept. |
| `audit/rereview/Decisions.spec.ts` | The L-I item-pledge test passes the instruction hash. |
| `helpers/pledge.ts`, `helpers/bonds.ts` | `PledgeItem` signs `maturityInstruction` (default `MATURITY_INSTRUCTION`). `deployBondFactory` is new. |
| `Assurance`, `ReserveUntouched` and the other factory users | Deploy the factory through `deployBondFactory`. |

## 3. Judgement calls

1. **A missed cycle no longer reaches bonds.** `settleExcess` (12.5) used to take pool shares, then bonds. A missed cycle is neither a default after notice and cure nor a Shortfall, so MB-05 §6.1 does not permit enforcement against a bond, and `payPledged` would not run.
   - Answer G supersedes the Phase 2b settlement gate that opened bonds to that path. I read it as settling this: the excess is now settled from pool shares only, and what they don't cover stays owed.
   - The 12.12 excess lock in the registry is unchanged. It no longer matters for bonds, which are locked while pledged anyway.
2. **The module's order (MB-05 Article 7 is not in the references).**
   - On a default: the bond's own tier, then pool shares' tier, then `BOOST`, then `INCOME`; never `SAVINGS`, which its own collateral covers.
   - On a shortfall: the bond tier only.

   The bond's tier goes first so that tier is not left drawn against a pledge that is gone. That follows the old `_settle` rule. For counsel.
3. **"Asset-Backed" means the bond kind's tier.**
   - This code gives bonds and pool shares separate tiers, each with its own limit (deploy/20). So `drawn` and `limitWithout` in the split are the `BOND` tier and the other pledged bonds. In test 19, which has only bonds, the spec's aggregate gives the same figures.
   - `drawn` is `principalOf`: principal plus materialised carry, not carry accrued since the last touch. So `toDebt` can come out a few units low, which favours the Holder, and what remains falls under the Shortfall rules.
4. **The request rule.**
   - Any caller names an id, so the module requests one specific bond: the smallest that covers the need, else the largest (the old selection rule). Calls repeat until the need is met.
   - On a shortfall, the closing amount uses the member's rate for the kind (the old formula), and a bond's own stored rate may differ slightly. The next call re-measures the gap.
5. **`accretedValue` is `presentValueOf`** (straight-line accretion). Phase 2f replaces the formula with the Earn spec's compounding at the Issue Yield. Both names answer the same figure, so `payPledged` pays exactly the Present Value.
6. **Holds.** A Liquidation Hold stops `payPledged` (enforcement). It does not stop the maturity split, which is the Holder's own instruction.
7. **Releasing an undrawn pledge.** A pledged bond no longer moves at all, even with nothing drawn (§9: pledged positions exit only through MB-05). To move one, the pledge is released first with the operator's `releaseItem`, which still refuses while anything is drawn.
8. **Trust is the same as before.** `pledgePaymentDue` reads only issuers the Liquidator already trusts for `liquidate`. Those are registered by the credit timelock (M-E) and enrolled for the member. The collection's `liquidator` keeps its 7-day delay, and the Liquidator's `earnBonds` is still `DEFAULT_ADMIN_ROLE`'s.
   - No role can trigger, price or redirect `payPledged` or `settle`: the amount is computed inside the bond, the destinations are the holder and that holder's own tiers, and both apply functions accept only the collection.
   - Two powers are gone: `setDefaultSource` and `setSettlementGate`.
9. **The settlement-shortfall rule** is built only for a pledged bond's `toHolder`. An unpledged bond's `settle` still reverts when the vault is short, as `redeemBond` always has. Phase 2f brings the general rule.

## 4. Conflicts

1. **`toDebt` moves USDC here, so a vault that cannot cover `toDebt` blocks the split.**
   - **Not built, open for a decision.** The fail-safe is kept: if the vault and the treasury can't cover `toDebt`, `settle` reverts and nothing moves.
   - **The spec.** The Earn spec (Phase 2f's full text) says `toDebt` "moves no USDC" and stays in the BondVault, so a short vault only affects `toHolder`.
   - **The code.** Asset-Backed Drawn is a balance on the co-op's ledger. A repayment has to deliver the reserve token to it (`settleFromCollateral` → `repayCreditBalanceFor`). So `toDebt` is paid from the vault to the Liquidator to the issuer, before `toHolder`.
   - **What works.** Whenever the vault and the treasury hold at least `toDebt`, test 19 holds as written: $725 applied, only the $275 subject to `SettlementShortfall`.
   - **The case that breaks.** If they hold less than `toDebt`, `settle` reverts and nothing moves. The bond stays pledged at its Maturity Amount until funds arrive. In that case the Holder's `toHolder` waits too, which is at odds with "toHolder never locked".
   - **Options:**
     - (a) Accept: a vault that cannot cover the debt part is a Reserve Shortfall, which Phase 2f blocks earlier.
     - (b) Apply what the vault has to the debt, pay the Holder nothing yet, and record both remainders for `completeSettlement`.
     - (c) Have the ledger accept a USDC-less "applied from Earn" repayment. This touches RevolvingIssuer and StableCredit, which the bond half may not.
   - **Recommendation: (b).** It keeps `settle` from ever reverting for lack of money, and it is a small change to `BondVault` and `Liquidator` alone.
2. **No other new conflict.** Answer G settles the Phase 2b gate and the 4b/REREVIEW bond decision (M-6's `seizeBond` gate, superseded and removed). Nothing touches ESADepositVault or ClaimEscrow.

## 5. Checks

- **Hardhat suite** (`npx hardhat test`, with revert strings): see section 7.
- **Turbo.** `npx turbo run typecheck test --affected` (Node 22, bun): 32 of 32 tasks passed. The member tests that read `apps/api` were also run uncached: 850 pass.
- **Sizes** (production, `npx hardhat compile --force`). No contract is over 24,576 bytes runtime or 49,152 bytes of creation code.

  | Contract | Runtime | Creation | Before |
  |---|---|---|---|
  | BurnerBond | 23,294 | 23,721 | 24,168 / 24,278 |
  | Liquidator | 22,833 | 22,970 | 20,380 / 20,517 |
  | CollateralRegistry | 15,596 | 15,733 | 13,503 / 13,640 |
  | BondVault | 11,373 | 11,510 | 10,290 / 10,427 |
  | BurnerBondPledges (new) | 9,603 | 9,630 | — |
  | LimitCalculator | 6,951 | 7,088 | — |
  | BurnerBondFactory | 7,270 | 46,475 | creation 46,956 |

  **The Liquidator has 1,743 bytes left** for the credit half's default-trigger changes.
- **Storage.** OpenZeppelin's `getStorageUpgradeReport` finds no errors against every implementation in the manifests:
  - `.openzeppelin/base-sepolia.json`: BondVault ×3, CollateralRegistry ×2, Liquidator ×2, LimitCalculator ×2, and also ESADepositVault ×4 and ClaimEscrow ×1, which are untouched;
  - `.openzeppelin/base.json`: ESADepositVault ×2 and ClaimEscrow ×1, untouched.

  The layout changes:
  - BondVault appends three slots and its gap goes 33 → 30.
  - CollateralRegistry appends three mappings and its gap goes 40 → 37.
  - Liquidator renames `_enforcing` to `retiredEnforcing` (`@custom:oz-renamed-from`), with the same slot and no new storage.
  - LimitCalculator adds no storage.
  - BurnerBond is a clone and has no proxy.
- **Slither** (Medium and High, per contract, the FIX-PLAN section 6 way, against `dev`):

  | Contract | `dev` | branch | New |
  |---|---|---|---|
  | BurnerBond | 4 | 4 | none |
  | BurnerBondPledges (new) | — | 0 | none: `uninitialized-state` is marked on BurnerBondBase's variables the module only reads, since the module reads the collection's storage |
  | BondVault | 4 | 3 | none: the audited treasury `arbitrary-send-erc20` moved from `_cover` to `_coverUpTo`, and `reentrancy-balance` in `_cover` is gone |
  | CollateralRegistry | 1 | 1 | none |
  | Liquidator | 19 | 13 | none: six fewer, all from the seize path |
  | LimitCalculator | 43 | 42 | none: one `unused-return` fewer |
  | BurnerBondFactory | 16 | 16 | none |
- **Generated files.**
  - `node scripts/command/code-fingerprints.mjs` regenerated `packages/command-types/src/chain/code.json` (34 contracts), and `--check` passes after a production compile.
  - `node scripts/docs/contract-reference.mjs` regenerated `docs/protocol/contracts/BurnerBond.md`, and `--check` passes.
  - `node scripts/check-doc-links.mjs` reports no broken links.
- **Docs.** `docs/protocol/bonds.md` and `docs/protocol/credit.md` describe the new paths.

## 6. App and API follow-ups (not in this branch)

1. **Maturity Instruction at pledging.** The pledge screen shows the instruction (MB-05 §5.6) and the member signs `PledgeItem` including `maturityInstruction`, the hash of the text they approved. Keep a copy in Documents.
   - `apps/api/src/services/chain/savingsCollateralService.ts` still calls the pre-4b, three-argument `pledgeItem`. It needs the member's signature and the new argument.
2. **95% / 70% display.**
   - Show each pledge's stored rate (`itemAdvanceBpsOf`, `advanceBpsOf`) and the limit from `advancedValueOf`, not the kind's current `haircutBps`.
   - Retire any 80% / 60% copy.
3. **Keepers** (all permissionless):
   - `payPledged`: for members in a computed default, or with a shortfall notice past `shortfallWait`, find the bond `pledgePaymentDue` requests and call it, repeating until none is due;
   - `noticeShortfall`;
   - `settle(id)` at maturity for opted-out bonds;
   - `completeSettlement(id)` when a recorded shortfall can be paid.
4. **Member app.**
   - A pledged bond's Redeem becomes the maturity split, previewed with `Liquidator.maturityToDebt`.
   - A pledged bond can't be sent anywhere.
   - Releasing an undrawn pledge is an operator `releaseItem`.
5. **Indexer and Command.** Index:
   - from the collection: `PledgePaid`, `PledgedMaturitySplit`;
   - from the vault: `SettledPledged`, `SettlementShortfall`, `SettlementCompleted`;
   - from the registry: `ItemPledgeTerms`, `PledgeAdvanceRate`;
   - from the Liquidator: `PledgePaymentApplied`, `MaturityInstructionApplied`.

   `onchain.ts` already closes bonds on the first two.
6. **Deployment** (not done here; no network was touched).
   - Deploy `BurnerBondPledges`, then a new factory and collection (`scripts/redeploy_bonds.ts`, with `setFirstBondId` above the current ids).
   - Upgrade BondVault, CollateralRegistry, Liquidator and LimitCalculator.
   - `deploy/23` grants the collection `ITEM_ROLLER_ROLE` (needed for `releaseRetiredItem`). `deploy/25` proposes the collection's `liquidator`.

## 7. Full suite

`npx hardhat test` on this branch: see the result recorded below by the final run.
