import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { contactsStore } from '../services/contactsStore.js';

/*
 * Contacts CRUD + member-directory lookup + opt-out. Wallet-scoped (requireWalletMatch), under
 * requireAuth. See services/contactsStore.ts.
 */
const router = Router();
const wallet = (req: Request) => String(req.params.wallet || '').toLowerCase();

function ensureReady(res: Response): boolean {
  if (!contactsStore.isConfigured()) {
    res.status(503).json({ error: 'Contacts not configured' });
    return false;
  }
  return true;
}

// Simple per-wallet rate limit for directory lookups (30 / minute).
const lookupHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const slot = lookupHits.get(key);
  if (!slot || now > slot.resetAt) {
    lookupHits.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  slot.count += 1;
  return slot.count > 30;
}

// GET /api/contacts/:wallet
router.get('/:wallet', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    res.json({ contacts: await contactsStore.list(w) });
  } catch (error) {
    console.error('[contacts/list]', error);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

// POST /api/contacts/:wallet  { name, email?, phone?, wallet? }
router.post('/:wallet', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  const b = req.body as { name?: string; email?: string; phone?: string; wallet?: string };
  if (!b?.name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  try {
    const contact = await contactsStore.add(w, {
      name: b.name.trim().slice(0, 200),
      email: b.email?.trim().slice(0, 320) || null,
      phone: b.phone?.trim().slice(0, 40) || null,
      wallet: b.wallet?.trim().slice(0, 64) || null,
    });
    res.json({ contact });
  } catch (error) {
    console.error('[contacts/add]', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// PATCH /api/contacts/:wallet/:id
router.patch('/:wallet/:id', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  const b = req.body as { name?: string; email?: string; phone?: string; wallet?: string };
  try {
    const contact = await contactsStore.update(w, String(req.params.id), {
      name: b.name?.trim().slice(0, 200),
      email: b.email?.trim().slice(0, 320),
      phone: b.phone?.trim().slice(0, 40),
      wallet: b.wallet?.trim().slice(0, 64),
    });
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json({ contact });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// DELETE /api/contacts/:wallet/:id
router.delete('/:wallet/:id', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    await contactsStore.remove(w, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove contact' });
  }
});

// GET /api/contacts/:wallet/lookup?email=&phone=  → { wallet, matchedOn } | { wallet: null }
router.get('/:wallet/lookup', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  if (rateLimited(w)) {
    res.status(429).json({ error: 'Too many lookups' });
    return;
  }
  const email = typeof req.query.email === 'string' ? req.query.email : undefined;
  const phone = typeof req.query.phone === 'string' ? req.query.phone : undefined;
  try {
    const match = await contactsStore.lookupWallet(email, phone);
    res.json(match ?? { wallet: null });
  } catch (error) {
    console.error('[contacts/lookup]', error);
    res.json({ wallet: null });
  }
});

// GET/PUT /api/contacts/:wallet/optout  → directory discoverability toggle
router.get('/:wallet/optout', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    res.json({ optedOut: await contactsStore.isOptedOut(w) });
  } catch {
    res.json({ optedOut: false });
  }
});

router.put('/:wallet/optout', async (req: Request, res: Response) => {
  const w = wallet(req);
  if (!requireWalletMatch(req, res, w, 'wallet')) return;
  if (!ensureReady(res)) return;
  try {
    await contactsStore.setOptout(w, Boolean((req.body as { optout?: boolean })?.optout));
    res.json({ optedOut: await contactsStore.isOptedOut(w) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update preference' });
  }
});

export default router;
