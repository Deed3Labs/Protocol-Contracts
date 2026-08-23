import { Router, type Request, type Response } from 'express';
import { requireAuth, requireVerifiedWallet } from '../middleware/auth.js';
import { chargeStore } from '../services/chargeStore.js';
import {
  approveCharge,
  declineCharge,
  raiseCharge,
  CHARGE_TTL_SECONDS,
} from '../services/chargeService.js';

/*
 * Charges: one route a merchant posts to, and three a member answers on.
 *
 * The asymmetry is the design. A merchant proves itself by signing — there is no merchant session,
 * so `POST /` authenticates from the body. Every other route is the member's own session acting on
 * their own charge, and each one re-checks that the charge is theirs rather than trusting the code:
 * a code travels by text and text gets forwarded, so possession of one cannot be what authorises
 * answering it.
 *
 * `requireAuth` is attached to those three routes individually rather than to the router, because
 * the router cannot carry it — `POST /` has no session. That is not a stylistic choice, and getting
 * it wrong is not a small bug: `requireVerifiedWallet` falls through to *true* when there is no
 * `req.auth` at all, a compatibility path for routes that authenticate some other way. Without
 * `requireAuth` in front of it, every ownership check below would pass for anyone holding a code.
 */
const chargesRouter = Router();

/** What a member is allowed to see. Payout and the merchant's address are not their business. */
function memberView(charge: {
  code: string;
  merchantName: string;
  amountCents: number;
  status: string;
  splitInto: number | null;
  planId: number | null;
  txHash: string | null;
  expiresAt: string;
  createdAt: string;
}) {
  return {
    code: charge.code,
    merchantName: charge.merchantName,
    amountCents: charge.amountCents,
    status: charge.status,
    splitInto: charge.splitInto,
    planId: charge.planId,
    txHash: charge.txHash,
    expiresAt: charge.expiresAt,
    createdAt: charge.createdAt,
  };
}

/**
 * A merchant raises a charge.
 *
 * Deliberately outside `requireAuth`: the caller is a merchant device, not a member session, and
 * it authenticates with an EIP-712 signature the service verifies against the on-chain registry.
 * Nothing here reads `req.auth`.
 */
chargesRouter.post('/', async (req: Request, res: Response) => {
  const { merchant, merchantName, member, amountCents, nonce, issuedAt, signature } = req.body ?? {};

  if (typeof merchant !== 'string' || typeof member !== 'string' || typeof signature !== 'string') {
    res.status(400).json({ error: 'Invalid request', message: 'merchant, member and signature are required' });
    return;
  }

  const result = await raiseCharge({
    merchant,
    merchantName: typeof merchantName === 'string' ? merchantName : '',
    member,
    amountCents: Number(amountCents),
    nonce: typeof nonce === 'string' ? nonce : '',
    issuedAt: Number(issuedAt),
    signature,
  });

  if (!result.ok || !result.charge) {
    // 400 rather than 401 across the board: a merchant device should not be able to tell a bad
    // signature from an inactive registration from an over-cap amount by status code alone.
    res.status(400).json({ error: 'Charge refused', message: result.reason ?? 'could not raise the charge' });
    return;
  }

  res.status(201).json({
    code: result.charge.code,
    status: result.charge.status,
    expiresAt: result.charge.expiresAt,
    ttlSeconds: CHARGE_TTL_SECONDS,
  });
});

/** The member opens it. Also what the merchant's "waiting" state is watching. */
chargesRouter.get('/:code', requireAuth, async (req: Request, res: Response) => {
  const charge = await chargeStore.get(req.params.code);
  if (!charge) {
    res.status(404).json({ error: 'Not found', message: 'No such charge.' });
    return;
  }
  if (!requireVerifiedWallet(req, res, charge.memberWallet, 'charge')) return;

  await chargeStore.markOpened(charge.code);
  res.json(memberView(charge));
});

chargesRouter.post('/:code/approve', requireAuth, async (req: Request, res: Response) => {
  const charge = await chargeStore.get(req.params.code);
  if (!charge) {
    res.status(404).json({ error: 'Not found', message: 'No such charge.' });
    return;
  }
  if (!requireVerifiedWallet(req, res, charge.memberWallet, 'charge')) return;

  const installments = Number(req.body?.installments);
  if (!Number.isInteger(installments) || installments < 1) {
    res.status(400).json({ error: 'Invalid split', message: 'installments must be a whole number.' });
    return;
  }

  const result = await approveCharge(charge.code, charge.memberWallet, installments);
  if (!result.ok || !result.charge) {
    res.status(409).json({ error: 'Could not approve', message: result.reason ?? 'Approval failed.' });
    return;
  }
  res.json(memberView(result.charge));
});

chargesRouter.post('/:code/decline', requireAuth, async (req: Request, res: Response) => {
  const charge = await chargeStore.get(req.params.code);
  if (!charge) {
    res.status(404).json({ error: 'Not found', message: 'No such charge.' });
    return;
  }
  if (!requireVerifiedWallet(req, res, charge.memberWallet, 'charge')) return;

  const result = await declineCharge(charge.code, charge.memberWallet);
  if (!result.ok || !result.charge) {
    res.status(409).json({ error: 'Could not decline', message: result.reason ?? 'Decline failed.' });
    return;
  }
  res.json(memberView(result.charge));
});

export default chargesRouter;
