import { Router, type Request, type Response } from 'express';
import { disputeStore, type DisputeKind } from '../services/disputes/disputeStore.js';
import { disputeCandidates, findCandidate } from '../services/disputes/disputeCandidates.js';
import { isCardReason, openCardDispute } from '../services/disputes/networkDispute.js';
import { holdDispute, withdrawDispute } from '../services/disputes/disputeEnforcement.js';
import { requireStepUp } from '../middleware/stepUp.js';

/*
 * Disputes — the member says a payment went wrong.
 *
 * The wallet comes from the verified session, never the body or the path: a dispute is a claim on
 * money, and one member must not be able to raise it on another's payment. The payment itself is
 * re-read from its own table before anything is stored, so the amount and the name are ours, not
 * the request's.
 */
const disputesRouter = Router();

const DETAIL_MAX = 2000;
const KINDS: DisputeKind[] = ['card', 'partner', 'member'];
const UNAVAILABLE = 'We could not file that just now. Nothing was sent, so please try again shortly.';

function sessionWallet(req: Request): string {
  return String(req.auth?.smartWallet || req.auth?.walletAddress || '')
    .trim()
    .toLowerCase();
}

/** GET /api/disputes/candidates — the payments this member can dispute, newest first per kind. */
disputesRouter.get('/candidates', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  try {
    const exclude = await disputeStore.openSubjects(wallet);
    const includeKind = String(req.query.kind ?? '') as DisputeKind;
    const includeRef = String(req.query.ref ?? '').trim();
    const include = KINDS.includes(includeKind) && includeRef ? { kind: includeKind, ref: includeRef } : undefined;
    return res.json({ candidates: await disputeCandidates(wallet, exclude, include) });
  } catch (error) {
    console.error('[disputes] candidates failed', error);
    return res.status(500).json({ error: 'Failed to read payments' });
  }
});

/** GET /api/disputes — this member's disputes. */
disputesRouter.get('/', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  try {
    return res.json({ disputes: await disputeStore.listFor(wallet) });
  } catch (error) {
    console.error('[disputes] list failed', error);
    return res.status(500).json({ error: 'Failed to read disputes' });
  }
});

/** POST /api/disputes — { kind, ref, detail, reason? } */
disputesRouter.post('/', requireStepUp, async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  const kind = String(req.body?.kind ?? '') as DisputeKind;
  const ref = String(req.body?.ref ?? '').trim();
  const detail = String(req.body?.detail ?? '').trim();
  const reason = req.body?.reason;

  if (!KINDS.includes(kind) || !ref) {
    return res.status(400).json({ error: 'Which payment', message: 'Choose the payment you are disputing.' });
  }
  if (!detail) {
    return res.status(400).json({ error: 'What went wrong', message: 'Tell us what went wrong so it can be looked at.' });
  }
  if (detail.length > DETAIL_MAX) {
    return res.status(400).json({ error: 'Too long', message: `Keep it under ${DETAIL_MAX} characters.` });
  }
  // The network decides on the reason, so a card dispute has to carry one.
  if (kind === 'card' && !isCardReason(reason)) {
    return res.status(400).json({ error: 'Why', message: 'Choose what went wrong with the card payment.' });
  }
  if (!disputeStore.isConfigured()) {
    return res.status(503).json({ error: 'Disputes unavailable', message: UNAVAILABLE });
  }

  try {
    if ((await disputeStore.openSubjects(wallet)).has(ref)) {
      return res.status(409).json({ error: 'Already disputed', message: 'You already have a dispute open on this payment.' });
    }
    const subject = await findCandidate(wallet, kind, ref);
    if (!subject) {
      return res.status(404).json({ error: 'Not found', message: 'We could not find that payment on your account.' });
    }

    const dispute = await disputeStore.file({
      wallet,
      kind,
      subjectRef: subject.ref,
      subjectLabel: subject.label,
      amountCents: subject.amountCents,
      reason: kind === 'card' ? String(reason) : null,
      detail,
    });
    if (!dispute) return res.status(503).json({ error: 'Disputes unavailable', message: UNAVAILABLE });

    // What the page promises while it is open starts now. Not awaited -- a partner plan is unwound
    // on chain -- and the sweep retries until it lands.
    const enforce = (record: typeof dispute) =>
      void holdDispute(record).catch((e) => console.error(`[disputes] hold for ${record.token} failed`, e));

    if (kind !== 'card' || !isCardReason(reason)) {
      console.log(`[disputes] ${dispute.token} (${kind}) filed by ${wallet}`);
      enforce(dispute);
      return res.status(201).json({ dispute, network: null });
    }

    // Stored first; the network is told second, and a refusal there does not undo the dispute.
    const outcome = await openCardDispute({
      transactionToken: subject.ref,
      amountCents: subject.amountCents,
      reason,
      note: detail,
    });
    const updated = (await disputeStore.recordNetwork(dispute.token, outcome)) ?? dispute;
    enforce(updated);
    console.log(
      `[disputes] ${dispute.token} (card) filed by ${wallet}; network ${'error' in outcome ? 'refused' : 'accepted'}`,
    );
    return res.status(201).json({
      dispute: updated,
      network: 'error' in outcome ? { filed: false } : { filed: true, status: outcome.status },
    });
  } catch (error) {
    console.error('[disputes] file failed', error);
    return res.status(500).json({ error: 'Failed to file dispute', message: UNAVAILABLE });
  }
});

/** POST /api/disputes/:token/withdraw — the member takes it back, before a decision. */
disputesRouter.post('/:token/withdraw', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  try {
    const result = await withdrawDispute(String(req.params.token), wallet);
    if (!result.ok) {
      const status = result.reason === 'not found' ? 404 : 409;
      return res.status(status).json({ error: 'Not withdrawn', message: result.reason });
    }
    return res.json({ withdrawn: true });
  } catch (error) {
    console.error('[disputes] withdraw failed', error);
    return res.status(500).json({ error: 'Failed to withdraw', message: 'We could not withdraw that just now. Please try again.' });
  }
});

export default disputesRouter;
