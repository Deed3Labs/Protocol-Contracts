import { CLEAR_VERSIONS, EVENT_TYPES, LATEST_VERSION, SIGNATURE_TOLERANCE_SECONDS } from '@clear/public-api-contracts';
import { EXAMPLE_PUBLISHABLE_KEY, NO_SERVER_SNIPPET, SERVER_SNIPPET, SHOP_CAN_SET, WEBHOOK_SNIPPET } from './snippets';

/**
 * The plain-text docs (pay spec §7), for a shop's AI first and its developer second: short, exact, and
 * every example one of the spec's snippets. `api.md` is generated separately, from the contracts.
 */

export const DOCS_BASE = 'https://useclear.org';
const fence = (lang: string, code: string) => `\`\`\`${lang}\n${code}\n\`\`\``;

/** As drawn (§7), with the MCP page added under Optional. */
export const llmsTxt = () => `# Clear
> Pay with Clear: online payments from Clear members (pay now or
> over time), with card on the shop's own Stripe as the fallback.

## Docs
- [Quickstart: no server](${DOCS_BASE}/docs/quickstart.md)
- [Quickstart: with a server](${DOCS_BASE}/docs/server.md)
- [Webhooks](${DOCS_BASE}/docs/webhooks.md)
- [API reference](${DOCS_BASE}/docs/api.md)

## Optional
- [MCP server: let an agent create links, look up payments and ask for refunds](${DOCS_BASE}/docs/mcp.md)
`;

const RULES = `## Rules that keep a shop safe

- Attach to the shop's existing checkout button. Don't add a button; the script never draws one.
- The amount never comes from the browser. It's a price made in the merchant app, or a payment the
  shop's server makes with its secret key.
- Fulfil orders from the \`payment.succeeded\` webhook, not from \`onSuccess\`. \`onSuccess\` runs in the
  customer's browser, where anyone can call it.
- The secret key (\`clear_sk_…\`) lives in the server's environment as \`CLEAR_SECRET_KEY\`. Never in a web
  page, a repository or a log. The publishable key (\`clear_pk_…\`) is safe in a page.`;

const TEST_MODE = `## Test mode

Test keys (\`clear_pk_test_…\`, \`clear_sk_test_…\`) never move money, and test and live never mix: a test
key can't see a live payment, nor the reverse.

- The test member: phone **(555) 010-0100**, code **000000**. Always approves.
- Test card: Stripe's **4242 4242 4242 4242**, any future date, any CVC (where the shop's card processor
  is in test mode).
- \`http://localhost\` can be an allowed website for a test key.`;

export const quickstartMd = () => `# Pay with Clear: quickstart, no server

Turn the shop's own checkout button into Pay with Clear: a click opens Clear's modal over the page.
Members pay now or over time; anyone can pay by card on the shop's own Stripe.

## 1. In the merchant app

- **Settings › Developers**: copy the publishable key (\`clear_pk_live_…\`), and add the website under
  **Allowed websites**. The modal only opens on those sites, so a copied key is useless anywhere else.
- **A price**: make one for what's sold (\`price_…\`). Its amount is set there, never in the page.

## 2. On the page

${fence('html', NO_SERVER_SNIPPET)}

${SHOP_CAN_SET}

\`attach\` takes a CSS selector, an element, or a list of elements, and works for elements added later.
It returns \`{ detach(), open() }\`.

## 3. What the page hears

- \`onSuccess({ id, status, reference })\`: paid (\`status\` is \`succeeded\`, or \`processing\` while it
  settles). That is all the page ever gets; nothing typed in the modal reaches it.
- \`onCancel()\`: closed without paying.
- \`onError({ code, message })\`: for example \`origin_not_allowed\` (the site isn't on the list),
  \`price_not_found\`, \`price_inactive\`, \`session_expired\`, \`unavailable\` (offer the shop's other ways
  to pay), \`network_error\`.

## 4. Fulfil

With no server, the sale shows in the merchant app's Charges, marked Online. To fulfil automatically,
add a webhook endpoint (${DOCS_BASE}/docs/webhooks.md) and act on \`payment.succeeded\`.

## Content-Security-Policy

If the site has one, it needs \`script-src https://js.useclear.org\`, \`connect-src https://api.useclear.org\`
and \`frame-src https://pay.useclear.org\`.

${TEST_MODE}

${RULES}
`;

