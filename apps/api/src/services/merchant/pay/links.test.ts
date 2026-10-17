import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type Stripe from 'stripe';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import * as catalog from '../catalog/catalogService.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { createOrder, getOrder, listOrderHistory, type OrderDeps } from '../orders/orderService.js';
import { type ClearCharges, syncClearTender } from '../orders/payments.js';
import { fixedClearSide } from '../rewards/clearSide.js';
import { joinShop } from '../rewards/customerApp.js';
import { addEntry, balance } from '../rewards/ledger.js';
import { resolvePerson } from '../rewards/people.js';
import { ensureShopApp, patchShopApp } from '../rewards/shopApp.js';
import { auditTrail } from '../security/audit.js';
import { cardPaymentHandlers } from '../stripeEvents/cardPaymentHandlers.js';
import { createPaymentLink, deactivatePaymentLink, listPaymentLinks, publicLink } from './links.js';
import { onlineOverTimeForCharge } from './overTime.js';
import { payInSession, paySessionView, startLinkSession, type PaySessionDeps } from './sessions.js';

/**
 * Payment links (pay spec §5; pay prompt, Phase 3). Mi Casa Tacos as the spec draws it: the taco tray
 * for 12 at $149.00, food taxed at 8.375%, so the link page reads $161.48.
 */

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});
afterEach(() => {
  delete process.env.PAY_OVER_TIME_ONLINE;
});

let seq = 0;
const key = () => `k-${++seq}-${Math.random().toString(36).slice(2, 6)}`;
const orders: OrderDeps = { taxApi: null, pinCheck: async () => null };
const OCT_16 = new Date('2026-10-16T17:40:00Z');
const wallet = () => `0x${Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40)}`;

async function miCasa() {
  const s = await seedShop(db);
  await db.query(
    `UPDATE merchant.profiles SET name = 'Mi Casa Tacos', address_line1 = '201 E State St', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92373',
       address_country = 'US', tax_rates = $2, tax_rates_address = '201 e state st|redlands|ca|92373|us', timezone = 'America/Los_Angeles' WHERE merchant = $1`,
    [s.merchant, JSON.stringify({ food: 83750, goods: 83750, labour: null })],
  );
  const item = (name: string, priceCents: number) =>
    catalog.createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name, detail: null, category: 'Catering', priceCents, costCents: null, taxKind: 'food', stockTracked: false, reorderAt: null } });
  const tray = await item('Taco tray for 12', 14900);
  const agua = await item('Agua fresca, gallon', 1100);
  return { ...s, tray, agua };
}

