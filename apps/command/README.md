# Clear Command Center

The co-op's internal app, the members' read-only view and the investors' data room, at
`command.useclear.org`. The design is [`docs/command-reference/clear-command-center.html`](../../docs/command-reference/clear-command-center.html);
the plan is [`docs/command-center-plan.md`](../../docs/command-center-plan.md); where the build departs
from the design is [`docs/command-reference/DECISIONS.md`](../../docs/command-reference/DECISIONS.md).

Phase 1 (this state): the whole prototype as a React app, on the prototype's demo data, with its
simulated sign-in. Auth, permissions and the API come in Phase 2.

## Run it

Node 22 (`PATH=/usr/local/bin:$PATH` on Kai's Mac).

```bash
npm install --workspace=@clear/command
```

```bash
npm run dev --workspace=@clear/command
```

It serves on http://localhost:5230. `#login` opens the sign-in page; `#members`, `#merchants` and so
on open a section.

## Where things are

- `src/App.tsx`: the shell's fixed parts (top bar, menu footer, empty containers).
- `src/runtime/dom.tsx`: how the sections draw into those containers.
- `src/sections/`: generated from the prototype. `data.tsx` is every figure, each section file is
  that section's functions, `startup.tsx` wires the events and draws the first page.
- `src/styles/command.css`: the prototype's stylesheet, unchanged.
- `scripts/port/`: the generator. `npm run port` rebuilds `src/sections` from the prototype. Once a
  section has been edited by hand (Phase 2 on), use `npm run port -- --to /tmp/port` and diff
  instead of regenerating over it.

## Checks

```bash
npm run test --workspace=@clear/command
```

```bash
npm run test:visual --workspace=@clear/command
```

```bash
npm run test:crawl --workspace=@clear/command
```

`test` is the unit tests. `test:visual` runs the DOM, sign-in and pixel checks against the prototype
at 1500, 1100 and 390 px in Paper and Ink; it starts its own servers on 5231 (the app) and 5233 (the
prototype). `test:crawl` clicks every button on every page in both and compares what opens; it takes
a few minutes.

## Live and preview (Phase 2)

- `http://localhost:5230/` is the live app: Privy sign-in against the API in `VITE_API_BASE_URL`.
- `http://localhost:5230/?preview=1` is the prototype's simulated sign-in and demo team. The checks
  above run on it.

`apps/command/.env.local` (copy `.env.example`):

| Variable | What |
|---|---|
| `VITE_PRIVY_APP_ID` | The Clear app's Privy app, the same one `apps/member` uses |
| `VITE_API_BASE_URL` | The API: `http://localhost:3001`, or the dev API on Railway |

The API (`apps/api`, Railway) needs:

| Variable | What |
|---|---|
| `COMMAND_ADMIN_EMAILS` | Comma-separated. Each becomes Admin on first sign-in. |
| `COMMAND_APP_URL` | Where invite links point. Default `https://command.useclear.org`. |
| `CORS_ORIGIN` | Must include the Command Center's origin. |
| `RESEND_API_KEY`, `RESEND_FROM` | Invites go by email (already set for receipts). |

Privy's dashboard needs the Command Center's origins (`http://localhost:5230`, its Vercel previews,
`https://command.useclear.org`) under allowed origins, or Privy refuses to load.
