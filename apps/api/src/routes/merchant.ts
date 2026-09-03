import { Router, type Request, type Response } from 'express';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import {
  requireDevice,
  requireManager,
  requireMerchant,
  requireOwner,
} from '../middleware/merchantAuth.js';
import { chargeStore } from '../services/chargeStore.js';
import { ownerCodeLimitFor, refundStore } from '../services/merchant/refundStore.js';
import { DEFAULT_IDLE_LOCK_SECONDS, deviceStore } from '../services/merchant/deviceStore.js';
import { sessionStore } from '../services/merchant/sessionStore.js';
import { attemptLimiter, staffStore } from '../services/merchant/staffStore.js';
import { merchantProfileStore } from '../services/merchant/profileStore.js';
import { canAddRole, type StaffRole } from '@clear/domain';
import { raiseChargeFromDevice, readMerchantTerms } from '../services/chargeService.js';
import { verifyPrivyToken } from '../services/merchant/privyOrg.js';
import { onboardMerchant } from '../services/merchant/onboardingService.js';

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

// Every handler below is async, and Express 4 lets a rejected one hang the request forever rather
// than answering. This makes them fail loudly instead — including the ones added after today.
const merchantRouter = forwardAsyncErrors(Router());

/** Sign-in is scoped to one shop: a four-digit PIN only means anything against a merchant. */
function merchantOf(req: Request): string {
  return String(req.body?.merchant ?? '').trim().toLowerCase();
}

/**
 * The shift roster — who is on the counter to choose from.
 *
 * Reached before anyone has signed in, so it is scoped only by merchant. It returns first names
 * and roles and nothing else: no counts, no emails, no secrets. That is close to public for a shop
 * whose address is already on chain, and it is the price of not asking a writer to remember which
 * of four codes is theirs — a borrowed PIN makes the name on every charge row a lie.
 *
 * Behind device authentication: the tablet says which shop it is, so this no longer takes a
 * merchant address from the request body — which anyone could have supplied — and an unenrolled
 * tablet gets no roster at all.
 */
merchantRouter.post('/roster', requireDevice, async (req: Request, res: Response) => {
  res.json({ staff: await staffStore.roster(req.device!.merchant) });
});

/**
 * Start a shift.
 *
 * A name was picked on the roster, then a PIN. This starts a SHIFT, not a login: it says who is at
 * the counter so charges can be attributed, and it authorises nothing that moves money. An owner
 * appears on the same roster and starts a shift the same way — making Mike sign in differently to
 * raise a charge is a reason to hand the tablet to Jen instead.
 *
 * Anything that moves money needs the owner's Privy sign-in, which does not happen here.
 */
