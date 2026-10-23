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
