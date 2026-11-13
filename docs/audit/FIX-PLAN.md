# Clear Protocol: audit fix and spec build plan

This is the brief for the Claude Code cloud sessions that fix the audit findings and build the two new specs. Every session reads this file first. It is written to be followed without the conversation that produced it.

Repo: `Deed3Labs/Protocol-Contracts`. Base branch: `dev`. Audited commit: `7eb5976`.

## 1. Inputs (all in this folder)

| File | What it is |
| --- | --- |
| `AUDIT-REPORT.md` | Main report. Credit core findings C-1, C-2, H-1..H-4, M-1..M-8, L-1..L-9, plus summaries of the X and D sections and the launch checklist |
| `DEEP-FINDINGS.md` | Refunds, payouts, bonds and pools: X-1..X-20, with invariant results |
| `DEED-FINDINGS.md` | Deed track: D-1..D-23, plus how the code compares to the trust-agreement assumptions |
| `DECISIONS.md` | Decisions the owner has already made. These override the specs where they differ |
| `specs/compliance-changes.md` | CFL/DFAL-driven credit changes (Phase 2) |
| `specs/deed-trust-v5-brief.md` + `specs/deed-trust-v5-addendum-1.md` | Trust agreement v5 contract requirements (Phase 3). The addendum supersedes item 8 of the brief |
| `../../test/audit/` | 53 audit tests. Each exploit test PASSES while its bug exists |

## 2. Ground rules (every phase)

1. **Never deploy, never use a private key, never send a transaction to a live network.** Write deploy and upgrade scripts; do not run them against `base`, `base-sepolia` or any RPC. The owner runs them through the Ops Safe.
2. **Never widen an admin power.** If a fix seems to need one, stop and write it up as an open question instead.
3. **Respect the compliance spec's "Do NOT change" list,** with one approved exception: `PayoutPool.redeem` eligibility (DECISIONS #3). If any change conflicts with that list or with a decision, do not choose silently. Record the conflict in the phase report and take the more conservative option.
4. **Contracts live on mainnet are upgrade-safe.** `ESADepositVault` and `ClaimEscrow` (and legacy `ClearUSD`, which is not upgradeable) are live on Base. Any change to an upgradeable live contract must keep storage layout: append only, shrink `__gap` to match. Check it with `upgrades.validateUpgrade` against `.openzeppelin/base.json`. The credit contracts exist only on Base Sepolia, so they may break layout, but say so in the report. Mainnet gets a fresh deployment of them.
5. **Do the fix, not a refactor.** Keep the house style: custom errors, NatSpec explaining *why*. Don't rewrite existing comments wholesale. Update comments the fix makes untrue.
6. **Every finding gets a regression test.** Flip each audit exploit test so it asserts the attack now FAILS, and keep it under `test/audit/`. Where an existing project test encoded the buggy behaviour, change it and list it in the report.
7. **When blocked on a decision,** use the default in section 7, record it in the report, and continue. Stop only for rule 2 or rule 3.

## 3. Saving usage (and time)

- **Read the reports, not the repo.** Open only the files you change and their direct callers. Do not re-audit.
- **At most 2 subagents at once,** and only for file-disjoint workstreams (section 4). Give each a complete written brief, because they start cold. Use Sonnet subagents for mechanical work: flipping tests, scripts, docs, deploy wiring. Keep ledger, issuer and PayoutPool logic in the lead session.
- **Compiling is slow** (about 4 minutes with viaIR). Batch related edits, compile once per batch, and run only the affected test files (`--no-compile` after a compile). Run the full suite only at the end of each workstream.
- **Fuzzing:** run `FUZZ_STEPS=60` while developing and the full default (300 steps) at the end of a phase.
- **Checkpoint by pushing, but open the PR only at the end.** Under `CLAUDE.md`, a branch without a PR gets no billed Vercel preview, so push the phase branch after each numbered step. That way a session that stops (usage limit, timeout) loses nothing. Open the PR once, when the phase is done. Put `[skip preview]` in every commit message that touches only contracts, tests or docs.
- **Keep `docs/audit/PHASE-N-PROGRESS.md` current:** a checklist of the phase's steps, ticked as they land, with one line on anything half-done. A resumed or fresh session reads it plus `git log` and carries on, instead of re-reading everything.

## 4. Phases and workstreams

Branches: `audit/phase-1`, `audit/phase-2-compliance`, `audit/phase-3-deed-v5`, `audit/phase-4-rereview`, each opened as a PR into `dev`. Phase 2 and Phase 3 start after Phase 1 is merged and can run at the same time, in two separate sessions, because their files don't overlap.

