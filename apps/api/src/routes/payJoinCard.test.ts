import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Stripe from 'stripe';
import { CardStarted, CodeVerified, JoinFinished, JoinHandoff, JoinState, JoinWindow, MemberQuote, PaidView, PaySession, PayStatus } from '@clear/merchant-contracts';
import type { Db } from '../db/db.js';
import { seedShop, testDb } from '../db/testDb.js';
import { createOnlineCardTender } from '../services/merchant/cards/cardTenders.js';
import { connectorStore } from '../services/merchant/cards/connectorStore.js';
import { fakeProvider } from '../services/merchant/cards/fakeProvider.js';
import type { OrderDeps } from '../services/merchant/orders/orderService.js';
import type { ClearCharges } from '../services/merchant/orders/payments.js';
import { findMismatches } from '../services/merchant/payouts/reconcile.js';
import { registerWalletDomains } from '../services/merchant/pay/card.js';
import type { FrameDeps, PayMember } from '../services/merchant/pay/frame.js';
import { joinWindow } from '../services/merchant/pay/join.js';
import { addSite, createKeys } from '../services/merchant/pay/keys.js';
import { decryptSecret } from '../services/merchant/pay/secrets.js';
import { joinShop } from '../services/merchant/rewards/customerApp.js';
import { ensureShopApp, patchShopApp } from '../services/merchant/rewards/shopApp.js';
import { cardPaymentHandlers } from '../services/merchant/stripeEvents/cardPaymentHandlers.js';
import { checkoutRouter, type PayRouteDeps } from './payLinks.js';
import { v1Cors, v1Errors, v1Router } from './v1.js';

/**
 * Phase 6 of Pay with Clear (pay prompt): joining from the modal, and card in it, over HTTP with the
 * spec's order, $185.32, and Marco, (909) 555-0188, who has no Clear account.
 */

let db: Db;
let server: Server;
let base: string;
const orders: OrderDeps = { taxApi: null, pinCheck: async () => null };
const pass: express.RequestHandler = (_req, _res, next) => next();
const fake = fakeProvider();

const sent: Array<{ to: string; code: string }> = [];
const granted: string[] = [];
const approved: Array<{ code: string; wallet: string; installments: number }> = [];
const SOFIA = '0x' + 'a'.repeat(40);
const MARCO = '0x' + 'c'.repeat(40);
/** Clear's members by phone, and Marco once he's joined. */
const members = new Map<string, PayMember>([['+19095550142', { wallet: SOFIA, firstName: 'Sofia', hasPasskey: false }]]);
const charges = new Map<string, 'pending' | 'approved' | 'cancelled'>();
let seq = 0;
const clear: ClearCharges = {
  raise: async () => {
    const code = `LIVE${++seq}`;
    charges.set(code, 'pending');
    return { ok: true, code };
  },
  status: async (code) => (charges.get(code) === 'cancelled' ? 'cancelled' : (charges.get(code) ?? null)) as 'pending' | 'approved' | null,
  cancel: async (code) => (charges.set(code, 'cancelled'), true),
  sendTo: async () => ({ ok: true, label: 'their Clear app' }),
};
const frameDeps = (): FrameDeps => ({
  orders,
  clear,
  card: async () => fake.provider,
  findMember: async (c) => (c.channel === 'phone' ? (members.get(c.value) ?? null) : null),
  memberByWallet: async (w) => [...members.values()].find((m) => m.wallet === w) ?? null,
  sendCode: async ({ contact, code }) => void sent.push({ to: contact.value, code }),
  notifyApp: async () => undefined,
  attachCharge: async () => true,
  approveCharge: async (code, wallet, installments) => {
    approved.push({ code, wallet, installments });
    charges.set(code, 'approved');
    return { ok: true };
  },
  creditAvailable: async (w) => (w === MARCO ? 50_000 : 300_000),
  bankLabel: async () => null,
  planOf: async (code) => ({ installments: approved.find((a) => a.code === code)?.installments ?? null }),
  grantStarterLimit: async (wallet) => (granted.push(wallet), { termLimitCents: 50_000 }),
});

