import { randomBytes } from 'node:crypto';
import {
  earnPoints,
  pointsWord,
  JoinShop,
  UpdateMembership,
  type Joined,
  type Membership,
  type MyShops,
  type Partners,
  type RewardsMe,
  type ShopActivity,
  type ShopBill,
  type ShopPaid,
} from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { type OrderDeps, priceWithReward } from '../orders/orderService.js';
import { pointByCode, pointStateFor } from '../terminal/pointState.js';
import type { ClearSide } from './clearSide.js';
import { cartLines, matchReward, spendable } from './counter.js';
import { RewardsError } from './errors.js';
import { creditOrderOnJoin, joinBonus, membershipOf, previewEarn, shopClock } from './ledger.js';
import type { PersonRow } from './people.js';
import { earnSummary, offersFor, rewardsFor, rewardView, rulesAt, shopBySlug, toShopApp, type ShopAppRow } from './shopApp.js';

/**
 * The customer's app, for one shop (a shop's token) or the hub. Everything here is one shop's: its
 * points, its rewards, its offers, the person's purchases there and nowhere else.
 */

export interface CustomerDeps {
  clear: ClearSide;
  orders: OrderDeps;
  /** How a Clear charge was paid: from the balance now, or over time. */
  chargePaidNow(code: string): Promise<boolean | null>;
}

type Shop = ShopAppRow & { name: string; timezone: string };

export async function shopOrThrow(q: Queryable, slug: string): Promise<Shop> {
  const shop = await shopBySlug(q, slug);
  if (!shop) throw new RewardsError('No shop has that address', 'not_found');
  return shop;
}

function toMembership(slug: string, r: { person_id: string; joined_at: Date | string; consent_at: Date | string; consent_version: string; texts: Membership['texts']; birth_month: number | null; referred_by: string | null }): Membership {
  return {
    shopSlug: slug,
    memberId: r.person_id,
    joinedAt: new Date(r.joined_at).toISOString(),
    consentAt: new Date(r.consent_at).toISOString(),
    consentVersion: r.consent_version,
    texts: r.texts,
    birthMonth: r.birth_month,
    referredBy: r.referred_by,
  };
}

async function membershipRow(q: Queryable, merchant: string, personId: string) {
  const { rows } = await q.query<{ person_id: string; joined_at: Date | string; consent_at: Date | string; consent_version: string; texts: Membership['texts']; birth_month: number | null; referred_by: string | null; ref_code: string }>(
    'SELECT * FROM rewards.loyalty_memberships WHERE merchant = $1 AND person_id = $2',
    [merchant, personId],
  );
  return rows[0] ?? null;
}

/** `GET /api/s/:slug/me`. */
export async function rewardsMe(q: Queryable, deps: CustomerDeps, input: { slug: string; person: PersonRow; phone?: string | null; now?: Date }): Promise<RewardsMe> {
  const now = input.now ?? new Date();
  const shop = await shopOrThrow(q, input.slug);
  const app = toShopApp(shop);
  const rules = await rulesAt(q, shop.merchant, now);
  const m = await membershipRow(q, shop.merchant, input.person.id);
  const points = m ? await spendable(q, shop.merchant, input.person.id) : 0;
  const rewards = await rewardsFor(q, shop.merchant);
  const member = await deps.clear.member({ did: input.person.privy_did, wallet: input.person.wallet, phone: input.phone });
  const ready = rewards.filter((r) => m && r.cost <= points);
  const next = rewards.filter((r) => !ready.includes(r)).map((r) => ({ ...rewardView(r, app.pointsName), toGo: Math.max(1, r.cost - points) }));
  return {
    person: { id: input.person.id, firstName: input.person.first_name, lastInitial: input.person.last_initial, phone: null, isClearMember: Boolean(member) },
    membership: m ? toMembership(app.slug, m) : null,
    points,
    // Ready first (the dearest first), then by what's left to go.
    ready: ready.sort((a, b) => b.cost - a.cost).map((r) => rewardView(r, app.pointsName)),
    next: next.sort((a, b) => a.toGo - b.toGo),
    offers: await offersFor(q, shop, shop.timezone, { member: Boolean(m), clearMember: Boolean(member) }, now),
    earn: earnSummary(rules, app.pointsName),
    clear: {
      status: member?.canPayWithClear ? 'active' : 'not_set_up',
      canPayWithClear: Boolean(member?.canPayWithClear),
      canPayOverTime: Boolean(member?.canPayWithClear),
    },
  };
}

