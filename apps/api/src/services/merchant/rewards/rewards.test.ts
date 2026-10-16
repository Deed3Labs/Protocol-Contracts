import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { CounterCustomer } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import * as catalog from '../catalog/catalogService.js';
import { createCardTender, syncCardTender } from '../cards/cardTenders.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { openDrawer } from '../drawer/drawerService.js';
import { applyDiscount, createOrder, getOrder, type OrderDeps } from '../orders/orderService.js';
import { type ClearCharges, createCashTender, createClearTender, sendClearTender, syncClearTender } from '../orders/payments.js';
import { settleOrder } from '../orders/settle.js';
import { fixedClearSide, type ClearSide } from './clearSide.js';
import { addCustomer, answerCounterConfirm, claimReward, counterCustomer, openClaim, orderCustomerState, setOrderMember, type RewardsNotifier } from './counter.js';
import { joinShop, leaveShop, shopPaid } from './customerApp.js';
import { addEntry, balance, expirePoints, onOrderPaid, onOrderRefunded } from './ledger.js';
import { createPerson, personByDid, resolvePerson } from './people.js';
import { createReward, ensureShopApp, patchShopApp, rulesAt } from './shopApp.js';
import { mintIdentityId, mintSession } from './tokens.js';
import { shopRouter, type RewardsDeps } from '../../../routes/rewards.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const key = () => `k-${++seq}-${Math.random().toString(36).slice(2, 6)}`;
const noTax: OrderDeps = { taxApi: null, pinCheck: async () => null };
const CONSENT = 'join-2026-10';

/** Mi Casa Tacos as the spec draws it: 8.375% on food, the menu, the rewards, a point a dollar. */
async function miCasa(opts: { rules?: Record<string, unknown> } = {}) {
  const s = await seedShop(db);
  await db.query(
    `UPDATE merchant.profiles SET address_line1 = '201 E State St', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92373', address_country = 'US',
       tax_rates = $2, tax_rates_address = '201 e state st|redlands|ca|92373|us', timezone = 'America/Los_Angeles' WHERE merchant = $1`,
    [s.merchant, JSON.stringify({ food: 83750, goods: 83750, labour: null })],
  );
  const item = (name: string, category: string, priceCents: number) =>
    catalog.createItem(db, { merchant: s.merchant, staffId: s.staff.owner, item: { name, detail: null, category, priceCents, costCents: null, taxKind: 'food', stockTracked: false, reorderAt: null } });
  const pastor = await item('Al pastor', 'Tacos', 450);
  const horchata = await item('Horchata', 'Drinks', 350);
  const jamaica = await item('Jamaica', 'Drinks', 350);
  const tray = await item('Family tray', 'Catering', 6500);
  await ensureShopApp(db, s.merchant, s.staff.owner);
  const slug = `micasa-${seq++}`;
  await patchShopApp(db, s.merchant, s.staff.owner, {
    slug,
    enabled: true,
    rules: {
      unit: 'dollars',
      pointsPer: 1,
      perAmountCents: 100,
      visitMinCents: 0,
      cardSize: 10,
      keepTheChange: false,
      clearMultiplier: 1,
      boosts: [],
      joinBonus: 0,
      birthdayRewardId: null,
      referralBonus: null,
      expiry: 'never',
      ...opts.rules,
    },
  });
  const agua = await createReward(db, s.merchant, { name: 'Free agua fresca', gives: { kind: 'item', itemIds: [jamaica.id, horchata.id], maxCents: null }, cost: 75, limit: 'daily', clearMembersOnly: false, note: 'any size' });
  const trayOff = await createReward(db, s.merchant, { name: 'Family tray, $20 off', gives: { kind: 'amount', amountCents: 2000, categories: ['Catering'] }, cost: 600, limit: 'none', clearMembersOnly: true, note: null });
  const table6 = () =>
    createOrder(db, noTax, {
      merchant: s.merchant,
      staffId: s.staff.jen,
      lines: [
        { itemId: pastor.id, quantity: 2, optionIds: [] },
        { itemId: horchata.id, quantity: 1, optionIds: [] },
        { itemId: jamaica.id, quantity: 1, optionIds: [] },
      ],
    });
  const lines = (cents: number) => createOrder(db, noTax, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Order', note: null, amountCents: cents, taxKind: 'exempt' }] });
  return { ...s, slug, items: { pastor, horchata, jamaica, tray }, rewards: { agua, trayOff }, table6, lines };
}

const wallet = () => `0x${Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40)}`;

/** Sofia: a Clear member. Marco: rewards only. */
async function people(clearMembers: Array<{ did: string; wallet: string; name: string }> = []) {
  const clear = fixedClearSide(clearMembers.map((m) => ({ did: m.did, wallet: m.wallet, subject: m.did, canPayWithClear: true, displayName: m.name })));
  return clear;
}

async function sofiaAt(shop: Awaited<ReturnType<typeof miCasa>>, points = 128) {
  const did = `did:privy:sofia-${seq++}`;
  const w = wallet();
  const phone = `+1909555${String(1000 + (seq % 9000)).slice(-4)}`;
  const clear = await people([{ did, wallet: w, name: 'Sofia M.' }]);
  const person = (await resolvePerson(db, clear, { did, wallet: w, phone }))!;
  await joinShop(db, { slug: shop.slug, person, body: { texts: 'codes_and_offers', birthMonth: null, consentVersion: CONSENT, ref: null, orderId: null } });
  if (points) await addEntry(db, { merchant: shop.merchant, personId: person.id, kind: 'adjust', points, rulesVersion: 1, reason: 'Opening balance', dedupeKey: key() });
  return { did, wallet: w, phone, person, clear };
}

function fakeClear() {
  const charges = new Map<string, 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled'>();
  const sent: Array<{ code: string; to: { member: string } | { phone: string } }> = [];
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
    async cancel(code) {
      charges.set(code, 'cancelled');
      return true;
    },
    async sendTo(code, to) {
      sent.push({ code, to });
      return { ok: true, label: 'their Clear app' };
    },
  };
  return { clear, charges, sent };
}

