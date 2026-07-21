import { Router, type Request, type Response } from 'express';
import { sendBridgeWebhookVerifier } from '../services/sendBridgeWebhookVerifier.js';
import { bridgeCustomerStore } from '../services/bridgeCustomerStore.js';
import { emitRampStatus } from '../services/rampNotifications.js';

/*
 * Bridge webhooks (PUBLIC, signature-verified) — the app-closed-safe source of truth for money that
 * moves without us initiating it.
 *
 * This matters most for DEPOSITS: a bank push into the member's virtual account is started at their
 * bank, so nothing in our app knows it happened. Polling can't help (there's no local record to poll
 * against) — the webhook is the only signal. Withdrawals also report here, which covers the window
 * after we've sent the USDC and Bridge is still working the ACH.
 *
 * Point Bridge at:  https://<backend-domain>/api/webhooks/bridge
 * Set the endpoint's PEM public key as BRIDGE_WEBHOOK_PUBLIC_KEY.
 * Signature model: X-Webhook-Signature: t=<ms>,v0=<base64 RSA-SHA256 over `${t}.${rawBody}`>.
 * Docs: https://apidocs.bridge.xyz/platform/orchestration/webhooks
 */
const router = Router();
type RawBodyRequest = Request & { rawBody?: Buffer };

/** Transfer/drain states that should tell the member something. Anything else is in-flight noise. */
const TERMINAL_OUT: Record<string, 'completed' | 'failed'> = {
  payment_processed: 'completed',
  returned: 'failed',
  undeliverable: 'failed',
  refunded: 'failed',
  refund_failed: 'failed',
  canceled: 'failed',
};

function amountOf(obj: Record<string, unknown>): number {
  const raw = obj.amount ?? obj.subtotal_amount ?? obj.final_amount;
  const n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

router.post('/', async (req: RawBodyRequest, res: Response) => {
  const verification = sendBridgeWebhookVerifier.verify({
    rawBody: req.rawBody ?? (req.body ? JSON.stringify(req.body) : undefined),
    signatureHeader: String(req.headers['x-webhook-signature'] || ''),
  });
  if (!verification.valid) {
    // 400 (not 200) so Bridge retries with a fresh timestamp if this was a clock/staleness issue.
    console.warn('[bridge/webhook] rejected:', verification.reason);
    res.status(400).json({ error: verification.reason || 'invalid signature' });
    return;
  }

  try {
    const e = (req.body || {}) as Record<string, any>;
    const category = String(e.event_category || '');
    const objectStatus = String(e.event_object_status || '');
    const obj = (e.event_object || {}) as Record<string, any>;
    const customerId = String(obj.customer_id || e.event_developer_id || '');

    const wallet = customerId ? await bridgeCustomerStore.walletFor(customerId) : null;
    if (!wallet) {
      // Unknown customer (or the pairing predates this table) — ack so Bridge stops retrying.
      console.log('[bridge/webhook] no wallet for customer', { category, customerId: customerId.slice(0, 8) });
      res.json({ received: true });
      return;
    }

    const amount = amountOf(obj);
    const ref = String(obj.id || e.event_object_id || `${category}-${e.event_id ?? ''}`);

    if (category === 'virtual_account.activity') {
      // A member pushed money into their USD account. `funds_received` is the deposit landing;
      // `payment_processed` is Bridge having delivered the USDC on-chain.
      const type = String(obj.type || objectStatus || '');
      if (type === 'funds_received' || type === 'payment_processed') {
        await emitRampStatus({ wallet, type: 'buy', status: 'completed', amount, ref: `bva:${ref}` });
      } else if (type === 'refund' || type === 'refund_failed') {
        await emitRampStatus({ wallet, type: 'buy', status: 'failed', amount, ref: `bva:${ref}` });
      }
    } else if (category === 'transfer' || category === 'liquidation_address.drain') {
      // Withdrawals: we already sent the USDC, this is Bridge finishing the fiat leg.
      const status = TERMINAL_OUT[String(obj.state || objectStatus || '')];
      if (status) {
        await emitRampStatus({ wallet, type: 'sell', status, amount, ref: `btr:${ref}` });
      }
    }
    // `customer` events (KYC transitions) are read on demand via /api/bridge/status, so nothing to do.

    res.json({ received: true });
  } catch (error) {
    // 200 so a parse issue doesn't trigger a retry storm — the signature already proved authenticity.
    console.error('[bridge/webhook] handler error', error);
    res.status(200).json({ received: true });
  }
});

export default router;