export const serverMd = () => `# Pay with Clear: quickstart, with a server

The shop's server makes the payment for the amount it worked out, and hands the page the payment's
\`clientSecret\`. The amount stays on the server.

## 1. Install

${fence('sh', 'npm install @useclear/node')}

Put the secret key from **Settings › Developers** in the server's environment as \`CLEAR_SECRET_KEY\`.

## 2. Make the payment, then attach

${fence('js', SERVER_SNIPPET)}

- Amounts are integer cents, tax included. Whatever \`amount\` comes to above the lines is the tax
  ($14.32 here).
- \`reference\` is the shop's own order number: once per mode, and on every event about the payment.
- \`idempotencyKey\` makes a retry safe: the same key and body is the same payment.

The page loads \`https://js.useclear.org/v1\` and attaches as above. ${SHOP_CAN_SET}

## 3. Fulfil from the webhook

${fence('js', WEBHOOK_SNIPPET)}

More in ${DOCS_BASE}/docs/webhooks.md.

## Also

- \`payments.retrieve(id)\`, \`payments.list({ reference, createdFrom, createdTo, limit })\`,
  \`payments.listAll(...)\`, \`payments.cancel(id)\` (before it's paid).
- \`refunds.create({ payment, amount })\`: a card payment, in part or in full, at once; with
  \`requireApproval: true\` it waits for an owner or manager in the merchant app. A Clear payment is
  refunded from Charges in the merchant app (\`refund_in_app\`).
- \`paymentLinks.create({ amount } or { price, quantity })\`: a link to pay at \`pay.useclear.org\`, no website
  needed.
- \`webhookEndpoints.create / list / del\`, \`webhookDeliveries.list(...)\`.

## Errors

A refused request throws \`ClearError\` with \`type\`, \`code\` (stable: branch on it), \`message\` (for
people), \`param\` (the field at fault) and \`status\`. Every code is in ${DOCS_BASE}/docs/api.md.

## Versions

Each request names a version in \`Clear-Version\` (the SDK sends ${LATEST_VERSION}). Without one, the key's
pinned version is used and said in the answer. Within a version the API only grows.

${TEST_MODE}

${RULES}
`;

export const webhooksMd = () => `# Pay with Clear: webhooks

Clear tells the shop's server what happened, signed. Fulfil orders from these, not from the page.

## Endpoints

Add one in **Settings › Developers › Webhooks**, or with the API:

${fence('js', `const endpoint = await clear.webhookEndpoints.create({
  url: "https://micasatacos.com/clear/webhook",
  events: ["payment.succeeded", "payment.failed", "refund.succeeded"],
});
// endpoint.secret is "whsec_…": shown this once. Keep it as CLEAR_WEBHOOK_SECRET.`)}

An endpoint is https, in one mode (the key's), and hears only the events it names: ${EVENT_TYPES.map((t) => `\`${t}\``).join(', ')}.

## Handling one

${fence('js', WEBHOOK_SNIPPET)}

- Mount \`express.raw\` on this route, not \`express.json\`: the signature is over the raw body.
- \`verify\` throws \`ClearSignatureError\` when the signature is missing, doesn't match, or is more than
  ${SIGNATURE_TOLERANCE_SECONDS / 60} minutes old. Answer those with a 400 and do nothing.
- Answer 2xx quickly, then do the work. Anything else, or no answer, is retried.
- The same event can arrive twice: act once per \`event.id\`.

## The event

${fence('json', `{
  "id": "evt_…",
  "object": "event",
  "type": "payment.succeeded",
  "createdAt": "2026-10-16T17:42:10Z",
  "livemode": true,
  "apiVersion": "${LATEST_VERSION}",
  "data": { "object": "payment", "id": "pay_…", "reference": "catering-1042", "amount": 18532, "status": "succeeded", "method": "clear" }
}`)}

(Shortened.) \`data\` is the object itself: a payment, or for \`refund.succeeded\` a refund, as in
${DOCS_BASE}/docs/api.md.

## The signature, without the SDK

\`Clear-Signature: t=<unix seconds>,v1=<hex>\`. The \`v1\` is HMAC-SHA256, keyed with the endpoint's secret,
of \`"<t>.<raw body>"\`. Accept it when any \`v1\` matches (while a secret is being rolled a delivery carries one
for each) and \`t\` is within ${SIGNATURE_TOLERANCE_SECONDS / 60} minutes of your clock. Compare in constant time.

## Retries

A delivery that fails is retried after 1, 5 and 30 minutes, 2, 5 and 10 hours, then every 12 hours,
for 3 days. Each try and the endpoint's answer are in Developers, and in \`GET /v1/webhook_deliveries\`.

## Testing a handler

${fence('js', `const body = JSON.stringify(event);
const header = clear.webhooks.sign(body, process.env.CLEAR_WEBHOOK_SECRET);
// POST body to your route with Clear-Signature: header`)}

Test-mode payments send test-mode events, to test-mode endpoints only.
`;

export const mcpMd = () => `# Pay with Clear: the MCP server

\`@useclear/mcp\` lets an AI agent (Claude, Cursor and others) act on a shop's Clear account: make payment
links, look up payments, and ask for refunds. It runs on the shop's own computer with the shop's secret
key from the environment; the agent never sees the key.

## Set up

${fence('json', `{
  "mcpServers": {
    "clear": {
      "command": "npx",
      "args": ["-y", "@useclear/mcp"],
      "env": { "CLEAR_SECRET_KEY": "clear_sk_live_…" }
    }
  }
}`)}

Use a \`clear_sk_test_…\` key to try it without moving money.

## Tools

- \`create_payment_link\`: for an amount or a price. Returns the link to send.
- \`get_payment\`: by id (\`pay_…\`) or by the shop's reference.
- \`list_payments\`: in a date range.
- \`refund_payment\`: asks the owner first. It never refunds by itself: it makes a refund request that an
  owner or manager approves in the merchant app, under Charges. A Clear payment is refunded from Charges.
- \`list_webhook_deliveries\`: what was sent to the shop's webhooks, and how each endpoint answered.

The publishable key in examples, \`${EXAMPLE_PUBLISHABLE_KEY}\`, is the spec's; use the shop's own.
`;

/** Every version the API has published, for the reference's header. */
export const VERSIONS = CLEAR_VERSIONS;
