# The Command Center's live switches

What decides, in code, whether each Command Center section shows sample rows or real data, and the
jobs that fetch the real data. **The switches are the API's environment variables, not controls in
the app**, and changing them on a deployment is governed:
[The Command Center → Going live](../governance/command-center.md#going-live). Running and deploying
the app itself is in [`apps/command/README.md`](../../apps/command/README.md).

## Three layers

**1. The app never draws sample data.** At start-up the app empties every dataset it was designed
with, then fills in what the API sends; what the API does not send stays empty, and the page says
so ([`live/empty.ts`](../../apps/command/src/live/empty.ts)). Only a development build opened with
`?preview=1` shows the design's own rows. What the app keeps is not data: labels, layout, and the
co-op's structure as the API writes it.

**2. The API's tables are seeded only when asked.** `COMMAND_SEED=on` fills the Command Center's
empty tables at start-up with the sample rows in
[`packages/command-types/src/fixtures`](../../packages/command-types/src/fixtures/). It fills a
table only when it is empty and a figure only when it is missing, so it never overwrites what a live
job wrote. Any other value, or none, seeds nothing. The structure (the contracts map, the entities,
the boards' seats) is written into empty tables either way, and the audit log is never seeded.

**3. Each section reads `seed` or `live`.** `PROVIDER_<SECTION>=live` switches one section to its
live sources; anything else, or nothing, leaves it on `seed`
([`sections.ts`](../../apps/api/src/services/command/sections.ts)). On `seed` a section reads the
Command Center's own tables, seeded or empty, as of the sample data's fixed day. On `live` it reads
its live sources as of today.

## What each switch changes

| Variable | `live` reads |
|---|---|
| `PROVIDER_MONEY` | The chain: the LendingPool, the savings vault's reserve, the AssurancePool's reserves, what the PayoutPool owes shops, the credit book, open bonds, BondVault, the Ops Safe's USDC and the `OffersIssuer` line. The feeds: the bank and payouts from Plaid and Stripe, card spend from Lithic, deposits moving through Bridge |
| `PROVIDER_CONTRACTS` | Each contract's address, version and releases from the indexer; the code changes and the Code tab from GitHub |
| `PROVIDER_SHOP` | The site's catalog; orders, hardware reservations and refunds from the shop's Stripe Checkout; the sales tax and deposits set aside, worked out from those |
| `PROVIDER_MEMBERS` | The member app's accounts, each one's invite code, first deposit and first spend; the waitlist from the join form |
| `PROVIDER_MERCHANTS` | The merchant app's shops, their Clear charges and their Points; enquiries from the join form |
| `PROVIDER_GROWTH` | Site and app visits from Umami; only forms received live |
| `PROVIDER_FIELD`, `PROVIDER_GOVERNANCE`, `PROVIDER_RECORDS`, `PROVIDER_HOME` | No live source of their own. They read the Command Center's tables either way; `live` changes only the day they are read for, to today |

Other sections follow these switches:

- **Home** counts members from the member app when Members is live, and shows Growth's live visits.
- **Governance** counts members' acceptances of the app's documents when Members is live.
- **Money and Contracts read Base Sepolia only.** It is the only address book in
  [`packages/command-types/src/chain`](../../packages/command-types/src/chain/).

### What actions do

Some actions behave differently on each side:

| Action | On `seed` | On `live` |
|---|---|---|
| Sending an invite batch (Members) | Recorded to the outbox | Takes the people from the waitlist and queues their invite emails |
| A catalog change (Shop) | Queued in the outbox for the site | Made in the Command Center's catalog, which the site reads; a price change to a product on sale is one the store will charge |
| Any action's time | The sample data's day | Now |

Which actions need a second person is in
[The Command Center → The two-person rule](../governance/command-center.md#the-two-person-rule).

## The jobs behind the live sources

The API runs these after its migrations. Each can be turned off, and each says at start-up whether
it is off and why.

| Job | Off with | Reads |
|---|---|---|
| Feeds | `COMMAND_FEEDS=off` | The feeds below, each on its own schedule |
| Indexer | `COMMAND_INDEXER=off` | Every deployed contract's events, every `COMMAND_INDEXER_MINUTES` (5) and on demand. History beyond the last 20,000 blocks comes from Etherscan V2 when `ETHERSCAN_API_KEY` or `COMMAND_HISTORY_API_KEY` is set, else Blockscout; `COMMAND_HISTORY_API=off` skips it |
| GitHub | `COMMAND_GITHUB=off` | Commits and pull requests of `COMMAND_GITHUB_REPO` on `COMMAND_GITHUB_BRANCHES`; `GITHUB_TOKEN` raises GitHub's rate limit |
| Invites | `COMMAND_INVITES=off` | Sends the queued invite emails through Resend, retrying a failed one |
| Geocoder | `COMMAND_GEOCODE=off` | Shops' street addresses, for the Merchants map |

### The feeds

| Feed | Every | Needs | Off when |
|---|---|---|---|
| `plaid` | Day (`COMMAND_PLAID_HOURS`), and when Plaid's webhook or a Stripe payout wakes it | `PLAID_CLIENT_ID`, `PLAID_SECRET`, the token envelope key | `PLAID_ENV` is not `sandbox` |
| `bridge` | 5 min (`COMMAND_FEEDS_MINUTES`) | `BRIDGE_SANDBOX_API_KEY` | `BRIDGE_ENV` is not `sandbox` |
| `lithic` | 5 min | `LITHIC_API_KEY` | `LITHIC_ENV` is not `sandbox` |
| `stripe` | 5 min | `COMMAND_STRIPE_KEY`, else `STRIPE_SECRET_KEY` | The key is not a test key |
| `shop` | 5 min | `COMMAND_SHOP_STRIPE_KEY`, else `SHOP_STRIPE_SECRET_KEY` | Neither is set. A live or a test key is accepted |
| `catalog` | 5 min | `COMMAND_SHOP_CATALOG_URL` (the site's catalog unless set); `COMMAND_CATALOG_TOKEN` to include drafts | The URL is `off` |
| `site`, `apps` | 15 min (`COMMAND_SITE_MINUTES`) | `UMAMI_API_URL`, `UMAMI_USERNAME`, `UMAMI_PASSWORD`, and the site's or apps' website ids | Any of them is not set |

**The money feeds read sandboxes only.** Plaid, Bridge, Lithic and Stripe each call their
provider's sandbox or test mode, and each turns itself off when given a live key
([`feedSources.ts`](../../apps/api/src/services/command/feedSources.ts)). With `PROVIDER_MONEY=live`
on a deployment holding live keys, the chain's figures are live and the bank, card, deposit and
payout figures stay empty: the code has no production path for them yet. Only the shop's feed takes
a live key.

**The Plaid feed makes its own bank link**, once, with Plaid's sandbox-only call: a sandbox
institution (`COMMAND_PLAID_INSTITUTION`) and a starting balance (`COMMAND_PLAID_SANDBOX_BALANCE`).
It registers `COMMAND_PLAID_WEBHOOK_URL` as the link's webhook, which should be the API's
`/api/command/webhooks/plaid`; that route checks Plaid's signature
([Going live → Webhooks](./going-live.md#webhooks)).

**The Ops Safe** is set by `COMMAND_SAFE_ADDRESS`, `COMMAND_SAFE_CHAIN_ID`, `SAFE_TX_SERVICE_URL`
and `SAFE_API_KEY`. Without an address, Build says no Safe is connected and nothing can be prepared
for signing.

## Seeing which are on

`GET /api/command/feeds` (Home at Totals or above) returns each feed's health: `synced`, `behind`,
`failing` with its error, `off` with the reason, or `never` run. The menu's foot draws it and
reads it again every 5 minutes. No endpoint reports a section's `PROVIDER_` value; it is whatever
the API's environment says.

Because they are environment variables, a change takes effect when the API restarts with it.
