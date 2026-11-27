# Phase 2b: the Liquidator side of section 12

Branch `audit/phase-2b-liquidator`, cut from `audit/phase-2b-credit-agreements`. It covers 12.5 (settling a missed cycle's excess, and Savings only on default), 12.6 (Liquidation Hold) and 12.8 (Earn shortfall), following the Liquidator part of the design in [PHASE-2B-PROGRESS.md](PHASE-2B-PROGRESS.md). Tests are in `test/audit/compliance/Section12Liquidator.spec.ts`.

Nothing was deployed, no key was used, and no live network was touched.

## What changed

| Item | Where | What |
|---|---|---|
| 12.5 excess | `Liquidator.settleExcess(member, issuer)` | Permissionless, and only for a trusted issuer. It reads `unsecuredExcessOf` (and `missedInRowOf` ≥ 1) from the issuer. It takes pledged pool shares first, then bonds, for the smallest amount that covers the excess, and settles BOOST then INCOME through `settleFromCollateral`. It never touches CLRUSD. |
| 12.5 excess lock | `CollateralRegistry.encumberedOfKind`, `isItemEncumbered`, new `unsecuredExcessOf` | While a member has an excess, each Earn kind (backing `AssetInternal`, never the CLRUSD kind) also locks enough units to cover that excess on its own, on top of what its own tier needs, and never more than was pledged. Pledged bonds read as encumbered. The lock is computed from the issuers (a static call, so an issuer without the view answers 0); no role sets it. |
| 12.5 Savings | `Liquidator.liquidate` | Already permissionless and gated on the issuer's computed default. It now also requires the savings tier and the SAVINGS kind. Before, a caller could name the INCOME tier: the seized CLRUSD settled INCOME, the savings tier stayed drawn, its lock stayed in place, and the next call could take more savings than Savings-backed drawn. |
| 12.6 Hold | `Liquidator` (`proposeHold`, `confirmHold`, `renewHold`, `clearHold`, `holdOf`, `maxHoldOf`, `setMaxHold`) | Per member `{proposer, reason, confirmed, setAt, lastSigner, until, clearProposer}`. One `HOLD_ROLE` signer proposes, a different one confirms, and only a confirmed hold is active. It lapses on its own at `until` (≤ `setAt` + the reason's max). A signer other than the last one can renew it, up to `setAt` + max. Clearing an active hold takes two different signers; a proposal nobody confirmed, or a lapsed hold, is just dropped. Events: `HoldProposed`, `HoldConfirmed`, `HoldRenewed`, `HoldLapsed`, `HoldClearProposed`, `HoldCleared`. |
| 12.6 gating | `_requireNoHold` | `liquidate`, `liquidateShares`, `settleExcess` and `settleShortfall` revert with `LiquidatorOnHold` while a hold is active. Nothing else is gated: `noticeShortfall`, `settleFromSavings` (the member's own choice) and `settleRealized` (applies cash already collected; takes nothing from the member). A hold moves nothing and has no hook into any token. |
| 12.8 shortfall | `Liquidator.noticeShortfall`, `settleShortfall`, `earnGapOf`, `shortfallWait`, `setShortfallWait` | The notice is permissionless. It records `shortfallNoticedAt[member][issuer]` and emits `ShortfallNoticed(member, gap)`. After the wait (default 72 hours), `settleShortfall` redeems the smallest amount that closes the gap, pool shares first, then bonds, and settles the tier that pledge backs. If the gap closed meanwhile it moves nothing and clears the notice. |
| Bonds | `Liquidator._redeemBond`, `inDefault`, `onERC1155Received` | Bonds are taken with `BurnerBond.seizeBond` and redeemed with `redeemEarly`, which pays present value. The Liquidator checks that it received at least present value (`LiquidatorBelowPresentValue`). See conflict 1. |
| Config | `setEarnSources(pool, bonds)` | Admin (`DEFAULT_ADMIN_ROLE`, the credit timelock) names the pool and the bond collection. Kinds are read from them (`collateralKind()`), so they can't be mismatched. Zero turns a leg off. |
| Refactor | `_takeShares` | `liquidateShares` and the new paths share it. `liquidateShares` behaves as before. |
| Test mock | `contracts/mocks/MockMissedCycleIssuer.sol` | Reports `unsecuredExcessOf` and `missedInRowOf`, which RevolvingIssuer gains on the parent branch. **The parent wires the real issuer**, and should add an end-to-end test that drives a real missed cycle into `settleExcess`. |

### Governed figures

| Figure | Default | Setter | Bounds |
|---|---|---|---|
| `maxHoldOf(DEATH)` | 90 days (decision 5) | `setMaxHold`, admin | 1 s to 365 days (`MAX_HOLD_CEILING`) |
| `maxHoldOf(BANKRUPTCY)` | 180 days | same | same |
| `maxHoldOf(BILLING_DISPUTE)` | 90 days (two billing cycles, the usual dispute-resolution window) | same | same |
| `maxHoldOf(LATE_NOTICE)` | 30 days (twice the 15-day cure window) | same | same |
| `shortfallWait` | 72 hours | `setShortfallWait`, admin | 72 hours to 30 days: governance can lengthen the notice, never shorten it below the addendum's 72 hours |

The defaults other than DEATH are this branch's picks and await counsel.

### How the amounts are computed

- **Excess.** Shares are `previewWithdraw(excess)`, capped at the member's balance and at what the registry locks. Any remainder (less what was queued at the pool) comes from bonds. Up to the excess, net of queued value, is applied to BOOST then INCOME. A whole bond's surplus goes to the tier that bond backed, then back to the member in USDC. Queued pool value is settled later through `settleRealized`, as for `liquidateShares`.
- **Shortfall.** The gap is measured per kind, as the registry locks and values pledges: `gap = drawn on that kind's tier − collateralValueOf(kind) × haircut`. Redeeming `r` of a kind with haircut `h` closes `r × (1 − h)`, so the smallest `r` is `ceil(gap / (1 − h))`, capped at the pledge's value. With pool shares at 70%, a 50 gap takes 166.666667 (acceptance 26 checks that one unit less leaves a gap). A bond can't be split, so all of a redeemed bond's proceeds settle its tier, and only what is left after that tier is paid off goes to the member.
- **Bond choice.** The smallest bond whose present value covers what is left; if none does, the largest, then repeat. Exact subset-sum minimisation is not attempted.

## Acceptance tests

| # | Test |
|---|---|
| 22 (Liquidator half) | "acceptance 22 (Liquidator half): settling the excess takes pool shares and leaves Savings unchanged", plus "runs only on a computed miss…" (a member with only Savings loses nothing on a miss) |
| 23 | "acceptance 23: the hold delays enforcement, and cannot move or block unencumbered assets" |
| 26 | "acceptance 26: after 72 hours the redemption is the smallest that closes the gap, pool shares first" |
| 12.5 Savings | "liquidate takes CLRUSD only on default, only for the savings tier, and never past the savings lock" (with the existing Dfal acceptance 13 and `Liquidator.spec.ts`, on the real issuer) |

14 tests in the new file.

## Conflicts and judgement calls

1. **Bonds outside default vs audit M-6 (needs the owner).** `BurnerBond.seizeBond` requires its `defaultSource` to report the member in default (M-6). A missed cycle and an Earn shortfall are not defaults, so the bond legs of `settleExcess` and `settleShortfall` can't run with the issuer as default source. No BurnerBond code was changed. The Liquidator implements `inDefault(member)`, which is true only for the member it is taking a bond from, during that one call. It works only if the collection owner points `setDefaultSource` at the Liquidator. That relaxes M-6's literal "member in default" to "the Liquidator is enforcing a computed default, excess or matured shortfall against this member right now". The seize stays bounded by `isItemEncumbered` and by the timelocked liquidator address. **No deploy script does this wiring.** Until the owner decides, leave the default source as it is. The bond legs then revert (`BurnerBondNotSeizable`), and the pool-share legs still work. Note that `setDefaultSource` is owner-only and immediate today, which is an M-6 gap in its own right.
2. **New computed lock on Earn pledges (12.5).** Without it, an excess could reach only shares already locked behind their own tier, and a member could withdraw pledged-but-undrawn Earn the moment a cycle was missed. The lock is computed and expires with the excess. 12.12 says "only the pledge stays locked while drawn, and only for the encumbered amount". This widens what counts as encumbered, so the parent should confirm it is wanted. `release`/`releaseItem` (operator) are not blocked by an excess.
3. **The shortfall gap is per kind and haircut-adjusted.** The addendum says "value … below what is drawn". On raw value, redeeming collateral to repay debt never closes the gap: both sides shrink by the same amount. Measured per kind, it matches what the registry locks. Only that kind's pledge is seizable behind its tier.
4. **`shortfallNoticedAt` is keyed by member and issuer**, not member alone. A notice about one issuer's positions shouldn't start the clock on another's.
5. **An excess can take Earn that also backs an asset tier.**
   - For pool shares the excess lock sits on top of the tier's own need, so spare shares cover it first.
   - A bond is taken whole, and its surplus settles the tier it backed.
   - Any asset gap left goes through the shortfall path, with its notice and wait.

## Not done here

- Deploy wiring: grant `HOLD_ROLE` (two or more keys), call `setEarnSources`, grant the Liquidator `LIQUIDATOR_ROLE` on the pool (already listed in `scripts/command/ops-roles.map.json`), and decide conflict 1. None of it was run.
- The real RevolvingIssuer `unsecuredExcessOf` / `missedInRowOf` (parent branch).

## Numbers

- Tests: the full Hardhat suite gives 900 passing and 0 failing, including the 14 new ones.
- Sizes (production build, `--force`, limit 24,576): Liquidator is 20,033 bytes and CollateralRegistry 11,752. No production contract is over the limit.
- `code.json` fingerprints were regenerated (the Liquidator and CollateralRegistry changed). `contract-reference --check` and `check-doc-links` pass.
- Storage: append-only. Liquidator adds 6 slots (257–262) and its gap goes from 42 to 36, ending at the same slot. CollateralRegistry adds no state.
