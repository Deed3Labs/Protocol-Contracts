# Setting up

Everything needed to run any part of this repository on your own machine, and to get a change
merged.

## Tools

| | Version | Why |
|---|---|---|
| Node | **22** | What CI and Vercel run. `package.json` allows ≥ 20.19, but the member build fails under 20.11 |
| npm | 10 | The workspaces and `package-lock.json` |
| Bun | **1.3.6** in CI | The API runs on it, and every app's unit tests run under `bun test` |
| Docker | optional | Local Redis for the API |

## Install

The root `package.json` is two things at once: the Hardhat toolchain for `contracts/`, and an npm
workspace over `apps/member`, `apps/merchant`, `apps/rewards`, `apps/pay`, `apps/command` and
`packages/*`. One install covers both.

```bash
npm install
```

**`apps/api` is not part of the workspace.** It installs on its own, with Bun, and links the
packages it needs with `file:`:

```bash
cd apps/api && bun install
```

It carries a `package-lock.json` from before it moved to Bun; `bun.lock` is the one that counts.

## Environment

Each surface reads its own file. None is committed; copy the example beside it.

| Surface | Copy | Then set at least |
|---|---|---|
| Contracts (Hardhat) | `.env.example` → `.env` | `DEPLOYER_PRIVATE_KEY`, `ALCHEMY_API_KEY`; `ETHERSCAN_API_KEY` to verify |
| API | `apps/api/env.example` → `apps/api/.env` | `DATABASE_URL`, `REDIS_URL`, then the providers you are working on |
| Member | `apps/member/.env.local.example` → `apps/member/.env.local` | `VITE_PRIVY_APP_ID` (required), `VITE_API_BASE_URL` |
| Merchant | `apps/merchant/.env.example` → `.env` | `VITE_PRIVY_APP_ID`, `VITE_API_BASE_URL` |
| Pay | `apps/pay/.env.example` → `.env` | `VITE_API_BASE_URL` |
| Command | `apps/command/.env.example` → `.env` | `VITE_PRIVY_APP_ID`, `VITE_API_BASE_URL` |
| Rewards | none | `VITE_API_BASE_URL` if the API is not on `localhost:3001` |

The member app's `.env.example` files still list Reown-era variables (`VITE_APPKIT_PROJECT_ID`) and
leave out ones the app now needs; the env table in [`apps/member/README.md`](../../apps/member/README.md)
is the reference.

**Anything prefixed `VITE_` ends up in the browser bundle.** Never give a secret that prefix. The
member build scans its bundle for secrets and fails if it finds one (`npm run scan:secrets`).

The API boots without Postgres or Redis, with a warning, but routes backed by the member store
return `503` until `DATABASE_URL` is set. For Redis locally:

```bash
docker compose -f apps/api/docker-compose.yml up -d redis
```

## Running

| | Command | Port |
|---|---|---|
| Member | `npm run dev --workspace @clear/member` | 5173 |
| Merchant | `npm run dev --workspace @clear/merchant` | 5174 |
| Rewards | `npm run dev --workspace @clear/rewards` | 5190 |
| Pay | `npm run dev --workspace @clear/pay` | 5195 |
| Command | `npm run dev --workspace @clear/command` | 5230 |
| API | `cd apps/api && bun run dev` | 3001 |

The apps call the API at `VITE_API_BASE_URL`, `http://localhost:3001` by default.

Signing in needs Privy, a backend and real accounts. To look at screens without any of that, the
member, merchant, rewards, pay and command apps each serve a preview harness at `?preview=1` — for
example `http://localhost:5173/?preview=1` — with placeholder data. See each app's README.

## Contracts

```bash
npm run compile
npm run test              # every Hardhat suite
npm run test:core         # test/core only
npm run test:coverage
npm run test:gas
```

Deploying is in [Operators](../operators/deploying-contracts.md).

## Before you push

```bash
npx turbo run typecheck test --affected
```

`--affected` compares with `dev`. It can pass from turbo's cache when a clean run would fail, so for
an app you changed, check it directly too:

| You changed | Also run |
|---|---|
| `apps/member` | `npm run build` in `apps/member` — `tsc -b`, then the Vite build and the secrets scan. `tsc --noEmit -p .` misses errors `tsc -b` catches |
| `apps/merchant` | `npm run typecheck` in `apps/merchant` |
| `apps/api` | `bun test src` in `apps/api`, **and** the member tests: some of them read API source as text and assert on it |
| `contracts/` | `npm run test` |

**CI does not run the API's own suite.** `apps/api` is outside the workspace, so turbo cannot see it;
CI only reruns the member tests when it changes. Run `bun test src` yourself.

End-to-end suites are Playwright, run by hand: `npm run test:e2e` in `apps/merchant`, and the specs
in `apps/command/e2e`.

## Getting a change merged

- **Branches.** `main` is production; `dev` is where work lands, and what `demo.useclear.org` and
  `merchant.useclear.org` follow. Work on a short-lived branch and open a pull request into `dev`. Delete the branch once it
  is merged.
- **The `ci` check** is what blocks a merge. It runs the affected apps' typecheck and tests, the
  Hardhat suite when contracts change, and a check that every relative link in the docs resolves
  (`node scripts/check-doc-links.mjs`). Lint runs but does not block yet.
- **Preview builds cost money.** A branch gets Vercel previews only once it has a pull request, and
  only for the apps it touches. Push at the end of a piece of work rather than after every commit,
  and put `[skip preview]` in the message of a push that only touches docs. Details in
  [`CLAUDE.md`](../../CLAUDE.md).
- **Docs move with the code.** If you change an interface or a workflow, change its page in the same
  pull request.
