import { Router, type Request, type Response } from 'express';
import { requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { chargeStore } from '../services/chargeStore.js';
import { refundStore } from '../services/merchant/refundStore.js';
import { sessionStore } from '../services/merchant/sessionStore.js';
import { attemptLimiter, staffStore } from '../services/merchant/staffStore.js';
import { merchantProfileStore } from '../services/merchant/profileStore.js';

/**
 * The merchant surface.
 *
 * Everything a counter tablet does except raising a charge, which lives in `routes/charges.ts`
 * because it authenticates differently — a merchant device signs an EIP-712 payload the registry
 * verifies on chain, and has no session at that point. Once a shop is set up, its staff sign in
 * here and carry a bearer token.
 *
 * **Two roles, enforced server-side.** The app hides Payouts and Staff from a counter writer's
 * nav, but a shared tablet is a device where a URL can be retyped, so `requireOwner` is the check
 * that actually matters. Counter staff never see payout figures, bank details, the rate or the
 * month's totals — and none of those fields leave this file without passing it.
 */

const merchantRouter = Router();

/** Sign-in is scoped to one shop: a four-digit PIN only means anything against a merchant. */
function merchantOf(req: Request): string {
  return String(req.body?.merchant ?? '').trim().toLowerCase();
}

/**
 * Start a shift.
 *
 * PIN for counter staff, email and password for an owner. One route rather than two so a failed
 * attempt cannot be told apart by which endpoint refused it.
 */
merchantRouter.post('/session', async (req: Request, res: Response) => {
  const merchant = merchantOf(req);
  const { pin, email, password } = req.body ?? {};

  if (!merchant) {
    res.status(400).json({ error: 'Invalid request', message: 'merchant is required' });
    return;
  }

  const gate = attemptLimiter(merchant);
  if (!gate.allowed) {
    res.status(429).json({
      error: 'Too many attempts',
      message: `Too many failed sign-ins. Try again in ${Math.ceil((gate.retryInSeconds ?? 60) / 60)} minutes.`,
    });
    return;
  }

  const staff =
    typeof pin === 'string' && pin.length > 0
      ? await staffStore.signInWithPin(merchant, pin)
      : typeof email === 'string' && typeof password === 'string'
        ? await staffStore.signInWithPassword(merchant, email, password)
        : null;

  if (!staff) {
    // One message for every failure mode. A writer who mistypes and an attacker guessing get the
    // same sentence, because the difference is only useful to the attacker.
    res.status(401).json({ error: 'Unauthorized', message: 'That did not match.' });
    return;
  }

  const session = await sessionStore.create(staff);
  if (!session) {
    res.status(503).json({ error: 'Unavailable', message: 'sessions are not configured' });
    return;
  }

  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    staff: { id: staff.id, name: staff.name, role: staff.role },
    merchant: staff.merchant,
  });
});

/** End a shift. */
merchantRouter.delete('/session', requireMerchant, async (req: Request, res: Response) => {
  await sessionStore.destroy((req.headers.authorization || '').replace('Bearer ', '').trim());
  res.json({ ok: true });
});

/** Who am I — the app calls this on load to decide what to render. */
merchantRouter.get('/session', requireMerchant, (req: Request, res: Response) => {
  const s = req.merchant!;
  res.json({
    staff: { id: s.staff.id, name: s.staff.name, role: s.staff.role },
    merchant: s.merchant,
    expiresAt: s.expiresAt,
  });
});

/**
 * The shop's own charges.
 *
 * Every row carries `raisedBy` so the list can say who raised it — not surveillance, it is how an
 * owner works out which writer is actually offering it. Counter staff see this list too: what is
 * waiting is their job.
 */
merchantRouter.get('/charges', requireMerchant, async (req: Request, res: Response) => {
  const { merchant, staff } = req.merchant!;
  const since = req.query.since ? new Date(String(req.query.since)) : undefined;
  const rows = await chargeStore.listByMerchant(merchant, {
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    limit: Math.min(Number(req.query.limit) || 200, 500),
  });

  const staffNames = new Map((await staffStore.list(merchant)).map((s) => [s.id, s.name]));
  const openRefunds = new Map(
    (await refundStore.listByMerchant(merchant, 200))
      .filter((r) => r.state === 'requested')
      .map((r) => [r.chargeCode, r]),
  );

  res.json({
    charges: rows.map((c) => ({
      code: c.code,
      amountCents: c.amountCents,
      // The payout is money: a counter writer never sees it.
      payoutCents: staff.role === 'owner' ? c.payoutCents : undefined,
      status: openRefunds.has(c.code) ? 'refund_requested' : c.status,
      splitInto: c.splitInto,
      member: c.memberWallet ? { displayName: shortWallet(c.memberWallet) } : null,
      raisedBy: c.raisedBy ? (staffNames.get(c.raisedBy) ?? null) : null,
      raisedByStaffId: c.raisedBy,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      openedAt: c.openedAt,
      resolvedAt: c.resolvedAt,
    })),
  });
});

/**
 * The shop withdraws a charge the member has not answered.
 *
 * Counter staff may cancel one they raised; an owner may cancel any. The store's UPDATE is
 * guarded on `pending`, so a member approving at the same moment wins or loses cleanly rather
 * than both succeeding.
 */
