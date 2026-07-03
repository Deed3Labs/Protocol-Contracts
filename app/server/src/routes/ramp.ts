import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { coinbaseOnrampService, type NormalizedRampQuote } from '../services/coinbaseOnrampService.js';
import { onramperStore } from '../services/onramperStore.js';
import { notificationStore, type NotificationKind } from '../services/notificationStore.js';

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

// GET /api/ramp/buy/status?partnerUserRef=0x.. → { status, purchaseAmount, currency, txHash }
//   Poll after checkout to confirm a deposit landed (works for both the hosted redirect and the iframe).
router.get('/buy/status', async (req: Request, res: Response) => {
  const ref = String(req.query.partnerUserRef || '').toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(ref)) {
    res.status(400).json({ error: 'partnerUserRef required' });
    return;
  }
  if (!requireWalletMatch(req, res, ref, 'partnerUserRef')) return;
  if (provider() !== 'coinbase') {
    res.json({ status: null });
    return;
  }
  try {
    const status = await coinbaseOnrampService.getBuyStatus(ref);
    res.json(status ?? { status: null });
  } catch (error: any) {
    console.error('[ramp/buy/status]', error?.message || error);
    res.status(502).json({ error: 'Status check failed' });
  }
});

// POST /api/ramp/sell/session { walletAddress, redirectUrl? } → { url, partnerUserRef }
//   Opens the offramp cash-out flow. After the user confirms, poll /sell/status for the send instruction.
router.post('/sell/session', async (req: Request, res: Response) => {
  const b = (req.body || {}) as Record<string, unknown>;
  const walletAddress = String(b.walletAddress || '');
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    res.status(400).json({ error: 'a valid walletAddress is required' });
    return;
  }
  if (!requireWalletMatch(req, res, walletAddress.toLowerCase(), 'walletAddress')) return;
  const partnerUserRef = walletAddress.toLowerCase();
  try {
    if (provider() === 'coinbase') {
      if (!coinbaseOnrampService.isConfigured()) {
        res.status(503).json({ error: 'Coinbase Offramp not configured' });
        return;
      }
      const { token } = await coinbaseOnrampService.createSessionToken({ address: walletAddress });
      const url = coinbaseOnrampService.buildSellUrl({ token, partnerUserRef, redirectUrl: b.redirectUrl ? String(b.redirectUrl) : undefined });
      res.json({ url, partnerUserRef });
      return;
    }
    // Onramper fallback: a pure hosted sell (no send-back), so no partnerUserRef polling.
    const amount = Number(b.amount) || 0;
    const url = await onramperCheckout({ onramp: String(b.onramp || ''), amount, paymentMethod: 'creditcard', walletAddress, fiat: 'usd', crypto: 'usdc_base', type: 'sell' });
    res.json({ url, partnerUserRef: null });
  } catch (error: any) {
    console.error('[ramp/sell/session]', error?.message || error);
    res.status(502).json({ error: 'Cash-out failed to start' });
  }
});

// GET /api/ramp/sell/status?partnerUserRef=0x.. → { status, toAddress, amount, currency, asset, network }
//   When status is STARTED, the client sends `amount` of USDC to `toAddress` (Coinbase-managed) on Base.
router.get('/sell/status', async (req: Request, res: Response) => {
  const ref = String(req.query.partnerUserRef || '').toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(ref)) {
    res.status(400).json({ error: 'partnerUserRef required' });
    return;
  }
  // Only the owner of that wallet may read its offramp status.
  if (!requireWalletMatch(req, res, ref, 'partnerUserRef')) return;
  if (provider() !== 'coinbase') {
    res.json({ status: null });
    return;
  }
  try {
    const status = await coinbaseOnrampService.getSellStatus(ref);
    res.json(status ?? { status: null });
  } catch (error: any) {
    console.error('[ramp/sell/status]', error?.message || error);
    res.status(502).json({ error: 'Status check failed' });
  }
});

// POST /api/ramp/event { type: 'buy'|'sell', status, amount, walletAddress, ref }
//   Record a ramp order's status + fire a notification. Called by the client at the points it observes
//   (checkout started, Apple Pay completed, cash-out sent). SEAM: a Coinbase webhook can call the same
//   path later for provider-confirmed completed/failed even when the app is closed.
const RAMP_NOTIFS: Record<string, { kind: NotificationKind; title: string; body: (amt: string) => string }> = {
  'buy:submitted': { kind: 'pending', title: 'Deposit started', body: (a) => `Your ${a} top-up is processing.` },
  'buy:completed': { kind: 'received', title: 'Money added', body: (a) => `${a} landed in your balance.` },
  'buy:failed': { kind: 'system', title: 'Deposit didn’t go through', body: (a) => `Your ${a} top-up didn’t complete.` },
  'sell:submitted': { kind: 'sent', title: 'Cash-out on its way', body: (a) => `${a} is being sent to your card.` },
  'sell:completed': { kind: 'sent', title: 'Cash-out complete', body: (a) => `${a} has been paid out to your card.` },
  'sell:failed': { kind: 'system', title: 'Cash-out failed', body: (a) => `Your ${a} cash-out didn’t complete.` },
};
router.post('/event', async (req: Request, res: Response) => {
  const b = (req.body || {}) as Record<string, unknown>;
  const type = String(b.type || '');
  const status = String(b.status || '');
  const amount = Number(b.amount);
  const walletAddress = String(b.walletAddress || '').toLowerCase();
  const ref = String(b.ref || '').trim();
  const spec = RAMP_NOTIFS[`${type}:${status}`];
  if (!spec || !ref || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    res.status(400).json({ error: 'type/status, ref and walletAddress are required' });
    return;
  }
  if (!requireWalletMatch(req, res, walletAddress, 'walletAddress')) return;
  const amt = amount > 0 ? `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Your';
  try {
    await onramperStore
      .upsert({ id: `cb:${ref}`, wallet: walletAddress, status, provider: 'coinbase', fiatAmount: amount || null, cryptoAmount: null, raw: { type, ref } })
      .catch(() => {});
    await notificationStore.emit({
      wallet: walletAddress,
      kind: spec.kind,
      title: spec.title,
      body: spec.body(amt),
      data: { type, status, amount: amount || null, href: type === 'sell' ? '/transactions' : '/' },
      dedupeKey: `ramp:${ref}:${status}`,
    }).catch(() => {});
    res.json({ ok: true });
  } catch (error) {
    console.error('[ramp/event]', error);
    res.json({ ok: false });
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