merchantRouter.post('/session', requireDevice, async (req: Request, res: Response) => {
  const merchant = req.device!.merchant;
  const { pin, staffId } = req.body ?? {};

  const gate = attemptLimiter(merchant);
  if (!gate.allowed) {
    res.status(429).json({
      error: 'Too many attempts',
      message: `Too many failed sign-ins. Try again in ${Math.ceil((gate.retryInSeconds ?? 60) / 60)} minutes.`,
    });
    return;
  }

  // Shift start only. There is deliberately no password path: an owner authenticates through
  // Privy — emailed code, passkey or an existing wallet — and Clear holds no owner credential to
  // check. A password box on the one screen that controls the money would imply otherwise.
  const staff =
    typeof pin === 'string' && pin.length > 0
      ? await staffStore.signInWithPin(merchant, pin, typeof staffId === 'string' ? staffId : undefined)
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

/**
 * Sign in as the owner — the only thing here that is a login.
 *
 * Takes a Privy access token, nothing else. Clear never sees an owner credential: Privy
 * authenticated them by emailed code, passkey or an existing wallet, and this route's whole job is
 * to check that token and find which shop the resulting user owns.
 *
 * Needed to move money, change terms or manage staff. **Not** needed to take a payment — that is
 * a shift, and it starts with a PIN on the roster. An owner who believes signing in is required to
 * raise a charge will sign in on a shared tablet and leave it signed in, which is the thing this
 * split exists to prevent.
 */
merchantRouter.post('/session/owner', async (req: Request, res: Response) => {
  // Deliberately NOT behind `requireDevice`: this is the route an owner uses on a tablet that has
  // not been enrolled yet, which is the only way a tablet ever becomes enrolled. Requiring a
  // device here would make enrollment impossible to reach.
  const merchant = merchantOf(req);
  const token = String(req.body?.privyToken ?? '');

  if (!token) {
    res.status(400).json({ error: 'Invalid request', message: 'token is required' });
    return;
  }

  const privyUserId = await verifyPrivyToken(token);
  if (!privyUserId) {
    res.status(401).json({ error: 'Unauthorized', message: 'That sign-in could not be verified.' });
    return;
  }

  // The token proves who they are; this proves the shop is theirs. Both are required — a valid
  // Privy user is not by itself an owner of anything.
  //
  // A fresh tablet cannot name the shop, so when it does not, Privy identity decides: almost every
  // owner has exactly one. More than one is asked rather than guessed, because signing in to the
  // wrong shop on a counter tablet is a mistake that only shows up in somebody's payouts.
  let staff = null;
  if (merchant) {
    staff = await staffStore.findByPrivyUser(merchant, privyUserId);
  } else {
    const shops = await staffStore.shopsForPrivyUser(privyUserId);
    if (shops.length > 1) {
      res.status(409).json({
        error: 'Choose a shop',
        message: 'That account owns more than one shop.',
        shops: shops.map((sh) => ({ merchant: sh.merchant, name: sh.name })),
      });
      return;
    }
    staff = shops[0] ?? null;
  }

  if (!staff || staff.role !== 'owner') {
    res.status(403).json({ error: 'Forbidden', message: 'That account does not own this shop.' });
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


/**
 * Bringing a shop into existence — reference section 13.
 *
 * Unauthenticated by design, and the only route here that is. Every other merchant route needs
 * either an enrolled device or a session, and a shop being created has neither: no staff exist to
 * sign in as, no tablet has been set up, and there is no merchant address yet because the address
 * is what this call produces. What stands in for auth is the Privy token — the owner signed in
 * with an emailed code or a passkey before reaching this step, and that identity becomes the
 * owner of the organization.
 *
 * The shop's address is NOT accepted from the client. It is the organization wallet's address, so
 * the registry, the payout destination and Clear's own row name the same thing by construction.
 */
merchantRouter.post('/onboarding', async (req: Request, res: Response) => {
  const privyToken = String(req.body?.privyToken ?? '');
  const shopName = String(req.body?.shopName ?? '').trim();
  const ownerName = String(req.body?.ownerName ?? '').trim();
  const ownerPin = String(req.body?.ownerPin ?? '');

  if (!privyToken || !shopName || !ownerName) {
    res.status(400).json({
      error: 'Invalid request',
      message: 'A shop name, your name and a verified sign-in are all required.',
    });
    return;
  }

  const result = await onboardMerchant({
    privyToken,
    shopName,
    ownerName,
    ownerPin,
    category: req.body?.category ? String(req.body.category) : null,
    town: req.body?.town ? String(req.body.town) : null,
  });

  if (!result.ok) {
    // Each failure says what the person can do about it. "Something went wrong" at step six of a
    // signup is where shops give up.
    const map = {
      unverified: [401, 'That sign-in could not be verified. Sign in again to continue.'],
      bad_pin: [400, 'A PIN is exactly four digits.'],
      privy_unavailable: [
        503,
        'Your shop wallet could not be created just now. Nothing was charged and nothing was lost — try again in a moment.',
      ],
      not_configured: [503, 'Clear is not ready to set up shops just now. Try again in a moment.'],
    } as const;
    const [status, message] = map[result.reason];
    res.status(status).json({ error: 'Onboarding failed', message });
    return;
  }

  res.json({
    merchant: result.merchant,
    walletAddress: result.walletAddress,
    created: result.created,
    // Stated rather than hidden: a shop whose wallet exists but whose signer does not can be
    // signed into and set up, and cannot yet be paid out of. The owner should know which they have.
    signerReady: result.signerReady,
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

/**
 * Raise a charge — reference sections 02 and 03.
 *
 * Two taps: the amount, then continue. There is no "how are they paying" step and no member field,
 * because entering the amount goes straight to the code — showing a code is the only path that
 * works for every customer, new or existing.
 *
 * Authenticated by the enrolled device plus the shift session, not by a signature. Section 20
 * settled that the tablet holds no signing material, so `POST /api/charges` — which recovers an
 * EIP-712 signature and matches it to the merchant — is unreachable from a counter and always was
 * going to be. The device token replaces it and is stronger: it says which shop this is, an owner
 * can revoke it from anywhere, and revocation takes effect on the very next request.
 *
 * The shop is taken from the device, never from the body. A counter cannot raise a charge for
 * somebody else's shop even by asking to.
 */
merchantRouter.post(
  '/charges',
  requireDevice,
  requireMerchant,
  async (req: Request, res: Response) => {
    const merchant = req.device!.merchant;
    const amountCents = Number(req.body?.amountCents);

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: 'Invalid request', message: 'That is not an amount.' });
      return;
    }

    const profile = await merchantProfileStore.forDisplay(merchant, false);
    const result = await raiseChargeFromDevice({
      merchant,
      merchantName: profile?.name ?? '',
      amountCents,
      // Who raised it. This is what a PIN buys — the staff name on every charge row is real.
      raisedBy: req.merchant!.staff.id,
    });

    if (!result.ok || !result.charge) {
      // One shape for every refusal. A counter writer needs something to say to the customer, and
      // "over the cap" versus "not active" is a distinction only useful to somebody probing it.
      res.status(400).json({
        error: 'Charge refused',
        message: result.reason ?? 'That charge could not be raised. Take the ticket the usual way.',
      });
      return;
    }

    res.status(201).json({
      code: result.charge.code,
      status: result.charge.status,
      expiresAt: result.charge.expiresAt,
      amountCents: result.charge.amountCents,
    });
  },
);

/**
 * Watch one charge — what the waiting screen polls.
 *
 * Scoped to the device's own shop: a code is short enough to guess at, and a counter should not be
 * able to watch another shop's charge by trying codes.
 */
merchantRouter.get(
  '/charges/:code',
  requireDevice,
  requireMerchant,
  async (req: Request, res: Response) => {
    const charge = await chargeStore.get(req.params.code);
    if (!charge || charge.merchantAddress !== req.device!.merchant) {
      res.status(404).json({ error: 'Not found', message: 'no such charge' });
      return;
    }
    res.json({
      code: charge.code,
      status: charge.status,
      amountCents: charge.amountCents,
      splitInto: charge.splitInto,
      expiresAt: charge.expiresAt,
      openedAt: charge.openedAt,
      resolvedAt: charge.resolvedAt,
    });
  },
);

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
  res.status(201).json({
    ...(await withNames(result.refund)),
    // Under this, an owner can approve with a code at the counter; at or above it, only from
    // their own device. The screen states the rule rather than discovering it on refusal.
    ownerCodeLimitCents: await ownerCodeLimitFor(merchant),
  });
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
      ? await refundStore.decline(refund.id, owner, 'owner_code')
      : await refundStore.approve(refund.id, owner, 'owner_code');

  if (!result.ok || !result.refund) {
    res.status(409).json({ error: 'Conflict', message: result.reason ?? 'could not settle it' });
    return;
  }
  res.json(await withNames(result.refund));
});

/**
 * The owner approves from their own device, having signed in with Privy.
 *
 * The other of the two paths, and the stronger one: this proves possession of the owner's device
 * rather than knowledge of four digits. It carries no amount limit for that reason — the counter
 * code is capped precisely because it is the weaker evidence.
 */
merchantRouter.post(
  '/refunds/:id/decide',
  requireMerchant,
  // A manager reaches this; the store holds them to the shop's refund ceiling. An owner is not
  // bounded by their own ceiling.
  requireManager,
  async (req: Request, res: Response) => {
    const { merchant, staff } = req.merchant!;
    const refund = await refundStore.get(req.params.id, merchant);
    if (!refund) {
      res.status(404).json({ error: 'Not found', message: 'no such refund' });
      return;
    }
    const result =
      req.body?.decision === 'decline'
        ? await refundStore.decline(refund.id, staff, 'owner_device')
        : await refundStore.approve(refund.id, staff, 'owner_device');

    if (!result.ok || !result.refund) {
      res.status(409).json({ error: 'Conflict', message: result.reason ?? 'could not settle it' });
      return;
    }
    res.json(await withNames(result.refund));
  },
);

/** The writer withdraws their own request. Nothing was ever said to the customer. */
merchantRouter.delete('/refunds/:id', requireMerchant, async (req: Request, res: Response) => {
  const { staff } = req.merchant!;
  const ok = await refundStore.withdraw(req.params.id, staff);
  res.status(ok ? 200 : 409).json({ ok });
});

/** Payouts are money. Owner only, enforced here rather than in the nav. */

/**
 * Ask for what is owed, early — reference section 18.
 *
 * A manager may send money to the account already on file; only an owner may change that account.
 * That split is the whole point of the role: the damage from a wrong withdrawal is bounded by what
 * the shop is owed, and it lands somewhere the owner chose.
 *
 * This records the request and answers with what was recorded. It does not claim the money has
 * moved, because it has not — settlement is a separate act, and the row sits at `requested` until
 * then.
 */
merchantRouter.post(
  '/payouts/withdraw',
  requireMerchant,
  requireManager,
  async (req: Request, res: Response) => {
    const { merchant, staff } = req.merchant!;
    const amountCents = Number(req.body?.amountCents);

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: 'Invalid request', message: 'That is not an amount.' });
      return;
    }

    const result = await merchantProfileStore.requestWithdrawal({
      merchant,
      amountCents,
      requestedBy: staff.id,
    });
    if (!result.ok) {
      res.status(409).json({ error: 'Cannot withdraw', message: result.reason ?? 'not available' });
      return;
    }

    const position = await merchantProfileStore.payoutPosition(merchant);
    res.status(201).json({
      id: result.id,
      amountCents,
      // What the shop should expect next, so the screen can say something true about timing.
      nextPayoutOn: position.nextPayoutOn,
      status: 'requested',
    });
  },
);

merchantRouter.get('/payouts', requireMerchant, requireManager, async (req: Request, res: Response) => {
  const { merchant } = req.merchant!;
  const position = await merchantProfileStore.payoutPosition(merchant);
  res.json(position);
});

/**
 * What a counter writer can clear with the owner's code.
 *
 * **Behind `requireOwner`, which only a Privy session satisfies.** That is the whole security
 * property: `/owner-check` deliberately issues no session, so the code path cannot reach this
 * route, and therefore the code can never raise its own limit. A writer who could would raise the
 * ceiling with the code and then use it.
 *
 * The ceiling is the shop's approval cap — an owner cannot authorise more by code than the shop
 * can charge in one transaction, so one number governs both directions. Zero is "Off" and a real
 * answer, not a degenerate one.
 */
merchantRouter.get(
  '/refund-threshold',
  requireMerchant,
  requireOwner,
  async (req: Request, res: Response) => {
    const { merchant } = req.merchant!;
    const terms = await readMerchantTerms(merchant).catch(() => null);
    res.json({
      limitCents: await ownerCodeLimitFor(merchant),
      // The highest it can be set to. Null when the registry is unreachable — the screen then says
      // so rather than offering a ceiling it cannot verify.
      maxCents: terms?.capCents ?? null,
    });
  },
);

merchantRouter.put(
  '/refund-threshold',
  requireMerchant,
  requireOwner,
  async (req: Request, res: Response) => {
    const { merchant } = req.merchant!;
    const requested = Number(req.body?.limitCents);

    if (!Number.isFinite(requested) || requested < 0) {
      res.status(400).json({ error: 'Invalid', message: 'that is not an amount' });
      return;
    }

    const terms = await readMerchantTerms(merchant).catch(() => null);
    if (!terms) {
      res.status(503).json({
        error: 'Unavailable',
        message: 'Could not confirm your approval cap just now. Try again in a moment.',
      });
      return;
    }
    if (terms.capCents > 0 && requested > terms.capCents) {
      res.status(400).json({
        error: 'Above your cap',
        message: 'The most you can clear by code is your approval cap.',
      });
      return;
    }

    await merchantProfileStore.setOwnerCodeLimit(merchant, Math.round(requested));
    res.json({ limitCents: Math.round(requested), maxCents: terms.capCents });
  },
);

/** Staff are the powers of the shop. Owner only. */
merchantRouter.get('/staff', requireMerchant, requireManager, async (req: Request, res: Response) => {
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

merchantRouter.post('/staff', requireMerchant, requireManager, async (req: Request, res: Response) => {
  const { merchant, staff } = req.merchant!;
  const { name, role, secret, email } = req.body ?? {};

  /**
   * Who may create whom.
   *
   * This read `role === 'owner' ? 'owner' : 'counter'`, which was harmless while only owners could
   * reach the route and is an escalation now that managers can: a manager could have minted an
   * owner and inherited the bank account and the terms with it.
   *
   * Nobody adds an owner from inside the app. Changing who owns the business is not a self-serve
   * action, and there is no in-product flow that could verify it.
   */
  const wanted: StaffRole = role === 'owner' ? 'owner' : role === 'manager' ? 'manager' : 'counter';
  if (!canAddRole(staff.role, wanted)) {
    res.status(403).json({
      error: 'Forbidden',
      message:
        wanted === 'owner'
          ? 'Owners are added by Clear, not from the app. Contact support.'
          : 'That needs a manager.',
    });
    return;
  }

  try {
    const added = await staffStore.add({
      merchant,
      name: String(name ?? ''),
      role: wanted,
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


/**
 * Enrolling a tablet — reference section 19. Once, by the owner, on the tablet itself.
 *
 * Behind the owner's Privy session and nothing weaker: enrollment grants a device the standing
 * ability to raise charges for this shop, which is authority the owner is delegating and should
 * cost a real sign-in. A shift PIN cannot reach here.
 *
 * The token comes back exactly once and is never readable again. There is no route that lists
 * tokens, because a token an owner can re-read is a token that can be copied onto a tablet nobody
 * enrolled — which would quietly undo the one control this whole design rests on.
 *
 * What is deliberately NOT accepted here is a per-device spend cap. The enrollment screen shows the
 * ceiling as "Fixed" and says "enforced by policy, not by this app" — it is the merchant's cap,
 * held in MerchantRegistry and backstopped by the wallet policy, so it holds on every device at
 * once and holds even if this app is bypassed. Letting a device carry its own cap here would make
 * that sentence a lie.
 */
merchantRouter.post('/devices', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const { merchant, staff } = req.merchant!;
  const label = String(req.body?.label ?? '').trim();
  const idle = Number(req.body?.idleLockSeconds ?? DEFAULT_IDLE_LOCK_SECONDS);

  // A tablet that never locks is a tablet anyone can pick up; one that locks every few seconds
  // gets propped open. Bounded rather than free-form, and only between sensible ends.
  const idleLockSeconds =
    Number.isFinite(idle) && idle >= 60 && idle <= 3600 ? Math.round(idle) : DEFAULT_IDLE_LOCK_SECONDS;

  const result = await deviceStore.enroll({
    merchant,
    label,
    enrolledBy: staff.id,
    idleLockSeconds,
  });
  if (!result) {
    res.status(503).json({ error: 'Unavailable', message: 'devices are not configured' });
    return;
  }

  res.json({
    deviceToken: result.token,
    device: result.device,
    merchant,
  });
});

/** Every tablet this shop has. Owner-only: it is the list a lost tablet is removed from. */
merchantRouter.get('/devices', requireMerchant, requireManager, async (req: Request, res: Response) => {
  const devices = await deviceStore.list(req.merchant!.merchant);
  const names = await staffStore.roster(req.merchant!.merchant);
  const byId = new Map(names.map((n) => [n.id, n.name]));
  res.json({
    devices: devices.map((d) => ({ ...d, enrolledByName: byId.get(d.enrolledBy) ?? null })),
  });
});

/**
 * Remove a tablet — from any device, which is the point.
 *
 * An owner whose counter tablet is in the back of a taxi opens this on their phone. It takes
 * effect on that tablet's next request, because `requireDevice` reads the row rather than trusting
 * anything the tablet holds.
 */
merchantRouter.delete('/devices/:id', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const ok = await deviceStore.revoke(req.params.id, req.merchant!.merchant);
  if (!ok) {
    res.status(404).json({ error: 'Not found', message: 'that device is not set up here' });
    return;
  }
  res.json({ ok: true });
});

/** Renaming, so "Counter tablet" can become "Front desk" without re-enrolling. */
merchantRouter.patch('/devices/:id', requireMerchant, requireOwner, async (req: Request, res: Response) => {
  const label = String(req.body?.label ?? '');
  const ok = await deviceStore.rename(req.params.id, req.merchant!.merchant, label);
  if (!ok) {
    res.status(404).json({ error: 'Not found', message: 'that device is not set up here' });
    return;
  }
  res.json({ ok: true });
});

/**
 * What this tablet is, asked on load before anyone signs in.
 *
 * The app needs to tell "not set up" from "signed out" to know whether to show the enrollment
 * screen or the PIN pad, and `requireDevice` answers 409 for the former. This also carries the
 * idle-lock setting, so the tablet does not need to be told it separately.
 */
merchantRouter.get('/device', requireDevice, (req: Request, res: Response) => {
  const d = req.device!;
  res.json({
    merchant: d.merchant,
    device: { id: d.id, label: d.label, idleLockSeconds: d.idleLockSeconds },
  });
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