/** `GET /api/rewards/me/shops`: every shop they've joined, with points and what's ready. */
export async function myShops(q: Queryable, input: { person: PersonRow }): Promise<MyShops> {
  const { rows } = await q.query<ShopAppRow & { name: string; texts: 'codes' | 'codes_and_offers' }>(
    `SELECT a.*, p.name, m.texts FROM rewards.loyalty_memberships m JOIN rewards.shop_apps a ON a.merchant = m.merchant JOIN merchant.profiles p ON p.merchant = m.merchant
      WHERE m.person_id = $1 AND a.enabled ORDER BY m.joined_at`,
    [input.person.id],
  );
  const shops: MyShops['shops'] = [];
  for (const r of rows) {
    const app = toShopApp(r);
    const rules = await rulesAt(q, r.merchant);
    const points = await spendable(q, r.merchant, input.person.id);
    const rewards = await rewardsFor(q, r.merchant);
    const next = rewards.filter((x) => x.cost > points).sort((a, b) => a.cost - b.cost)[0];
    shops.push({
      slug: app.slug,
      name: r.name,
      brand: { logoUrl: app.brand.logoUrl, monogram: app.brand.monogram, colour: app.brand.colour, onColour: app.brand.onColour, headingFont: app.brand.headingFont },
      pointsName: app.pointsName,
      unit: rules.unit,
      points,
      cardSize: rules.unit === 'visits' ? rules.cardSize : null,
      readyCount: rewards.filter((x) => x.cost <= points).length,
      next: next ? { name: next.name, toGo: next.cost - points } : null,
      texts: r.texts,
    });
  }
  return { shops };
}

const R = 6_371_000;
function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** `GET /api/partners?near=lat,lng`: Clear shops with an app, nearest first. The location isn't kept. */
export async function partners(q: Queryable, input: { near: { lat: number; lng: number } | null; personId: string | null }): Promise<Partners> {
  const { rows } = await q.query<ShopAppRow & { name: string; joined: boolean }>(
    `SELECT a.*, p.name, EXISTS (SELECT 1 FROM rewards.loyalty_memberships m WHERE m.merchant = a.merchant AND m.person_id = $1) AS joined
       FROM rewards.shop_apps a JOIN merchant.profiles p ON p.merchant = a.merchant WHERE a.enabled`,
    [input.personId],
  );
  const out: Partners['partners'] = [];
  for (const r of rows) {
    const app = toShopApp(r);
    const rules = await rulesAt(q, r.merchant);
    const summary = earnSummary(rules, app.pointsName);
    out.push({
      slug: app.slug,
      name: r.name,
      brand: { logoUrl: app.brand.logoUrl, monogram: app.brand.monogram, colour: app.brand.colour, onColour: app.brand.onColour, headingFont: app.brand.headingFont },
      distanceMeters: input.near && r.lat !== null && r.lng !== null ? distance(input.near, { lat: r.lat, lng: r.lng }) : null,
      earns: rules.unit === 'visits' ? pointsWord(app.pointsName, 2) : summary.rate,
      joined: Boolean(r.joined),
    });
  }
  return { partners: out.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.name.localeCompare(b.name)) };
}

// ---- Joining and leaving ------------------------------------------------------------------------

const refCode = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8).toUpperCase();

/**
 * Join: consent to share name, number and what they buy here, recorded with the line they saw. The
 * join bonus, and the order they just paid when there is one.
 */
