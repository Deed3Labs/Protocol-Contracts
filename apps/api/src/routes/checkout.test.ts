import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CodeVerified, ContactSent, MemberQuote, PaidView, PaySession } from '@clear/merchant-contracts';
import type { Db } from '../db/db.js';
import { seedShop, testDb } from '../db/testDb.js';
import type { OrderDeps } from '../services/merchant/orders/orderService.js';
import type { ClearCharges } from '../services/merchant/orders/payments.js';
import { approveInFrame, firstCycleDate, maskContact, parseContact, sendContact, verifyCode, type FrameDeps, type PayMember } from '../services/merchant/pay/frame.js';
import { addSite, createKeys } from '../services/merchant/pay/keys.js';
import { ensureShopApp, patchShopApp } from '../services/merchant/rewards/shopApp.js';
import { checkoutRouter, type PayRouteDeps } from './payLinks.js';
import { v1Cors, v1Errors, v1Router } from './v1.js';

/**
 * The modal's API (pay prompt, Phase 5): signing in with a code, the member's screen, approving, the
 * approval page, and test mode, over HTTP with the spec's order: $185.32, over time in 4 at $48.65.
 */

let db: Db;
let server: Server;
let base: string;
const orders: OrderDeps = { taxApi: null, pinCheck: async () => null };
const pass: express.RequestHandler = (_req, _res, next) => next();

/** What the live side was asked to do, and who it knows. */
const sent: Array<{ to: string; code: string; link: string }> = [];
const pushed: Array<{ wallet: string; link: string }> = [];
const attached: Array<{ code: string; wallet: string }> = [];
const approved: Array<{ code: string; wallet: string; installments: number }> = [];
const members = new Map<string, PayMember>([
  ['+19095550142', { wallet: '0x' + 'a'.repeat(40), firstName: 'Sofia', hasPasskey: false }],
  ['+19095550177', { wallet: '0x' + 'b'.repeat(40), firstName: 'Dana', hasPasskey: true }],
]);
const charges = new Map<string, 'pending' | 'approved'>();
let seq = 0;
const clear: ClearCharges = {
  raise: async () => {
    const code = `LIVE${++seq}`;
    charges.set(code, 'pending');
    return { ok: true, code };
  },
  status: async (code) => charges.get(code) ?? null,
  cancel: async () => true,
  sendTo: async () => ({ ok: true, label: 'their Clear app' }),
};
const frameDeps = (): FrameDeps => ({
  orders,
  clear,
  card: async () => null,
  findMember: async (c) => (c.channel === 'phone' ? (members.get(c.value) ?? null) : null),
  memberByWallet: async (w) => [...members.values()].find((m) => m.wallet === w) ?? null,
  sendCode: async ({ contact, code, link }) => void sent.push({ to: contact.value, code, link }),
  notifyApp: async ({ wallet, link }) => void pushed.push({ wallet, link }),
  attachCharge: async (code, wallet) => (attached.push({ code, wallet }), true),
  approveCharge: async (code, wallet, installments) => {
    approved.push({ code, wallet, installments });
    charges.set(code, 'approved');
    return { ok: true };
  },
  creditAvailable: async () => 300_000,
  bankLabel: async () => 'Chase •••• 4471',
  planOf: async (code) => ({ installments: approved.find((a) => a.code === code)?.installments ?? null }),
});

