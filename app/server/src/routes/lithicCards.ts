import express, { type Request, type Response } from 'express';
import { listCardTransactions } from '../services/lithic/cardTransactionsService.js';
import { isConfigured } from '../services/lithic/lithicClient.js';
import { cardStore } from '../services/lithic/cardStore.js';
import { cardService } from '../services/lithic/cardService.js';

const router = express.Router();

/*
 * Member-facing card endpoints — spec step 8.
 *
 * Two rules hold everywhere in this file.
 *
 * The wallet comes from the verified session, never from the body. These endpoints freeze cards and
 * reveal card details; accepting a caller-supplied address would let any signed-in member operate
 * anyone else's card.
 *
 * Every mutation checks ownership against our own mapping before it reaches Lithic. A card token is
 * not a secret — it appears in webhooks and logs — so possession of one proves nothing.
 */

function sessionWallet(req: Request): string {
  return String(req.auth?.smartWallet || req.auth?.walletAddress || '')
    .trim()
    .toLowerCase();
}

/** Loads the card only if this session owns it. */
async function ownedCard(req: Request): Promise<{ token: string } | null> {
  const wallet = sessionWallet(req);
  const token = String(req.params.token || '');
  if (!wallet || !token) return null;
  const record = await cardStore.get(token);
  return record && record.wallet === wallet ? { token } : null;
}

/** GET /api/lithic/cards — this member's cards. */
router.get('/', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  if (!isConfigured() || !cardStore.isConfigured()) {
    return res.json({ configured: false, cards: [] });
  }

  try {
    return res.json({ configured: true, cards: await cardService.listCards(wallet) });
  } catch (error) {
    console.error('[cards] list failed', error);
    return res.status(500).json({ error: 'Failed to load cards' });
  }
});


/**
 * GET /api/lithic/cards/transactions — what this member's cards have spent.
 *
 * Read from our own approved authorizations rather than fetched from Lithic: every approval already
 * passes through the Auth Stream handler, which records the amount, the merchant object and which
 * tiers paid. Asking Lithic again for something we decided ourselves would be slower, rate-limited,
 * and no more true.
 *
 * Registered before `/:token` so a card token named "transactions" cannot shadow it — the tokens
 * are UUIDs and could not, but route order that depends on that is a trap for the next person.
 */
router.get('/transactions', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  if (!isConfigured()) return res.json({ transactions: [] });

  try {
    const limit = Number.parseInt(String(req.query.limit ?? '50'), 10);
    res.json({ transactions: await listCardTransactions(wallet, Number.isFinite(limit) ? limit : 50) });
  } catch (error) {
    console.error('[lithic] card transactions read failed:', error instanceof Error ? error.message : error);
    res.status(502).json({ error: 'Could not read card transactions' });
  }
});

/** POST /api/lithic/cards — issue a virtual card. */
router.post('/', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  if (!isConfigured()) return res.status(503).json({ error: 'Cards unavailable' });

  try {
    const card = await cardService.createVirtualCard(wallet, {
      memo: typeof req.body?.memo === 'string' ? req.body.memo.slice(0, 50) : undefined,
      spendLimitCents: Number(req.body?.spendLimitCents) || undefined,
      spendLimitDuration:
        typeof req.body?.spendLimitDuration === 'string' ? req.body.spendLimitDuration : undefined,
    });
    return res.status(201).json({ card });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create card';
    return res.status(400).json({ error: message });
  }
});

/** POST /api/lithic/cards/physical — order a physical card. */
router.post('/physical', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  const s = req.body?.shipping ?? {};
  const required = ['firstName', 'lastName', 'address1', 'city', 'state', 'postalCode'];
  const missing = required.filter((k) => !String(s[k] ?? '').trim());
  if (missing.length) {
    return res.status(400).json({ error: `Missing shipping fields: ${missing.join(', ')}` });
  }

  try {
    const card = await cardService.createPhysicalCard(wallet, s, {
      memo: typeof req.body?.memo === 'string' ? req.body.memo.slice(0, 50) : undefined,
    });
    return res.status(201).json({ card });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to order card';
    return res.status(400).json({ error: message });
  }
});

/** POST /api/lithic/cards/:token/freeze — freeze or unfreeze. */
router.post('/:token/freeze', async (req: Request, res: Response) => {
  const owned = await ownedCard(req);
  if (!owned) return res.status(404).json({ error: 'Card not found' });

  try {
    const card = await cardService.setFrozen(owned.token, req.body?.frozen !== false);
    return res.json({ card });
  } catch (error) {
    console.error('[cards] freeze failed', error);
    return res.status(500).json({ error: 'Failed to update card' });
  }
});

/** POST /api/lithic/cards/:token/spend-limit — the member's own guardrail. */
router.post('/:token/spend-limit', async (req: Request, res: Response) => {
  const owned = await ownedCard(req);
  if (!owned) return res.status(404).json({ error: 'Card not found' });

  const cents = Number(req.body?.spendLimitCents);
  if (!Number.isFinite(cents) || cents < 0) {
    return res.status(400).json({ error: 'spendLimitCents must be zero or more' });
  }

  try {
    const card = await cardService.setSpendLimit(
      owned.token,
      cents,
      typeof req.body?.duration === 'string' ? req.body.duration : 'MONTHLY',
    );
    return res.json({ card });
  } catch (error) {
    console.error('[cards] spend limit failed', error);
    return res.status(500).json({ error: 'Failed to update spend limit' });
  }
});

/**
 * GET /api/lithic/cards/:token/embed — a short-lived URL for Lithic's card-details iframe.
 *
 * Returns a URL, never card data. The member's browser calls Lithic directly, so the PAN and CVV
 * never pass through this server and cannot end up in its logs.
 */
router.get('/:token/embed', async (req: Request, res: Response) => {
  const owned = await ownedCard(req);
  if (!owned) return res.status(404).json({ error: 'Card not found' });

  try {
    const url = await cardService.getCardEmbedUrl(owned.token);
    // no-store: a URL that reveals card details must not sit in a shared cache.
    res.set('Cache-Control', 'no-store');
    return res.json({ url, expiresInSeconds: 60 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prepare card details';
    return res.status(400).json({ error: message });
  }
});

export default router;
