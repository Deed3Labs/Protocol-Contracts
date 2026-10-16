# @clear/pay-docs

Pay with Clear's docs for AI (pay spec §7): the `llms.txt` and plain-text pages `useclear.org` serves,
for a shop's coding AI first and its developer second. Private; nothing here is published to npm.

| Path | What |
|---|---|
| `/llms.txt` | As drawn in the spec, plus the MCP page under Optional |
| `/docs/quickstart.md` | No server: a price from the merchant app |
| `/docs/server.md` | With a server: `@useclear/node` |
| `/docs/webhooks.md` | Endpoints, signatures, retries |
| `/docs/api.md` | Generated from `@clear/public-api-contracts` |
| `/docs/mcp.md` | `@useclear/mcp` |

## How they stay right

- Every example is one of the spec's §1 snippets (`src/snippets.ts`), written once.
- `api.md` is rendered from the routes (`ENDPOINTS`) and the JSON Schema of what the latest version
  publishes. No field is described by hand.
- `bun run write` puts the files in `apps/member/public`. `bun test` fails when the committed files differ
  from what renders, so a contract change without `bun run write` fails CI.

## Where they're served

`apps/member/public`, so `app.useclear.org/llms.txt` serves today. `useclear.org` itself is the website's
project, which rewrites `/llms.txt` and `/docs/*.md` here (pay DECISIONS, Hard Stop 1, conflict 3).