/** The Clear window's signed-in member, as a test plays it: the wallet and what Privy verified. */
const memberAuth: express.RequestHandler = (req, _res, next) => {
  const wallet = req.header('x-test-wallet');
  if (!wallet) return _res.status(401).json({ error: 'Unauthorized' });
  req.auth = { walletAddress: wallet, smartWallet: wallet, phone: req.header('x-test-phone') ?? undefined, emails: [], email: undefined } as unknown as typeof req.auth;
  next();
};

const PK = ['pk', 'test', 'x'.repeat(24)].join('_');
beforeAll(async () => {
  process.env.STRIPE_PUBLISHABLE_KEY = PK;
  ({ db } = await testDb());
  const deps: PayRouteDeps = { db: async () => db, session: () => ({ orders, clear, card: async () => fake.provider }), frame: frameDeps, limits: { read: pass, act: pass }, memberAuth };
  const app = express();
  app.use('/v1', v1Cors);
  app.use(express.json());
  app.use('/v1', v1Router({ db: async () => db, v1: () => ({ orders, refunds: async () => ({ card: fake.provider, pinCheck: async () => null }) }), limit: pass }));
  app.use('/v1', v1Errors);
  app.use('/api/checkout', checkoutRouter(deps));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  delete process.env.STRIPE_PUBLISHABLE_KEY;
});
afterEach(() => {
  delete process.env.PAY_OVER_TIME_ONLINE;
});

