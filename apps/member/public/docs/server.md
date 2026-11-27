# Pay with Clear: quickstart, with a server

The shop's server makes the payment for the amount it worked out, and hands the page the payment's
`clientSecret`. The amount stays on the server.

## 1. Install

```sh
npm install @useclear/node
```

Put the secret key from **Settings › Developers** in the server's environment as `CLEAR_SECRET_KEY`.

## 2. Make the payment, then attach

```js
// server
import Clear from "@useclear/node";
const clear = new Clear(process.env.CLEAR_SECRET_KEY);

const payment = await clear.payments.create({
  amount: 18532,            // cents
  currency: "usd",
  reference: "catering-1042",
  lines: [{ name: "Taco tray for 12", amount: 14900 },
          { name: "Agua fresca, gallon", amount: 1100, quantity: 2 }],
}, { idempotencyKey: "catering-1042" });

// page
Clear("clear_pk_live_mc8Q2v").attach("#pay", { payment: payment.clientSecret });
```

- Amounts are integer cents, tax included. Whatever `amount` comes to above the lines is the tax
  ($14.32 here).
- `reference` is the shop's own order number: once per mode, and on every event about the payment.
- `idempotencyKey` makes a retry safe: the same key and body is the same payment.

The page loads `https://js.useclear.org/v1` and attaches as above. What the shop can set: `accent`, `logo`, `locale`, `methods` (`["clear", "card"]` or one of them) and `email` to prefill. What it can’t: the amount, the modal’s layout, or anything typed into it.

## 3. Fulfil from the webhook

```js
app.post("/clear/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const event = clear.webhooks.verify(req.body, req.headers["clear-signature"]);
  if (event.type === "payment.succeeded") markPaid(event.data.reference);
  res.sendStatus(200);
});
```

More in https://useclear.org/docs/webhooks.md.

## Also

- `payments.retrieve(id)`, `payments.list({ reference, createdFrom, createdTo, limit })`,
  `payments.listAll(...)`, `payments.cancel(id)` (before it's paid).
- `refunds.create({ payment, amount })`: a card payment, in part or in full, at once; with
  `requireApproval: true` it waits for an owner or manager in the merchant app. A Clear payment is
  refunded from Charges in the merchant app (`refund_in_app`).
- `paymentLinks.create({ amount } or { price, quantity })`: a link to pay at `pay.useclear.org`, no website
  needed.
- `webhookEndpoints.create / list / del`, `webhookDeliveries.list(...)`.

## Errors

A refused request throws `ClearError` with `type`, `code` (stable: branch on it), `message` (for
people), `param` (the field at fault) and `status`. Every code is in https://useclear.org/docs/api.md.

## Versions

Each request names a version in `Clear-Version` (the SDK sends 2026-10-16). Without one, the key's
pinned version is used and said in the answer. Within a version the API only grows.

## Test mode

Test keys (`clear_pk_test_…`, `clear_sk_test_…`) never move money, and test and live never mix: a test
key can't see a live payment, nor the reverse.

- The test member: phone **(555) 010-0100**, code **000000**. Always approves.
- Test card: Stripe's **4242 4242 4242 4242**, any future date, any CVC (where the shop's card processor
  is in test mode).
- `http://localhost` can be an allowed website for a test key.

## Rules that keep a shop safe

- Attach to the shop's existing checkout button. Don't add a button; the script never draws one.
- The amount never comes from the browser. It's a price made in the merchant app, or a payment the
  shop's server makes with its secret key.
- Fulfil orders from the `payment.succeeded` webhook, not from `onSuccess`. `onSuccess` runs in the
  customer's browser, where anyone can call it.
- The secret key (`clear_sk_…`) lives in the server's environment as `CLEAR_SECRET_KEY`. Never in a web
  page, a repository or a log. The publishable key (`clear_pk_…`) is safe in a page.
