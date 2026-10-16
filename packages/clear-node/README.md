# @useclear/node

Pay with Clear for your server: make payments, payment links and refunds, and check the webhooks Clear
sends you. Node 18 or later.

```sh
npm install @useclear/node
```

## Take a payment

Your server makes the payment, with the amount it worked out, and hands the page its `clientSecret`.

```js
import Clear from "@useclear/node";
const clear = new Clear(process.env.CLEAR_SECRET_KEY);

const payment = await clear.payments.create({
  amount: 18532, currency: "usd", reference: "catering-1042",
  lines: [{ name: "Taco tray for 12", amount: 14900 }, { name: "Agua fresca, gallon", amount: 1100, quantity: 2 }],
}, { idempotencyKey: "catering-1042" });
// page gets payment.clientSecret
```

Amounts are integer cents, tax included. Whatever `amount` comes to above the lines is the tax ($14.32 here).

Also: `payments.retrieve(id)`, `payments.list({ reference, createdFrom, createdTo, limit, startingAfter })`,
`payments.cancel(id)`, `prices.list()`, `paymentLinks.create(…)`, `refunds.create({ payment })`, and
`webhookEndpoints.create / list / del`. To walk every payment:

```js
for await (const p of clear.payments.listAll({ createdFrom: "2026-10-01T00:00:00Z" })) console.log(p.id);
```

## Fulfil from the webhook

Fulfil the order when `payment.succeeded` arrives, not when the page says it's paid. Verify the raw body,
so mount `express.raw` on this route, not `express.json`.

```js
app.post("/clear/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const event = clear.webhooks.verify(req.body, req.headers["clear-signature"]);
  if (event.type === "payment.succeeded") markPaid(event.data.reference);
  res.sendStatus(200);
});
```

`verify` checks with the endpoint's `whsec_…` secret from `new Clear(key, { webhookSecret })`, else
`CLEAR_WEBHOOK_SECRET`; or pass it as the third argument. It throws `ClearSignatureError` when the
signature doesn't match, is more than five minutes old, or is missing: answer those with a 400 and don't act
on them. While you roll a secret, a delivery carries a signature for each one, and either matches.

To test your handler, sign a payload the way Clear does and post it with that header:

```js
const body = JSON.stringify(event);
const header = clear.webhooks.sign(body, process.env.CLEAR_WEBHOOK_SECRET);
```

## Errors

A request Clear refuses throws `ClearError`:

```js
import Clear, { ClearError } from "@useclear/node";

try {
  await clear.payments.create({ amount: 18532, currency: "usd", reference: "catering-1042" });
} catch (err) {
  if (err instanceof ClearError && err.code === "reference_taken") { /* already made */ }
  else throw err;
}
```

It has `type` (`invalid_request`, `authentication`, `permission`, `not_found`, `conflict`, `rate_limit`, `api`),
`code` (stable; branch on it), `message` (for people), `param` (the field at fault), `status` and `requestId`.
`connection_error` means Clear never answered.

## Test mode

`sk_test_…` keys only see test payments, and `sk_live_…` keys only live ones. Nothing moves money in test
mode. The publishable key (`pk_…`) belongs in the browser, with the Clear script; this package refuses it.

## Idempotency and retries

Every POST carries an `Idempotency-Key`, so sending it again never makes a second payment. Pass your own
(`{ idempotencyKey: "catering-1042" }`) to make retrying across restarts safe too; otherwise one is made
for each call. Network errors, 429s and 5xx answers are retried twice, with backoff, under the same key.
Other 4xx answers are not retried.

## Options

```js
new Clear(key, {
  webhookSecret,      // for webhooks.verify
  baseUrl,            // https://api.useclear.org, or CLEAR_API_URL
  version,            // Clear-Version; the version this package was built for unless you say
  timeoutMs: 30000,   // per try
  maxRetries: 2,
  fetch,              // your own fetch
});
```
