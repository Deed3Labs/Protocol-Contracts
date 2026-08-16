import express, { type Request, type Response } from 'express';
import crypto from 'crypto';
import { sweepStore } from '../services/sweeps/sweepStore.js';
import { beginSweep, retryAllocation } from '../services/sweeps/sweepService.js';

const router = express.Router();

/*
 * Member-facing sweep endpoints — spec step 7.
 *
 * The wallet comes from the verified session and never from the request body. A sweep moves the
 * caller's own money; accepting an address would let any signed-in member debit anyone.
 *
 * The point of exposing sweeps at all is `ready_to_allocate`. A member whose sweep stalled after
 * the USDC landed has money on their smart account that the app put there and did not finish
 * placing. They are entitled to see exactly that, and to act on it.
 */

function sessionWallet(req: Request): string {
  return String(req.auth?.smartWallet || req.auth?.walletAddress || '')
    .trim()
    .toLowerCase();
}

/** GET /api/sweeps — this member's sweeps, most recent first. */
router.get('/', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  if (!sweepStore.isConfigured()) return res.json({ configured: false, sweeps: [] });

  try {
    const sweeps = await sweepStore.listFor(wallet);
    return res.json({
      configured: true,
      sweeps,
      // Surfaced separately so the UI cannot fail to show it by forgetting to filter.
      needsAttention: sweeps.filter((s) => s.state === 'ready_to_allocate'),
    });
  } catch (error) {
    console.error('[sweeps] list failed', error);
    return res.status(500).json({ error: 'Failed to load sweeps' });
  }
});

/**
 * POST /api/sweeps — start one.
 *
 * `idempotencyKey` is the caller's to choose and the whole defence against a double-tap becoming
 * two debits. When absent we mint one, which makes a retried request a second sweep — so the client
 * should always send it.
 */
router.post('/', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  if (!sweepStore.isConfigured()) return res.status(503).json({ error: 'Sweeps unavailable' });

  const amountCents = Math.round(Number(req.body?.amountCents ?? 0));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: 'amountCents must be positive' });
  }

  const id = String(req.body?.idempotencyKey || '').trim() || crypto.randomUUID();

  try {
    // Sweeps starting in the same hour share a batch key, so the treasury converts once for all of
    // them rather than once each. Payday is the case this exists for.
    const batchKey = new Date().toISOString().slice(0, 13);
    const sweep = await beginSweep({ id, wallet, amountCents, batchKey });
    return res.status(201).json({ sweep });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start sweep';
    return res.status(400).json({ error: message });
  }
});

/**
 * POST /api/sweeps/:id/allocate — finish a sweep stuck in `ready_to_allocate`.
 *
 * Ownership is checked before anything moves: a sweep id is guessable, and this resumes a money
 * movement.
 */
router.post('/:id/allocate', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  try {
    const existing = await sweepStore.get(String(req.params.id));
    if (!existing || existing.wallet !== wallet) {
      return res.status(404).json({ error: 'Sweep not found' });
    }

    const result = await retryAllocation(existing.id);
    if (result.error) return res.status(409).json({ error: result.error, sweep: result.sweep });
    return res.json({ sweep: result.sweep });
  } catch (error) {
    console.error('[sweeps] allocate failed', error);
    return res.status(500).json({ error: 'Failed to allocate' });
  }
});

export default router;