beforeAll(async () => {
  ({ db } = await testDb());
  const deps: PayRouteDeps = { db: async () => db, session: () => ({ orders, clear, card: async () => null }), frame: frameDeps, limits: { read: pass, act: pass } };
  const app = express();
  app.use('/v1', v1Cors);
  app.use(express.json());
  app.use('/v1', v1Router({ db: async () => db, v1: () => ({ orders, refunds: async () => ({ card: null, pinCheck: async () => null }) }), limit: pass }));
  app.use('/v1', v1Errors);
  app.use('/api/checkout', checkoutRouter(deps));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

const key = () => `k-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

/** Mi Casa Tacos, with its app at 1.5× for Clear, its keys, and micasatacos.com and localhost allowed. */
async function miCasa() {
  const s = await seedShop(db);
  await db.query(`UPDATE merchant.profiles SET name = 'Mi Casa Tacos', timezone = 'America/Los_Angeles' WHERE merchant = $1`, [s.merchant]);
  const live = await createKeys(db, { merchant: s.merchant, staffId: s.staff.owner, livemode: true });
  const test = await createKeys(db, { merchant: s.merchant, staffId: s.staff.owner, livemode: false });
  const { rows } = await db.query<{ token: string; livemode: boolean }>(`SELECT token, livemode FROM payments.api_keys WHERE merchant = $1 AND kind = 'publishable'`, [s.merchant]);
  await addSite(db, { merchant: s.merchant, staffId: s.staff.owner, request: { site: 'micasatacos.com' } });
  await addSite(db, { merchant: s.merchant, staffId: s.staff.owner, request: { site: 'http://localhost:3000' } });
  await ensureShopApp(db, s.merchant, s.staff.owner);
  await patchShopApp(db, s.merchant, s.staff.owner, {
    slug: `micasa${++seq}`,
    enabled: true,
    rules: { unit: 'dollars', pointsPer: 1, perAmountCents: 100, visitMinCents: 0, cardSize: 10, keepTheChange: false, clearMultiplier: 1.5, boosts: [], joinBonus: 0, birthdayRewardId: null, referralBonus: null, expiry: 'never' },
  });
  return { ...s, liveSecret: live.secret, testSecret: test.secret, livePk: rows.find((r) => r.livemode)!.token, testPk: rows.find((r) => !r.livemode)!.token };
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

/** The spec's server snippet, then the script's modal session for it, as the shop's page opens it. */
async function modalFor(shop: Awaited<ReturnType<typeof miCasa>>, mode: 'test' | 'live', origin = mode === 'test' ? 'http://localhost:3000' : 'https://micasatacos.com') {
  const payment = await json<{ id: string; clientSecret: string }>(
    await post(
      '/v1/payments',
      {
        amount: 18532,
        currency: 'usd',
        reference: `catering-${++seq}`,
        lines: [
          { name: 'Taco tray for 12', amount: 14900 },
          { name: 'Agua fresca, gallon', amount: 1100, quantity: 2 },
        ],
      },
      { Authorization: `Bearer ${mode === 'test' ? shop.testSecret : shop.liveSecret}`, 'Idempotency-Key': key() },
    ),
  );
  const session = await json<{ id: string; url: string }>(await post('/v1/modal_sessions', { payment: payment.clientSecret }, { Authorization: `Bearer ${mode === 'test' ? shop.testPk : shop.livePk}`, Origin: origin }));
  return { payment, session: session.id };
}

describe('the spec’s order, end to end in test mode', () => {
  test('$185.32 with the test member, over time in 4 at $48.65, earning 256 points', async () => {
    const shop = await miCasa();
    const { payment, session } = await modalFor(shop, 'test');

    const view = PaySession.parse(await json(await fetch(`${base}/api/checkout/${session}`)));
    expect(view).toMatchObject({ livemode: false, state: 'open', overTime: true, shopHost: 'localhost:3000', order: { totalCents: 18532, taxCents: 1432 }, methods: { clear: true, card: false } });
    expect(view.order.summary).toBe('Taco tray for 12, 2 × Agua fresca, gallon');

    // The one screen: a code and a link, whoever it is. The test member's code is 000000.
    const contact = ContactSent.parse(await json(await post(`/api/checkout/${session}/contact`, { contact: '(555) 010-0100' })));
    expect(contact).toEqual({ channel: 'phone', to: '(555) •••-0100', resendInSeconds: 60 });
    const signedIn = CodeVerified.parse(await json(await post(`/api/checkout/${session}/code`, { code: '000000' })));
    expect(signedIn.person).toEqual({ kind: 'member', firstName: 'Test' });

    // Hi Test: the split control's figures, from the member's terms at 2%.
    const quote = MemberQuote.parse(await json(await fetch(`${base}/api/checkout/${session}/member`, { headers: { 'X-Pay-Session': signedIn.token } })));
    expect(quote.splits.map((s) => [s.installments, s.perCycleCents])).toEqual([
      [1, 18903],
      [2, 9544],
      [4, 4865],
      [12, 1745],
    ]);
    expect(quote.splits.find((s) => s.installments === 4)!.carryCents).toBe(927);
    expect(quote).toMatchObject({ firstName: 'Test', totalCents: 18532, clearsFrom: 'Test Bank •••• 0000', approveIn: 'frame' });
    expect(quote.points).toEqual({ earns: 256, shopName: 'Mi Casa', multiplierLabel: '1.5× for paying with Clear', before: 0, after: 256 });

    // Approve $185.32 in 4.
    const res = await post(`/api/checkout/${session}/approve`, { installments: 4, idempotencyKey: key() }, { 'X-Pay-Session': signedIn.token });
    expect(res.status).toBe(200);
    const done = PaidView.parse(await json(res));
    expect(done).toEqual({ method: 'clear', installments: 4, firstCycle: { amountCents: 4865, on: firstCycleDate(new Date(), 'America/Los_Angeles') }, points: { earned: 256, now: 256 }, receipt: 'In Clear and by email' });

    // The payment succeeded, its webhook event is a test one, and nothing reached the books.
    const v1 = await json<{ status: string; method: string }>(await fetch(`${base}/v1/payments/${payment.id}`, { headers: { Authorization: `Bearer ${shop.testSecret}` } }));
    expect(v1).toMatchObject({ status: 'succeeded', method: 'clear' });
    const after = PaySession.parse(await json(await fetch(`${base}/api/checkout/${session}`)));
    expect(after.state).toBe('paid');
    expect(after.payment).toEqual({ id: payment.id, reference: expect.stringMatching(/^catering-/) });
    const { rows: events } = await db.query<{ type: string; livemode: boolean }>(`SELECT type, livemode FROM payments.webhook_events WHERE merchant = $1`, [shop.merchant]);
    expect(events).toEqual([{ type: 'payment.succeeded', livemode: false }]);
    const { rows: ledger } = await db.query(`SELECT 1 FROM ledger.entries WHERE merchant = $1`, [shop.merchant]).catch(() => ({ rows: [] }));
    expect(ledger).toHaveLength(0);
  });

  test('in test mode only the test member signs in, and nothing is sent', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop, 'test');
    const res = await post(`/api/checkout/${session}/contact`, { contact: '(909) 555-0142' });
    expect(res.status).toBe(422);
    expect((await json<{ message: string }>(res)).message).toBe('In test mode, use the test member: (555) 010-0100');
  });
});

describe('one screen for everyone (live)', () => {
  test('a member and a stranger get the same answer; the member also gets the request in the app', async () => {
    const shop = await miCasa();
    const a = await modalFor(shop, 'live');
    const b = await modalFor(shop, 'live');
    sent.length = 0;
    pushed.length = 0;
    const member = await json(await post(`/api/checkout/${a.session}/contact`, { contact: '909-555-0142' }));
    const stranger = await json(await post(`/api/checkout/${b.session}/contact`, { contact: '(909) 555-0188' }));
    expect(member).toEqual({ channel: 'phone', to: '(909) •••-0142', resendInSeconds: 60 });
    expect(stranger).toEqual({ channel: 'phone', to: '(909) •••-0188', resendInSeconds: 60 });
    // Both are texted a code and the approval page's link; only the member's app is asked.
    expect(sent.map((s) => s.to)).toEqual(['+19095550142', '+19095550188']);
    expect(sent.every((s) => /^\d{6}$/.test(s.code) && /\/approve\/[0-9A-Za-z]{24}$/.test(s.link))).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.wallet).toBe('0x' + 'a'.repeat(40));
  });

  test('after the code, someone with no account is new; their number is shown back', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop, 'live');
    sent.length = 0;
    await post(`/api/checkout/${session}/contact`, { contact: '(909) 555-0188' });
    const verified = await json<{ person: unknown }>(await post(`/api/checkout/${session}/code`, { code: sent[0]!.code }));
    expect(verified.person).toEqual({ kind: 'new', contact: '(909) 555-0188' });
  });

  test('a member with Face ID approves in the Clear app’s window, not the frame', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop, 'live');
    process.env.PAY_OVER_TIME_ONLINE = 'on';
    try {
      sent.length = 0;
      await post(`/api/checkout/${session}/contact`, { contact: '(909) 555-0177' });
      const { token } = await json<{ token: string }>(await post(`/api/checkout/${session}/code`, { code: sent[0]!.code }));
      const quote = await json<{ approveIn: string }>(await fetch(`${base}/api/checkout/${session}/member`, { headers: { 'X-Pay-Session': token } }));
      expect(quote.approveIn).toBe('window');
      const res = await post(`/api/checkout/${session}/approve`, { installments: 4, idempotencyKey: key() }, { 'X-Pay-Session': token });
      expect(res.status).toBe(409);
      const approval = await json<{ url: string }>(await post(`/api/checkout/${session}/approval`, {}));
      expect(approval.url).toMatch(/\/approve\/[0-9A-Za-z]{24}$/);
      const view = await json<{ channel: string; returnUrl: string; chargeCode: string; order: { totalCents: number } }>(await fetch(`${base}/api/checkout/approval/${approval.url.split('/').pop()}`));
      expect(view).toMatchObject({ channel: 'online', returnUrl: 'https://micasatacos.com', order: { totalCents: 18532 } });
      expect(view.chargeCode).toMatch(/^LIVE/);
    } finally {
      delete process.env.PAY_OVER_TIME_ONLINE;
    }
  });

  test('over time online is off in live until it’s switched on: no splits, and approving is refused', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop, 'live');
    sent.length = 0;
    await post(`/api/checkout/${session}/contact`, { contact: '(909) 555-0142' });
    const { token } = await json<{ token: string }>(await post(`/api/checkout/${session}/code`, { code: sent[0]!.code }));
    const quote = await json<{ splits: unknown[]; canPayNow: boolean; clearsFrom: string }>(await fetch(`${base}/api/checkout/${session}/member`, { headers: { 'X-Pay-Session': token } }));
    expect(quote).toMatchObject({ splits: [], canPayNow: true, clearsFrom: 'Chase •••• 4471' });
    expect((await post(`/api/checkout/${session}/approve`, { installments: 4, idempotencyKey: key() }, { 'X-Pay-Session': token })).status).toBe(422);
  });

  test('a live member over time in the frame: the charge is theirs, the plan opened, the sale paid', async () => {
    const shop = await miCasa();
    const { payment, session } = await modalFor(shop, 'live');
    process.env.PAY_OVER_TIME_ONLINE = 'on';
    try {
      sent.length = 0;
      approved.length = 0;
      await post(`/api/checkout/${session}/contact`, { contact: '(909) 555-0142' });
      const { token } = await json<{ token: string }>(await post(`/api/checkout/${session}/code`, { code: sent[0]!.code }));
      const done = await json<{ installments: number }>(await post(`/api/checkout/${session}/approve`, { installments: 4, idempotencyKey: key() }, { 'X-Pay-Session': token }));
      expect(done.installments).toBe(4);
      expect(approved[0]).toMatchObject({ wallet: '0x' + 'a'.repeat(40), installments: 4 });
      const v1 = await json<{ status: string }>(await fetch(`${base}/v1/payments/${payment.id}`, { headers: { Authorization: `Bearer ${shop.liveSecret}` } }));
      expect(v1.status).toBe('succeeded');
    } finally {
      delete process.env.PAY_OVER_TIME_ONLINE;
    }
  });
});

describe('a payment-scoped session', () => {
  test('its token can’t read or pay another payment', async () => {
    const shop = await miCasa();
    const a = await modalFor(shop, 'test');
    const b = await modalFor(shop, 'test');
    await post(`/api/checkout/${a.session}/contact`, { contact: '(555) 010-0100' });
    const { token } = await json<{ token: string }>(await post(`/api/checkout/${a.session}/code`, { code: '000000' }));
    expect((await fetch(`${base}/api/checkout/${b.session}/member`, { headers: { 'X-Pay-Session': token } })).status).toBe(403);
    expect((await post(`/api/checkout/${b.session}/approve`, { installments: 4, idempotencyKey: key() }, { 'X-Pay-Session': token })).status).toBe(403);
    expect((await fetch(`${base}/api/checkout/${a.session}/member`, { headers: { 'X-Pay-Session': `${token}x` } })).status).toBe(403);
  });

  test('which website may frame it: its own, while it’s open', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop, 'live');
    expect(await json<unknown>(await fetch(`${base}/api/checkout/${session}/frame`))).toEqual({ origin: 'https://micasatacos.com' });
    expect(await json<unknown>(await fetch(`${base}/api/checkout/ms_${'0'.repeat(32)}/frame`))).toEqual({ origin: null });
  });
});

describe('codes', () => {
  test('five wrong tries and that code is done', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop, 'live');
    sent.length = 0;
    await post(`/api/checkout/${session}/contact`, { contact: '(909) 555-0188' });
    const wrong = sent[0]!.code === '123456' ? '654321' : '123456';
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await post(`/api/checkout/${session}/code`, { code: wrong })).status);
    expect(codes).toEqual([422, 422, 422, 422, 429]);
    expect((await post(`/api/checkout/${session}/code`, { code: sent[0]!.code })).status).toBe(429);
  });

  test('a code runs out after 10 minutes', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop, 'live');
    sent.length = 0;
    const t0 = new Date();
    await sendContact(db, frameDeps(), { session, request: { contact: '(909) 555-0188' }, now: t0 });
    await expect(verifyCode(db, frameDeps(), { session, request: { code: sent[0]!.code }, now: new Date(t0.getTime() + 10 * 60_000 + 1) })).rejects.toMatchObject({ code: 'expired' });
  });

  test('one contact gets five codes an hour, a minute apart', async () => {
    const shop = await miCasa();
    const t0 = new Date();
    const sessions = await Promise.all([1, 2, 3, 4, 5, 6].map(() => modalFor(shop, 'live')));
    const results: string[] = [];
    for (const [i, s] of sessions.entries()) {
      results.push(
        await sendContact(db, frameDeps(), { session: s.session, request: { contact: 'marco@example.com' }, now: new Date(t0.getTime() + i * 61_000) }).then(
          () => 'sent',
          (e: { code: string }) => e.code,
        ),
      );
    }
    expect(results).toEqual(['sent', 'sent', 'sent', 'sent', 'sent', 'too_many']);
  });

  test('approving needs the member’s split to be offered', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop, 'test');
    await post(`/api/checkout/${session}/contact`, { contact: '(555) 010-0100' });
    const { token } = await json<{ token: string }>(await post(`/api/checkout/${session}/code`, { code: '000000' }));
    await expect(approveInFrame(db, frameDeps(), { session, token, request: { installments: 3, idempotencyKey: key() } })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('contacts', () => {
  test('phones as people type them, and emails', () => {
    expect(parseContact('(909) 555-0188')).toEqual({ channel: 'phone', value: '+19095550188' });
    expect(parseContact('1 909 555 0188')).toEqual({ channel: 'phone', value: '+19095550188' });
    expect(parseContact('Sofia.M@Gmail.com')).toEqual({ channel: 'email', value: 'sofia.m@gmail.com' });
    expect(parseContact('nope')).toBeNull();
    expect(maskContact({ channel: 'email', value: 'sofia.m@gmail.com' })).toBe('s•••@gmail.com');
  });
  test('the first cycle is the 1st of next month, in the shop’s time', () => {
    expect(firstCycleDate(new Date('2026-10-16T17:40:00Z'), 'America/Los_Angeles')).toBe('2026-11-01');
    expect(firstCycleDate(new Date('2026-12-31T07:59:00Z'), 'America/Los_Angeles')).toBe('2027-01-01');
  });
});
