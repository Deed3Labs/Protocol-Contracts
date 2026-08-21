# Clear — deployment & wiring plan

How the app rebuild gets off mock data, starting on Base Sepolia. Companion to
`clear-contracts-build-plan.md`, which says what the contracts do; this says what has to be
deployed, in what order, and which part of the app each step unlocks.

---

## 1. Where things actually stand

**Nothing from the new build is deployed on any network.**

| Network | Deployed |
|---|---|
| `base` | ClaimEscrow, ClearUSD, ESADepositVault, Create2Deployer |
| `base-sepolia` | AccessManager, ClaimEscrow, ClearUSD, ESADepositVault, MembershipRegistry, SavingsIntentFactory, CLRUSDTokenPool + the Deed track |
| `sepolia` | ClearUSD, CLRUSDTokenPool, Create2Deployer |

The `deploy/` pipeline (hardhat-deploy, numbered scripts) covers the Deed track and the savings
side. **Thirteen contracts from the new build have no deploy script at all**: CreditIssuer,
RevolvingIssuer, TermIssuer, CollateralRegistry, LimitCalculator, LendingPool, BondVault,
PayoutPool, MerchantRegistry, NetworkRegistry, Liquidator, ClearUSDUpgradeable, BondValuer.
StableCredit has none either — `08_deploy_AssurancePool.ts` passes it as a zero address with a
TODO. AssurancePool, AssuranceOracle and BurnerBondFactory have scripts that have never been run.

**The app is mocked at two levels, and they need different work.**

1. Every rebuilt page takes its data as a prop defaulting to a `*_IN_USE` placeholder. Wiring those
   to real contexts is pure app work.
2. `CreditContext` is not merely mocked — it models the *superseded* product: "NO interest — a flat
   fee per draw", limit backed by CLRUSD 1:1, purpose lines. The new contracts implement carry per
   cycle and a tiered ceiling. This layer gets replaced, not wired.

**The rebuild's model already matches the contracts**, which is the good news. `clearModel.ts`'s
`Credit.tiers` (savings/asset/income/boost with limit, used, rate) maps onto `RevolvingIssuer` +
`LimitCalculator`; `Cycle` onto the issuer's cycle; `LimitBacking` onto `CollateralRegistry`;
`TermPlans` onto `TermIssuer`. Wiring is mechanical rather than a redesign.

---

## 2. Two blockers, both before any deployment

### 2.1 ~~`StableCredit` and `CreditIssuer` cannot be deployed as they stand~~ — **DONE**

**Resolved.** `contracts/core/ClearCredit.sol` is the deployable ledger, and the fixture deploys it
rather than a harness, so all 597 tests now run against the production artifact.
`StableCreditHarness` is deleted.

**`CreditIssuer` needed no child.** `RevolvingIssuer` and `TermIssuer` already extend it and already
carry public initializers — they are its concrete forms, and a bare one is never deployed. Its
harness stays, to exercise the base class in isolation.

The original finding, for the record:

Neither exposes a public initializer. Both have only `__StableCredit_init` / `__CreditIssuer_init`
under `onlyInitializing`, and the only things that add a public `initialize` are test harnesses in
`contracts/mocks/`. The test fixture deploys `StableCreditHarness`, not `StableCredit`.

Two ways out, and the choice matters:

- **A concrete pair in `contracts/core/`** — e.g. `ClearCredit is StableCredit` and
  `ClearIssuer is CreditIssuer`, each adding `initialize`. Keeps the base contracts extensible,
  which is what `onlyInitializing` was for, and leaves room for the `PartnerIssuer` §2 anticipates.
- **Add `initialize` to the base contracts.** Fewer files; forecloses cleanly extending them later.

Recommend the first. It is also the only one that does not touch contracts with 597 passing tests.

### 2.2 CLRUSD is a migration, not an upgrade

The deployed `ClearUSD` is **not behind a proxy** — confirmed against `.openzeppelin/`, which
tracks four proxies on base-sepolia (AccessManager and MembershipRegistry transparent,
ESADepositVault and ClaimEscrow UUPS) and does not list the token. `ClearUSDUpgradeable` is therefore a new token, and standing it up
means:

