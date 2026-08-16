import express, { type Request, type Response } from 'express';
import { Webhook } from 'standardwebhooks';
import { lithicStore } from '../services/lithic/lithicStore.js';
import { recordDeposit } from '../services/deposits/depositReceiptService.js';

const router = express.Router();

/*
 * Lithic webhooks (PUBLIC, signature-verified) — the fiat half of money arriving.
 *
 * Point Lithic at:  https://<backend-domain>/api/webhooks/lithic
 * Signature model:  standard-webhooks — webhook-id / webhook-timestamp / webhook-signature.
 *
 * Only inbound settlement is handled here. A `payment_transaction` moving INBOUND and reaching a
 * settled state is an ACH credit landing in the member's financial account: their paycheck. Card
 * transactions arrive on their own events and are already accounted for by the auth stream, so
 * replaying them here would double-count.
 *
 * Distinct from the auth stream, which is synchronous and answers a question. This is asynchronous
 * and reports a fact, so it can afford the database work the auth path cannot.
 */

type RawBodyRequest = Request & { rawBody?: Buffer };

interface LithicEvent {
  event_type?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

function verifySignature(req: Request, rawBody: Buffer): boolean {
  const secret = (process.env.LITHIC_WEBHOOK_SECRET || '').trim();
  if (!secret) return false;
  try {
    new Webhook(secret).verify(rawBody.toString('utf8'), {
      'webhook-id': String(req.headers['webhook-id'] ?? ''),
      'webhook-timestamp': String(req.headers['webhook-timestamp'] ?? ''),
      'webhook-signature': String(req.headers['webhook-signature'] ?? ''),
    });
    return true;
  } catch {
    return false;
  }
}

/** Settled inbound money. Anything else is in-flight and must not move a member's balance. */
const SETTLED = new Set(['SETTLED', 'settled', 'COMPLETED', 'completed']);

router.post('/', async (req: RawBodyRequest, res: Response) => {
  const rawBody = req.rawBody;
  if (!rawBody || !verifySignature(req, rawBody)) {
    // 400 so Lithic retries — a clock skew or a rotated secret should not be silently swallowed.
    console.warn('[lithic/webhook] rejected: signature verification failed');
    return res.status(400).json({ error: 'invalid signature' });
  }

  try {
    const event = (req.body ?? {}) as LithicEvent;
    const eventType = String(event.event_type ?? '');
    const payload = (event.payload ?? event) as Record<string, unknown>;

    if (eventType.startsWith('payment_transaction')) {
      const direction = String(payload.direction ?? payload.category ?? '').toUpperCase();
      const status = String(payload.status ?? payload.result ?? '');
      const financialAccountToken = String(payload.financial_account_token ?? '');
      const token = String(payload.token ?? '');
      // Lithic amounts are in cents already.
      const amountCents = Number(payload.settled_amount ?? payload.amount ?? 0);

      const inbound = direction === 'CREDIT' || direction === 'INBOUND';
      if (inbound && SETTLED.has(status) && amountCents > 0 && token) {
        const member = financialAccountToken
          ? await lithicStore.findByCashFinancialAccount(financialAccountToken)
          : null;

        if (!member) {
          // Ack so Lithic stops retrying; an unmapped account is our gap, not their delivery problem.
          console.warn('[lithic/webhook] no member for financial account', financialAccountToken);
          return res.json({ received: true });
        }

        const outcome = await recordDeposit({
          rail: 'lithic_ach',
          externalId: token,
          wallet: member.wallet,
          amountCents: Math.round(amountCents),
          metadata: { eventType, financialAccountToken },
        });

        if (outcome.recorded) {
          console.log(
            `[lithic/webhook] ACH receipt ${amountCents}c → settled ${outcome.plan?.settledCents ?? 0}c,` +
              ` savings ${outcome.toSavingsCents}c, cash ${outcome.toCashCents}c`,
          );
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    // 200 so a parse issue doesn't trigger a retry storm — the signature already proved authenticity,
    // and every write in the pipeline is idempotent, so a manual replay is safe.
    console.error('[lithic/webhook] handler error', error);
    res.status(200).json({ received: true });
  }
});

export default router;