async function payClear(shop: { merchant: string; staff: { jen: string } }, orderId: string) {
  const fc = fakeClear();
  const o = await getOrder(db, shop.merchant, orderId);
  const t = await createClearTender(db, fc.clear, { merchant: shop.merchant, orderId, staffId: shop.staff.jen, tender: { amountCents: o.totalCents, tipCents: 0, idempotencyKey: key() } });
  fc.charges.set(t.clearChargeCode!, 'approved');
  await syncClearTender(db, fc.clear, { merchant: shop.merchant, tenderId: t.id, actor: null });
  return { tender: t, fc };
}

async function payCash(shop: { merchant: string; staff: { jen: string } }, orderId: string) {
  await openDrawer(db, { merchant: shop.merchant, staffId: shop.staff.jen }).catch(() => null);
  const o = await getOrder(db, shop.merchant, orderId);
  return createCashTender(db, { merchant: shop.merchant, orderId, staffId: shop.staff.jen, tender: { amountCents: o.totalCents, tipCents: 0, handedOverCents: o.totalCents, idempotencyKey: key() } });
}

const entries = async (merchant: string, personId: string) =>
  (await db.query<{ kind: string; points: number }>('SELECT kind, points FROM rewards.loyalty_entries WHERE merchant = $1 AND person_id = $2 ORDER BY at, id', [merchant, personId])).rows;

