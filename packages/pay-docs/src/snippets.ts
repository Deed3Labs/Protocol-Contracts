/**
 * The spec's snippets (pay spec §1), word for word, with the publishable key in the approved form
 * (`clear_pk_…`, pay DECISIONS Hard Stop 4). Every example in the docs is one of these.
 */

export const EXAMPLE_PUBLISHABLE_KEY = 'clear_pk_live_mc8Q2v';

/** No server: a price from the merchant app. */
export const NO_SERVER_SNIPPET = `<!-- their own button, their own styles -->
<button id="pay" class="btn-primary">Pay with Clear</button>

<script src="https://js.useclear.org/v1"></script>
<script>
  Clear("${EXAMPLE_PUBLISHABLE_KEY}").attach("#pay", {
    price: "price_tacotray12",
    quantity: 1,
    onSuccess: (p) => location.href = "/thanks?order=" + p.id,
  });
</script>`;

/** With a server: the amount stays on the server. */
export const SERVER_SNIPPET = `// server
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
Clear("${EXAMPLE_PUBLISHABLE_KEY}").attach("#pay", { payment: payment.clientSecret });`;

/** The webhook: fulfil on this, not on the page. */
export const WEBHOOK_SNIPPET = `app.post("/clear/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const event = clear.webhooks.verify(req.body, req.headers["clear-signature"]);
  if (event.type === "payment.succeeded") markPaid(event.data.reference);
  res.sendStatus(200);
});`;

/** What the shop can set, and what it can't (§1). */
export const SHOP_CAN_SET = 'What the shop can set: `accent`, `logo`, `locale`, `methods` (`["clear", "card"]` or one of them) and `email` to prefill. What it can’t: the amount, the modal’s layout, or anything typed into it.';