### Phase 0: setup (first 20 minutes of the Phase 1 session)

1. Branch `audit/phase-1` from `dev` (it must already contain `docs/audit/` and `test/audit/`; if not, stop and say so).
2. Toolchain (section 6). `npx hardhat compile`.
3. Baseline: `npm test` should give 763 passing (with the audit tests, 816). `npx hardhat test test/audit/*.spec.ts test/audit/deed/*.spec.ts test/audit/deep/*.spec.ts --no-compile` should give 53 passing. Record both numbers in the report. If the baseline differs, stop and report.

### Phase 1: fix every audit finding (no new features)

Three workstreams. The lead session owns **1A** and is the only one that edits shared interfaces (`contracts/core/interfaces/**`) and deploy scripts. It runs **1B** and **1C** as subagents in parallel.

**1A: ledger and credit (lead).** Files: `StableCredit`, `MutualCredit`, `ClearCredit`, `CreditIssuer`, `RevolvingIssuer`, `TermIssuer`, `OffersIssuer`, `PayoutPool`, `MerchantRegistry`, `NetworkRegistry`, `CollateralRegistry`, `LimitCalculator`, `Liquidator`, `AccessManager`, `MembershipRegistry`, `CarryIndex`, `ExposureMath`. Work in this order, compiling and testing after each step:

