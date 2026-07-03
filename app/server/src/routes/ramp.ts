import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { coinbaseOnrampService, type NormalizedRampQuote } from '../services/coinbaseOnrampService.js';
import { onramperStore } from '../services/onramperStore.js';

/*
 * Unified fiat↔crypto ramp API. One set of endpoints the frontend calls; the actual provider is chosen
 * server-side by RAMP_PROVIDER ('coinbase' default, 'onramper' fallback), so we can flip back to the
 * Onramper aggregator instantly via env without a client change. Coinbase (CDP) Onramp is cheaper and we
 * already hold the CDP keys. Bank/ACH deposits are NOT here — those stay on Bridge.
 *
 * Phase A (this route): on-ramp (buy) + transaction status. Off-ramp (sell) is added alongside.
 */
const router = Router();

function provider(): 'coinbase' | 'onramper' {
  const p = (process.env.RAMP_PROVIDER || 'coinbase').trim().toLowerCase();
  return p === 'onramper' ? 'onramper' : 'coinbase';
}

// ---- Onramper fallback helpers (mirror routes/onramper.ts upstream calls) --------------------------
const ONRAMPER_BASE = process.env.ONRAMPER_API_BASE || 'https://api.onramper.com';
const onramperKey = () => process.env.ONRAMPER_API_KEY?.trim() || null;

async function onramperBuyQuotes(p: { amount: number; paymentMethod: string; walletAddress?: string; fiat: string; crypto: string; country: string }) {
  const key = onramperKey();
  if (!key) return [];
  const params = new URLSearchParams({ amount: String(p.amount), type: 'buy', paymentMethod: p.paymentMethod, country: p.country });
  if (p.walletAddress) params.set('walletAddress', p.walletAddress);
  const r = await fetch(`${ONRAMPER_BASE}/quotes/${p.fiat}/${p.crypto}?${params.toString()}`, { headers: { Authorization: key } });
  const data = await r.json().catch(() => null);
  const arr = Array.isArray(data) ? data : Array.isArray((data as any)?.message) ? (data as any).message : [];
  return arr as Array<Record<string, any>>;
}

function normalizeOnramperQuote(q: Record<string, any> | undefined, amount: number, crypto: string): NormalizedRampQuote {
  const payout = Number(q?.payout);
  return {
    provider: 'onramper',
    fiatAmount: amount,
    fiatSubtotal: amount,
    cryptoAmount: Number.isFinite(payout) ? payout : undefined,
    coinbaseFee: Number(q?.transactionFee) || undefined,
    networkFee: Number(q?.networkFee) || undefined,
    quoteId: q?.ramp ? String(q.ramp) : undefined,
    asset: crypto,
    network: 'base',
    raw: q,
  };
}

async function onramperCheckout(p: { onramp: string; amount: number; paymentMethod: string; walletAddress: string; fiat: string; crypto: string; type: 'buy' | 'sell' }): Promise<string | null> {
  const key = onramperKey();
  if (!key) return null;
  const body = {
    onramp: p.onramp,
    source: p.type === 'buy' ? p.fiat : p.crypto,
    destination: p.type === 'buy' ? p.crypto : p.fiat,
    amount: p.amount,
    type: p.type,
    paymentMethod: p.paymentMethod,
    network: 'base',
    wallet: { address: p.walletAddress },
    country: 'us',
  };
  const r = await fetch(`${ONRAMPER_BASE}/checkout/intent`, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => null)) as Record<string, any> | null;
  return data?.sessionInformation?.url || data?.transactionInformation?.url || data?.url || data?.redirectUrl || null;
}

// ---- Routes ---------------------------------------------------------------------------------------

// GET /api/ramp/config → which provider is active (for display / feature-gating on the client)
router.get('/config', (_req: Request, res: Response) => {
  const p = provider();
  res.json({ provider: p, configured: p === 'coinbase' ? coinbaseOnrampService.isConfigured() : Boolean(onramperKey()) });
});

// GET /api/ramp/buy/quote?amount=&paymentMethod=&country=&subdivision=  → best/normalized buy quote
router.get('/buy/quote', async (req: Request, res: Response) => {
  const amount = Number(req.query.amount);
  if (!(amount > 0)) {
    res.status(400).json({ error: 'amount must be > 0' });
    return;
  }
  const paymentMethod = String(req.query.paymentMethod || 'creditcard');
  const country = String(req.query.country || 'us');
  try {
    if (provider() === 'coinbase') {
      if (!coinbaseOnrampService.isConfigured()) {
        res.status(503).json({ error: 'Coinbase Onramp not configured' });
        return;
      }
      const quote = await coinbaseOnrampService.buyQuote({
        amount,
        paymentMethod,
        country,
        subdivision: req.query.subdivision ? String(req.query.subdivision) : undefined,
      });
      res.json({ quote });
      return;
    }
    // Onramper fallback: aggregate quotes, return the best (highest USDC payout).
    const raw = await onramperBuyQuotes({ amount, paymentMethod, walletAddress: req.query.walletAddress ? String(req.query.walletAddress) : undefined, fiat: 'usd', crypto: 'usdc_base', country });
    const best = raw.filter((q) => Number.isFinite(Number(q.payout))).sort((a, b) => Number(b.payout) - Number(a.payout))[0];
    res.json({ quote: best ? normalizeOnramperQuote(best, amount, 'usdc_base') : null });
  } catch (error: any) {
    console.error('[ramp/buy/quote]', error?.message || error);
    res.status(502).json({ error: 'Quote fetch failed' });
  }
});

