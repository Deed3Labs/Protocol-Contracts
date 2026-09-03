import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

/*
 * Raising a charge is the one action that creates money owed, and three decisions about it are
 * each a one-line edit away from being undone silently. These pin them.
 *
 * Section 20 settled that the counter device holds no signing material — Clear's backend holds the
 * organization's key. So the enrolled device token IS the authentication, and everything that used
 * to be carried by an EIP-712 signature now has to be established server-side instead.
 */
describe('a counter raises a charge with a device, not a signature', () => {
  const route = read('routes/merchant.ts');
  const chargeRoute = route.slice(
    route.indexOf("merchantRouter.post(\n  '/charges'"),
    route.indexOf("merchantRouter.post('/charges/:code/cancel'"),
  );

  test('the route exists and is behind both the device and a shift', () => {
    expect(chargeRoute).toContain("'/charges'");
    // requireDevice says which shop; requireMerchant says who is on shift, which is what makes the
    // staff name on the charge row real.
    expect(chargeRoute).toContain('requireDevice');
    expect(chargeRoute).toContain('requireMerchant');
  });

  test('the shop comes from the device, never from the request body', () => {
    // The whole point of device enrollment: a counter cannot raise a charge for another shop even
    // by asking to. `req.body.merchant` reaching the service would give that away.
    expect(chargeRoute).toContain('req.device!.merchant');
    expect(chargeRoute).not.toMatch(/merchant:\s*(String\()?req\.body/);
  });

  test('it does not accept a payout, a rate or a member', () => {
    // The payout is computed from the registry. A merchant that could name its own payout could
    // name the whole purchase and leave the co-op nothing.
    expect(chargeRoute).not.toMatch(/payoutCents\s*[:=]\s*(Number\()?req\.body/);
    expect(chargeRoute).not.toMatch(/discount\w*\s*[:=]\s*(Number\()?req\.body/);
    // And no member: entering the amount goes straight to the code, so nobody has said who they
    // are yet. Accepting one here would quietly reintroduce the choice screen section 03 removed.
    expect(chargeRoute).not.toMatch(/member\s*[:=]\s*(String\()?req\.body/);
  });

  test('every refusal reads the same to the counter', () => {
    // A writer needs something to say to the customer. "Over the cap" versus "not active" is a
    // distinction only useful to somebody probing the endpoint.
    expect(chargeRoute).toContain('Charge refused');
    expect(chargeRoute).not.toMatch(/res\.status\(40[13]\)/);
  });
});

describe('the customer attaches by opening the code', () => {
  const service = read('services/chargeService.ts');
  const store = read('services/chargeStore.ts');

  test('a device-raised charge starts with no member', () => {
    const fn = service.slice(service.indexOf('export async function raiseChargeFromDevice'));
    expect(fn.slice(0, 3000)).toContain('memberWallet: null');
  });

  test('the registry is still what decides terms, not the caller', () => {
    const fn = service.slice(
      service.indexOf('export async function raiseChargeFromDevice'),
      service.indexOf('// No notification'),
    );
    for (const call of ['isActive', 'approvalCapOf', 'discountBpsOf']) {
      expect(fn).toContain(call);
    }
    // A failed read is not a pass: charging for a merchant nobody can confirm is still one.
    expect(fn).toContain('could not confirm the merchant right now');
  });

  test('claiming is a race nobody can win twice', () => {
    const fn = store.slice(store.indexOf('async attachMember('));
    // Two people scanning the same screen: the second must be told, not silently overwrite.
    expect(fn.slice(0, 900)).toContain('member_wallet IS NULL');
    expect(fn.slice(0, 900)).toContain("status = 'pending'");
    expect(fn.slice(0, 900)).toContain('expires_at > now()');
  });

  test('nobody is notified about a charge that has no customer yet', () => {
    const fn = service.slice(service.indexOf('export async function notifyMember'));
    expect(fn.slice(0, 600)).toContain('if (!charge.memberWallet) return;');
  });
});