1. **C-1, H-1, M-1:** issuers validate the draw recipient (active merchant or named system address). `PayoutPool.redeem` accepts only registered + active merchants plus an allowlist of co-op addresses. A plain transfer mints only against the *transferable* (revolving) limit, while `originatePurchase` checks the total. `RevolvingIssuer._syncCreditPositions` reverts when `_draw` cannot place the whole shortfall. No transfers out of a merchant except to the PayoutPool.
2. **H-2:** compliant periods roll forward instead of being deleted. A draw with a limit and no period is invalid. The operator setters `setPeriodExpirationOf`, `setGraceLengthOf` and `pausePeriodOf` may only extend or pause, never move an expiry earlier (compliance 10b: no declared default).
3. **C-2:** savings collateral is valued at `min(pledgedOf, clrusd.balanceOf(member))`, and free CLRUSD is checked at draw time, in `_draw` and in `settleCardSpend`. Do NOT lock the pledge (DECISIONS #2).
4. **Refund path, X-1, X-3, X-4, X-5, X-12, X-13, X-14:** never move a member's obligation during a cash refund. A merchant shortfall becomes a tracked refund receivable. `originatePurchase` nets the recipient's existing obligation before minting (or `redeem` subtracts it). Withheld carry is settled. Refunds are paid only from member money. Plans track materialised carry explicitly. Emit net amounts.
5. **Pool accounting, X-2, X-8, X-20:** the pool's need = `totalSupply − memberFunded` (minus `refundsOwed` if that reads cleaner). `advancedOf` is reduced whenever a carrier's claim is settled or moved, and each share is capped. `drawForDueClaim` is all-or-nothing.
6. **X-6:** write-offs are not offered to other issuers. The defaulting issuer clears only its own positions.
7. **Hot keys, H-4 (credit side):** split `AccessManager` operator powers per function (open lines and plans / set limits / settings). Caps per day on new limits and plan totals. Plan merchants must be registered and active. `openPlan` requires the member's EIP-712 signature over the plan terms (section 7). `settleCardSpend` has a per-tx and per-day cap, refuses defaulted members, and only settles up to a recorded authorization (M-2).
8. **M-3 (encumbrance fails open):** fail closed for holders with drawn credit, and emit an event when the source reverts. **L-2:** the ledger's `burn`/`burnFrom` revert. **L-1:** add `_disableInitializers()` constructors. **L-5, L-6, L-7, L-8:** as the report says. **X-11:** saturate or cap the carry index.

**1B: money peripherals (subagent).** Files: `ESADepositVault`, `ClaimEscrow`, `SavingsIntentFactory`, `SavingsIntentEscrow`, `ClearUSDUpgradeable`, `LendingPool`, `AssurancePool`, `AssuranceOracle`, `BondVault`, `BurnerBond`, `BurnerBondDeposit`, `BurnerBondFactory`, `BondValuer`, `TokenRegistry`. Findings:

- **H-3:** the vault's `OPERATOR_ROLE` is split. Accepting tokens and other settings go to an admin/settings role. A `RELAYER_ROLE` covers only the signed-deposit, signed-redeem and mandate paths. `cancelMandate` is also callable by the depositor. Storage-safe (live on Base).
- **M-5:** the deposit receiver is bound by the depositor's signature (a signed intent). `redeemWithAuthorization` uses `SignatureChecker` (EIP-1271). Redeem only in the deposited token, or keep USDC the only accepted token.
- **H-4 (remaining):**
  - ClaimEscrow: the claim recipient is bound by the recipient's signature or a hashed claim secret, and claims can't race `refundExpired`. Storage-safe (live on Base).
  - SavingsIntent: the escrow address commits to the full config (`salt = keccak256(userSalt, config)`).
  - LendingPool `borrow`: a fixed destination stored on the pool, plus a daily cap.
- **M-4:** `finalize` accepts `balance >= amount` and refunds the excess.
- **M-6:** `seizeBond` is bounded by `isItemEncumbered` plus a default check; `setLiquidator` is timelocked.
- **M-8, X-17:** the `repayFrom*` functions are restricted to the tracked borrower; interest is split from principal.
- **X-7:** price queued withdrawals at claim time, or pro-rate losses onto them. **X-18:** stream interest into the share price.
- **X-9, X-15, X-16:** per-token reserve balances (or USDC only); no fixed $1 pricing; gains booked back to the tier that lost.
- **X-10:** bucket bonds by maturity; raise the minimum face. **X-19:** gate `createCollection`.
- **M-7 prep:** the vault upgrade adds `setClrusd` (with the existing zero-supply guard), plus the migration script, not run.

**1C: Deed track (subagent).** Files: `DeedNFT`, `Validator`, `ValidatorRegistry`, `MetadataRenderer`, `FundManager`, `FractionToken`, `Subdivide`, `Fractionalize`, `FractionTokenFactory`, `ValidatorFactory`, `deploy/deploy_all.ts`, `deploy/03`, `deploy/04`. Findings D-1 to D-22, as `DEED-FINDINGS.md` describes. No v5 features yet (that's Phase 3). But don't build anything Phase 3 will have to undo: per-deed validator authority (D-2, D-7), never reusing IDs (D-8) and subdivision custody (D-9) are exactly what v5 needs.

**Phase 1 done when:**

- The full suite passes, and every audit exploit test is flipped and passing.
- The invariant suite holds at 300 steps across all seeds, except breaks listed and justified in the report.
- Slither, run per changed contract (section 6), reports no new High or Medium.
- `validateUpgrade` passes for `ESADepositVault` and `ClaimEscrow` against `.openzeppelin/base.json`.
- `docs/audit/PHASE-1-REPORT.md` is written (section 5), the branch is pushed and a PR is opened into `dev`. Then **stop**.

### Phase 2: compliance spec (`specs/compliance-changes.md`)

Starts from merged Phase 1. Credit files plus a new `RateSchedule`. Apply DECISIONS #1, #4, #6, #7 and #10. Suggested order:

1. `RateSchedule`, with governance and timelock.
2. The principal/carry split and per-band indexes in both issuers.
3. The member-level ceiling.
4. Term-plan free rules, and the `PlanOpened` disclosure event.
5. Re-split with an EIP-712 signature.
6. Clear Cash, including the 13-cycle option.
7. MerchantRegistry additions.
8. The state gate.
9. DFAL 10a–10e: the computed lock, permissionless computed liquidation, fraud and security pauses with 72-hour expiry and a two-person renewal, token powers, 7-day upgrade timelocks.
10. The vault pilot cap (storage-safe, WY default per DECISIONS #6).

A Sonnet subagent may build `RateSchedule` and its tests in parallel with step 2. Implement acceptance tests 1–17 from the spec. Recompute the figures in tests 1, 2 and 5 for per-second accrual (DECISIONS #1); do not tune the code to the old numbers. Report in `docs/audit/PHASE-2-REPORT.md`, plus `docs/audit/UPGRADEABILITY.md` (which contracts are upgradeable, by which role, behind which timelock).

### Phase 3: Deed trust agreement v5 (`specs/deed-trust-v5-*.md`)

Starts from merged Phase 1, and may run alongside Phase 2. Deed files plus a new `CoopTransferAgent` and a Functional Contract registry. Apply the addendum and DECISIONS addendum items 1–6, #8, #9 and #10. Return, in `docs/audit/DEED-V5-INTERFACE.md`:

- the final function signatures, event names and reserved trait keys;
- every deviation from the brief, with the reason.

The owner aligns the agreement's drafting notes to that file.

### Phase 4: independent re-review and rehearsal

A fresh session, from `dev` with Phases 1–3 merged:

1. Rebase the 53 audit tests onto the new code and confirm every attack fails.
2. A reviewer subagent that has seen neither the fixes nor this plan's reasoning reviews the diff `7eb5976..HEAD` for new issues.
3. Extend the invariant fuzz to the Deed track and to Phase 2's accrual.
4. Re-run Slither per contract.
5. If the owner has set `BASE_SEPOLIA_RPC_URL` in the environment, rehearse the upgrades on a fork with `FORK_RPC_URL`, read-only.

Report in `docs/audit/REREVIEW.md`. The owner then decides on an external human audit before mainnet.

## 5. Phase report format

`docs/audit/PHASE-N-REPORT.md` contains:

1. A table: finding ID → what changed (one line) → files → regression test name.
2. Existing tests changed, and why.
3. Deviations from the plan or spec, and defaults taken from section 7.
4. Conflicts found (rule 3).
5. Open questions for the owner. Keep it short; these block nothing.
6. Test counts before and after; fuzz steps; Slither summary; storage-layout check results.

## 6. Toolchain notes for the cloud environment

- Node 22. To save time, install only the root workspace for contract work: `npm ci --ignore-scripts --no-audit --no-fund --workspaces=false --include-workspace-root`. CI (`.github/workflows/ci.yml`) also runs app typechecks, so run `npx turbo run typecheck test --affected` before the final push only if the apps were touched.
- **If Hardhat can't download solc** (`HH502`, `binaries.soliditylang.org` blocked), install it from GitHub releases:
  ```bash
  D=~/.cache/hardhat-nodejs/compilers-v2/linux-amd64; mkdir -p $D
  curl -sSL -o $D/solc-linux-amd64-v0.8.29+commit.ab55807c https://github.com/ethereum/solidity/releases/download/v0.8.29/solc-static-linux
  chmod +x $D/solc-linux-amd64-v0.8.29+commit.ab55807c
  echo '{"builds":[{"path":"solc-linux-amd64-v0.8.29+commit.ab55807c","version":"0.8.29","build":"commit.ab55807c","longVersion":"0.8.29+commit.ab55807c","keccak256":"0x0","sha256":"0x0","urls":[]}],"releases":{"0.8.29":"solc-linux-amd64-v0.8.29+commit.ab55807c"},"latestRelease":"0.8.29"}' > $D/list.json
  ```
- **Slither:** whole-project mode fails because `hardhat-preprocessor` rewrites lines. Run it per contract with solc directly:
  ```bash
  pip install --break-system-packages slither-analyzer
  slither contracts/peripherals/X.sol --solc <path-to-solc-0.8.29> \
    --solc-remaps "@openzeppelin/contracts-upgradeable/=node_modules/@openzeppelin/contracts-upgradeable/ @openzeppelin/contracts/=node_modules/@openzeppelin/contracts/ @chainlink/contracts/=node_modules/@chainlink/contracts/ @chainlink/contracts-ccip/=node_modules/@chainlink/contracts-ccip/" \
    --solc-args "--via-ir --optimize --optimize-runs 1" --filter-paths node_modules --exclude-informational --exclude-optimization
  ```
- The fuzz writes raw output to `$FUZZ_OUT` (default `<tmpdir>/clear-audit-fuzz`). Don't commit it.
- `test/deploy/CreditCore.deploy.spec.ts` writes to `deployments/hardhat/`. Don't run it from two agents at once.

## 7. Defaults for questions not yet decided

Use these, record each one you used in the phase report, and keep going:

| Question | Default |
| --- | --- |
| Who signs a term plan on chain | The member, by an EIP-712 signature over member, merchant, amount, split, rate and the disclosure hash. The operator submits it |
| Card settlement vs DFAL 10a (a settler key raising a member's draw) | Allowed only up to an authorization recorded at approval, with per-tx and daily caps. Flag it for counsel in the report |
| `IDeedCustody.beneficialOwnerOf` scope | Only contracts that can hold a deed: `Subdivide`, `Fractionalize`, and any future escrow or bridge. Not CollateralRegistry, Liquidator, ClaimEscrow, LendingPool or SavingsIntentEscrow, which never hold deeds |
| `Liquidator.liquidate` access | Permissionless, with default computed on chain (compliance 10b) |
| Anything that would add a new admin power | Don't. Write it up as an open question |