1. Deploy `ClearUSDUpgradeable` (UUPS, 6 decimals, Chainlink `BurnMintERC20UUPS`).
2. **Upgrade `ESADepositVault` in place** to the version carrying `setClrusd`, then call it. The
   vault is UUPS behind a proxy that OpenZeppelin already tracks, and `scripts/upgrade_vault.ts` is
   a working precedent for upgrading that exact proxy — so this is a same-address upgrade, not a
   redeployment, and `clearContracts.esaVault` does not change.
   `setClrusd` reverts while any of the old token is outstanding: redeem first, then re-point, so
   holders cannot be stranded against a vault that no longer recognises what they hold.
3. Redeploy or reconfigure `CLRUSDTokenPool` — `15_deploy_CLRUSDTokenPool.ts` binds the pool to the
   `ClearUSD` deployment address, so CCIP breaks silently otherwise.
4. Move supply. Trivial on testnet; **5.88 on Base mainnet**, all the user's own.
5. Update `app/src/lib/clearNetwork.ts`.

**None of this is needed for Phase A.** The encumbrance check that makes savings-backed credit
enforceable lives in `ClearUSDUpgradeable._update`, so the migration buys *credit*, not savings.
Savings and Send run today against the deployed token, the deployed vault and the existing
`/savings` and `/send` routes — which already carry the equity-credit ledger the rebuilt Savings
page reads. `setClrusd` exists only to make the swap possible; nothing calls it until Phase D.

---

## 3. What each page needs

| Page | Needs | Status |
|---|---|---|
| Savings | ESADepositVault, ClearUSD, `/savings` | **Deployed + server route exists** |
| Activity | `/transactions` | **Server route exists** |
| Card | Lithic/Bridge via `/cards`, `/lithic` | **Server routes exist** |
| Send | ClaimEscrow, `/send` | **Deployed + server route exists** |
| Home | credit tiers, cycle, backing, term plans | **Needs the credit core** |
| Earn | bonds, lending pool, patronage | **Needs bonds + pool** |

There is no `credit` route and no `earn`/`bonds` route on the server. Everything else the rebuild
needs already has one.

**So four of six pages can come off mock data before a single new contract is deployed.**

---

## 4. Phases

Each ships and is verified before the next starts.

### Phase A — Wire what needs no chain work — **DONE**

`SavingsRoute`, `ActivityRoute`, `SendRoute` added; `HomeRoute` extended; `CardRoute` was already
live. The standing merge blocker is cleared: no page shows a figure it has not read.

| Page | Real now | Still placeholder |
|---|---|---|
| Home | cash, savings, equity credits, recent activity, deposit numbers | credit tiers, cycle, backing, term plans |
| Savings | balance, equity credits | projection, milestones, assurance, vesting schedule |
| Activity | the rows | cycle spend, categories, inside-the-co-op |
| Send | handle, QR link, contacts, money awaiting claim | partners, kept-in-network, pay-from |
| Card | activation, freeze, last four, variant | transactions, period total, spend limits |

Two conventions worth keeping as the rest lands:

- **Fall back, never blank.** A figure only overrides the placeholder once it has actually been
  read. A zero balance mid-fetch tells a member their money is gone, which is worse than the
  placeholder it replaces.
- **Except where empty is the truth.** Activity rows, contacts and card transactions show empty for
  a new member, because there the placeholder is the lie. The two rules look contradictory and are
  the same rule: never show something false.

Equity credits come from `/api/pay/:wallet/summary`, not a savings endpoint — `savings.ts` is
all POST, and the Pay summary is where the ledger is totalled. Savings-match credits sit in the
same ledger as rent and bill credits, so a second endpoint would be a second place to disagree.

Card is honest about being half-live: its controls are real, but nothing can settle until the
Lithic program has Financial Accounts enabled.

### Phase B — Make the core deployable — **DONE**

