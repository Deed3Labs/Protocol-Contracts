# Command Center: brief update 2

The design moved a long way since the reference in the repo was last replaced (3 Nov, #854). This note covers what changed and how to bring `apps/command` up to it. The attached `clear-command-center.html` replaces `docs/command-reference/clear-command-center.html` and is still the spec. Where this note and the file disagree, the file wins on looks and this note wins on data and wiring.

## 0. Ground rules

- **This repository is public.** The Legal tab is built from the private `Deed3Labs/clear-agreements` repo. In the attached reference its rows are placeholders ("Sample agreement F-01", "Sample question for counsel…"). Keep it that way everywhere in this repo: no real agreement titles, counsel questions, research memo titles or PR titles in `data.tsx`, the fixtures, the seed, tests, screenshots or the built bundle. The live rows come from the API at request time (section 3).
- **Don't regenerate the sections.** They're hand-edited. Run `npm run port -- --to /tmp/port` against the old and the new reference, diff the two outputs, and carry the differences into `src/sections` by hand.
- **Keep the live wiring.** Where a section already reads the API (`L ? live : demo`, `notReal(...)`), keep that path and change the markup around it. Several cards in this update already exist in the app from #902 and a2f76e0. Change those to match the new layout, but keep their data sources.
- **Contract state comes from the records,** not from figures typed into the app. The day-0 records are on `claude/new-session-e5u3cp` (commit 00d8a17) and aren't merged into `dev` yet. Ask Kai before merging that branch. Don't copy addresses out of the reference.
- Re-record the visual baselines from the new reference at 1500, 1100 and 390 px, in Paper and Ink. `npm run test`, `npm run typecheck`, `npx playwright test empty` and the crawl must pass. Record every departure from the reference in `DECISIONS.md`.

## 1. New tabs

| Page | Tab | Status in the app |
|---|---|---|
| Governance | **Legal** | Missing. Add between Agreements and Calendar (see 3). |
| Build | **Signing** | Missing. Add between Contracts and Deploys (see 6). |

## 2. Governance → Entities

- The I-06 lender is now **Clear Building Co.** In the agreements it is called "Building Co."; earlier names were "Lending Sub" and "Lending Subsidiary". It is owned by Holdings, sits on the Manager's row to its **left**, and lends to the co-op for housing only after the Founding Period.
- Clear Capital Management sits under Holdings. The stem from Holdings is short, so the line down to the Manager is long. Clear Properties Co. and Clear Lending Co. hang under the Manager, and their boxes say "Holdings · 100%" because Holdings owns them and the Manager runs them (`MANAGED`).
- Lines are drawn **once per parent**: a stem, a bus, and one drop per child (`busY`). Before this, a line was drawn once per child, so shared segments were overdrawn and looked thicker and brighter. Ownership labels are centred on the drops.
- Positions are in `ENTXY`, and the map is `height:680px`. The Home mini-tree follows the same layout.

## 3. Governance → Legal (new tab)

What it shows (`renderLegal`, `legalPanel`, the `.lg-*` styles):

- **Agreements register.**
  - On the left is a family list. Each family shows one meta line: "N agreements · N open · N S1".
  - On the right are that family's agreements. Titles can wrap to two lines, and the ID is aligned to the first line. A status is shown only when it isn't the usual final draft (Dropped, Working checklist).
  - Above the rows, the family header says "each a final draft with counsel unless marked".
  - The filter has three options: All, Open questions and Redesign-level.
  - Clicking a row opens the side panel with family, status, file, counsel's question counts, gates and signing order, plus the S1 questions for that agreement.
- **Counsel review.** A headline open count, then one stacked bar: open, answered with counsel to confirm, answered, decided and applied, and resolved. Below that, open questions by gate (G0–G5), split S1/S2/S3.
- **Who needs to answer.** Open questions by specialty.
- **Questions that could force a redesign.** The open S1 questions, each with its gate and specialty.
- **Signing order** (the Formation steps), **Research memos**, and **In the repo** (specs plus the six most recent pull requests).
- The hero line reads: "N agreements are final drafts with counsel. N of counsel's N questions are open, and N could force a redesign."

Live source. This is a new API section, `GET /sections/legal`:

- It reads `Deed3Labs/clear-agreements` with its **own** read-only token, `COMMAND_AGREEMENTS_TOKEN` (Contents: read on that repo only). Set `COMMAND_AGREEMENTS_REPO`, defaulting to `Deed3Labs/clear-agreements`.
- The register comes from the README. Counsel's counts and the S1 questions come from `docs/counsel-packet/part-*.md` and each agreement's counsel-notes file. Research memos come from `docs/research/`, and recent changes from the merged PRs.
- Cache it like the GitHub feed (5c). It is Admin only. Every other role sees the tab's totals but no titles or questions.
- The demo and the seed use the placeholder rows from the reference. Add a test that fails if a title from the real register shows up in `src/` or the fixtures.

## 4. Governance → Agreements

- "Every agreement" gets a header row (Agreement, Version, Signed, Status). Each row is aligned to its first line.
- The versions timeline:
  - The name column is 250px, and names wrap.
  - The Today label sits on the months row.
  - Any month label within 5% of Today is hidden.
  - Dot labels have a ground behind them.
  - The label now reads "Both companies sign".
- In "Waiting on someone", rows have a fixed minimum height of 70px, and a hatched filler takes up the leftover space.

## 5. Money

**Pools → Yield pool**

- **The loop diagram** (`.ny-dg`): Holders → Yield pool → Clear Lending ("Borrowed · owed back") → Members, with a loss line underneath.
- **"The pool, now and over the next 30 days"** (`yieldProjection()`, `.yc-*`). The chart shows:
  - cash as solid green;
  - money lent to Clear Lending as a green hatch, with the hatch stopping around each label;
  - the scheduled Returns and the Deployment along the next 30 days.
  
  The labels stay on the chart, not in the footer, and the top labels align on one line.
- **The rate is the deployed model.** The current app comment ("the LendingPool's curve, which no contract charges") is **out of date**: since E2b on 17 Nov the LendingPool is the Yield Pool, and its `YieldPoolLedger` accrues the Funding Rate on what Clear Lending has borrowed.
  - The formula is Funding Rate = R₀ 2% + S₁ 3% × U/80% up to the kink, then + S₂ 5% × (U − 80%)/20%. The maximum is 10%.
  - Holders earn about Funding Rate × Utilization, before losses.
  - At 50% utilization that is 1.94%, at 80% it is 4.00%, at 90% 6.75%, and at 100% 10%.
  - The bars show 50%, now, 2 Nov, 80%, 90% and 100% on one 0–10% track (`.yr-t`), and the footer says 10% is the ceiling, reached only if every dollar is lent out.
  - Live, read `fundingRate()`, `fundingRateAt(u)` and `utilization()`, and the model from `RateModelProposed`/applied events (all WAD, annual). Don't compute rates in the client.
  - A pending rate change shows with its effective date. A non-lowering change waits 48h; a lowering one needs 30 days' notice.
- **"Where member payments go"** (`memberPayments()`, `CARRY`, `MFEE`). This covers one month: the carry members pay by product, plus the 2.5% merchant fee. Then comes the "Then the Spread" strip, which follows L-01 §9.2:
  1. Bills and reserves first.
  2. Kept as capital.
  3. Or paid to Holdings, only if the §12.2 tests pass.
  4. Split by shares, with Class A and Class B alike.

  Live, take these figures from the credit book and the rate schedule. The demo shows demo balances.

**The loss ladder ("If a member stops paying")**

- It is now one component, `lossLayers()`, `lossLadder({compact})` and `lossVerdict()`, used in two places:
  - **Overview** uses the compact version: rows stacked, with one overlay line for the worst case.
  - **Pools** uses the full version. Each layer's used portion is filled (`.lw-used`), and the worst-case line runs the full height (`.lw-wc`). There is no floating "worst case stops here" text.
- "Never takes a loss" is its own row, not part of the ladder. Its heading shows the name, the total and "Outside the order".

**Pools → Payout pool and Assurance**

- **Automatic top-ups** and **The top-up wallet** cards. The top-ups card exists in the app (`payoutTopUps.tsx`); change it to the new layout and add the wallet card.
- **Assurance fees.** It is paid from the Credit Backstop through the CL Fees wallet, with the stages Due, Funding proposed, Funded and Paid (`AF_ST`). It exists in the app; change it to the new layout.
- **Repayments and interchange** ("Into the pool") is new.
- Copy: payout top-ups draw on **borrowed funding-base money** that sits in CL Operating, not on Clear Lending's own capital.

**Cash → Where it sits**

- The accounts are grouped, with heading rows (`.nh-g`).
  - New entries: Member cash and the Clear Treasury Safe.
  - A new "Clear Lending's" group holds CL Operating, the **Credit Settlement Account** (I-02 §4.9; it funds members' card swipes through Lithic), the CL Loss Reserve and the CL Fees wallet.
- Each bar segment's width is its exact share of the total.
- The list header labels are vertically centred.

## 6. Build

- **Signing (new tab).** This is the real day-0 plan: 51 steps, 48 done.
  - Three steps wait for day 7, Tue 24 Nov: the Earn batch E8x at 10:36 PT, the vault batch I3x at 13:00 PT, and the Assurance batch ASx at 10:56 PT.
  - Stages (`SG_STAGES`) include TU for payout top-ups.
  - Live, read the plan that `scripts/signing_plan.ts` produces (`clear-signing-plan/1`) and the run logs in `deployments/base-sepolia/run-log/`.
  - `tools/signing-page` already reads that format, so reuse its parsing.
- **Contracts.**
  - 37 of the 41 contracts on the map are live. **OffersIssuer was redeployed on 17 Nov**, but its record isn't pushed yet. When `deployments/base-sepolia/OffersIssuer.json` lands, read the address from it. The old one is `OffersIssuerPreAudit`.
  - AssurancePool v2 is shipped, and finding F1 is fixed.
  - The TokenRegistry address is `0x4B13…8a86`.
  - There are two new cards under the map:
    - **Timelocks and helpers.** CreditTimelock, AssuranceTimelock, VaultTimelock and EarnTimelock, plus BurnerBondFactory, BurnerBondDeposit and Create2Deployer, each with what it does, who runs it and its address.
    - **Retired.** The old OffersIssuer, AssurancePool v1, ClearUSD v1 and AssuranceOracle, plus a count of the earlier copies (PreAudit, Pre2f, Pre2d, Legacy).
  - Build both cards from the `deployments/base-sepolia` records by name, not from a hand list.
- **Security → automatic jobs** (`AUTO`, `.bd-aj-*`).
  - It lists payout top-ups, the Assurance fee payer and the keeper. All three show **"Not on yet"** until their env is set on day 7.
  - Read their state from the jobs' own status endpoints, as the top-ups card does.
  - Protocol rules gain `p-topup`, `p-cef` and `p-ix`.
- **Overview and the Home tile** read "37 of 41". Compute it from the records.

## 7. Elsewhere

- Copy fixes across Money: the CL Operating funding note, the loss line, and the rate footer. Take the wording from the reference.
- There is a global polish pass covering header and footer guards, `.m-big small` line-height, the `.nrw-e` end label, `sn-fl` nowrap and `.sn-tr` widths. The diff will show it; carry it over.

## 8. Order

1. Replace the reference and run the port diff. Write the list of differences into `docs/command-center-plan.md`.
2. Governance: Entities, Agreements, then Legal (UI with placeholders first, then the API section).
3. Money: Yield pool, then the loss ladder, Payout pool and Assurance, then Cash.
4. Build: Contracts, then Signing, then Security.
5. Baselines, checks, `DECISIONS.md`, then one PR per page group into `dev`.

If any of this conflicts with work already merged, list the conflict in the plan doc and ask Kai before reworking it.
