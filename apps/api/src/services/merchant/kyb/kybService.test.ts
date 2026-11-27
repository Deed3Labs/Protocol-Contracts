import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import type { CustomerSnapshot } from '../../bridgeCustomerService.js';
import { type BridgeKyb, bridgeKyb, KybError, kybStatus, PERSONAL_EMAIL, startKyb } from './kybService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

/** Bridge as the tests play it: one business customer, whose status the test sets. */
function fakeBridge(opts: { configured?: boolean; refuse?: string } = {}) {
  const started: Array<{ customerId: string | null; email: string; legalName: string; redirectUri: string }> = [];
  let snap: Partial<CustomerSnapshot> = { status: 'not_started', tosAccepted: false, payoutFiat: 'pending', rejectionReason: null };
  const bridge: BridgeKyb = {
    configured: () => opts.configured ?? true,
    start: async (input) => {
      started.push(input);
      if (opts.refuse) return { error: opts.refuse, status: 400 };
      const id = input.customerId ?? `cus_biz_${started.length}`;
      return { customerId: id, url: `https://bridge.example/verify?c=${id}&n=${started.length}` };
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
    expect(b.started[0]).toEqual({ customerId: null, email: 'mike@mikestire.com', legalName: 'Mike’s Tire LLC', redirectUri: 'https://merchant.useclear.org/settings/advanced?kyb=back' });
    expect((await kybStatus(db, b.bridge, merchant)).state).toBe('needs_info');

    b.set({ status: 'under_review', tosAccepted: true });
    expect((await kybStatus(db, b.bridge, merchant)).state).toBe('in_review');
    b.set({ status: 'active', payoutFiat: 'pending' });
    expect(await kybStatus(db, b.bridge, merchant)).toMatchObject({ state: 'verified', withdrawToBank: false, email: 'mike@mikestire.com' });
    b.set({ payoutFiat: 'active' });
    expect((await kybStatus(db, b.bridge, merchant)).withdrawToBank).toBe(true);
    b.set({ status: 'rejected', rejectionReason: 'The EIN didn’t match the business name' });
    expect(await kybStatus(db, b.bridge, merchant)).toMatchObject({ state: 'rejected', reason: 'The EIN didn’t match the business name', withdrawToBank: false });

    // Starting again carries on with the same customer, under the first address, not a new one.
    await startKyb(db, b.bridge, { merchant, staffId: staff.owner, body: { legalName: 'Mike’s Tire LLC', email: 'other@example.com' }, appUrl: 'https://merchant.useclear.org' });
    expect(b.started[1]).toMatchObject({ customerId: 'cus_biz_1', email: 'mike@mikestire.com' });
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

  test('a shop started under the owner verified as a person is told so, and starts over as the business', async () => {
    const { merchant, staff } = await seedShop(db);
    await db.query(`UPDATE merchant.profiles SET bridge_customer_id = 'cus_owner', kyb_email = 'mike@gmail.com' WHERE merchant = $1`, [merchant]);
    const b = fakeBridge();
    b.set({ type: 'individual', status: 'active', payoutFiat: 'active' });
    expect(await kybStatus(db, b.bridge, merchant)).toMatchObject({ state: 'needs_info', withdrawToBank: false, reason: expect.stringContaining('as a person') });

    await startKyb(db, b.bridge, { merchant, staffId: staff.owner, body: { legalName: 'Mike’s Tire LLC', email: 'accounts@mikestire.com' }, appUrl: 'x' });
    expect(b.started[0]).toMatchObject({ customerId: null, email: 'accounts@mikestire.com' });
    const { rows } = await db.query<{ bridge_customer_id: string; kyb_email: string }>('SELECT bridge_customer_id, kyb_email FROM merchant.profiles WHERE merchant = $1', [merchant]);
    expect(rows[0]).toEqual({ bridge_customer_id: 'cus_biz_1', kyb_email: 'accounts@mikestire.com' });
  });
});

/** Bridge's own answers, played through fetch: what the real `bridgeKyb()` does with each. */
describe('starting with Bridge, never by email', () => {
  const realFetch = globalThis.fetch;
  const saved = { key: process.env.BRIDGE_API_KEY, url: process.env.BRIDGE_API_BASE_URL };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.BRIDGE_API_KEY = saved.key;
    process.env.BRIDGE_API_BASE_URL = saved.url;
  });
  function play(answers: Record<string, { status: number; body: unknown }>) {
    const calls: string[] = [];
    process.env.BRIDGE_API_KEY = 'sk-test-fake';
    process.env.BRIDGE_API_BASE_URL = 'https://bridge.test/v0';
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace('https://bridge.test/v0', '').split('?')[0]!;
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      const a = answers[`${init?.method ?? 'GET'} ${path}`] ?? { status: 404, body: { message: 'not found' } };
      return new Response(JSON.stringify(a.body), { status: a.status });
    }) as typeof fetch;
    return calls;
  }
  const input = { customerId: null, email: 'mike@gmail.com', legalName: 'Mike’s Tire LLC', redirectUri: 'https://m/back' };
  const dup = (type: string) => ({ status: 400, body: { code: 'duplicate_record', message: 'A kyc link has already been created for this email.', existing_kyc_link: { customer_id: 'cus_x', type } } });

  test('a new business customer; the email is never looked up', async () => {
    const calls = play({ 'POST /kyc_links': { status: 200, body: { customer_id: 'cus_new', tos_link: 'https://bridge/tos', kyc_link: 'https://bridge/kyc' } } });
    expect(await bridgeKyb().start(input)).toEqual({ customerId: 'cus_new', url: 'https://bridge/tos' });
    expect(calls).toEqual(['POST /kyc_links']);
  });

  test('an email Bridge has as a person is refused, not taken for the business', async () => {
    const calls = play({ 'POST /kyc_links': dup('individual') });
    expect(await bridgeKyb().start(input)).toEqual({ error: PERSONAL_EMAIL, status: 409 });
    expect(calls).toEqual(['POST /kyc_links']);
  });

  test('an email Bridge has as a business carries on with that business', async () => {
    play({
      'POST /kyc_links': dup('business'),
      'GET /customers/cus_x/tos_acceptance_link': { status: 200, body: { url: 'https://bridge/tos' } },
      'GET /customers/cus_x/kyc_link': { status: 200, body: { url: 'https://bridge/kyc' } },
      'GET /customers/cus_x': { status: 200, body: { id: 'cus_x', type: 'business', has_accepted_terms_of_service: true } },
    });
    expect(await bridgeKyb().start(input)).toEqual({ customerId: 'cus_x', url: 'https://bridge/kyc' });
  });

  test('the shop’s own customer, once it has one', async () => {
    const calls = play({
      'GET /customers/cus_mine/tos_acceptance_link': { status: 200, body: { url: 'https://bridge/tos' } },
      'GET /customers/cus_mine/kyc_link': { status: 200, body: { url: 'https://bridge/kyc' } },
      'GET /customers/cus_mine': { status: 200, body: { id: 'cus_mine', type: 'business', has_accepted_terms_of_service: false } },
    });
    expect(await bridgeKyb().start({ ...input, customerId: 'cus_mine' })).toEqual({ customerId: 'cus_mine', url: 'https://bridge/tos' });
    expect(calls).not.toContain('POST /kyc_links');
  });
});