merchantRouter.post('/charges/:code/cancel', requireMerchant, async (req: Request, res: Response) => {
  const { merchant, staff } = req.merchant!;
  const existing = await chargeStore.get(req.params.code);

  if (!existing || existing.merchantAddress !== merchant) {
    res.status(404).json({ error: 'Not found', message: 'no such charge' });
    return;
  }
  if (staff.role !== 'owner' && existing.raisedBy !== staff.id) {
    res.status(403).json({ error: 'Forbidden', message: 'you can only cancel a charge you raised' });
    return;
  }

  const cancelled = await chargeStore.cancel(req.params.code, merchant);
  if (!cancelled) {
    res.status(409).json({
      error: 'Too late',
      message: 'They have already answered this one.',
    });
    return;
  }
  res.json({ code: cancelled.code, status: cancelled.status });
});

/**
 * Check an owner's code without issuing them a session.
 *
 * Step two of a refund: an owner walks over and types their code so the writer's screen can move
 * to the authorise step. It deliberately returns only a name — no token, no session — because the
 * owner is approving one act, not starting a shift. The decision itself re-sends the code, so
 * nothing here grants anything that outlives the request.
 */
merchantRouter.post('/owner-check', requireMerchant, async (req: Request, res: Response) => {
  const { merchant } = req.merchant!;
  const owner = await staffStore.verifyOwnerSecret(merchant, String(req.body?.code ?? ''));
  if (!owner) {
    res.status(401).json({ error: 'Unauthorized', message: 'That code was not recognised.' });
    return;
  }
  res.json({ id: owner.id, name: owner.name, role: owner.role });
});

/** Any staff member can start a refund. It moves nothing. */
merchantRouter.post('/refunds', requireMerchant, async (req: Request, res: Response) => {
  const { merchant, staff } = req.merchant!;
  const { chargeCode, splitInto, cyclesCleared, ratePerCycle, discountRate, nextPayoutCents } =
    req.body ?? {};

  const result = await refundStore.request({
    chargeCode: String(chargeCode ?? ''),
    merchant,
    staff,
    splitInto: Number(splitInto) || 1,
    cyclesCleared: Number(cyclesCleared) || 0,
    ratePerCycle: Number(ratePerCycle) || 0,
    discountRate: Number(discountRate) || 0,
    nextPayoutCents: Number(nextPayoutCents) || 0,
  });

  if (!result.ok || !result.refund) {
    res.status(400).json({ error: 'Refund refused', message: result.reason ?? 'could not start it' });
    return;
  }
  res.status(201).json(await withNames(result.refund));
});

/**
 * An owner authorises, by code, without taking over the session.
 *
 * The writer stays signed in: the owner is approving one act rather than starting a shift. That is
 * the whole point of the three-step flow, and it is why this verifies a secret rather than issuing
 * a token.
 */
merchantRouter.post('/refunds/:id/authorise', requireMerchant, async (req: Request, res: Response) => {
  const { merchant } = req.merchant!;
  const { code, decision } = req.body ?? {};

  const owner = await staffStore.verifyOwnerSecret(merchant, String(code ?? ''));
  if (!owner) {
    res.status(401).json({ error: 'Unauthorized', message: 'That code was not recognised.' });
    return;
  }

  const refund = await refundStore.get(req.params.id, merchant);
  if (!refund) {
    res.status(404).json({ error: 'Not found', message: 'no such refund' });
    return;
  }

  const result =
    decision === 'decline'
      ? await refundStore.decline(refund.id, owner)
      : await refundStore.approve(refund.id, owner);

  if (!result.ok || !result.refund) {
    res.status(409).json({ error: 'Conflict', message: result.reason ?? 'could not settle it' });
    return;
  }
  res.json(await withNames(result.refund));
});

/** The writer withdraws their own request. Nothing was ever said to the customer. */
merchantRouter.delete('/refunds/:id', requireMerchant, async (req: Request, res: Response) => {
  const { staff } = req.merchant!;
  const ok = await refundStore.withdraw(req.params.id, staff);
  res.status(ok ? 200 : 409).json({ ok });
});

/** Payouts are money. Owner only, enforced here rather than in the nav. */
merchantRouter.get('/payouts', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const { merchant } = req.merchant!;
  const position = await merchantProfileStore.payoutPosition(merchant);
  res.json(position);
});

/** Staff are the powers of the shop. Owner only. */
merchantRouter.get('/staff', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const { merchant } = req.merchant!;
  const [staff, counts] = await Promise.all([
    staffStore.list(merchant),
    merchantProfileStore.chargeCountsByStaff(merchant),
  ]);
  res.json({
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      active: s.active,
      chargesThisMonth: counts[s.id] ?? 0,
    })),
  });
});

merchantRouter.post('/staff', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const { merchant } = req.merchant!;
  const { name, role, secret, email } = req.body ?? {};
  try {
    const added = await staffStore.add({
      merchant,
      name: String(name ?? ''),
      role: role === 'owner' ? 'owner' : 'counter',
      secret: String(secret ?? ''),
      email: typeof email === 'string' ? email : undefined,
    });
    res.status(201).json({ id: added?.id, name: added?.name, role: added?.role });
  } catch (err) {
    res.status(400).json({ error: 'Invalid', message: (err as Error).message });
  }
});

/** The shop's own details. The rate and cap are owner-only; the name is not. */
merchantRouter.get('/profile', requireMerchant, async (req: Request, res: Response) => {
  const { merchant, staff } = req.merchant!;
  res.json(await merchantProfileStore.forDisplay(merchant, staff.role === 'owner'));
});

/** `0x1234…abcd` — a merchant is never shown a member's full address. */
function shortWallet(w: string): string {
  return w.length > 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

async function withNames(refund: Awaited<ReturnType<typeof refundStore.get>>) {
  if (!refund) return null;
  const names = await refundStore.namesFor(refund);
  return { ...refund, requestedByName: names.requestedBy, decidedByName: names.decidedBy };
}

export default merchantRouter;
