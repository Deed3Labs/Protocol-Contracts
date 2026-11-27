# @useclear/js

Pay with Clear for the browser. It turns the shop's own button into Pay with Clear: a click opens
Clear's modal (an iframe from `pay.useclear.org`) over the page. Members approve, new customers can
join, and anyone can pay by card. The script never draws a button.

## Add it

From Clear's host:

```html
<script src="https://js.useclear.org/v1"></script>
```

`/v1` is the latest build of version 1, cached for 5 minutes. To pin an exact build, use
`https://js.useclear.org/v1.0.1.0.js`, which never changes.

Or from npm, in a bundled app:

```sh
npm install @useclear/js
```

```js
import Clear from "@useclear/js";
```

## No server: a price from the merchant app

```html
<!-- their own button, their own styles -->
<button id="pay" class="btn-primary">Pay with Clear</button>

<script src="https://js.useclear.org/v1"></script>
<script>
  Clear("clear_pk_live_mc8Q2v…").attach("#pay", {
    price: "price_tacotray12",
    quantity: 1,
    onSuccess: (p) => location.href = "/thanks?order=" + p.id,
  });
</script>
```

## With a server: a payment your server makes

The amount stays on the server. Make the payment with `@useclear/node` and your secret key, and hand
the page its `clientSecret`:

```js
Clear("clear_pk_live_…").attach("#pay", { payment: payment.clientSecret });
```

## `Clear(publishableKey, options?)`

- `publishableKey`: `clear_pk_test_…` or `clear_pk_live_…`, from Settings › Developers in the merchant
  app. Anything else throws, and a secret key (`clear_sk_…`) is refused with a warning: it must never
  be in a web page. If one was, roll it.
- `options.apiBase`: `https://api.useclear.org` unless you say.
- `options.payOrigin`: `https://pay.useclear.org`. Another origin only with a test key, for local
  development.

`Clear()` is the only call that throws. Everything after it reports through `onError` and the console.

## `.attach(target, what, options?)`

- `target`: a CSS selector, an element, or a list of elements. A selector may match several elements,
  and elements added later still work (the click is caught on the document).
- `what`: `{ price, quantity }` or `{ payment }`.
- `options`: what the shop may set, and the callbacks. They can also go in the same object as `what`:

```js
Clear(key).attach("#pay", { price: "price_tacotray12", quantity: 2 }, {
  accent: "#B4532A",                 // buttons and links; Clear's ink when it fails contrast
  logo: "https://micasatacos.com/logo.png",
  locale: "en-US",
  methods: ["clear", "card"],        // or one of them
  email: "sofia@example.com",        // fills in "Email or phone"
  onSuccess: (p) => {},
  onCancel: () => {},
  onError: (e) => {},
});
```

Anything else (an `amount`, a `name`, `lines`…) is dropped with a console warning. The amount never
comes from the page.

It returns `{ detach(), open() }`. `open()` opens the modal as a click would.

## Events

- `onSuccess({ id, status, reference })`: paid. `status` is `succeeded` or `processing`; `reference` is
  your server's reference or `null`. That is all the page ever gets. The modal then closes.
- `onCancel()`: closed without paying (the modal's Close, Esc, or a click on the scrim).
- `onError({ code, message })`:
  - the API's codes, such as `origin_not_allowed` (this website isn't on the shop's list in
    Developers), `price_not_found`, `price_inactive`, `payment_closed`, `key_invalid`;
  - the modal's: `session_expired` and `origin_not_allowed` (the modal closes), `unavailable`
    (it stays open and says so; offer your other ways to pay);
  - the script's own: `insecure_page`, `invalid_options`, `network_error`, `invalid_response`, and
    `unavailable` when the modal hasn't loaded after 20 seconds.

## The modal

- A centred modal on a screen 640px wide or more; a bottom sheet under that. It takes the height the
  frame asks for, up to 90% of the screen.
- The page doesn't scroll while it's open, focus stays inside it, and Esc closes it. Focus goes back to
  the button afterwards. Motion is off under `prefers-reduced-motion`.
- One modal at a time: a click while one is open does nothing.
- Styled through the elements' own `style`, so a Content-Security-Policy without `'unsafe-inline'`
  styles is fine. The page's CSP needs `script-src https://js.useclear.org`,
  `connect-src https://api.useclear.org` and `frame-src https://pay.useclear.org`.

## Security

- **Fulfil from the webhook**, not from `onSuccess`. `onSuccess` runs in the customer's browser, where
  anyone can call it. Your server gets `payment.succeeded`, signed; verify it with
  `clear.webhooks.verify` from `@useclear/node`.
- **The page only ever gets `{ id, status, reference }`.** Phone numbers, emails, codes, names and
  balances are typed into Clear's frame, which the page can't read, and the frame's messages are
  strict: one carrying anything else is ignored.
- The script only listens to messages from `https://pay.useclear.org`, from its own frame, in Clear's
  protocol (`clear.v1`). The page never sends the frame anything: the accent, logo and the rest travel
  in the modal session, which the API makes from your publishable key and the page's origin.
- The publishable key only opens a modal, and only on the websites listed in Developers, so a copied
  key is useless elsewhere.
- It runs on https pages only, plus `localhost`, `127.0.0.1` and `[::1]` with a test key.

## Developing it

```sh
npm run build      # dist/v1.js (the script tag's file) and dist/index.mjs; prints the gzipped size
npm test           # bun
npm run typecheck
```

`apps/pay`'s prebuild copies `dist/v1.js` to `apps/pay/public/js/`, and `js.useclear.org/v1` is a
host rewrite on that project.