`deploy/20_deploy_CreditCore.ts`, idempotent, verified by `test/deploy/CreditCore.deploy.spec.ts`
which runs it against a fresh chain every suite. Two errors it caught that reading would not have:
`TermIssuer` has no exposure source (term plans pledge nothing — the AssurancePool is the other
contract that needs one, since that is the RTD denominator), and `CreditIssuer` initialized its
parents out of linearized order, latent until UUPS made it checked.

**The core is now upgradeable.** Everything built for this system was UUPS; everything inherited
from the fork was not — provenance, not a decision. `StableCredit`, `CreditIssuer` and
`AssurancePool` now carry UUPS, covering `ClearCredit`, `RevolvingIssuer` and `TermIssuer` by
inheritance. Authority sits with the admin each already answers to, which is not a new trust
surface: that address can already appoint operators, and an operator can already move a member's
credit limit. **CLRUSD stays immutable** — it is money with a one-for-one reserve claim, and there
immutability is the guarantee.

*Original scope, for the record:* the concrete pair from §2.1, plus deploy scripts for the credit core:
StableCredit, CreditIssuer, NetworkRegistry, CollateralRegistry, LimitCalculator, RevolvingIssuer,
TermIssuer. The test fixture `test/helpers/phase0-fixture.ts` is already the wiring recipe —
ordering, roles and cross-registration — and should be the script's source rather than reinvented.

*No deployment yet. Ends with `hardhat deploy --network base-sepolia --tags credit` working locally.*

### Phase C — Deploy the credit core to Base Sepolia
Run Phase B's scripts. Then AssurancePool and AssuranceOracle, whose scripts exist but have never
run and currently pass a zero address for StableCredit.

Verify against §5 of the build plan on live state, not just in tests: RTD reads zero when all credit
is savings-backed; a purchase nets to zero; no redemption path reaches the AssurancePool.

*Unlocks nothing in the app on its own — Phase D is what the user sees.*

### Phase D — CLRUSD migration + credit in the app
The §2.2 migration, then the credit half of Home. Needs a decision first: **does the app read credit
from chain directly, or through a new server route?** Every other page goes through the server, and
card authorization needs an off-chain snapshot anyway (build plan §4), so a `/credit` route is the
consistent answer — but it is a real piece of backend work, not just wiring.

*Unlocks: Home in full. Replaces `CreditContext`.*

### Phase E — Bonds and the pool
BurnerBondFactory (script exists, never run), BondVault, BondValuer, LendingPool, PayoutPool,
MerchantRegistry, Liquidator. Register bonds and pool shares in CollateralRegistry so the
asset-backed tier lights up — this is build-plan Phase 4, and `BondCollateral.spec.ts` already
covers the behaviour.

*Unlocks: Earn. Also the asset-backed tier on Home.*

### Phase F — Merge and PR
Merge `feat/clear-permissions` into `feat/clear-app-rebuild`, wire the onboarding grant into
`OnboardingFlow`'s real container, then PR the rebuild to `dev`.

**Merge the permissions branch earlier than this.** It is small, additive, and already reviewed;
holding it until the end just accumulates drift against a branch that is moving underneath it. The
only part that must wait for a deployment is the grant *call site*, and that waits on
`OnboardingFlow`'s container regardless.

---

## 5. Open decisions

1. ~~Concrete subclass or initializer on the base contracts (§2.1).~~ **Decided: subclass, done.**
2. ~~Credit via server route or direct chain reads (Phase D).~~ **Decided: server route.** Not merely
   for consistency — two of the four tiers (income, Boost) exist *only* off-chain as attestations,
   so a direct chain read returns a credit line missing half its tiers. One snapshot, two readers:
   the app's `/credit` route and the Lithic ASA. This makes Phase D a service, not an endpoint, and
   the largest single piece of remaining work.
3. **Mainnet CLRUSD migration timing.** Cheap now at 5.88 supply, and it only gets dearer.
4. **Whether Phase A waits.** It has no dependency on any of this and removes a merge blocker, so it
   can run in parallel with B/C.
