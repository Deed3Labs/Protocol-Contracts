import express, { type Request, type Response } from 'express';
import { Webhook } from 'standardwebhooks';
import { lithicStore } from '../services/lithic/lithicStore.js';
import { cardStore } from '../services/lithic/cardStore.js';
import { recordDeposit } from '../services/deposits/depositReceiptService.js';
import { handleReturn } from '../services/lithic/achOriginationService.js';
import { handleCardTransaction } from '../services/lithic/cardTransactionEvents.js';

const router = express.Router();

/*
 * Lithic webhooks (PUBLIC, signature-verified) — the fiat half of money arriving.
 *
 * Point Lithic at:  https://<backend-domain>/api/webhooks/lithic
 * Signature model:  standard-webhooks — webhook-id / webhook-timestamp / webhook-signature.
 *
 * A `payment_transaction` moving INBOUND and reaching a settled state is an ACH credit landing in
 * the member's financial account: their paycheck.
 *
 * A `card_transaction` is the *aftermath* of a swipe the auth stream already decided. The charge
 * itself is not replayed here — that would double-count — but a void, a reversal or a clearing for a
 * different amount is reported nowhere else, and each one has to move the member's availability
 * back. So these events reconcile the existing draw rather than creating one.
 *
 * Distinct from the auth stream, which is synchronous and answers a question. This is asynchronous
 * and reports a fact, so it can afford the database work the auth path cannot.
 *
 * ACH RETURNS arrive here too, and they are not a status change to log — the money left the
 * member's bank, arrived, may already have settled against credit, and is now going back. Every
 * return must reverse cleanly through both ledgers, so it is handled explicitly rather than falling
 * through as an unrecognised status.
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

    /*
     * The post, which a card's own state cannot tell us.
     *
     * PENDING_ACTIVATION means it went to card production, not that it left the building, and there
     * is no delivery event at all. This is the one moment Lithic reports, and it carries the date
     * and the tracking number the member is shown.
     */
    if (eventType === 'card.shipped') {
      const cardToken = String(payload.card_token ?? '');
      if (cardToken) {
        await cardStore.recordShipped({
          cardToken,
          shippedAt: new Date().toISOString(),
          trackingNumber: (payload.tracking_number as string | null) ?? null,
          shippingMethod: (payload.shipping_method as string | null) ?? null,
        });
      }
      return res.json({ received: true });
    }

    /*
     * What happened to a card charge after it was authorized.
     *
     * The auth stream decides and draws down; only this tells us the charge was voided, partly
     * reversed, or cleared for a different figure. Without it the ledger moves one way forever and a
     * member never gets a voided $5 back.
     */
    if (eventType.startsWith('card_transaction')) {
      const result = await handleCardTransaction(payload);
      /*
       * Every outcome is logged, including the ones that moved nothing.
       *
       * Logging only the adjustments was a mistake: `unknown` — no decision of ours matches this
       * transaction — is the single most important thing this handler can report, and it was the one
       * case that wrote nothing at all. From the outside it is indistinguishable from working, since
       * the endpoint answers 200 either way. The token is here so it can be compared against the one
       * the auth stream recorded; if those two differ, nothing will ever match and this line is the
       * only place that shows it.
       */
      if (result) {
        const detail =
          result.outcome === 'unknown'
            ? 'no approved decision of ours matches this transaction'
            : `${result.deltaCents}c → holding ${result.targetCents}c` +
              (result.unfundedCents > 0 ? ` (${result.unfundedCents}c unfunded)` : '');
        const line = `[lithic:card_transaction] ${result.outcome} tx=${result.transactionToken} ${detail}`;
        if (result.outcome === 'unknown') console.warn(line);
        else console.log(line);
      }
      return res.json({ received: true });
    }

    if (eventType.startsWith('payment_transaction')) {
      const direction = String(payload.direction ?? payload.category ?? '').toUpperCase();
      const status = String(payload.status ?? payload.result ?? '');
      const financialAccountToken = String(payload.financial_account_token ?? '');
      const token = String(payload.token ?? '');
      // Lithic amounts are in cents already.
      const amountCents = Number(payload.settled_amount ?? payload.amount ?? 0);

      // A return closes the loop on a pull we originated. Handle it before anything else, because
      // a returned payment is not a deposit no matter which direction it reports.
      const returnCode = String(payload.return_reason_code ?? '');
      if (returnCode || status === 'RETURNED') {
        const reversed = await handleReturn(token, returnCode || 'UNKNOWN');
        if (reversed) {
          console.warn(
            `[lithic/webhook] ACH return ${returnCode} on ${token} —` +
              ` ${reversed.amountCents}c going back for ${reversed.wallet}`,
          );
        }
        return res.json({ received: true });
      }

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
