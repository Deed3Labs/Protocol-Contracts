import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as cards from '../services/clearCardService.js';

/*
 * Clear card (Bridge / Stripe Issuing) — P2 scaffold. Every route no-ops with `configured:false` until
 * STRIPE_SECRET_KEY is set, so this is inert in prod/dev without credentials. See clearCardService.ts.
 */
const router = Router();
const DEFAULT_CHAIN = 8453; // Base

router.get('/', requireAuth, async (req: Request, res: Response) => {
  if (!cards.isConfigured()) return res.json({ configured: false, card: null });
  const wallet = req.auth?.walletAddress;
  if (!wallet) return res.status(401).json({ error: 'Unauthorized' });
  return res.json({ configured: true, card: await cards.getCard(wallet) });
});

// Ensure a cardholder (Bridge "cards" endorsement) + issue a virtual card. Returns 'pending' until the
// Bridge endorsement is live (see the TODO in clearCardService.ensureCardholder).
router.post('/activate', requireAuth, async (req: Request, res: Response) => {
  if (!cards.isConfigured()) return res.status(503).json({ error: 'Cards not configured' });
  const wallet = req.auth?.walletAddress;
  if (!wallet) return res.status(401).json({ error: 'Unauthorized' });
  const { walletAddress, chainId } = (req.body ?? {}) as { walletAddress?: string; chainId?: number };
  try {
    const { cardholderId, pending } = await cards.ensureCardholder(wallet, { email: null, name: null });
    if (!cardholderId || pending) return res.json({ status: 'pending', card: await cards.getCard(wallet) });
    const card = await cards.issueCard(wallet, {
      cardholderId,
      walletAddress: walletAddress || wallet,
      chainId: chainId || DEFAULT_CHAIN,
    });
    return res.json({ status: card.status, card });
  } catch (e) {
    console.error('card activate error:', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Activation failed' });
  }
});

// Mint an ephemeral key for the Stripe Issuing Element. Client sends the nonce it generated with
// stripe.createEphemeralKeyNonce + its Stripe.js apiVersion.
router.post('/ephemeral-key', requireAuth, async (req: Request, res: Response) => {
  if (!cards.isConfigured()) return res.status(503).json({ error: 'Cards not configured' });
  const wallet = req.auth?.walletAddress;
  if (!wallet) return res.status(401).json({ error: 'Unauthorized' });
  const { nonce, apiVersion } = (req.body ?? {}) as { nonce?: string; apiVersion?: string };
  if (!nonce || !apiVersion) return res.status(400).json({ error: 'Missing nonce/apiVersion' });
  const card = await cards.getCard(wallet);
  if (!card?.stripeCardId) return res.status(404).json({ error: 'No card' });
  try {
    const secret = await cards.ephemeralKey(card.stripeCardId, nonce, apiVersion);
    return res.json({ secret, cardId: card.stripeCardId });
  } catch (e) {
    console.error('ephemeral-key error:', e);
    return res.status(500).json({ error: 'Failed to create key' });
  }
});

router.post('/freeze', requireAuth, async (req: Request, res: Response) => {
  if (!cards.isConfigured()) return res.status(503).json({ error: 'Cards not configured' });
  const wallet = req.auth?.walletAddress;
  if (!wallet) return res.status(401).json({ error: 'Unauthorized' });
  const card = await cards.getCard(wallet);
  if (!card?.stripeCardId) return res.status(404).json({ error: 'No card' });
  try {
    const updated = await cards.setActive(wallet, card.stripeCardId, Boolean((req.body ?? {}).active));
    return res.json({ card: updated });
  } catch (e) {
    console.error('card freeze error:', e);
    return res.status(500).json({ error: 'Failed' });
  }
});

export default router;
