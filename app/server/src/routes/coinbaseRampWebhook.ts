import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { emitRampStatus, type RampType, type RampStatus } from '../services/rampNotifications.js';

/*
 * Coinbase Onramp/Offramp webhook (PUBLIC, signature-verified) — the reliable, app-closed-safe source of
 * ramp status notifications. Coinbase POSTs onramp.transaction.* / offramp.transaction.* events; we verify
 * the X-Hook0-Signature (v0 = HMAC-SHA256 over `${t}.${rawBody}`), then emit the matching notification via
 * the shared emitRampStatus (deduped per Coinbase transaction id, so it never doubles the client poll).
 *
 * Point Coinbase at:  https://<backend-domain>/api/webhooks/coinbase-ramp
 * Set the subscription's metadata.secret as CDP_RAMP_WEBHOOK_SECRET.
 * Docs: https://docs.cdp.coinbase.com/webhooks/onramp
 */
const router = Router();
type RawBodyRequest = Request & { rawBody?: Buffer };

function safeEq(a: string, b: string): boolean {
  try {
    return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** Verify the X-Hook0-Signature v0 field: HMAC-SHA256(secret, `${timestamp}.${rawBody}`), hex. */
function verifyHook0(rawBody: string, header: string, secret: string): boolean {
  if (!secret) return true; // no secret configured (dev) — accept, like the Onramper webhook
  if (!header) return false;
  const fields = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = fields.t;
  const v0 = fields.v0;
  if (!t || !v0) return false;
  // Reject stale timestamps (replay protection) — 5-minute tolerance.
  const ts = Number(t);
  if (Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const computed = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return safeEq(computed, v0);
}

router.post('/', async (req: RawBodyRequest, res: Response) => {
  const secret = (process.env.CDP_RAMP_WEBHOOK_SECRET || '').trim();
  const sig = String(req.headers['x-hook0-signature'] || req.headers['X-Hook0-Signature'] || '');
  const rawStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
  if (!verifyHook0(rawStr, sig, secret)) {
    console.warn('[coinbase/webhook] signature verification failed');
    res.status(401).json({ error: 'invalid signature' });
    return;
  }

  try {
    const e = (req.body || {}) as Record<string, any>;
    const eventType = String(e.eventType || e.event_type || '');
    // Only act on terminal states; created/updated are informational.
    const status: RampStatus | null = eventType.endsWith('.success')
      ? 'completed'
      : eventType.endsWith('.failed')
        ? 'failed'
        : null;
    const type: RampType = eventType.startsWith('offramp') ? 'sell' : 'buy';
    // Wallet: guest-checkout uses walletAddress; the headless order uses destinationAddress; both carry
    // partnerUserRef (which we set to the lowercased wallet).
    const wallet = String(e.walletAddress || e.destinationAddress || e.partnerUserRef || '').toLowerCase();
    // Amount: guest payload is an object { value }, the headless order is a plain string.
    const rawAmt = e.purchaseAmount ?? e.sellAmount ?? e.amount;
    const amount = Number(typeof rawAmt === 'object' && rawAmt ? rawAmt.value : rawAmt) || 0;
    const ref = String(e.transactionId || e.orderId || `${wallet}-${eventType}`);

    if (status && /^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      await emitRampStatus({ wallet, type, status, amount, ref });
    } else {
      console.log('[coinbase/webhook] ignored event', { eventType, hasWallet: /^0x/.test(wallet) });
    }
    res.json({ received: true });
  } catch (error) {
    // 200 so Coinbase doesn't retry-storm on a parse issue.
    console.error('[coinbase/webhook] handler error', error);
    res.status(200).json({ received: true });
  }
});

export default router;
