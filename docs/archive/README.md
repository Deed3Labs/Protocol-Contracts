# Archive

Documents kept for the record, not for reference. **Everything here is dated and out of step with
the repository** — read it as a snapshot of what was believed at the time, not as a description of
what is built.

| Document | As of | Superseded by |
|---|---|---|
| [`CLEAR_MEMBER_OVERVIEW_2026.md`](./CLEAR_MEMBER_OVERVIEW_2026.md) | March 2026 | The root [`README`](../../README.md) for the system; the app itself for the products |
| [`CLEAR_RECONCILIATION_BASELINE_2026.md`](./CLEAR_RECONCILIATION_BASELINE_2026.md) | March 2026 | [`docs/contracts/clear-contracts-build-plan.md`](../contracts/clear-contracts-build-plan.md) and [`clear-deployment-plan.md`](../contracts/clear-deployment-plan.md) |
| [`clear-merchant-app-reference.html`](./clear-merchant-app-reference.html) | September 2026 | [`docs/merchant-reference/`](../merchant-reference/) |
| [`clear-merchant-auth.html`](./clear-merchant-auth.html) | September 2026 | [`docs/merchant-reference/clear-merchant-sign-in.html`](../merchant-reference/clear-merchant-sign-in.html) |

The first two predate the monorepo restructure, the credit stack going to Base Sepolia, the Privy migration,
Lithic card issuing and the merchant app. Their contract inventories are short by roughly a dozen
contracts that are now deployed.

The two merchant HTML files are the first merchant app's design, replaced by the per-screen
reference set. Code comments in `apps/api` that cite "reference section NN" (enrolling a tablet is
section 19, for example) mean the numbered sections of `clear-merchant-app-reference.html`; the
decisions they record still stand.

Two investor-facing documents that sat beside these — an investor dossier and an LP/VC memo, both
dated March 2026 — were removed from the repository rather than archived. They described the
contract inventory as "repository-verified" while being six months behind it, which is a claim that
should not sit in a public repository at any staleness. They remain in the project's own records.
