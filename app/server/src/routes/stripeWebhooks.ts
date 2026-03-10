import { Router, type Request, type Response } from 'express';
import { memberBillingService } from '../services/memberBillingService.js';

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

export default router;