// POST /api/ramp/buy/session { amount, paymentMethod, walletAddress, quoteId?, redirectUrl? }
//   → { url } to open the hosted checkout (Coinbase Pay or the Onramper provider page).
router.post('/buy/session', async (req: Request, res: Response) => {
  const b = (req.body || {}) as Record<string, unknown>;
  const amount = Number(b.amount);
  const walletAddress = String(b.walletAddress || '');
  if (!(amount > 0) || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    res.status(400).json({ error: 'amount and a valid walletAddress are required' });
    return;
  }
  // Users may only on-ramp to a wallet they've verified.
  if (!requireWalletMatch(req, res, walletAddress.toLowerCase(), 'walletAddress')) return;
  const paymentMethod = String(b.paymentMethod || 'creditcard');
  try {
    if (provider() === 'coinbase') {
      if (!coinbaseOnrampService.isConfigured()) {
        res.status(503).json({ error: 'Coinbase Onramp not configured' });
        return;
      }
      const { token } = await coinbaseOnrampService.createSessionToken({ address: walletAddress });
      const url = coinbaseOnrampService.buildBuyUrl({
        token,
        amount,
        paymentMethod,
        quoteId: b.quoteId ? String(b.quoteId) : undefined,
        partnerUserId: walletAddress.toLowerCase(),
        redirectUrl: b.redirectUrl ? String(b.redirectUrl) : undefined,
      });
      res.json({ url });
      return;
    }
    // Onramper fallback: pick the best onramp, then create its checkout intent.
    const quotes = await onramperBuyQuotes({ amount, paymentMethod, walletAddress, fiat: 'usd', crypto: 'usdc_base', country: 'us' });
    const best = quotes.filter((q) => Number.isFinite(Number(q.payout))).sort((a, b2) => Number(b2.payout) - Number(a.payout))[0];
    if (!best?.ramp) {
      res.status(502).json({ error: 'No onramp available' });
      return;
    }
    const url = await onramperCheckout({ onramp: String(best.ramp), amount, paymentMethod, walletAddress, fiat: 'usd', crypto: 'usdc_base', type: 'buy' });
    res.json({ url });
  } catch (error: any) {
    console.error('[ramp/buy/session]', error?.message || error);
    res.status(502).json({ error: 'Checkout failed' });
  }
});

// POST /api/ramp/buy/order { amount, walletAddress, email, phone, paymentMethod? }
//   HEADLESS on-ramp: returns { paymentLinkUrl } — an Apple Pay button to embed in an iframe, so the
//   buy happens inside our own UI (Coinbase only; the Onramper fallback has no equivalent).
router.post('/buy/order', async (req: Request, res: Response) => {
  if (provider() !== 'coinbase') {
    res.status(400).json({ error: 'Headless order is only supported on the Coinbase provider' });
    return;
  }
  if (!coinbaseOnrampService.isConfigured()) {
    res.status(503).json({ error: 'Coinbase Onramp not configured' });
    return;
  }
  const b = (req.body || {}) as Record<string, unknown>;
  const amount = Number(b.amount);
  const walletAddress = String(b.walletAddress || '');
  const email = String(b.email || '').trim();
  const phone = String(b.phone || '').trim();
  if (!(amount > 0) || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    res.status(400).json({ error: 'amount and a valid walletAddress are required' });
    return;
  }
  if (!email || !phone) {
    res.status(422).json({ error: 'verified email and phone are required for guest checkout', code: 'NEEDS_CONTACT' });
    return;
  }
  if (!requireWalletMatch(req, res, walletAddress.toLowerCase(), 'walletAddress')) return;
  // The iframe is embedded on the page that made the request — that host must be allowlisted in CDP.
  const origin = req.get('origin') || '';
  let domain = process.env.RAMP_IFRAME_DOMAIN || '';
  try { if (!domain && origin) domain = new URL(origin).hostname; } catch { /* ignore */ }
  if (!domain) domain = 'app.useclear.org';
  try {
    const order = await coinbaseOnrampService.createOnrampOrder({
      amount,
      email,
      phoneNumber: phone,
      destinationAddress: walletAddress,
      domain,
      partnerUserRef: walletAddress.toLowerCase(),
      paymentMethod: String(b.paymentMethod || '').toUpperCase() === 'GUEST_CHECKOUT_CARD' ? 'GUEST_CHECKOUT_CARD' : 'GUEST_CHECKOUT_APPLE_PAY',
    });
    res.json({ paymentLinkUrl: order.paymentLinkUrl, paymentLinkType: order.paymentLinkType, orderId: order.orderId });
  } catch (error: any) {
    console.error('[ramp/buy/order]', error?.status, error?.message || error, error?.raw ?? '');
    res.status(error?.status && error.status < 500 ? 400 : 502).json({ error: error?.message || 'Order failed' });
  }
});

// GET /api/ramp/transactions/:wallet → recent ramp orders + status (from webhooks / status polling)
router.get('/transactions/:wallet', async (req: Request, res: Response) => {
  const w = String(req.params.wallet || '').toLowerCase();
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  try {
    res.json({ transactions: await onramperStore.listByWallet(w) });
  } catch (error) {
    console.error('[ramp/transactions]', error);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

export default router;
