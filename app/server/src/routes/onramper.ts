import { Router, type Request, type Response } from 'express';

/*
 * Onramper (headless) proxy — fiat→USDC on-ramp aggregator for the Add-money flow. Proxied through
 * the backend so the API key stays server-side and browser CORS is avoided. The key is the Onramper
 * publishable key (pk_test_… / pk_prod_…) in ONRAMPER_API_KEY. Docs: https://docs.onramper.com.
 * Card / Apple Pay deposits use this; bank/ACH deposits go through Bridge (separate rail).
 */
const router = Router();
const BASE = process.env.ONRAMPER_API_BASE || 'https://api.onramper.com';

function apiKey(): string | null {
  return process.env.ONRAMPER_API_KEY?.trim() || null;
}

// GET /api/onramper/quotes?fiat=usd&crypto=usdc_base&amount=100&paymentMethod=creditcard&country=us&walletAddress=0x..
router.get('/quotes', async (req: Request, res: Response) => {
  const key = apiKey();
  if (!key) {
    res.status(503).json({ error: 'Onramper not configured' });
    return;
  }
  const fiat = String(req.query.fiat || 'usd').toLowerCase();
  const crypto = String(req.query.crypto || 'usdc_base').toLowerCase();
  const params = new URLSearchParams({ amount: String(req.query.amount || ''), type: 'buy' });
  if (req.query.paymentMethod) params.set('paymentMethod', String(req.query.paymentMethod));
  if (req.query.country) params.set('country', String(req.query.country));
  if (req.query.walletAddress) params.set('walletAddress', String(req.query.walletAddress));
  try {
    const r = await fetch(`${BASE}/quotes/${fiat}/${crypto}?${params.toString()}`, {
      headers: { Authorization: key },
    });
    const data = await r.json().catch(() => null);
    res.status(r.ok ? 200 : r.status).json(data ?? { error: 'Bad upstream response' });
  } catch (error) {
    console.error('[onramper/quotes]', error);
    res.status(502).json({ error: 'Quote fetch failed' });
  }
});

// POST /api/onramper/checkout  { onramp, amount, paymentMethod, walletAddress, fiat?, crypto?, network?, country? }
router.post('/checkout', async (req: Request, res: Response) => {
  const key = apiKey();
  if (!key) {
    res.status(503).json({ error: 'Onramper not configured' });
    return;
  }
  const b = (req.body || {}) as Record<string, unknown>;
  if (!b.onramp || !b.walletAddress || !(Number(b.amount) > 0)) {
    res.status(400).json({ error: 'onramp, amount and walletAddress are required' });
    return;
  }
  const body = {
    onramp: String(b.onramp),
    source: String(b.fiat || 'usd'),
    destination: String(b.crypto || 'usdc_base'),
    amount: Number(b.amount),
    type: 'buy',
    paymentMethod: b.paymentMethod ? String(b.paymentMethod) : 'creditcard',
    network: String(b.network || 'base'),
    wallet: { address: String(b.walletAddress) },
    country: String(b.country || 'us'),
  };
  try {
    const r = await fetch(`${BASE}/checkout/intent`, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await r.json().catch(() => null)) as Record<string, any> | null;
    // Onramper returns the provider checkout URL; field name varies by version, so extract defensively.
    const url =
      data?.sessionInformation?.url ||
      data?.transactionInformation?.url ||
      data?.url ||
      data?.redirectUrl ||
      null;
    res.status(r.ok ? 200 : r.status).json({ url, raw: data });
  } catch (error) {
    console.error('[onramper/checkout]', error);
    res.status(502).json({ error: 'Checkout failed' });
  }
});

export default router;
