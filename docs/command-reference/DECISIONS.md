# Decisions taken over the reference

`clear-command-center.html` in this folder is the spec. Where the app departs from it, or where the
way it was built needs explaining, the decision is recorded here so a later reader doesn't undo it.
The answers to the plan's open questions are in [`../command-center-plan.md`](../command-center-plan.md).

Decided 2026-10-22, Phase 1.

## How the prototype became React

- **The markup is generated, not retyped.** `apps/command/scripts/port` turns the prototype's HTML
  template strings into JSX with Babel, so every tag, class, attribute and line of copy comes from
  the prototype itself. `npm run port` regenerates `src/sections` from this file; `npm run port --
  --to DIR` writes elsewhere, to diff a new version of the prototype against the port.
- **Data, functions and start-up are split.** `src/sections/data.tsx` holds every figure and row the
  prototype draws, in the prototype's order. Each section file (`home.tsx`, `growth.tsx`, …) holds
  only that section's functions. `startup.tsx` is the prototype's top-level statements: the event
  listeners, the theme and menu set-up, and the first draw. Phase 3 moves `data.tsx` into the
  database seed.
- **Drawing works the way the prototype's did.** The prototype assigned HTML to a few containers
  (`#main`, `#modalRoot`, `#pfRoot`, `#loginRoot`, the menu and the phone tabs) and listened for
  clicks on `document`. Each container is now a React root and `html(el, jsx)` replaces
  `el.innerHTML = …` (`src/runtime/dom.tsx`). Every draw builds fresh DOM, as innerHTML did, so
  entry animations replay, inputs reset, and anything the prototype changed by hand doesn't survive
  into the next draw.
- **Not typed yet.** The generated files start with `// @ts-nocheck`. The data is positional tuples
  that only make sense once they are real rows, and typing them twice would be waste: Phase 3
  replaces them with typed rows from the API, and each section is typed as it is wired.
- **React escapes text.** The prototype's `esc()` calls are gone; JSX escapes for us. That is also
  why markup is never built as a string anywhere in the port.

## Changes to the prototype's code

None of these change what is drawn. The DOM and pixel checks below prove it.

| Where | The prototype | The port | Why |
|---|---|---|---|
| Merchants map | Adds a `<script>` from unpkg for MapLibre | Imports the `maplibre-gl` npm package when the map first shows | No third-party script hosts under the CSP (Phase 8). |
| `spark()` | Declared twice; the second (Growth's) wins everywhere | Only Growth's is kept | The first was dead code. |
| `gCell(…).replace('class="c-body"', …)`, `miniSpark(…).replace(…)`, `areaKey().replace(/…/)` | Edits finished HTML strings | A parameter: `gCell(…, bodyCls)`, `miniSpark(…, cls)`, `areaKey(bare)` | Markup isn't a string any more. |
| `fund.replace('cell s-5', …)`, `appr.replace('cell s-4 wt', …)` | Edits finished HTML strings | `swapClass(el, from, to)` | Same reason. |
| Modals | `#mt` and `.m-mn` redrawn by setting their innerHTML | The title, body and foot are their own roots | So a flow can redraw one part, as before. |
| The board's side panel | `pane.innerHTML = kcHtml()` | The panel is its own root | Same reason. |
| Sign-in | Copies the top bar's logo with `outerHTML` | The `BrandMark` component | Same mark, drawn once in code. |
| `index.html` | No viewport tag (the prototype ran in a frame) | `width=device-width` | The 390 px phone layout needs it in a real browser. |

## Still the prototype's, on purpose

- **Hash routes** (`#home`, `#members`) and the pane state held in memory, exactly as drawn.
- **Sign-in is the prototype's simulation.** Privy, the server check and real sessions arrive in
  Phase 2.
- **Read-only views and "Preview this view"** still use the prototype's client-side rules, including
  `vScrub`. Phase 2 moves the rules to the server and deletes `vScrub`.
- **Demo data.** Everything on screen is the prototype's figures until Phase 3.

## How it's checked

`apps/command/e2e`, on the installed Chrome:

- `parity.spec.ts`: the canonical DOM of the menu, the phone tabs and the page, for every section and
  every pane tab, against the prototype.
- `signin.spec.ts`: every sign-in state against the prototype.
- `visual.spec.ts`: every section and pane at 1500, 1100 and 390 px in Paper and Ink. The
  prototype's screenshot is the baseline, so the baseline can't drift from the design.
- `crawl.spec.ts` (`npm run test:crawl`, slow): up to three of each kind of button on every page
  and pane, clicked in both, comparing what opens.

**The prototype is compared in standards mode.** The file has no `<!doctype html>`, so opened on its
own a browser renders it in quirks mode, where tables don't inherit `line-height` and every table
row's text sits a pixel lower. Claude's artifact viewer, where the design was drawn and reviewed,
adds the doctype, and so does the app; the checks serve the prototype with one.
