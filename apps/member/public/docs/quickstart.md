# Pay with Clear: quickstart, no server

Turn the shop's own checkout button into Pay with Clear: a click opens Clear's modal over the page.
Members pay now or over time; anyone can pay by card on the shop's own Stripe.

## 1. In the merchant app

- **Settings › Developers**: copy the publishable key (`clear_pk_live_…`), and add the website under
  **Allowed websites**. The modal only opens on those sites, so a copied key is useless anywhere else.
- **A price**: make one for what's sold (`price_…`). Its amount is set there, never in the page.

## 2. On the page

```html
<!-- their own button, their own styles -->
<button id="pay" class="btn-primary">Pay with Clear</button>

<script src="https://js.useclear.org/v1"></script>
<script>
  Clear("clear_pk_live_mc8Q2v").attach("#pay", {
    price: "price_tacotray12",
    quantity: 1,
    onSuccess: (p) => location.href = "/thanks?order=" + p.id,
  });
</script>
```

What the shop can set: `accent`, `logo`, `locale`, `methods` (`["clear", "card"]` or one of them) and `email` to prefill. What it can’t: the amount, the modal’s layout, or anything typed into it.

`attach` takes a CSS selector, an element, or a list of elements, and works for elements added later.
It returns `{ detach(), open() }`.

## 3. What the page hears

- `onSuccess({ id, status, reference })`: paid (`status` is `succeeded`, or `processing` while it
  settles). That is all the page ever gets; nothing typed in the modal reaches it.
- `onCancel()`: closed without paying.
- `onError({ code, message })`: for example `origin_not_allowed` (the site isn't on the list),
  `price_not_found`, `price_inactive`, `session_expired`, `unavailable` (offer the shop's other ways
  to pay), `network_error`.

## 4. Fulfil

With no server, the sale shows in the merchant app's Charges, marked Online. To fulfil automatically,
add a webhook endpoint (https://useclear.org/docs/webhooks.md) and act on `payment.succeeded`.

## Content-Security-Policy

If the site has one, it needs `script-src https://js.useclear.org`, `connect-src https://api.useclear.org`
and `frame-src https://pay.useclear.org`.

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
