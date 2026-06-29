import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { onramperStore } from '../services/onramperStore.js';

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

// GET /api/onramper/sell-quotes?crypto=usdc_base&fiat=usd&amount=100&paymentMethod=creditcard&country=us
// Off-ramp (sell) quotes: crypto → fiat, payout to a debit card. Docs: get_quotes-crypto-fiat.
router.get('/sell-quotes', async (req: Request, res: Response) => {
  const key = apiKey();
  if (!key) {
    res.status(503).json({ error: 'Onramper not configured' });
    return;
  }
  const crypto = String(req.query.crypto || 'usdc_base').toLowerCase();
  const fiat = String(req.query.fiat || 'usd').toLowerCase();
  const params = new URLSearchParams({ amount: String(req.query.amount || ''), type: 'sell' });
  if (req.query.paymentMethod) params.set('paymentMethod', String(req.query.paymentMethod));
  if (req.query.country) params.set('country', String(req.query.country));
  if (req.query.walletAddress) params.set('walletAddress', String(req.query.walletAddress));
  try {
    // Sell quotes are crypto → fiat (source/dest swapped vs. buy).
    const r = await fetch(`${BASE}/quotes/${crypto}/${fiat}?${params.toString()}`, {
      headers: { Authorization: key },
    });
    const data = await r.json().catch(() => null);
    res.status(r.ok ? 200 : r.status).json(data ?? { error: 'Bad upstream response' });
  } catch (error) {
    console.error('[onramper/sell-quotes]', error);
    res.status(502).json({ error: 'Quote fetch failed' });
  }
});

// POST /api/onramper/sell-checkout  { onramp, amount, paymentMethod, walletAddress, fiat?, crypto?, network?, country? }
// Creates an off-ramp (sell) intent → returns the provider URL where the user completes the cash-out
// (sends USDC, receives fiat to their debit card). Mirrors /checkout but type='sell'.
router.post('/sell-checkout', async (req: Request, res: Response) => {
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
    // For sell, source = crypto, destination = fiat.
    source: String(b.crypto || 'usdc_base'),
    destination: String(b.fiat || 'usd'),
    amount: Number(b.amount),
    type: 'sell',
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
    const url =
      data?.sessionInformation?.url ||
      data?.transactionInformation?.url ||
      data?.url ||
      data?.redirectUrl ||
      null;
    res.status(r.ok ? 200 : r.status).json({ url, raw: data });
  } catch (error) {
    console.error('[onramper/sell-checkout]', error);
    res.status(502).json({ error: 'Checkout failed' });
  }
});

// GET /api/onramper/transactions/:wallet → recent on-ramp purchases + their status (from webhooks)
router.get('/transactions/:wallet', async (req: Request, res: Response) => {
  const w = String(req.params.wallet || '').toLowerCase();
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  try {
    res.json({ transactions: await onramperStore.listByWallet(w) });
  } catch (error) {
    console.error('[onramper/transactions]', error);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

export default router;
