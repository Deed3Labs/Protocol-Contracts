import express, { type Request, type Response } from 'express';
import crypto from 'crypto';
import { sweepStore } from '../services/sweeps/sweepStore.js';
import { beginSweep, allocateToSavings } from '../services/sweeps/sweepService.js';
import { autoSaveStore } from '../services/deposits/autoSaveStore.js';

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
      // Surfaced separately so the UI cannot fail to show it by forgetting to filter. This is
      // money the member holds and has not placed yet — the unspendable half of their cash account.
      readyToAllocate: sweeps.filter((s) => s.state === 'ready_to_allocate'),
      // Still travelling: fiat has left Lithic, USDC has not arrived. Shows as a pending deposit.
      inFlight: sweeps.filter((s) => s.state === 'initiated' || s.state === 'fiat_debited'),
    });
  } catch (error) {
    console.error('[sweeps] list failed', error);
    return res.status(500).json({ error: 'Failed to load sweeps' });
  }
});

/*
 * Auto-save rules live here because they produce sweeps: a rule is a standing instruction to move
 * part of every deposit to savings, and the movement it causes is the saga above.
 */

/** GET /api/sweeps/auto-save — the member's standing rule, or null. */
router.get('/auto-save', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  if (!autoSaveStore.isConfigured()) return res.json({ configured: false, rule: null });

  try {
    return res.json({ configured: true, rule: await autoSaveStore.get(wallet) });
  } catch (error) {
    console.error('[auto-save] read failed', error);
    return res.status(500).json({ error: 'Failed to load auto-save' });
  }
});

/**
 * PUT /api/sweeps/auto-save — set it.
 *
 * `mode: 'percent'` with a whole number of points, or `mode: 'fixed'` with cents. Percent is the
 * better default for most people: it survives a raise or a short paycheck without being revisited.
 */
router.put('/auto-save', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  const mode = req.body?.mode;
  if (mode !== 'fixed' && mode !== 'percent') {
    return res.status(400).json({ error: "mode must be 'fixed' or 'percent'" });
  }

  try {
    const rule = await autoSaveStore.put({
      wallet,
      mode,
      value: Number(req.body?.value),
      enabled: req.body?.enabled !== false,
    });
    return res.json({ rule });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save the rule';
    return res.status(400).json({ error: message });
  }
});

/** DELETE /api/sweeps/auto-save — stop saving automatically. */
router.delete('/auto-save', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  try {
    await autoSaveStore.disable(wallet);
    return res.json({ rule: null });
  } catch (error) {
    console.error('[auto-save] disable failed', error);
    return res.status(500).json({ error: 'Failed to turn off auto-save' });
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
 * POST /api/sweeps/:id/allocate — the member putting their delivered USDC into the ESA.
 *
 * Not a retry of a stalled process: `ready_to_allocate` is where a sweep is meant to come to rest,
 * and this is the member deciding what happens next.
 *
 * Takes the same signed authorization as `/api/savings/gasless/submit`, because it is the same
 * operation — the client prepares typed data there, the member signs, and this relays it and closes
 * the sweep out. The server contributes gas and nothing else; the USDC is the member's and cannot
 * move without their signature.
 *
 * Ownership is checked twice on purpose: the session must own the sweep, and the signature must be
 * the same wallet. A sweep id is guessable, and this moves money.
 */
router.post('/:id/allocate', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  const body = req.body ?? {};
  if (!body.signature || !body.submit) {
    return res.status(400).json({
      error: 'A signed authorization is required',
      message: 'Prepare the deposit at /api/savings/gasless/prepare and sign it first.',
    });
  }

  try {
    const existing = await sweepStore.get(String(req.params.id));
    if (!existing || existing.wallet !== wallet) {
      return res.status(404).json({ error: 'Sweep not found' });
    }

    const result = await allocateToSavings(existing.id, {
      signature: String(body.signature),
      submit: body.submit,
      chainId: Number(body.chainId) || undefined,
    });
    if (result.error) return res.status(409).json({ error: result.error, sweep: result.sweep });
    return res.json({ sweep: result.sweep });
  } catch (error) {
    console.error('[sweeps] allocate failed', error);
    return res.status(500).json({ error: 'Failed to allocate' });
  }
});

export default router;