const key = () => `k-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

/** Mi Casa Tacos with keys, its sites, its app at 1.5× for Clear, and (by default) its card processor. */
async function miCasa(opts: { cards?: boolean } = {}) {
  const s = await seedShop(db);
  await db.query(`UPDATE merchant.profiles SET name = 'Mi Casa Tacos', timezone = 'America/Los_Angeles' WHERE merchant = $1`, [s.merchant]);
  const live = await createKeys(db, { merchant: s.merchant, staffId: s.staff.owner, livemode: true });
  const test = await createKeys(db, { merchant: s.merchant, staffId: s.staff.owner, livemode: false });
  const { rows } = await db.query<{ token: string; livemode: boolean }>(`SELECT token, livemode FROM payments.api_keys WHERE merchant = $1 AND kind = 'publishable'`, [s.merchant]);
  await addSite(db, { merchant: s.merchant, staffId: s.staff.owner, request: { site: 'micasatacos.com' } });
  await addSite(db, { merchant: s.merchant, staffId: s.staff.owner, request: { site: 'http://localhost:3000' } });
  const slug = `micasa${++seq}`;
  await ensureShopApp(db, s.merchant, s.staff.owner);
  await patchShopApp(db, s.merchant, s.staff.owner, {
    slug,
    enabled: true,
    rules: { unit: 'dollars', pointsPer: 1, perAmountCents: 100, visitMinCents: 0, cardSize: 10, keepTheChange: false, clearMultiplier: 1.5, boosts: [], joinBonus: 0, birthdayRewardId: null, referralBonus: null, expiry: 'never' },
  });
  const acct = `acct_${s.merchant.slice(-8)}`;
  if (opts.cards !== false) {
    await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: s.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
  }
  return { ...s, acct, slug, liveSecret: live.secret, testSecret: test.secret, livePk: rows.find((r) => r.livemode)!.token, testPk: rows.find((r) => !r.livemode)!.token };
}
type Shop = Awaited<ReturnType<typeof miCasa>>;

/** The spec's server snippet, then the script's modal session for it, with card allowed. */
async function modalFor(shop: Shop, mode: 'test' | 'live' = 'live', amount = 18532) {
  const payment = await json<{ id: string; clientSecret: string }>(
    await post(
      '/v1/payments',
      amount === 18532
        ? { amount, currency: 'usd', reference: `catering-${++seq}`, lines: [{ name: 'Taco tray for 12', amount: 14900 }, { name: 'Agua fresca, gallon', amount: 1100, quantity: 2 }] }
        : { amount, currency: 'usd', reference: `small-${++seq}`, lines: [{ name: 'Horchata', amount }] },
      { Authorization: `Bearer ${mode === 'test' ? shop.testSecret : shop.liveSecret}`, 'Idempotency-Key': key() },
    ),
  );
  const origin = mode === 'test' ? 'http://localhost:3000' : 'https://micasatacos.com';
  const session = await json<{ id: string }>(
    await post('/v1/modal_sessions', { payment: payment.clientSecret, methods: ['clear', 'card'] }, { Authorization: `Bearer ${mode === 'test' ? shop.testPk : shop.livePk}`, Origin: origin }),
  );
  return { payment, session: session.id };
}

/** Marco, after the code: a new person's token. */
async function marcoSignsIn(session: string) {
  sent.length = 0;
  await post(`/api/checkout/${session}/contact`, { contact: '(909) 555-0188' });
  return CodeVerified.parse(await json(await post(`/api/checkout/${session}/code`, { code: sent[0]!.code })));
}

const MARCO_BASICS = { legalName: 'Marco Alvarez', dateOfBirth: '1991-04-12', zip: '91762', street: '418 W 6th St, Ontario, CA' };
const handoffOf = (url: string) => new URL(url).searchParams.get('h')!;
const asMarco = { 'x-test-wallet': MARCO, 'x-test-phone': '+19095550188' };

describe('joining (§3)', () => {
  test('a join that hands back yields a member who can approve: $185.32 in 4 on a starting limit', async () => {
    process.env.PAY_OVER_TIME_ONLINE = 'on';
    const shop = await miCasa();
    const { session } = await modalFor(shop);
    const marco = await marcoSignsIn(session);
    // You're new to Clear: "Join Clear and split it · In 4 is about $48.65 a cycle".
    expect(marco.person).toEqual({ kind: 'new', contact: '(909) 555-0188', join: { split: { installments: 4, perCycleCents: 4865 } } });

    // Step 1 in the modal, then the window's address.
    const handoff = JoinHandoff.parse(await json(await post(`/api/checkout/${session}/join`, MARCO_BASICS, { 'X-Pay-Session': marco.token })));
    expect(handoff.url).toMatch(/\/join\/pay\?h=[0-9A-Za-z]{24}$/);
    expect(JoinState.parse(await json(await fetch(`${base}/api/checkout/${session}/join`, { headers: { 'X-Pay-Session': marco.token } })))).toEqual({ state: 'waiting', token: null });

    // Step 2, in the Clear window, signed in with the same phone: step 1 read back, nothing typed twice.
    const h = handoffOf(handoff.url);
    const view = JoinWindow.parse(await json(await fetch(`${base}/api/checkout/join/${h}`, { headers: asMarco })));
    expect(view).toMatchObject({ shop: { name: 'Mi Casa Tacos' }, order: { totalCents: 18532 }, shopHost: 'micasatacos.com', basics: MARCO_BASICS, contact: { channel: 'phone', value: '+19095550188' } });
    const done = JoinFinished.parse(await json(await post(`/api/checkout/join/${h}/done`, {}, asMarco)));
    expect(done).toEqual({ state: 'done', termLimitCents: 50_000 });
    expect(granted).toContain(MARCO);
    members.set('+19095550188', { wallet: MARCO, firstName: 'Marco', hasPasskey: false });

    // Step 3, back in the modal: Marco's own screen, and over time in 4.
    const state = JoinState.parse(await json(await fetch(`${base}/api/checkout/${session}/join`, { headers: { 'X-Pay-Session': marco.token } })));
    expect(state.state).toBe('done');
    const quote = MemberQuote.parse(await json(await fetch(`${base}/api/checkout/${session}/member`, { headers: { 'X-Pay-Session': state.token! } })));
    expect(quote.firstName).toBe('Marco');
    expect(quote.splits.find((s) => s.installments === 4)?.perCycleCents).toBe(4865);
    const res = await post(`/api/checkout/${session}/approve`, { installments: 4, idempotencyKey: key() }, { 'X-Pay-Session': state.token! });
    expect(res.status).toBe(200);
    expect(PaidView.parse(await json(res))).toMatchObject({ method: 'clear', installments: 4 });
    expect(approved.at(-1)).toMatchObject({ wallet: MARCO, installments: 4 });
    // The rest of the file meets Marco before he's joined.
    members.delete('+19095550188');
  });

  test('the window is only for the person whose code it was, and only once', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop);
    const marco = await marcoSignsIn(session);
    const handoff = JoinHandoff.parse(await json(await post(`/api/checkout/${session}/join`, MARCO_BASICS, { 'X-Pay-Session': marco.token })));
    const h = handoffOf(handoff.url);
    // Signed in with another number: nothing read, nothing finished.
    const other = { 'x-test-wallet': '0x' + 'd'.repeat(40), 'x-test-phone': '+19095550111' };
    expect((await fetch(`${base}/api/checkout/join/${h}`, { headers: other })).status).toBe(403);
    expect((await post(`/api/checkout/join/${h}/done`, {}, other)).status).toBe(403);
    expect((await fetch(`${base}/api/checkout/join/${h}`)).status).toBe(401);
    // Done once; the link is spent.
    expect((await post(`/api/checkout/join/${h}/done`, {}, asMarco)).status).toBe(200);
    expect((await fetch(`${base}/api/checkout/join/${h}`, { headers: asMarco })).status).toBe(410);
    expect((await post(`/api/checkout/join/${h}/done`, {}, asMarco)).status).toBe(410);
  });

  test('the window’s link runs out after 15 minutes, and step 1 never keeps an SSN or a minor', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop);
    const marco = await marcoSignsIn(session);
    const minor = await post(`/api/checkout/${session}/join`, { ...MARCO_BASICS, dateOfBirth: '2012-01-01' }, { 'X-Pay-Session': marco.token });
    expect(minor.status).toBe(422);
    expect((await json<{ message: string }>(minor)).message).toBe('You need to be 18 or older to join Clear');
    const handoff = JoinHandoff.parse(await json(await post(`/api/checkout/${session}/join`, { ...MARCO_BASICS, ssn: '123-45-6789' }, { 'X-Pay-Session': marco.token })));
    const { rows } = await db.query<{ join_basics_enc: string }>('SELECT join_basics_enc FROM payments.pay_sessions WHERE id = $1', [session]);
    expect(Object.keys(JSON.parse(decryptSecret(rows[0]!.join_basics_enc))).sort()).toEqual(['dateOfBirth', 'legalName', 'street', 'zip']);
    const later = new Date(Date.now() + 16 * 60 * 1000);
    await expect(joinWindow(db, frameDeps(), { handoff: handoffOf(handoff.url), who: { phone: '+19095550188' }, now: later })).rejects.toMatchObject({ code: 'expired' });
  });

  test('a member doesn’t join again; test mode has only the test member', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop);
    sent.length = 0;
    await post(`/api/checkout/${session}/contact`, { contact: '(909) 555-0142' });
    const sofia = CodeVerified.parse(await json(await post(`/api/checkout/${session}/code`, { code: sent[0]!.code })));
    expect((await post(`/api/checkout/${session}/join`, MARCO_BASICS, { 'X-Pay-Session': sofia.token })).status).toBe(409);
  });

  test('closing the join window leaves card working', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop);
    const marco = await marcoSignsIn(session);
    await post(`/api/checkout/${session}/join`, MARCO_BASICS, { 'X-Pay-Session': marco.token });
    // The window was closed: nothing came back. Pay by card is still there, and it starts.
    expect(PaySession.parse(await json(await fetch(`${base}/api/checkout/${session}`))).methods.card).toBe(true);
    const card = CardStarted.parse(await json(await post(`/api/checkout/${session}/card`, { idempotencyKey: key() }, { 'X-Pay-Session': marco.token })));
    expect(card).toMatchObject({ stripeAccount: shop.acct, publishableKey: PK, amountCents: 18532 });
  });
});

/** Stripe's payment_intent.* event, applied by the same handler as every card. */
async function stripeEvent(type: string, shop: Shop, paymentIntent: string) {
  const event = { type, account: shop.acct, data: { object: { id: paymentIntent } } } as unknown as Stripe.Event;
  await db.transaction((tx) => cardPaymentHandlers(() => fake.provider)[type]!(tx, event));
}
const tenderFor = async (session: string) =>
  (
    await db.query<{ id: string; status: string; payment_intent_id: string | null; application_fee_cents: number; order_id: string }>(
      `SELECT t.* FROM payments.tenders t JOIN payments.pay_sessions s ON s.order_id = t.order_id WHERE s.id = $1 AND t.method = 'card' ORDER BY t.created_at DESC LIMIT 1`,
      [session],
    )
  ).rows[0]!;

describe('card in the modal (§3)', () => {
  test('a card sale under $10 has no Clear fee, and one at $185.32 has 30¢ on pay-as-you-go', async () => {
    const shop = await miCasa();
    const big = await modalFor(shop);
    const small = await modalFor(shop, 'live', 800);
    await post(`/api/checkout/${big.session}/card`, { idempotencyKey: key() });
    await post(`/api/checkout/${small.session}/card`, { idempotencyKey: key() });
    expect((await tenderFor(big.session)).application_fee_cents).toBe(30);
    expect((await tenderFor(small.session)).application_fee_cents).toBe(0);
    const pi = (await tenderFor(big.session)).payment_intent_id!;
    expect(fake.payments.get(pi)).toMatchObject({ amount: 18532, fee: 30 });
  });

  test('paid by card: Online in Charges, the order paid, and found in the shop’s Stripe payouts', async () => {
    const shop = await miCasa();
    const { payment, session } = await modalFor(shop);
    await post(`/api/checkout/${session}/card`, { idempotencyKey: key() });
    const t = await tenderFor(session);
    // The PaymentIntent is kept from the start, so its events and the reconciliation find the tender.
    expect(t.payment_intent_id).toBeTruthy();
    fake.payOnline(t.payment_intent_id!);
    await stripeEvent('payment_intent.succeeded', shop, t.payment_intent_id!);
    expect((await tenderFor(session)).status).toBe('captured');
    const { rows } = await db.query<{ status: string; source: string; source_detail: string; raised_by: string | null }>('SELECT status, source, source_detail, raised_by FROM commerce.orders WHERE id = $1', [t.order_id]);
    expect(rows[0]).toEqual({ status: 'paid', source: 'online', source_detail: 'https://micasatacos.com', raised_by: null });
    const status = PayStatus.parse(await json(await fetch(`${base}/api/checkout/${session}/status`)));
    expect(status).toMatchObject({ state: 'paid', paid: { method: 'card', installments: null, receipt: 'On your card statement' } });
    const v1 = await json<{ status: string; method: string }>(await fetch(`${base}/v1/payments/${payment.id}`, { headers: { Authorization: `Bearer ${shop.liveSecret}` } }));
    expect(v1).toMatchObject({ status: 'succeeded', method: 'card' });
    // The processor's balance item for it matches the tender: no charge without a tender, no fee mismatch.
    const flags = await findMismatches(db, fake.provider, { merchant: shop.merchant, account: shop.acct, since: new Date(Date.now() - 60_000) });
    expect(flags.filter((f) => f.detail.includes(t.payment_intent_id!) || f.ref === t.id)).toEqual([]);
  });

  test('a declined card can be tried again on the same payment', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop);
    const first = CardStarted.parse(await json(await post(`/api/checkout/${session}/card`, { idempotencyKey: key() })));
    const t = await tenderFor(session);
    fake.decline(t.payment_intent_id!);
    await stripeEvent('payment_intent.payment_failed', shop, t.payment_intent_id!);
    expect((await tenderFor(session)).status).toBe('pending');
    expect(fake.calls.cancels).not.toContain(t.payment_intent_id!);
    // Back in the fields: the same payment, not a second one.
    const again = CardStarted.parse(await json(await post(`/api/checkout/${session}/card`, { idempotencyKey: key() })));
    expect(again.clientSecret).toBe(first.clientSecret);
    fake.payOnline(t.payment_intent_id!);
    await stripeEvent('payment_intent.succeeded', shop, t.payment_intent_id!);
    expect((await tenderFor(session)).status).toBe('captured');
  });

  test('a shop with no processor never shows card; test mode never runs on a live key', async () => {
    const none = await miCasa({ cards: false });
    const a = await modalFor(none);
    expect(PaySession.parse(await json(await fetch(`${base}/api/checkout/${a.session}`))).methods.card).toBe(false);
    expect((await post(`/api/checkout/${a.session}/card`, { idempotencyKey: key() })).status).toBe(409);

    // A live key here: a test-mode session's card would be real money, so it isn't offered.
    const liveKey = fakeProvider({ livemode: true });
    const shop = await miCasa();
    const b = await modalFor(shop, 'test');
    const view = await import('../services/merchant/pay/sessions.js').then((m) => m.paySessionView(db, { orders, clear, card: async () => liveKey.provider }, { session: b.session }));
    expect(view.methods.card).toBe(false);

    // No publishable key for the fields: no card.
    const was = process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    try {
      expect(PaySession.parse(await json(await fetch(`${base}/api/checkout/${b.session}`))).methods.card).toBe(false);
    } finally {
      process.env.STRIPE_PUBLISHABLE_KEY = was;
    }
  });

  test('a signed-in member who switches to card: the Clear charge is withdrawn, and the points follow the card', async () => {
    const shop = await miCasa();
    const { session } = await modalFor(shop);
    // Sofia is a member of Mi Casa's rewards.
    const { rows: person } = await db.query(
      `INSERT INTO rewards.people (id, privy_did, wallet, first_name) VALUES ($1, $2, $3, 'Sofia')
       ON CONFLICT (privy_did) DO UPDATE SET wallet = EXCLUDED.wallet RETURNING *`,
      [`rwp_sofia_${seq}`, `did:test:sofia:${++seq}`, SOFIA],
    );
    await joinShop(db, { slug: shop.slug, person: person[0] as never, body: { texts: 'codes', birthMonth: null, consentVersion: 'test', ref: null, orderId: null }, now: new Date() });
    sent.length = 0;
    await post(`/api/checkout/${session}/contact`, { contact: '(909) 555-0142' });
    const sofia = CodeVerified.parse(await json(await post(`/api/checkout/${session}/code`, { code: sent[0]!.code })));
    const { rows: before } = await db.query<{ status: string }>(`SELECT t.status FROM payments.tenders t JOIN payments.pay_sessions s ON s.order_id = t.order_id WHERE s.id = $1 AND t.method = 'clear'`, [session]);
    expect(before.map((r) => r.status)).toEqual(['pending']);

    await post(`/api/checkout/${session}/card`, { idempotencyKey: key() }, { 'X-Pay-Session': sofia.token });
    const { rows: after } = await db.query<{ status: string }>(`SELECT t.status FROM payments.tenders t JOIN payments.pay_sessions s ON s.order_id = t.order_id WHERE s.id = $1 AND t.method = 'clear'`, [session]);
    expect(after.map((r) => r.status)).toEqual(['cancelled']);
    const t = await tenderFor(session);
    fake.payOnline(t.payment_intent_id!);
    await stripeEvent('payment_intent.succeeded', shop, t.payment_intent_id!);
    const status = PayStatus.parse(await json(await fetch(`${base}/api/checkout/${session}/status`)));
    // $171 of food, a point a dollar; Clear's 1.5× is for Clear's cents only.
    expect(status.paid).toMatchObject({ method: 'card', points: { earned: 171, now: 171 }, receipt: 'In Clear' });
  });

  test('adding a site registers it and Clear’s pay host for wallets; localhost is left out', async () => {
    const shop = await miCasa();
    fake.calls.domains.length = 0;
    expect(await registerWalletDomains(db, fake.provider, { merchant: shop.merchant, origin: 'https://micasatacos.com' })).toEqual(['micasatacos.com', 'pay.useclear.org']);
    expect(await registerWalletDomains(db, fake.provider, { merchant: shop.merchant, origin: 'http://localhost:3000' })).toEqual(['pay.useclear.org']);
    expect(fake.calls.domains.every((d) => d.account === shop.acct)).toBe(true);
  });
});
