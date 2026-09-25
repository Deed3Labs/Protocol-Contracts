import { Router, type Request, type Response } from 'express';
import { memberBillingService } from '../services/memberBillingService.js';
import { merchantDb } from '../config/merchantDb.js';
import { receiveStripeWebhook } from '../services/merchant/stripeEvents/webhook.js';
import { drainStripeEvents } from '../jobs/stripeEventProcessor.js';

type RawBodyRequest = Request & { rawBody?: Buffer };

const router = Router();

router.post('/membership', async (req: Request, res: Response) => {
  const rawReq = req as RawBodyRequest;
  const signature = req.get('stripe-signature');

  if (!rawReq.rawBody) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Stripe webhook raw body is unavailable',
    });
  }

  if (!signature) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Missing Stripe signature header',
    });
  }

  try {
    const result = await memberBillingService.handleWebhook(rawReq.rawBody, signature);
    res.json(result);
  } catch (error) {
    console.error('Stripe membership webhook error:', error);
    res.status(400).json({
      error: 'Webhook rejected',
      message: error instanceof Error ? error.message : 'Unknown webhook error',
    });
  }
});

/**
 * Events from shops' own Stripe accounts (Connect). Stored in the inbox and acknowledged; the
 * stripe-events job acts on them. Register this URL in Stripe as an endpoint listening to events
 * from connected accounts, and put its signing secret in STRIPE_CONNECT_WEBHOOK_SECRET.
 */
router.post('/connect', async (req: Request, res: Response) => {
  const result = await receiveStripeWebhook({
    db: await merchantDb(),
    endpoint: 'connect',
    secret: (process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '').trim(),
    rawBody: (req as RawBodyRequest).rawBody,
    signature: req.get('stripe-signature'),
  });
  res.status(result.status).json(result.body);
  if (result.stored) void drainStripeEvents();
});

export default router;
