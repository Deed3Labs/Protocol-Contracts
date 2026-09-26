import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import type { CustomerSnapshot } from '../../bridgeCustomerService.js';
import { type BridgeKyb, KybError, kybStatus, startKyb } from './kybService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

/** Bridge as the tests play it: one business customer, whose status the test sets. */
function fakeBridge(opts: { configured?: boolean; refuse?: string } = {}) {
  const started: Array<{ email: string; legalName: string; redirectUri: string }> = [];
  let snap: Partial<CustomerSnapshot> = { status: 'not_started', tosAccepted: false, payoutFiat: 'pending', rejectionReason: null };
  const bridge: BridgeKyb = {
    configured: () => opts.configured ?? true,
    start: async (input) => {
      started.push(input);
      if (opts.refuse) return { error: opts.refuse, status: 400 };
      return { customerId: 'cus_biz_1', url: `https://bridge.example/verify?c=cus_biz_1&n=${started.length}` };
    },
    snapshot: async (customerId) => ({ customerId, baseEndorsement: 'incomplete', payinFiat: 'pending', status: 'not_started', tosAccepted: false, payoutFiat: 'pending', rejectionReason: null, ...snap }) as CustomerSnapshot,
  };
  return { bridge, started, set: (s: Partial<CustomerSnapshot>) => void (snap = { ...snap, ...s }) };
}

describe('business verification with Bridge', () => {
  test('not started; then Bridge’s link, and the shop is a Bridge customer; its status follows Bridge', async () => {
    const { merchant, staff } = await seedShop(db);
    const b = fakeBridge();
    expect(await kybStatus(db, b.bridge, merchant)).toEqual({ state: 'not_started', withdrawToBank: false, reason: null, email: null, available: true });

    const r = await startKyb(db, b.bridge, { merchant, staffId: staff.owner, body: { legalName: 'Mike’s Tire LLC', email: 'Mike@MikesTire.com' }, appUrl: 'https://merchant.useclear.org/' });
    expect(r.url).toContain('cus_biz_1');
    expect(b.started[0]).toEqual({ email: 'mike@mikestire.com', legalName: 'Mike’s Tire LLC', redirectUri: 'https://merchant.useclear.org/settings/advanced?kyb=back' });
    expect((await kybStatus(db, b.bridge, merchant)).state).toBe('needs_info');

    b.set({ status: 'under_review', tosAccepted: true });
    expect((await kybStatus(db, b.bridge, merchant)).state).toBe('in_review');
    b.set({ status: 'active', payoutFiat: 'pending' });
    expect(await kybStatus(db, b.bridge, merchant)).toMatchObject({ state: 'verified', withdrawToBank: false, email: 'mike@mikestire.com' });
    b.set({ payoutFiat: 'active' });
    expect((await kybStatus(db, b.bridge, merchant)).withdrawToBank).toBe(true);
    b.set({ status: 'rejected', rejectionReason: 'The EIN didn’t match the business name' });
    expect(await kybStatus(db, b.bridge, merchant)).toMatchObject({ state: 'rejected', reason: 'The EIN didn’t match the business name', withdrawToBank: false });

    // Starting again carries on under the first address, not a new one.
    await startKyb(db, b.bridge, { merchant, staffId: staff.owner, body: { legalName: 'Mike’s Tire LLC', email: 'other@example.com' }, appUrl: 'https://merchant.useclear.org' });
    expect(b.started[1]!.email).toBe('mike@mikestire.com');
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments.audit_log WHERE merchant = $1 AND action = 'kyb.started'`, [merchant]);
    expect(rows[0]!.n).toBe(2);
  });

  test('refused: not set up, bad details, Bridge saying no', async () => {
    const { merchant, staff } = await seedShop(db);
    const body = { legalName: 'Mike’s Tire LLC', email: 'mike@mikestire.com' };
    await expect(startKyb(db, fakeBridge({ configured: false }).bridge, { merchant, staffId: staff.owner, body, appUrl: 'x' })).rejects.toMatchObject({ code: 'not_configured', status: 503 });
    await expect(startKyb(db, fakeBridge().bridge, { merchant, staffId: staff.owner, body: { ...body, email: 'mike' }, appUrl: 'x' })).rejects.toThrow('That isn’t an email address');
    await expect(startKyb(db, fakeBridge({ refuse: 'email is already in use by another customer' }).bridge, { merchant, staffId: staff.owner, body, appUrl: 'x' })).rejects.toBeInstanceOf(KybError);
    expect((await kybStatus(db, fakeBridge({ configured: false }).bridge, merchant)).available).toBe(false);
  });
});
