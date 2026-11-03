# Archive

Documents kept for the record, not for reference. **Everything here is dated and out of step with
the repository** — read it as a snapshot of what was believed at the time, not as a description of
what is built. Links inside archived files are not maintained and may not resolve.

| Document | As of | Superseded by |
|---|---|---|
| [`CLEAR_MEMBER_OVERVIEW_2026.md`](./CLEAR_MEMBER_OVERVIEW_2026.md) | March 2026 | The root [`README`](../../README.md) for the system; the app itself for the products |
| [`CLEAR_RECONCILIATION_BASELINE_2026.md`](./CLEAR_RECONCILIATION_BASELINE_2026.md) | March 2026 | [`docs/contracts/clear-contracts-build-plan.md`](../contracts/clear-contracts-build-plan.md) |
| [`clear-merchant-app-reference.html`](./clear-merchant-app-reference.html) | September 2026 | [`docs/merchant-reference/`](../merchant-reference/) |
| [`clear-merchant-auth.html`](./clear-merchant-auth.html) | September 2026 | [`docs/merchant-reference/clear-merchant-sign-in.html`](../merchant-reference/clear-merchant-sign-in.html) |
| [`plans/clear-deployment-plan.md`](./plans/clear-deployment-plan.md) | August 2026 | Carried out. Everything it lists is deployed; the root README's address tables are current |
| [`plans/clear-onboarding-plan.md`](./plans/clear-onboarding-plan.md) | August 2026 | Built. `OnboardingRoute` in `apps/member` is the live flow |
| [`deed-track-frontend/`](./deed-track-frontend/) | 2025 – September 2026 | Nothing yet. User guides, minting, admin operations, XMTP messaging and the Mapbox map for the Deed-track frontend, written against Reown AppKit and screens the rebuild removed |
| [`member-app-internals/`](./member-app-internals/) | September 2026 | [`apps/member/README.md`](../../apps/member/README.md). Data fetching, pricing, portfolio, NFT caching, RPC and Alchemy cost, EIP-5792 — written against the pre-monorepo `app/` paths, multichain aggregation and Reown |

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

Removed outright in November 2026, because they were wrong rather than merely old and git history
keeps them: the pre-rebuild hook and component references, `contract-interfaces.md` (it named
sixteen functions no contract has), `installation.md`, a second copy of the XMTP doc, the root
`DEPLOYMENT_SUMMARY.md`, the BurnerBond-only `deploy/DEPLOYMENT_GUIDE.md` and
`deploy/QUICK_START.md`, and the API's generic `DEPLOYMENT.md` and migration-era `QUICK_TEST.md`.
