import express, { type Request, type Response } from 'express';
import { Webhook } from 'standardwebhooks';
import { authorize } from '../services/lithic/authStore.js';
import type { AsaResult } from '../services/lithic/authDecision.js';

const router = express.Router();

/*
 * Auth Stream Access — spec step 3. Lithic asks, in real time, whether to approve a card
 * authorization; we answer from a precomputed snapshot.
 *
 * Rules this endpoint lives by:
 *  - Never call out. No chain reads, no Plaid, no HTTP. One indexed Postgres row is the whole
 *    lookup. Lithic allows 6 seconds and recommends under 3; we are budgeting single-digit
 *    milliseconds and the ceiling exists to be nowhere near.
 *  - Idempotent by the transaction token. Lithic retries, and a retry that draws again is money
 *    invented from nothing.
 *  - Fail closed. Any error, any unknown card, any unverifiable signature: decline. An approval we
 *    cannot fund is worse than a decline we can explain.
 *  - Log every decision with the inputs that produced it — we will have to explain individual
 *    authorizations to members.
 *
 * The request shape is taken from Lithic's OpenAPI schema, not inferred: `token` is the transaction
 * group uuid and our idempotency key, `card.token` identifies the card (there is no account token in
 * this payload, which is why snapshots are keyed by card), and `amounts.cardholder.amount` is the
 * amount in cents to authorize against. The deprecated top-level `amount` carries the same value and
 * is read only as a fallback.
 */

/** Signature headers are disabled until you fetch the secret from GET /v1/auth_stream/secret. */
function verifySignature(req: Request, rawBody: Buffer): boolean {
  const secret = (process.env.LITHIC_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    // Refuse rather than trust. An unauthenticated endpoint that approves card spend is not a
    // configuration gap to work around; it is the whole vulnerability.
    return false;
  }
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

interface AsaRequestBody {
  token?: string;
  event_token?: string;
  status?: string;
  amount?: number;
  authorization_amount?: number;
  amounts?: { cardholder?: { amount?: number; currency?: string } };
  card?: { token?: string; state?: string };
  merchant?: Record<string, unknown>;
}

function amountCentsOf(body: AsaRequestBody): number {
  const structured = body.amounts?.cardholder?.amount;
  if (typeof structured === 'number') return structured;
  if (typeof body.amount === 'number') return body.amount;
  if (typeof body.authorization_amount === 'number') return body.authorization_amount;
  return 0;
}

function decline(res: Response, result: AsaResult, reason: string, extra?: Record<string, unknown>) {
  // Always HTTP 200 — the verdict lives in the body. A non-200 is a timeout to Lithic, which
  // declines anyway but tells us nothing and looks like an outage.
  console.warn(`[lithic:asa] decline ${result} — ${reason}`, extra ?? '');
  res.status(200).json({ result });
}

router.post('/', async (req: Request, res: Response) => {
  const started = Date.now();
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!rawBody || !verifySignature(req, rawBody)) {
    return decline(res, 'SUSPECTED_FRAUD', 'signature verification failed');
  }

  const body = (req.body ?? {}) as AsaRequestBody;
  const transactionToken = String(body.token || body.event_token || '').trim();
  const cardToken = String(body.card?.token || '').trim();
  const amountCents = amountCentsOf(body);
  const requestStatus = String(body.status || 'AUTHORIZATION');

  if (!transactionToken || !cardToken) {
    return decline(res, 'INSUFFICIENT_FUNDS', 'missing transaction or card token');
  }

  // A balance inquiry asks what is there; it draws nothing. Answering it from the snapshot without
  // touching balances keeps the two paths from ever sharing a decrement.
  if (requestStatus === 'BALANCE_INQUIRY') {
    try {
      const { authStore } = await import('../services/lithic/authStore.js');
      const snapshot = await authStore.getSnapshot(cardToken);
      const available = snapshot
        ? snapshot.cashCents +
          snapshot.savingsCents +
          snapshot.assetCents +
          snapshot.incomeCents +
          snapshot.boostCents
        : 0;
      return res.status(200).json({ result: 'APPROVED', balance: available, available });
    } catch (error) {
      return decline(res, 'INSUFFICIENT_FUNDS', 'balance inquiry failed', { error: String(error) });
    }
  }

  try {
    const outcome = await authorize({
      transactionToken,
      cardToken,
      amountCents,
      requestStatus,
      merchant: body.merchant,
    });

    const latency = Date.now() - started;
    console.log(
      `[lithic:asa] ${outcome.decision.result} ${amountCents}c card=${cardToken}` +
        ` credit=${outcome.decision.creditCents}c${outcome.replayed ? ' (replay)' : ''}` +
        ` ${latency}ms`,
      { draws: outcome.decision.draws, wallet: outcome.wallet },
    );

    if (!outcome.known) {
      console.error(`[lithic:asa] no snapshot for card ${cardToken} — declining`);
    }

    res.status(200).json({ result: outcome.decision.result });
  } catch (error) {
    // Fail closed, loudly. This is the alert condition in the spec.
    console.error('[lithic:asa] decision failed, declining:', error);
    res.status(200).json({ result: 'INSUFFICIENT_FUNDS' });
  }
});

export default router;
