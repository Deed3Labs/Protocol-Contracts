import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { onramperStore } from '../services/onramperStore.js';

/*
 * Onramper webhook (PUBLIC, signature-verified) — reconciliation of on-ramp purchases. Onramper POSTs
 * transaction status events here; we verify the HMAC against ONRAMPER_WEBHOOK_SECRET, then upsert the
 * status into onramp_transactions (foundation for order-status + notifications). Give Onramper this URL:
 *   https://<backend-domain>/api/webhooks/onramper
 * NOTE: the exact signature header + event shape are best-effort until verified against a real webhook
 * — every event is stored raw so we can adjust the field mapping once live.
 */
const router = Router();

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret) return true; // no secret configured (dev) — accept
  if (!signature) return false;
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // Some providers prefix the scheme (e.g. "sha256="); compare against the hex tail too.
  const candidate = signature.includes('=') ? signature.split('=').pop()! : signature;
  try {
    return (
      crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(candidate)) ||
      crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
    );
  } catch {
    return false;
  }
}

router.post('/', async (req: RawBodyRequest, res: Response) => {
  const secret = process.env.ONRAMPER_WEBHOOK_SECRET?.trim() || '';
  const sig = String(
    req.headers['onramper-webhook-signature'] ||
      req.headers['x-onramper-signature'] ||
      req.headers['x-webhook-signature'] ||
      req.headers['x-signature'] ||
      '',
  );
  const rawStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});

  if (!verifySignature(rawStr, sig, secret)) {
    console.warn('[onramper/webhook] signature verification failed');
    res.status(401).json({ error: 'invalid signature' });
    return;
  }

  try {
    const e = (req.body || {}) as Record<string, any>;
    const p = (e.payload || e.data || e) as Record<string, any>;
    const txId = e.id || p.id || p.transactionId || p.txnId || null;
    const status = String(e.type || e.status || p.status || 'unknown');
    const wallet = String(p.walletAddress || p.wallet?.address || e.walletAddress || '').toLowerCase() || null;
    const provider = p.onramp || p.provider || e.onramp || null;
    const fiatAmount = Number(p.sourceAmount ?? p.fiatAmount ?? e.sourceAmount) || null;
    const cryptoAmount = Number(p.destinationAmount ?? p.cryptoAmount ?? e.destinationAmount) || null;

    if (txId) {
      await onramperStore.upsert({
        id: String(txId),
        wallet,
        status,
        provider: provider ? String(provider) : null,
        fiatAmount,
        cryptoAmount,
        raw: e,
      });
    } else {
      console.warn('[onramper/webhook] event missing transaction id; stored nothing', { keys: Object.keys(e) });
    }
    res.json({ received: true });
  } catch (error) {
    // Return 200 so Onramper doesn't retry-storm on a parsing issue (the raw event is what matters).
    console.error('[onramper/webhook] handler error', error);
    res.status(200).json({ received: true });
  }
});

export default router;
