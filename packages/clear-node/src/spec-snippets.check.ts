/**
 * The spec's two server snippets, as written, so `tsc` proves they type-check against this SDK. Never
 * run and never bundled (tsup's entry is index.ts). `app` and `express` are declared, not installed.
 */
import Clear from './index';

type Req = { body: Buffer; headers: Record<string, string | string[] | undefined> };
type Res = { sendStatus(code: number): void };
declare const app: { post(path: string, ...handlers: unknown[]): void };
declare const express: { raw(options: { type: string }): unknown };
declare function markPaid(reference: string | null): void;

export async function serverSnippet() {
  const clear = new Clear(process.env.CLEAR_SECRET_KEY);
  const payment = await clear.payments.create(
    {
      amount: 18532,
      currency: 'usd',
      reference: 'catering-1042',
      lines: [
        { name: 'Taco tray for 12', amount: 14900 },
        { name: 'Agua fresca, gallon', amount: 1100, quantity: 2 },
      ],
    },
    { idempotencyKey: 'catering-1042' },
  );
  // page gets payment.clientSecret
  const clientSecret: string | undefined = payment.clientSecret;

  app.post('/clear/webhook', express.raw({ type: '*/*' }), (req: Req, res: Res) => {
    const event = clear.webhooks.verify(req.body, req.headers['clear-signature']);
    if (event.type === 'payment.succeeded') markPaid(event.data.reference);
    res.sendStatus(200);
  });

  return clientSecret;
}
