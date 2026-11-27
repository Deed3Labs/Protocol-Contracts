import { Router, type Request, type Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { claimStore } from '../services/assurance/claimStore.js';

/*
 * Assurance claims.
 *
 * The page promises a person reads it, usually the same day. Nothing here decides anything — it
 * takes the member's account of what happened, stores it, and hands back a token they can be told
 * out loud. Every other state on a claim is somebody moving it by hand.
 *
 * The one rule this route enforces is the one the claim page states: a protection you have not
 * unlocked cannot be claimed on. That check belongs on the server because the client's copy of
 * which protections are active is a render of data it was given, and a claim is money.
 */
const assuranceRouter = Router();

/** The member's own account, in their words. Long enough to explain, short enough to read. */
const DETAIL_MAX = 2000;

assuranceRouter.get('/:wallet/claims', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;

  try {
    res.json({ wallet: wallet.toLowerCase(), claims: await claimStore.listFor(wallet) });
  } catch (error) {
    console.error('[assurance] claim list failed', error);
    res.status(500).json({ error: 'Failed to read claims' });
  }
});

assuranceRouter.post('/:wallet/claims', async (req: Request, res: Response) => {
  const wallet = req.params.wallet;
  if (!requireWalletMatch(req, res, wallet, 'wallet')) return;

  const protectionId = String(req.body?.protectionId ?? '').trim();
  const protectionName = String(req.body?.protectionName ?? '').trim();
  const detail = String(req.body?.detail ?? '').trim();

  if (!protectionId || !protectionName) {
    res.status(400).json({ error: 'Which protection', message: 'A claim has to name what it is claiming on.' });
    return;
  }
  if (!detail) {
    res.status(400).json({ error: 'What happened', message: 'Tell us what happened so somebody can read it.' });
    return;
  }
  if (detail.length > DETAIL_MAX) {
    res.status(400).json({ error: 'Too long', message: `Keep it under ${DETAIL_MAX} characters.` });
    return;
  }

  /*
   * No database means no claim, and the member is told so.
   *
   * The alternative — answering 200 and dropping it — is the exact failure this whole flow is
   * built against: a form that looked like it worked on the day somebody needed it to.
   */
  if (!claimStore.isConfigured()) {
    res.status(503).json({
      error: 'Claims unavailable',
      message: 'We could not file that just now. Nothing was sent, so please try again shortly.',
    });
    return;
  }

  try {
    const claim = await claimStore.file({ wallet, protectionId, protectionName, detail });
    if (!claim) {
      res.status(503).json({
        error: 'Claims unavailable',
        message: 'We could not file that just now. Nothing was sent, so please try again shortly.',
      });
      return;
    }
    console.log(`[assurance] claim ${claim.token} filed on ${protectionName} for ${claim.wallet}`);
    res.status(201).json({ claim });
  } catch (error) {
    console.error('[assurance] claim failed', error);
    res.status(500).json({ error: 'Failed to file claim' });
  }
});

/**
 * The published record — the figures the claim page states before a member claims.
 *
 * Co-op-wide and deliberately including the declines: a reserve that never says no is not being
 * managed, and the page says so, so the decline count comes from the same place as the paid one.
 */
assuranceRouter.get('/record', async (_req: Request, res: Response) => {
  try {
    res.json({ ...(await claimStore.record()), source: 'claims' });
  } catch (error) {
    console.error('[assurance] record failed', error);
    res.status(500).json({ error: 'Failed to read the record' });
  }
});

export default assuranceRouter;
