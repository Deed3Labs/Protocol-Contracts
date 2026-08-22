import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = readFileSync(join(import.meta.dir, 'ChargeApprovalRoute.tsx'), 'utf8');
const SCREEN = readFileSync(join(import.meta.dir, 'ChargeApproval.tsx'), 'utf8');
const SERVER = join(import.meta.dir, '../../../server/src');
const SERVICE = readFileSync(join(SERVER, 'services/chargeService.ts'), 'utf8');
const STORE = readFileSync(join(SERVER, 'services/chargeStore.ts'), 'utf8');
const ROUTES = readFileSync(join(SERVER, 'routes/charges.ts'), 'utf8');

/*
 * The rule the whole feature exists to enforce: a service writer must not be picking somebody's
 * repayment terms. If a merchant could ever set the split, this feature would be worse than not
 * having it.
 */
describe('the split is chosen on the member’s phone', () => {
  test('a merchant’s request carries no repayment terms', () => {
    const raise = SERVICE.slice(SERVICE.indexOf('export async function raiseCharge'), SERVICE.indexOf('export async function notifyMember'));
    expect(raise).not.toContain('installments');
    expect(raise).not.toContain('splitInto');
  });

  test('installments only arrive on approve, from the member’s own session', () => {
    expect(ROUTES).toContain("chargesRouter.post('/:code/approve', requireAuth");
    const approve = ROUTES.slice(ROUTES.indexOf("post('/:code/approve'"), ROUTES.indexOf("post('/:code/decline'"));
    expect(approve).toContain('req.body?.installments');
  });
});

/*
 * A code travels by text, and text gets forwarded. Possession of one cannot be what authorises
 * answering it.
 */
describe('a code is not a credential', () => {
  test('every member route sits behind requireAuth', () => {
    for (const route of ["get('/:code'", "post('/:code/approve'", "post('/:code/decline'"]) {
      const at = ROUTES.indexOf(route);
      expect(at).toBeGreaterThan(-1);
      expect(ROUTES.slice(at, at + 120)).toContain('requireAuth');
    }
  });

  test('and re-checks the charge belongs to the caller', () => {
    // Three routes, three checks. requireVerifiedWallet falls through to true when there is no
    // req.auth at all, which is why the requireAuth test above is not redundant with this one.
    const checks = ROUTES.split('requireVerifiedWallet(req, res, charge.memberWallet').length - 1;
    expect(checks).toBe(3);
  });

  test('the merchant route is the only one without a session', () => {
    const post = ROUTES.slice(ROUTES.indexOf("chargesRouter.post('/'"), ROUTES.indexOf("chargesRouter.get('/:code'"));
    expect(post).not.toContain('requireAuth');
    expect(post).not.toContain('req.auth');
  });
});

/*
 * A merchant proves itself by signing. The checks below are what stop that being a formality.
 */
describe('merchant authentication', () => {
  test('the signer is the merchant, not whoever the body names', () => {
    expect(SERVICE).toContain('recovered.toLowerCase() !== input.merchant.trim().toLowerCase()');
  });

  test('a signature expires', () => {
    // Without an age bound a captured signature is a standing licence to charge the same member
    // the same amount forever.
    expect(SERVICE).toContain('SIGNATURE_MAX_AGE_SECONDS');
    expect(SERVICE).toContain("reason: 'signature is stale'");
  });

  test('an unreadable registry is not a pass', () => {
    expect(SERVICE).toContain("reason: 'could not confirm the merchant right now'");
  });

  test('inactive merchants are refused', () => {
    expect(SERVICE).toContain("if (!active) return { ok: false, reason: 'merchant is not active' }");
  });

  test('the payout comes from the registry, never from the request', () => {
    // A merchant that could name its own payout could name the whole purchase.
    expect(SERVICE).toContain('discountBps');
    const raise = SERVICE.slice(SERVICE.indexOf('export async function raiseCharge'), SERVICE.indexOf('export async function notifyMember'));
    expect(raise).not.toContain('input.payoutCents');
  });
});

/*
 * Approving opens a real term plan. These are the tests about not opening two.
 */