export async function joinShop(q: Queryable, input: { slug: string; person: PersonRow; body: unknown; now?: Date }): Promise<Joined> {
  const now = input.now ?? new Date();
  const parsed = JoinShop.safeParse(input.body);
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'That join isn’t valid', 'invalid');
  const b = parsed.data;
  const shop = await shopOrThrow(q, input.slug);
  let referredBy: string | null = null;
  if (b.ref) {
    const { rows } = await q.query<{ person_id: string }>('SELECT person_id FROM rewards.loyalty_memberships WHERE merchant = $1 AND ref_code = $2', [shop.merchant, b.ref.toUpperCase()]);
    if (rows[0] && rows[0].person_id !== input.person.id) referredBy = rows[0].person_id;
  }
  const existing = await membershipRow(q, shop.merchant, input.person.id);
  if (!existing) {
    await q.query(
      `INSERT INTO rewards.loyalty_memberships (merchant, person_id, joined_at, consent_at, consent_version, texts, birth_month, referred_by, ref_code)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [shop.merchant, input.person.id, now.toISOString(), b.consentVersion, b.texts, b.birthMonth, referredBy, refCode()],
    );
  }
  const rules = await rulesAt(q, shop.merchant, now);
  const join = existing ? 0 : await joinBonus(q, { merchant: shop.merchant, personId: input.person.id, rules, now });
  const payment = b.orderId ? await creditOrderOnJoin(q, { merchant: shop.merchant, personId: input.person.id, orderId: b.orderId, now }) : 0;
  const row = (await membershipRow(q, shop.merchant, input.person.id))!;
  return { membership: toMembership(toShopApp(shop).slug, row), points: await spendable(q, shop.merchant, input.person.id), credited: { join, payment } };
}

export async function updateMembership(q: Queryable, input: { slug: string; person: PersonRow; body: unknown }): Promise<Membership> {
  const parsed = UpdateMembership.safeParse(input.body);
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'That isn’t valid', 'invalid');
  const shop = await shopOrThrow(q, input.slug);
  const m = await membershipRow(q, shop.merchant, input.person.id);
  if (!m) throw new RewardsError('Join first', 'not_joined');
  await q.query('UPDATE rewards.loyalty_memberships SET texts = COALESCE($3, texts), birth_month = CASE WHEN $4 THEN $5 ELSE birth_month END WHERE merchant = $1 AND person_id = $2', [
    shop.merchant,
    input.person.id,
    parsed.data.texts ?? null,
    parsed.data.birthMonth !== undefined,
    parsed.data.birthMonth ?? null,
  ]);
  return toMembership(toShopApp(shop).slug, (await membershipRow(q, shop.merchant, input.person.id))!);
}

/**
 * Leave: this shop's points and the consent go, and the shop no longer sees them on its orders.
 * Nothing at any other shop changes, and their Clear account isn't touched.
 */
export async function leaveShop(q: Queryable, input: { slug: string; person: PersonRow }): Promise<void> {
  const shop = await shopBySlug(q, input.slug, { includeOff: true });
  if (!shop) throw new RewardsError('No shop has that address', 'not_found');
  await q.query('DELETE FROM rewards.loyalty_entries WHERE merchant = $1 AND person_id = $2', [shop.merchant, input.person.id]);
  await q.query('DELETE FROM rewards.reward_claims WHERE merchant = $1 AND person_id = $2 AND order_id IS NULL', [shop.merchant, input.person.id]);
  await q.query(`UPDATE commerce.orders SET member_person = NULL WHERE merchant = $1 AND member_person = $2 AND status NOT IN ('open','paying')`, [shop.merchant, input.person.id]);
  await q.query('DELETE FROM rewards.loyalty_memberships WHERE merchant = $1 AND person_id = $2', [shop.merchant, input.person.id]);
}

// ---- Purchases here -----------------------------------------------------------------------------

const PAID = ['paid', 'partly_refunded', 'refunded'];

/** `GET /api/s/:slug/activity`: purchases at this shop only. */
export async function shopActivity(q: Queryable, input: { slug: string; person: PersonRow }): Promise<ShopActivity> {
  const shop = await shopOrThrow(q, input.slug);
  const { rows } = await q.query<{ id: string; created_at: Date | string; total_cents: string | number; number: number | null }>(
    `SELECT o.id, o.created_at, o.total_cents, t.number FROM commerce.orders o LEFT JOIN merchant.tables t ON t.id = o.table_id
      WHERE o.merchant = $1 AND o.member_person = $2 AND o.status = ANY($3::text[]) ORDER BY o.created_at DESC LIMIT 100`,
    [shop.merchant, input.person.id, PAID],
  );
  const items: ShopActivity['items'] = [];
  for (const o of rows) {
    const { rows: tenders } = await q.query<{ method: 'clear' | 'card' | 'cash' }>(`SELECT DISTINCT method FROM payments.tenders WHERE order_id = $1 AND status NOT IN ('pending','declined','cancelled')`, [o.id]);
    const { rows: pts } = await q.query<{ kind: string; points: number }>('SELECT kind, points FROM rewards.loyalty_entries WHERE order_id = $1 AND person_id = $2', [o.id, input.person.id]);
    items.push({
      orderId: o.id,
      at: new Date(o.created_at).toISOString(),
      table: o.number ? `Table ${o.number}` : null,
      totalCents: Number(o.total_cents),
      paidWith: tenders.length > 1 ? 'split' : (tenders[0]?.method ?? 'card'),
      points: { earned: pts.filter((p) => p.kind === 'earn').reduce((s, p) => s + p.points, 0), used: -pts.filter((p) => p.kind === 'redeem').reduce((s, p) => s + p.points, 0) },
    });
  }
  return { items };
}

/** A Point's bill at this shop, as this person sees it, with the reward they have ready that fits. */
export async function shopBill(q: Queryable, deps: CustomerDeps, input: { slug: string; pointCode: string; person: PersonRow; now?: Date }): Promise<ShopBill> {
  const now = input.now ?? new Date();
  const shop = await shopOrThrow(q, input.slug);
  const p = await pointByCode(q, input.pointCode);
  // A Point at another shop isn't this shop's bill, whatever its code.
  if (!p || p.merchant !== shop.merchant) throw new RewardsError('No bill here', 'not_found');
  const { state } = await pointStateFor(q, p.deviceId, now);
  if (state.kind !== 'bill') throw new RewardsError('There’s no bill here right now', 'conflict');
  const orderId = state.orderId;
  const { rows: o } = await q.query<{ member_person: string | null; number: number | null; table_number: number | null }>(
    `SELECT o.member_person, o.number, t.number AS table_number FROM commerce.orders o LEFT JOIN merchant.tables t ON t.id = o.table_id WHERE o.id = $1`,
    [orderId],
  );
  if (o[0]?.member_person && o[0].member_person !== input.person.id) throw new RewardsError('This bill is someone else’s', 'forbidden');
  const { rows: d } = await q.query<{ kind: string; reward_id: string | null }>('SELECT kind, reward_id FROM commerce.order_discounts WHERE order_id = $1 AND removed_at IS NULL', [orderId]);
  const lines = await cartLines(q, orderId);
  const rules = await rulesAt(q, shop.merchant, now);
  const clock = shopClock(now, shop.timezone);
  const earnOn = (nets: Array<{ netCents: number; category: string | null }>, total: number, clear: boolean) =>
    earnPoints({ rules, lines: nets, at: clock, clearCents: clear ? total : 0, paidCents: total, carryCents: 0, stampedToday: false }).points;

  const joined = await membershipOf(q, shop.merchant, input.person.id);
  const without = await priceWithReward(q, deps.orders, { merchant: shop.merchant, orderId, reward: null });
  let reward: ShopBill['reward'] = null;
  let withReward: ShopBill['withReward'] = null;
  let withLines = without.lines;
  const hasDiscount = Boolean(d[0]) && d[0]!.kind !== 'reward';
  if (joined && !hasDiscount) {
    const points = await spendable(q, shop.merchant, input.person.id, orderId);
    const member = await deps.clear.member({ did: input.person.privy_did, wallet: input.person.wallet });
    // The ready reward worth the most on this bill.
    const best = (await rewardsFor(q, shop.merchant))
      .filter((r) => r.cost <= points && (!r.clearMembersOnly || member))
      .map((r) => ({ r, m: matchReward(r, lines) }))
      .filter((x): x is { r: (typeof x)['r']; m: NonNullable<(typeof x)['m']> } => x.m !== null)
      .sort((a, b) => b.m.amountCents - a.m.amountCents || a.r.cost - b.r.cost)[0];
    if (best) {
      const g = best.r.gives;
      const priced = await priceWithReward(q, deps.orders, {
        merchant: shop.merchant,
        orderId,
        reward: { percent: g.kind === 'percent' ? g.percent : null, amountCents: g.kind === 'percent' ? null : best.m.amountCents, categories: g.kind === 'item' ? null : g.categories },
      });
      reward = { rewardId: best.r.id, name: best.r.name, cost: best.r.cost, amountCents: priced.discountCents, pointsBefore: points };
      withReward = { discountCents: priced.discountCents, taxCents: priced.taxCents, totalCents: priced.totalCents, earnsPoints: earnOn(priced.lines, priced.totalCents, false) };
      withLines = priced.lines;
    }
  }
  return {
    pointCode: input.pointCode.toUpperCase(),
    orderId,
    table: o[0]?.table_number ? `Table ${o[0].table_number}` : null,
    lines: lines.map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, lineCents: l.lineCents })),
    withReward,
    withoutReward: { discountCents: without.discountCents, taxCents: without.taxCents, totalCents: without.totalCents, earnsPoints: joined ? earnOn(without.lines, without.totalCents, false) : 0 },
    reward,
    hasDiscount,
    earnsWithClear: joined ? earnOn(withLines, withReward?.totalCents ?? without.totalCents, true) : 0,
  };
}

/** The Paid screen: money, and points both ways; or, at a shop they haven't joined, what joining would give. */
export async function shopPaid(q: Queryable, deps: CustomerDeps, input: { slug: string; orderId: string; person: PersonRow; now?: Date }): Promise<ShopPaid> {
  const shop = await shopOrThrow(q, input.slug);
  const { rows } = await q.query<{ id: string; status: string; total_cents: string | number; updated_at: Date | string; member_person: string | null; table_number: number | null }>(
    `SELECT o.id, o.status, o.total_cents, o.updated_at, o.member_person, t.number AS table_number FROM commerce.orders o LEFT JOIN merchant.tables t ON t.id = o.table_id
      WHERE o.id = $1 AND o.merchant = $2`,
    [input.orderId, shop.merchant],
  );
  const o = rows[0];
  // Another shop's order, or someone else's, is simply not here.
  if (!o || o.member_person !== input.person.id || !PAID.includes(o.status)) throw new RewardsError('No such purchase', 'not_found');
  const { rows: tenders } = await q.query<{ method: string; clear_charge_code: string | null }>(`SELECT method, clear_charge_code FROM payments.tenders WHERE order_id = $1 AND status IN ('approved','authorised','captured','partly_refunded','refunded')`, [o.id]);
  const clear = tenders.find((t) => t.method === 'clear');
  const paidNow = clear?.clear_charge_code ? await deps.chargePaidNow(clear.clear_charge_code) : null;
  const joined = await membershipOf(q, shop.merchant, input.person.id);
  let points: ShopPaid['points'] = null;
  let joinOffer: ShopPaid['joinOffer'] = null;
  if (joined) {
    const { rows: e } = await q.query<{ kind: string; points: number; reward_id: string | null; name: string | null }>(
      `SELECT e.kind, e.points, e.reward_id, r.name FROM rewards.loyalty_entries e LEFT JOIN rewards.rewards r ON r.id = e.reward_id WHERE e.order_id = $1 AND e.person_id = $2`,
      [o.id, input.person.id],
    );
    const used = e.find((x) => x.kind === 'redeem');
    points = {
      used: used ? { reward: used.name ?? 'Reward', points: -used.points } : null,
      earned: e.filter((x) => x.kind === 'earn').reduce((s, x) => s + x.points, 0),
      have: await spendable(q, shop.merchant, input.person.id),
    };
  } else {
    const rules = await rulesAt(q, shop.merchant, input.now);
    const fromThis = await previewEarn(q, shop.merchant, o.id, input.person.id, { clear: Boolean(clear), now: input.now });
    joinOffer = { joinBonus: rules.joinBonus, fromThis, total: rules.joinBonus + fromThis };
  }
  return {
    orderId: o.id,
    amountCents: Number(o.total_cents),
    paidAt: new Date(o.updated_at).toISOString(),
    table: o.table_number ? `Table ${o.table_number}` : null,
    paidWith: clear ? (paidNow === false ? 'over_time' : 'clear_balance') : 'card',
    points,
    joinOffer,
  };
}
