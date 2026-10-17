# Pay with Clear: webhooks

Clear tells the shop's server what happened, signed. Fulfil orders from these, not from the page.

## Endpoints

Add one in **Settings › Developers › Webhooks**, or with the API:

```js
const endpoint = await clear.webhookEndpoints.create({
  url: "https://micasatacos.com/clear/webhook",
  events: ["payment.succeeded", "payment.failed", "refund.succeeded"],
});
// endpoint.secret is "whsec_…": shown this once. Keep it as CLEAR_WEBHOOK_SECRET.
```

An endpoint is https, in one mode (the key's), and hears only the events it names: `payment.succeeded`, `payment.failed`, `payment.canceled`, `refund.succeeded`.

## Handling one

```js
app.post("/clear/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const event = clear.webhooks.verify(req.body, req.headers["clear-signature"]);
  if (event.type === "payment.succeeded") markPaid(event.data.reference);
  res.sendStatus(200);
});
```

- Mount `express.raw` on this route, not `express.json`: the signature is over the raw body.
- `verify` throws `ClearSignatureError` when the signature is missing, doesn't match, or is more than
  5 minutes old. Answer those with a 400 and do nothing.
- Answer 2xx quickly, then do the work. Anything else, or no answer, is retried.
- The same event can arrive twice: act once per `event.id`.

## The event

```json
{
  "id": "evt_…",
  "object": "event",
  "type": "payment.succeeded",
  "createdAt": "2026-10-16T17:42:10Z",
  "livemode": true,
  "apiVersion": "2026-10-16",
  "data": { "object": "payment", "id": "pay_…", "reference": "catering-1042", "amount": 18532, "status": "succeeded", "method": "clear" }
}
```

(Shortened.) `data` is the object itself: a payment, or for `refund.succeeded` a refund, as in
https://useclear.org/docs/api.md.

## The signature, without the SDK

`Clear-Signature: t=<unix seconds>,v1=<hex>`. The `v1` is HMAC-SHA256, keyed with the endpoint's secret,
of `"<t>.<raw body>"`. Accept it when any `v1` matches (while a secret is being rolled a delivery carries one
for each) and `t` is within 5 minutes of your clock. Compare in constant time.

## Retries

A delivery that fails is retried after 1, 5 and 30 minutes, 2, 5 and 10 hours, then every 12 hours,
for 3 days. Each try and the endpoint's answer are in Developers, and in `GET /v1/webhook_deliveries`.

## Testing a handler

```js
const body = JSON.stringify(event);
const header = clear.webhooks.sign(body, process.env.CLEAR_WEBHOOK_SECRET);
// POST body to your route with Clear-Signature: header
```

Test-mode payments send test-mode events, to test-mode endpoints only.