describe('a purchase becomes at most one plan', () => {
  test('the charge is claimed in the WHERE clause, not read-then-written', () => {
    expect(STORE).toContain("WHERE code = $1 AND status = 'pending' AND expires_at > now()");
  });

  test('the plan is opened before the row is marked approved', () => {
    const approve = SERVICE.slice(SERVICE.indexOf('export async function approveCharge'));
    expect(approve.indexOf('issuer.openPlan(')).toBeLessThan(approve.indexOf("status: 'approved'"));
  });

  test('a submitted-but-unconfirmed call is never released', () => {
    // A dropped connection while waiting for a receipt looks exactly like a revert from here.
    // Releasing on that would let the same purchase be approved a second time.
    expect(SERVICE).toContain('if (!submitted) {');
    const approve = SERVICE.slice(SERVICE.indexOf('export async function approveCharge'));
    expect(approve.indexOf('submitted = true;')).toBeLessThan(approve.indexOf('await tx.wait()'));
  });

  test('finish only closes a row this request claimed', () => {
    expect(STORE).toContain("WHERE code = $1 AND status = 'resolving'");
  });
});

describe('expiry', () => {
  test('is derived on read rather than swept', () => {
    // A sweeping cron would be a second writer racing the approve path, in exactly the window a
    // member is pressing Approve on a charge about to lapse.
    expect(STORE).toContain('function withDerivedStatus');
    expect(STORE).not.toContain('setInterval');
  });

  test('and is re-checked when the charge is claimed', () => {
    expect(STORE).toContain('expires_at > now()');
  });
});

describe('what the member is shown', () => {
  test('the approval screen never sees the payout or the merchant address', () => {
    expect(ROUTES).toContain('function memberView');
    const view = ROUTES.slice(ROUTES.indexOf('function memberView'), ROUTES.indexOf('* A merchant raises a charge'));
    expect(view).not.toContain('payoutCents');
    expect(view).not.toContain('merchantAddress');
  });

  test('the limit is left unset rather than invented when unread', () => {
    expect(ROUTE).toContain('perCycleLimit');
    expect(SCREEN).toContain("perCycleLimit == null ? 'Not set'");
  });

  test('every resolved state says which one it is', () => {
    for (const word of ['expired', 'declined']) expect(ROUTE).toContain(word);
    expect(ROUTE).toContain('Nothing was charged.');
  });

  test('approval waits for the chain rather than showing an optimistic confirmation', () => {
    // setCharge runs on the result, so `approved` can only come from what the server returned.
    expect(ROUTE).toContain('setCharge(result.charge)');
    expect(ROUTE).toContain("approved={charge.status === 'approved'}");
  });

  test('the reference’s exact reassurance is on the screen', () => {
    expect(SCREEN).toContain('Expires in 24 hours. Nothing is charged until you approve.');
    expect(SCREEN).toContain('MAKE THE NEXT ONE FREE');
  });
});

describe('the alert', () => {
  test('says the member has not been charged', () => {
    // The whole message, per the reference — it is what makes the rest safe on a lock screen.
    expect(SERVICE).toContain('You have not been charged yet.');
  });

  test('goes out in-app and by text, and never fails the charge', () => {
    expect(SERVICE).toContain('notificationStore.emit');
    expect(SERVICE).toContain('sendChargeAlert');
    const notify = SERVICE.slice(SERVICE.indexOf('export async function notifyMember'));
    expect(notify).toContain('catch');
  });

  test('respects a member who opted out', () => {
    expect(SERVICE).toContain('if (!contact) return;');
  });
});

describe('coming back after signing in', () => {
  test('uses the state shape LoginPage actually reads', () => {
    // A `?next=` would be silently ignored and drop somebody on the home screen.
    expect(ROUTE).toContain('state: { from: location }');
    expect(ROUTE).not.toContain("navigate('/login?");
  });
});

/*
 * The confirmation quotes a figure the member will budget against. It has to be the same one the
 * split chooser showed them a moment earlier — dividing the amount by the split looks right and
 * silently drops the carry.
 */
describe('the first payment matches what was quoted', () => {
  test('comes from splitQuote, not from division', () => {
    expect(SCREEN).toContain('splitQuote(amount, splitInto, ratePerCycle).perCycle');
    expect(SCREEN).not.toContain('amount / splitInto');
  });

  test('and the two disagree, which is why it matters', async () => {
    const { splitQuote } = await import('@/lib/clearModel');
    const quoted = splitQuote(940, 4, 0.02).perCycle;
    expect(quoted).toBeCloseTo(246.75, 2);
    expect(quoted).not.toBeCloseTo(940 / 4, 2);
  });
});