/** A fake Clear side: charges it raised, and who paid each. */
function fakeClear(payerWallet: string | null = null) {
  const charges = new Map<string, 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled'>();
  let n = 0;
  const clear: ClearCharges = {
    async raise() {
      const code = `CLR${++n}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      charges.set(code, 'pending');
      return { ok: true, code };
    },
    async status(code) {
      return charges.get(code) ?? null;
    },
    async payer() {
      return payerWallet;
    },
    async cancel(code) {
      charges.set(code, 'cancelled');
      return true;
    },
    async sendTo() {
      return { ok: true, label: 'their Clear app' };
    },
  };
  return { clear, charges };
}

const deps = (clear: ClearCharges, card: PaySessionDeps['card'] = async () => null): PaySessionDeps => ({ orders, clear, card });

const trayLink = (shop: Awaited<ReturnType<typeof miCasa>>, patch: Record<string, unknown> = {}) =>
  createPaymentLink(db, orders, {
    merchant: shop.merchant,
    staffId: shop.staff.owner,
    now: OCT_16,
    request: { for: 'item', itemId: shop.tray.id, quantity: 1, note: 'Saturday pickup, 11:30am', expires: '7d', allowOverTime: true, ...patch },
  });

describe('New charge › Send a link', () => {
  test('§5: the taco tray, with its note, for 7 days, at $161.48 with tax', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    expect(link).toMatchObject({ name: 'Taco tray for 12', totalCents: 16148, itemId: shop.tray.id, quantity: 1, note: 'Saturday pickup, 11:30am', allowOverTime: true, active: true, livemode: true });
    expect(link.expiresAt).toBe('2026-10-23T17:40:00.000Z');
    // Mi Casa Tacos has no app here, so its everyday name: "Mi Casa" → micasa.
    expect(link.slug).toMatch(/^micasa-[a-z2-9]{6}$/);
    expect(link.url).toBe(`https://pay.useclear.org/l/${link.slug}`);
    expect((await listPaymentLinks(db, orders, shop.merchant)).map((l) => l.id)).toEqual([link.id]);
  });

  test('a shop with an app uses its slug', async () => {
    const shop = await miCasa();
    await ensureShopApp(db, shop.merchant, shop.staff.owner);
    await patchShopApp(db, shop.merchant, shop.staff.owner, { slug: `micasa${seq++}` });
    expect((await trayLink(shop)).slug).toMatch(/^micasa\d+-[a-z2-9]{6}$/);
  });

  test('an amount is what the customer pays: no tax is added', async () => {
    const shop = await miCasa();
    const link = await createPaymentLink(db, orders, { merchant: shop.merchant, staffId: shop.staff.manager, request: { for: 'amount', amountCents: 2500, note: null, expires: 'never', allowOverTime: false } });
    expect(link).toMatchObject({ name: 'Payment', amountCents: 2500, totalCents: 2500, expiresAt: null });
    expect((await publicLink(db, orders, link.slug)).order).toMatchObject({ totalCents: 2500, taxCents: 0 });
  });

  test('an archived item, or one with options to choose, can’t be a link', async () => {
    const shop = await miCasa();
    await catalog.archiveItem(db, { merchant: shop.merchant, itemId: shop.agua.id });
    await expect(createPaymentLink(db, orders, { merchant: shop.merchant, staffId: shop.staff.owner, request: { for: 'item', itemId: shop.agua.id, quantity: 1, note: null, expires: 'never', allowOverTime: false } })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('the link page', () => {
  test('shows the shop, the item with tax, the note and the expiry', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    const page = await publicLink(db, orders, link.slug, OCT_16);
    expect(page).toMatchObject({
      shop: { name: 'Mi Casa Tacos', initials: 'MC', logoUrl: null, accent: null },
      order: { lines: [{ name: 'Taco tray for 12', quantity: 1, lineCents: 14900 }], subtotalCents: 14900, taxCents: 1248, totalCents: 16148, summary: 'Taco tray for 12' },
      note: 'Saturday pickup, 11:30am',
      expiresAt: '2026-10-23T17:40:00.000Z',
      state: 'open',
      methods: { clear: true, card: false },
    });
  });

  test('an unknown address says so', async () => {
    await expect(publicLink(db, orders, 'nobody-abcdef')).rejects.toMatchObject({ code: 'not_found' });
    await expect(publicLink(db, orders, '../etc')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('expired and turned-off links refuse payment', () => {
  test('after its expiry, the page says expired and nothing starts', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    const after = new Date('2026-10-23T17:40:01Z');
    expect((await publicLink(db, orders, link.slug, after)).state).toBe('expired');
    await expect(startLinkSession(db, deps(fakeClear().clear), { slug: link.slug, now: after })).rejects.toMatchObject({ code: 'expired' });
  });

  test('a payment started before it expired can’t be paid after', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    const { clear } = fakeClear();
    const { session } = await startLinkSession(db, deps(clear), { slug: link.slug, now: OCT_16 });
    const after = new Date('2026-10-23T17:40:01Z');
    expect((await paySessionView(db, deps(clear), { session, now: after })).state).toBe('expired');
    await expect(payInSession(db, deps(clear), { session, now: after, request: { method: 'clear', idempotencyKey: key() } })).rejects.toMatchObject({ code: 'expired' });
  });

  test('turned off, it says so, and neither a new nor a started payment goes through', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    const { clear } = fakeClear();
    const { session } = await startLinkSession(db, deps(clear), { slug: link.slug });
    const off = await deactivatePaymentLink(db, orders, { merchant: shop.merchant, staffId: shop.staff.manager, id: link.id });
    expect(off.active).toBe(false);
    expect((await publicLink(db, orders, link.slug)).state).toBe('inactive');
    await expect(startLinkSession(db, deps(clear), { slug: link.slug })).rejects.toMatchObject({ code: 'inactive' });
    await expect(payInSession(db, deps(clear), { session, request: { method: 'clear', idempotencyKey: key() } })).rejects.toMatchObject({ code: 'inactive' });
  });

  test('another shop’s link can’t be turned off', async () => {
    const shop = await miCasa();
    const other = await miCasa();
    const link = await trayLink(shop);
    await expect(deactivatePaymentLink(db, orders, { merchant: other.merchant, staffId: other.staff.owner, id: link.id })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the amount can’t be changed by the request', () => {
  test('the order is the link’s, whatever the request says', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    const { clear } = fakeClear();
    const { session } = await startLinkSession(db, deps(clear), { slug: link.slug });
    const started = await payInSession(db, deps(clear), {
      session,
      request: { method: 'clear', idempotencyKey: key(), amountCents: 1, totalCents: 1, lines: [{ itemId: null, name: 'Taco tray for 12', amountCents: 1 }] },
    });
    expect(started.method).toBe('clear');
    const { rows } = await db.query<{ amount_cents: string; order_id: string }>(`SELECT amount_cents, order_id FROM payments.tenders WHERE clear_charge_code = $1`, [
      started.method === 'clear' ? started.chargeCode : '',
    ]);
    expect(Number(rows[0]!.amount_cents)).toBe(16148);
    expect((await getOrder(db, shop.merchant, rows[0]!.order_id)).totalCents).toBe(16148);
  });

  test('a reward can’t be put on a link', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    const { clear } = fakeClear();
    const { session } = await startLinkSession(db, deps(clear), { slug: link.slug });
    await expect(payInSession(db, deps(clear), { session, request: { method: 'clear', idempotencyKey: key(), rewardId: 'rwd_1' } })).rejects.toMatchObject({ code: 'invalid' });
  });

  test('a second tap opens the same Clear charge', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    const { clear } = fakeClear();
    const { session } = await startLinkSession(db, deps(clear), { slug: link.slug });
    const a = await payInSession(db, deps(clear), { session, request: { method: 'clear', idempotencyKey: key() } });
    const b = await payInSession(db, deps(clear), { session, request: { method: 'clear', idempotencyKey: key() } });
    expect(a).toEqual(b);
    expect(a.method === 'clear' && a.url).toMatch(/\/c\/CLR/);
  });
});

describe('a link sale', () => {
  test('appears in Charges as Link, with nobody at the shop behind it, and the audit reads online', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    const { clear, charges } = fakeClear();
    const { session } = await startLinkSession(db, deps(clear), { slug: link.slug, now: OCT_16 });
    const started = await payInSession(db, deps(clear), { session, request: { method: 'clear', idempotencyKey: key() } });
    const code = started.method === 'clear' ? started.chargeCode : '';
    charges.set(code, 'approved');
    const { rows } = await db.query<{ id: string }>('SELECT id FROM payments.tenders WHERE clear_charge_code = $1', [code]);
    await syncClearTender(db, clear, { merchant: shop.merchant, tenderId: rows[0]!.id, actor: null });
    expect((await paySessionView(db, deps(clear), { session })).state).toBe('paid');
    const history = await listOrderHistory(db, shop.merchant, '2026-10-16', '2026-10-16');
    expect(history[0]).toMatchObject({ status: 'paid', source: 'link', sourceDetail: link.slug, raisedBy: null, livemode: true, totalCents: 16148 });
    expect(history[0]!.tenders[0]).toMatchObject({ method: 'clear', status: 'approved', amountCents: 16148 });
    const trail = await auditTrail(db, { merchant: shop.merchant, from: '2026-10-16', to: '2026-10-17' });
    expect(trail.find((e) => e.action === 'tender.clear_started')).toMatchObject({ actor: null, source: 'link' });
  });

  test('earns points through the rewards hook: Sofia, at 1.5× for Clear, gets 223 for the $149.00 tray', async () => {
    const shop = await miCasa();
    await ensureShopApp(db, shop.merchant, shop.staff.owner);
    const slug = `micasa${seq++}`;
    await patchShopApp(db, shop.merchant, shop.staff.owner, {
      slug,
      enabled: true,
      rules: { unit: 'dollars', pointsPer: 1, perAmountCents: 100, visitMinCents: 0, cardSize: 10, keepTheChange: false, clearMultiplier: 1.5, boosts: [], joinBonus: 0, birthdayRewardId: null, referralBonus: null, expiry: 'never' },
    });
    const did = `did:privy:sofia-${seq}`;
    const w = wallet();
    const side = fixedClearSide([{ did, wallet: w, subject: did, canPayWithClear: true, displayName: 'Sofia M.' }]);
    const person = (await resolvePerson(db, side, { did, wallet: w, phone: '+19095550142' }))!;
    await joinShop(db, { slug, person, body: { texts: 'codes_and_offers', birthMonth: null, consentVersion: 'join-2026-10', ref: null, orderId: null } });
    await addEntry(db, { merchant: shop.merchant, personId: person.id, kind: 'adjust', points: 128, rulesVersion: 1, reason: 'Opening balance', dedupeKey: key() });

    const link = await trayLink(shop);
    const { clear, charges } = fakeClear(w);
    const { session } = await startLinkSession(db, deps(clear), { slug: link.slug });
    const started = await payInSession(db, deps(clear), { session, request: { method: 'clear', idempotencyKey: key() } });
    const code = started.method === 'clear' ? started.chargeCode : '';
    charges.set(code, 'approved');
    const { rows } = await db.query<{ id: string; order_id: string }>('SELECT id, order_id FROM payments.tenders WHERE clear_charge_code = $1', [code]);
    await syncClearTender(db, clear, { merchant: shop.merchant, tenderId: rows[0]!.id, actor: null });
    // Points are counted before tax: ⌊149 × 1.5⌋ = 223.
    expect(await balance(db, shop.merchant, person.id)).toBe(128 + 223);
    expect((await getOrder(db, shop.merchant, rows[0]!.order_id)).member?.memberId).toBe(person.id);
  });

  test('by card: a checkout on the shop’s own account, with Clear’s 30¢, paid by its webhook', async () => {
    const shop = await miCasa();
    const fake = fakeProvider();
    const acct = `acct_${shop.merchant.slice(-6)}`;
    await connectorStore.insert(db, { merchant: shop.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: shop.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    const link = await trayLink(shop);
    expect((await publicLink(db, orders, link.slug)).methods).toEqual({ clear: true, card: true });
    const { clear } = fakeClear();
    const d = deps(clear, async () => fake.provider);
    const { session } = await startLinkSession(db, d, { slug: link.slug });
    const started = await payInSession(db, d, { session, request: { method: 'card', idempotencyKey: key() } });
    expect(started.method).toBe('card');
    const { rows } = await db.query<{ order_id: string; checkout_session_id: string; application_fee_cents: string; created_by: string | null; amount_cents: string }>(
      `SELECT order_id, checkout_session_id, application_fee_cents, created_by, amount_cents FROM payments.tenders WHERE order_id = (SELECT order_id FROM payments.pay_sessions WHERE id = $1)`,
      [session],
    );
    expect(rows[0]).toMatchObject({ created_by: null });
    expect(Number(rows[0]!.amount_cents)).toBe(16148);
    expect(Number(rows[0]!.application_fee_cents)).toBe(30);
    const paymentId = fake.payCheckout(rows[0]!.checkout_session_id);
    const handlers = cardPaymentHandlers(() => fake.provider);
    const event = { type: 'checkout.session.completed', account: acct, data: { object: { id: rows[0]!.checkout_session_id, payment_intent: paymentId } } } as unknown as Stripe.Event;
    await db.transaction((tx) => handlers['checkout.session.completed']!(tx, event));
    expect((await getOrder(db, shop.merchant, rows[0]!.order_id)).status).toBe('paid');
    expect((await paySessionView(db, d, { session })).state).toBe('paid');
  });

  test('a shop with no card processor isn’t offered card', async () => {
    const shop = await miCasa();
    const link = await trayLink(shop);
    const { clear } = fakeClear();
    const { session } = await startLinkSession(db, deps(clear, async () => fakeProvider().provider), { slug: link.slug });
    await expect(payInSession(db, deps(clear, async () => fakeProvider().provider), { session, request: { method: 'card', idempotencyKey: key() } })).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('paying over time online (rule 9)', () => {
  async function chargeFor(patch: Record<string, unknown>) {
    const shop = await miCasa();
    const link = await trayLink(shop, patch);
    const { clear } = fakeClear();
    const { session } = await startLinkSession(db, deps(clear), { slug: link.slug });
    const started = await payInSession(db, deps(clear), { session, request: { method: 'clear', idempotencyKey: key() } });
    return { code: started.method === 'clear' ? started.chargeCode : '', session, clear };
  }

  test('off in live until it’s switched on, even where the link allows it', async () => {
    const { code, session, clear } = await chargeFor({ allowOverTime: true });
    expect(await onlineOverTimeForCharge(db, code)).toBe(false);
    expect((await paySessionView(db, deps(clear), { session })).overTime).toBe(false);
    process.env.PAY_OVER_TIME_ONLINE = 'on';
    expect(await onlineOverTimeForCharge(db, code)).toBe(true);
    expect((await paySessionView(db, deps(clear), { session })).overTime).toBe(true);
  });

  test('never where the link doesn’t allow it', async () => {
    process.env.PAY_OVER_TIME_ONLINE = 'on';
    const { code } = await chargeFor({ allowOverTime: false });
    expect(await onlineOverTimeForCharge(db, code)).toBe(false);
  });

  test('a counter charge keeps the counter’s rules', async () => {
    expect(await onlineOverTimeForCharge(db, 'NOTONLINE')).toBeNull();
  });
});

describe('orders without staff', () => {
  test('only a website’s or a link’s order goes without', async () => {
    const shop = await miCasa();
    await expect(createOrder(db, orders, { merchant: shop.merchant, staffId: null, lines: [{ itemId: shop.tray.id, quantity: 1, optionIds: [] }] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      db.query(`INSERT INTO commerce.orders (id, merchant, raised_by, business_date) VALUES ('ord_nobody_${seq++}', $1, NULL, '2026-10-16')`, [shop.merchant]),
    ).rejects.toThrow(/orders_staff_unless_online/);
  });

  test('a tender with nobody behind it needs an online order', async () => {
    const shop = await miCasa();
    const counter = await createOrder(db, orders, { merchant: shop.merchant, staffId: shop.staff.jen, lines: [{ itemId: shop.tray.id, quantity: 1, optionIds: [] }] });
    await expect(
      db.query(
        `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, idempotency_key, request_hash, created_by) VALUES ('tnd_nobody_${seq++}', $1, $2, 'clear', 100, $3, 'h', NULL)`,
        [shop.merchant, counter.id, key()],
      ),
    ).rejects.toThrow(/needs a staff member/);
  });
});