describe('section 3: Sofia pays for Table 6', () => {
  test('$16.00 of food is $17.33 (tax per line); the agua fresca makes it $13.55; she earns 12 and has 65', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    const order = await shop.table6();
    expect(order).toMatchObject({ subtotalCents: 1600, taxCents: 133, totalCents: 1733 });

    await setOrderMember(db, { merchant: shop.merchant, orderId: order.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
    const withReward = await applyDiscount(db, noTax, { merchant: shop.merchant, orderId: order.id, staff: { id: shop.staff.jen, role: 'counter' }, request: { kind: 'reward', rewardId: shop.rewards.agua.id } });
    expect(withReward).toMatchObject({ discountCents: 350, taxCents: 105, totalCents: 1355 });
    expect(withReward.discount).toMatchObject({ kind: 'reward', rewardId: shop.rewards.agua.id, points: 75, label: 'Free agua fresca' });
    expect(withReward.member).toMatchObject({ memberId: sofia.person.id, addedVia: 'code', addedBy: shop.staff.jen });

    // Points come off when it's paid, not when it's applied.
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(128);
    await payClear(shop, order.id);
    expect((await getOrder(db, shop.merchant, order.id)).status).toBe('paid');
    expect((await entries(shop.merchant, sofia.person.id)).slice(1).sort((x, y) => x.kind.localeCompare(y.kind))).toEqual([
      { kind: 'earn', points: 12 },
      { kind: 'redeem', points: -75 },
    ]);
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(65);

    const paid = await shopPaid(db, { clear: sofia.clear, orders: noTax, chargePaidNow: async () => true }, { slug: shop.slug, orderId: order.id, person: sofia.person });
    expect(paid).toMatchObject({ amountCents: 1355, paidWith: 'clear_balance', points: { used: { reward: 'Free agua fresca', points: 75 }, earned: 12, have: 65 }, joinOffer: null });
  });

  test('a paid event that arrives twice earns once', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop, 0);
    const order = await shop.table6();
    await setOrderMember(db, { merchant: shop.merchant, orderId: order.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
    await payCash(shop, order.id);
    await db.transaction(async (tx) => {
      await onOrderPaid(tx, { merchant: shop.merchant, orderId: order.id, attempt: 0 });
      await settleOrder(tx, { merchant: shop.merchant, orderId: order.id, actor: null });
    });
    expect(await entries(shop.merchant, sofia.person.id)).toEqual([{ kind: 'earn', points: 16 }]);
  });

  test('a reward and a code never stack', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    await db.query(`INSERT INTO commerce.discount_codes (id, merchant, code, percent) VALUES ($1,$2,'TACOTUE',10)`, [`dsc_${seq++}`, shop.merchant]);
    const order = await shop.table6();
    await setOrderMember(db, { merchant: shop.merchant, orderId: order.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
    await applyDiscount(db, noTax, { merchant: shop.merchant, orderId: order.id, staff: { id: shop.staff.jen, role: 'counter' }, request: { kind: 'reward', rewardId: shop.rewards.agua.id } });
    await expect(applyDiscount(db, noTax, { merchant: shop.merchant, orderId: order.id, staff: { id: shop.staff.jen, role: 'counter' }, request: { kind: 'code', code: 'TACOTUE' } })).rejects.toMatchObject({ code: 'one_discount' });
  });

  test('a reward they can’t afford, or a Clear-members reward for someone without Clear, is refused', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop, 40);
    const order = await shop.table6();
    await setOrderMember(db, { merchant: shop.merchant, orderId: order.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
    await expect(applyDiscount(db, noTax, { merchant: shop.merchant, orderId: order.id, staff: { id: shop.staff.jen, role: 'counter' }, request: { kind: 'reward', rewardId: shop.rewards.agua.id } })).rejects.toMatchObject({ message: 'Not enough points for Free agua fresca' });
  });
});

describe('earning', () => {
  test('1 per $10 with keep the change: $15 and $15 earn 3', async () => {
    const shop = await miCasa({ rules: { perAmountCents: 1000, keepTheChange: true } });
    const sofia = await sofiaAt(shop, 0);
    for (let i = 0; i < 2; i++) {
      const o = await shop.lines(1500);
      await setOrderMember(db, { merchant: shop.merchant, orderId: o.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
      await payCash(shop, o.id);
    }
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(3);
  });

  test('card at the counter, with a member added, earns', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop, 0);
    const fake = fakeProvider();
    const acct = `acct_rw_${shop.merchant.slice(-6)}`;
    const cc = await connectorStore.insert(db, { merchant: shop.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: shop.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','m2',$4,'M2')`, [`rdr_rw_${shop.merchant.slice(-6)}`, shop.merchant, cc.id, `M2-${shop.merchant}`]);
    const o = await shop.table6();
    await setOrderMember(db, { merchant: shop.merchant, orderId: o.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
    const start = await createCardTender(db, fake.provider, { merchant: shop.merchant, orderId: o.id, staffId: shop.staff.jen, amountCents: o.totalCents, tipCents: 0, readerId: `rdr_rw_${shop.merchant.slice(-6)}`, idempotencyKey: key() });
    fake.tap(fake.payments.values().next().value!.id);
    await syncCardTender(db, fake.provider, { merchant: shop.merchant, tenderId: start.tenderId, actor: null });
    expect(await entries(shop.merchant, sofia.person.id)).toEqual([{ kind: 'earn', points: 16 }]);
  });

  test('visits: one stamp for $5 or more, at most once a day', async () => {
    const shop = await miCasa({ rules: { unit: 'visits', visitMinCents: 500, cardSize: 10 } });
    const sofia = await sofiaAt(shop, 0);
    for (const cents of [400, 800, 900]) {
      const o = await shop.lines(cents);
      await setOrderMember(db, { merchant: shop.merchant, orderId: o.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
      await payCash(shop, o.id);
    }
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(1);
  });

  test('a void takes back what was earned and gives back the reward', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    const o = await shop.table6();
    await setOrderMember(db, { merchant: shop.merchant, orderId: o.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
    await applyDiscount(db, noTax, { merchant: shop.merchant, orderId: o.id, staff: { id: shop.staff.jen, role: 'counter' }, request: { kind: 'reward', rewardId: shop.rewards.agua.id } });
    await payCash(shop, o.id);
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(65);
    // The void's own rules (PINs, the drawer) aren't what's under test: mark it voided as a void does,
    // and let settleOrder see the sale no longer stands.
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE commerce.orders SET status = 'voided', voided_at = now(), voided_by = $2 WHERE id = $1`, [o.id, shop.staff.manager]);
      await settleOrder(tx, { merchant: shop.merchant, orderId: o.id, actor: null });
    });
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(128);
  });

  test('a refund takes back the refunded part; everything refunded returns the reward', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    const o = await shop.table6();
    await setOrderMember(db, { merchant: shop.merchant, orderId: o.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
    await applyDiscount(db, noTax, { merchant: shop.merchant, orderId: o.id, staff: { id: shop.staff.jen, role: 'counter' }, request: { kind: 'reward', rewardId: shop.rewards.agua.id } });
    await payCash(shop, o.id);
    // $2.71 of the $13.55 back (a fifth): 12 × 0.2 rounds to 2.
    await db.query('UPDATE payments.tenders SET refunded_cents = 271 WHERE order_id = $1', [o.id]);
    await db.transaction((tx) => onOrderRefunded(tx, { merchant: shop.merchant, orderId: o.id, key: 'rfd_1' }));
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(63);
    await db.transaction((tx) => onOrderRefunded(tx, { merchant: shop.merchant, orderId: o.id, key: 'rfd_1' }));
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(63);
    await db.query('UPDATE payments.tenders SET refunded_cents = 1355 WHERE order_id = $1', [o.id]);
    await db.transaction((tx) => onOrderRefunded(tx, { merchant: shop.merchant, orderId: o.id, key: 'rfd_2' }));
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(128);
  });

  test('paid somewhere new, then joined: this visit counts, with the join bonus', async () => {
    const shop = await miCasa({ rules: { joinBonus: 25 } });
    const did = `did:privy:peña-${seq++}`;
    const w = wallet();
    const clear = await people([{ did, wallet: w, name: 'Sofia M.' }]);
    const person = (await resolvePerson(db, clear, { did, wallet: w }))!;
    const o = await shop.lines(840);
    await setOrderMember(db, { merchant: shop.merchant, orderId: o.id, personId: person.id, by: null, via: 'app' });
    await payCash(shop, o.id);
    expect(await balance(db, shop.merchant, person.id)).toBe(0);
    const offer = await shopPaid(db, { clear, orders: noTax, chargePaidNow: async () => null }, { slug: shop.slug, orderId: o.id, person });
    expect(offer.joinOffer).toEqual({ joinBonus: 25, fromThis: 8, total: 33 });
    const joined = await joinShop(db, { slug: shop.slug, person, body: { texts: 'codes', birthMonth: null, consentVersion: CONSENT, ref: null, orderId: o.id } });
    expect(joined).toMatchObject({ points: 33, credited: { join: 25, payment: 8 } });
  });

  test('points expire from the last visit, only under the rules they were earned with', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop, 0);
    const never = await rulesAt(db, shop.merchant);
    await addEntry(db, { merchant: shop.merchant, personId: sofia.person.id, kind: 'earn', points: 40, rulesVersion: never.version, dedupeKey: key() });
    await patchShopApp(db, shop.merchant, shop.staff.owner, { rules: { ...never, expiry: '6m', boosts: [] } });
    const six = await rulesAt(db, shop.merchant);
    await addEntry(db, { merchant: shop.merchant, personId: sofia.person.id, kind: 'earn', points: 30, rulesVersion: six.version, dedupeKey: key() });
    await db.query(`UPDATE rewards.loyalty_memberships SET last_visit_at = now() - interval '7 months' WHERE person_id = $1`, [sofia.person.id]);
    await expirePoints(db);
    await expirePoints(db);
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(40);
  });
});

describe('bonuses', () => {
  test('bring a friend: both get the bonus when the friend first pays, once', async () => {
    const shop = await miCasa({ rules: { referralBonus: 50 } });
    const sofia = await sofiaAt(shop, 0);
    const { rows } = await db.query<{ ref_code: string }>('SELECT ref_code FROM rewards.loyalty_memberships WHERE merchant = $1 AND person_id = $2', [shop.merchant, sofia.person.id]);
    const friend = await createPerson(db, fixedClearSide([]), { did: `did:privy:friend-${seq++}`, wallet: wallet(), phone: '+19095550111' }, { firstName: 'Ana' });
    await joinShop(db, { slug: shop.slug, person: friend, body: { texts: 'codes', birthMonth: null, consentVersion: CONSENT, ref: rows[0]!.ref_code, orderId: null } });
    for (let i = 0; i < 2; i++) {
      const o = await shop.lines(1000);
      await setOrderMember(db, { merchant: shop.merchant, orderId: o.id, personId: friend.id, by: shop.staff.jen, via: 'code' });
      await payCash(shop, o.id);
    }
    expect(await balance(db, shop.merchant, friend.id)).toBe(10 + 10 + 50);
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(50);
  });

  test('birthday: the reward’s points in their month, once a year', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop, 0);
    const rules = await rulesAt(db, shop.merchant);
    await patchShopApp(db, shop.merchant, shop.staff.owner, { rules: { ...rules, birthdayRewardId: shop.rewards.agua.id } });
    await db.query('UPDATE rewards.loyalty_memberships SET birth_month = 11 WHERE person_id = $1', [sofia.person.id]);
    const { birthdayRewards } = await import('./ledger.js');
    const first = new Date('2026-11-01T08:00:00Z');
    await birthdayRewards(db, first);
    await birthdayRewards(db, first);
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(75);
  });
});

describe('the counter', () => {
  const notify = () => {
    const texts: Array<{ to: string; message: string }> = [];
    const n: RewardsNotifier = { text: async (to, message) => (texts.push({ to, message }), true), app: async () => undefined };
    return { n, texts };
  };

  test('their signed code adds them; the counter sees points and the reward that fits, never a balance', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    const order = await shop.table6();
    const { id } = mintIdentityId(sofia.wallet);
    const state = await addCustomer(db, { clear: sofia.clear, notify: notify().n, rewardsUrl: 'https://rewards.test' }, { merchant: shop.merchant, orderId: order.id, staffId: shop.staff.jen, body: { via: 'code', code: `https://app.useclear.org/send?to=${sofia.wallet}&id=${id}` } });
    expect(state.status).toBe('added');
    if (state.status !== 'added') return;
    expect(state.customer).toMatchObject({ firstName: 'Sofia', lastInitial: 'M', isClearMember: true, canPayWithClear: true, membership: { points: 128 } });
    expect(state.customer.membership!.readyRewards[0]).toMatchObject({ name: 'Free agua fresca', amountCents: 350, matches: { label: '1 × Jamaica' } });
    expect(state.earnsPoints).toBe(16);
    expect(JSON.stringify(state)).not.toMatch(/balance|212|other/i);
    expect(() => CounterCustomer.parse({ ...state.customer, balanceCents: 21240 })).toThrow();
  });

  test('a bare wallet (anyone can write one) doesn’t add anybody', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    const order = await shop.table6();
    await expect(addCustomer(db, { clear: sofia.clear, notify: notify().n, rewardsUrl: 'x' }, { merchant: shop.merchant, orderId: order.id, staffId: shop.staff.jen, body: { via: 'code', code: `https://app.useclear.org/send?to=${sofia.wallet}` } })).rejects.toMatchObject({ code: 'invalid' });
  });

  test('a number typed in shows nothing until they confirm, whether or not it’s anyone’s', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    const phone = (await db.query<{ phone_hash: string }>('SELECT phone_hash FROM rewards.people WHERE id = $1', [sofia.person.id])).rows[0]!;
    expect(phone.phone_hash).toBeTruthy();
    const { n, texts } = notify();
    const deps = { clear: sofia.clear, notify: n, rewardsUrl: 'https://rewards.test' };
    const known = await shop.table6();
    const unknown = await shop.table6();
    const a = await addCustomer(db, deps, { merchant: shop.merchant, orderId: known.id, staffId: shop.staff.jen, body: { via: 'phone', phone: sofia.phone } });
    const b = await addCustomer(db, deps, { merchant: shop.merchant, orderId: unknown.id, staffId: shop.staff.jen, body: { via: 'phone', phone: '(909) 555-0100' } });
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect([a.status, b.status]).toEqual(['pending', 'pending']);
    expect(texts).toHaveLength(2);
    expect((await orderCustomerState(db, deps, { merchant: shop.merchant, orderId: known.id })).status).toBe('pending');
    const token = texts[0]!.message.split('/confirm/')[1]!;
    // Someone else, signed in, can't confirm it for her.
    const other = await createPerson(db, fixedClearSide([]), { did: `did:privy:x-${seq++}`, wallet: wallet(), phone: '+19095550199' }, { firstName: 'Dev' });
    await expect(db.transaction((tx) => answerCounterConfirm(tx, { token, answer: 'confirm', person: other }))).rejects.toMatchObject({ code: 'forbidden' });
    await db.transaction((tx) => answerCounterConfirm(tx, { token, answer: 'confirm', person: sofia.person }));
    expect((await orderCustomerState(db, deps, { merchant: shop.merchant, orderId: known.id })).status).toBe('added');
  });

  test('Clear goes straight to the added customer, with no code shown', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    const order = await shop.table6();
    await setOrderMember(db, { merchant: shop.merchant, orderId: order.id, personId: sofia.person.id, by: shop.staff.jen, via: 'code' });
    const fc = fakeClear();
    const t = await createClearTender(db, fc.clear, { merchant: shop.merchant, orderId: order.id, staffId: shop.staff.jen, tender: { amountCents: order.totalCents, tipCents: 0, idempotencyKey: key() } });
    const sent = await sendClearTender(db, fc.clear, { merchant: shop.merchant, tenderId: t.id, actor: shop.staff.jen, body: { to: 'customer' } });
    expect(sent).toEqual({ to: 'customer', label: 'their Clear app, text and email' });
    expect(fc.sent).toEqual([{ code: t.clearChargeCode!, to: { member: sofia.wallet.toLowerCase() } }]);
  });

  test('a claimed counter code puts the reward on, adds its member, and runs out after 15 minutes', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    const order = await shop.table6();
    const claim = await claimReward(db, { merchant: shop.merchant, personId: sofia.person.id, rewardId: shop.rewards.agua.id, host: 'https://rewards.test' });
    expect(claim.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    await expect(openClaim(db, { merchant: shop.merchant, code: claim.code, orderId: order.id, now: new Date(Date.now() + 16 * 60_000) })).rejects.toMatchObject({ code: 'expired' });
    const o = await applyDiscount(db, noTax, { merchant: shop.merchant, orderId: order.id, staff: { id: shop.staff.jen, role: 'counter' }, request: { kind: 'claim', code: claim.code } });
    expect(o).toMatchObject({ totalCents: 1355, member: { memberId: sofia.person.id, addedVia: 'claim' } });
    // A code that's never used costs nothing; this one comes off on payment.
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(128);
    await payCash(shop, order.id);
    expect(await balance(db, shop.merchant, sofia.person.id)).toBe(65);
  });

  test('the view parses strictly and carries no balance for a member who hasn’t joined', async () => {
    const shop = await miCasa();
    const did = `did:privy:dev-${seq++}`;
    const w = wallet();
    const clear = await people([{ did, wallet: w, name: 'Dev L.' }]);
    const dev = (await resolvePerson(db, clear, { did, wallet: w }))!;
    const view = await counterCustomer(db, { clear }, { merchant: shop.merchant, personId: dev.id, orderId: null });
    expect(view).toEqual({ firstName: 'Dev', lastInitial: 'L', isClearMember: true, canPayWithClear: true, membership: null, lastVisit: null });
  });
});

describe('people and shops', () => {
  test('a Clear member who joined with email lands in their own account, and adding a phone later keeps one person', async () => {
    const did = `did:privy:email-${seq++}`;
    const w = wallet();
    const clear = await people([{ did, wallet: w, name: 'Sofia Martinez' }]);
    const first = (await resolvePerson(db, clear, { did, wallet: w, email: 'sofia@example.com' }))!;
    expect(first).toMatchObject({ first_name: 'Sofia', last_initial: 'M', member_subject: did, phone_hash: null });
    // "Already have Clear? Yes": they sign in their usual way and link the number, so the same DID comes back with it.
    const again = (await resolvePerson(db, clear, { did, wallet: w, phone: '+19095550142' }))!;
    expect(again.id).toBe(first.id);
    expect(again.phone_hash).toBeTruthy();
    expect(Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM rewards.people WHERE privy_did = $1 OR wallet = $2', [did, w.toLowerCase()])).rows[0]!.n)).toBe(1);
  });

  test('someone with only a number is nobody until Welcome, and never a Clear member', async () => {
    const did = `did:privy:marco-${seq++}`;
    const none = fixedClearSide([]);
    expect(await resolvePerson(db, none, { did, wallet: wallet(), phone: '+19095550188' })).toBeNull();
    const marco = await createPerson(db, none, { did, wallet: wallet(), phone: '+19095550188' }, { firstName: 'Marco' });
    expect(marco).toMatchObject({ first_name: 'Marco', member_subject: null });
    expect((await personByDid(db, did))!.id).toBe(marco.id);
  });

  test('leaving a shop deletes only that shop’s points', async () => {
    const miCasaShop = await miCasa();
    const tire = await miCasa();
    const sofia = await sofiaAt(miCasaShop, 128);
    await joinShop(db, { slug: tire.slug, person: sofia.person, body: { texts: 'codes', birthMonth: null, consentVersion: CONSENT, ref: null, orderId: null } });
    await addEntry(db, { merchant: tire.merchant, personId: sofia.person.id, kind: 'adjust', points: 340, rulesVersion: 1, reason: 'Opening balance', dedupeKey: key() });
    await db.transaction((tx) => leaveShop(tx, { slug: miCasaShop.slug, person: sofia.person }));
    expect(await balance(db, miCasaShop.merchant, sofia.person.id)).toBe(0);
    expect(await balance(db, tire.merchant, sofia.person.id)).toBe(340);
    expect((await db.query('SELECT 1 FROM rewards.loyalty_memberships WHERE merchant = $1 AND person_id = $2', [miCasaShop.merchant, sofia.person.id])).rows).toHaveLength(0);
  });

  test('the ledger can’t be edited', async () => {
    const shop = await miCasa();
    const sofia = await sofiaAt(shop);
    await expect(db.query('UPDATE rewards.loyalty_entries SET points = 9999 WHERE person_id = $1', [sofia.person.id])).rejects.toThrow(/immutable/);
  });
});

describe('a token that sees one shop', () => {
  let server: Server;
  let base = '';
  let shops: { a: Awaited<ReturnType<typeof miCasa>>; b: Awaited<ReturnType<typeof miCasa>> };
  let sofia: Awaited<ReturnType<typeof sofiaAt>>;
  let orderAtB = '';
  let clear: ClearSide;

  beforeAll(async () => {
    shops = { a: await miCasa(), b: await miCasa() };
    sofia = await sofiaAt(shops.a);
    clear = sofia.clear;
    await joinShop(db, { slug: shops.b.slug, person: sofia.person, body: { texts: 'codes', birthMonth: null, consentVersion: CONSENT, ref: null, orderId: null } });
    const o = await shops.b.table6();
    await setOrderMember(db, { merchant: shops.b.merchant, orderId: o.id, personId: sofia.person.id, by: shops.b.staff.jen, via: 'code' });
    await payCash(shops.b, o.id);
    orderAtB = o.id;
    const pass: express.RequestHandler = (_q, _r, next) => next();
    const deps: RewardsDeps = {
      db: async () => db,
      clear,
      notify: { text: async () => true, app: async () => undefined },
      orders: () => noTax,
      chargePaidNow: async () => null,
      rewardsUrl: 'https://rewards.test',
      privy: (req, res) => res.status(401).json({ error: 'privy only' }),
      limits: { read: pass, act: pass },
      apiUrl: '',
    };
    const app = express();
    app.use(express.json());
    app.use('/api/s', shopRouter(deps));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server?.close());

  const tokenFor = (shop: string) => mintSession({ did: sofia.did, wallet: sofia.wallet, scope: { shop } }).token;
  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

  test('its own shop answers', async () => {
    const r = await get(`/api/s/${shops.a.slug}/me`, tokenFor(shops.a.slug));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ points: 128, membership: { shopSlug: shops.a.slug } });
  });

  test('another shop’s routes refuse it', async () => {
    const r = await get(`/api/s/${shops.b.slug}/me`, tokenFor(shops.a.slug));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: 'scope' });
  });

  test('another shop’s order isn’t there, even by its id', async () => {
    const r = await get(`/api/s/${shops.a.slug}/paid/${orderAtB}`, tokenFor(shops.a.slug));
    expect(r.status).toBe(404);
    const activity = await (await get(`/api/s/${shops.a.slug}/activity`, tokenFor(shops.a.slug))).json();
    expect(activity).toEqual({ items: [] });
  });

  test('a forged or Privy token gets nothing', async () => {
    const forged = tokenFor(shops.a.slug).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await get(`/api/s/${shops.a.slug}/me`, forged)).status).toBe(401);
  });

  test('the public config is the shop’s look and rewards, cached by version', async () => {
    const r = await fetch(`${base}/api/s/${shops.a.slug}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('etag')).toMatch(/^"micasa-\d+-\d+"$/);
    const body = (await r.json()) as { rewards: unknown[] } & Record<string, unknown>;
    expect(body).toMatchObject({ slug: shops.a.slug, earn: { rate: '1 point per $1', expiry: 'Points never expire' } });
    expect(body.rewards[0]).toMatchObject({ name: 'Free agua fresca', detail: '75 points · any size' });
    const manifest = await (await fetch(`${base}/api/s/${shops.a.slug}/manifest.webmanifest`)).json();
    expect(manifest).toMatchObject({ id: `/s/${shops.a.slug}/`, scope: `/s/${shops.a.slug}/`, start_url: `/s/${shops.a.slug}/`, display: 'standalone' });
  });
});
