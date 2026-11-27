# Command Center: brief update 1

You're partway through the build. The design and the brief changed after you started. This note lists only what changed; the full updated brief is attached as `command-center-build-prompt.md` and replaces the old one. Finish the phase you're on, then apply this before starting the next.

## 1. Replace the design file

Replace `design/clear-command-center.html` with the attached version. It is still the spec. Re-record the Playwright visual baselines from it, at 1500, 1100 and 390 px, in Paper and Ink.

## 2. Repo layout (if your Phase 0 plan assumed `apps/web`)

There is no `apps/web`. The monorepo is `Deed3Labs/Protocol-Contracts` on the `dev` branch, a Turborepo:
- `apps/member`: Vite + React 19 + TS, `@privy-io/react-auth`, deployed on Vercel.
- `apps/api`: Express + `pg`, on Railway, with `migrations/`.
- `apps/merchant`, `apps/pay`, `apps/rewards`.
- `packages/*`, including `contracts-sdk` and `tokens`.

`apps/command` should match `apps/member`: Vite, the same Privy setup, its own `vercel.json`, and the turbo `build:vercel` task. If your plan already found this, nothing changes. Otherwise update `docs/command-center-plan.md`.

## 3. Shared CSS fix (Phase 1 port)

In the column chart, set bar height to `calc(var(--colh) * value / max)` and put `flex: none` on the bar. The old prototype used `%` of the column, which squashed tall bars. Fix it in the ported stylesheet and the column component.

## 4. Money: yield pool and new layouts

The yield pool (`LendingPool`, ERC-4626) is now a first-class part of Money. The full spec is in §7 of the brief. In short:

- **New tab:** Money is now Overview, Reserves, **Yield pool**, Credit, Bonds, Schedule.
- **Loss order:** savings-backed credit is covered by the member's own savings. Unsecured credit is covered by the yield pool first (first loss, via `absorbLoss`), then the AssurancePool. Bondholders, the PayoutPool and other members' savings never cover a loss. RTD is unchanged (AssurancePool ÷ unsecured).
- **Payout gap:** when a shop's claim is due and the PayoutPool can't pay it, `PayoutPool.drawForDueClaim` (permissionless) borrows from the yield pool's free cash, then from AssurancePool spare (never its reserve). Repayments pay it back, principal first, then interest. A top-up from operating cash is an **optional** proposal now, not a required one.
- **Charts replaced:** the line charts on Overview (credit gate, payout pool), Reserves (AssurancePool), Yield pool (rate, deposits) and Credit are gone. In their place are sums with centred `×` / `÷` / `+` / `−` / `=`, split bars, a floor meter and plain rows. Port them as built; don't bring the line charts back.
- **Credit:** the top card is now **October**: the headline is the share of this cycle's repayments collected or on autopay, with a bar for collected, on autopay and due, then a sum (owed on 1 Oct + spent − repaid = owed now).
- **Claims in order:** a fourth tier, yield pool deposits. Its bar splits cash from money out on loan.
- **Depositor table:** masked (`M•••4f`) for every viewer.
- **Data:**
  - Add `yield_position` (per depositor, derived from `LendingPool` events).
  - Index `LendingPool` and the PayoutPool loan events: `Borrowed`, `Repaid`, `LossAbsorbed`, `WithdrawalQueued`, `WithdrawalClaimed`, `DrewFromYieldPool`, `DrewFromReserve`, `RepaidYieldPool`, `RepaidReserve`, `InterestPaid`.
  - Read rates from `utilizationBps`, `borrowRatePerCycle`, `supplyRatePerCycle` and `RevolvingIssuer.cycleLength()`. Never compute rates in the client.
- **Seed:** the prototype's yield pool sample data goes into the seed like every other section: 18 depositors, daily balances since 15 Oct, and the 4 Nov loan.

## 5. Process

If anything here conflicts with work you've already merged, list the conflict in the plan doc and ask Kai before reworking it. Phase order is unchanged; the yield pool's live data lands in Phase 5 with the rest of the indexer.
