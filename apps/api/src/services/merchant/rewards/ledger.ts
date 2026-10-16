import { randomUUID } from 'node:crypto';
import { earnPoints, refundPoints, type EarnRules, type LoyaltyEntry } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { rulesAt, rulesByVersion } from './shopApp.js';

/**
 * The points ledger (`rewards.loyalty_entries`). A member's points at a shop are the sum of their
 * entries, never a stored number; every entry keeps the rules version that made it, and a dedupe key
 * so an event seen twice writes once.
 *
 * Earning happens in the same transaction as the order first becoming paid (`settleOrder`), so the
 * Paid screen already has the new total.
 */

type Kind = LoyaltyEntry['kind'];

export interface EntryInput {
  merchant: string;
  personId: string;
  kind: Kind;
  points: number;
  rulesVersion: number;
  dedupeKey: string;
  orderId?: string | null;
  rewardId?: string | null;
  reason?: string | null;
  by?: string | null;
  at?: Date;
}

/** Writes an entry unless its key was written before. Returns whether it wrote. */
export async function addEntry(q: Queryable, e: EntryInput): Promise<boolean> {
  if (e.points === 0) return false;
  const { rows } = await q.query(
    `INSERT INTO rewards.loyalty_entries (id, merchant, person_id, kind, points, order_id, reward_id, rules_version, reason, by_staff, dedupe_key, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [`rle_${randomUUID()}`, e.merchant, e.personId, e.kind, e.points, e.orderId ?? null, e.rewardId ?? null, e.rulesVersion, e.reason ?? null, e.by ?? null, e.dedupeKey, (e.at ?? new Date()).toISOString()],
  );
  return Boolean(rows[0]);
}

export async function balance(q: Queryable, merchant: string, personId: string): Promise<number> {
  const { rows } = await q.query<{ p: string | number }>('SELECT COALESCE(sum(points), 0) AS p FROM rewards.loyalty_entries WHERE merchant = $1 AND person_id = $2', [merchant, personId]);
  return Number(rows[0]!.p);
}

/** Points promised to rewards on orders not yet paid: they can't be spent twice. */
export async function heldPoints(q: Queryable, merchant: string, personId: string, exceptOrderId?: string): Promise<number> {
  const { rows } = await q.query<{ p: string | number }>(
    `SELECT COALESCE(sum(d.reward_points), 0) AS p FROM commerce.order_discounts d JOIN commerce.orders o ON o.id = d.order_id
      WHERE o.merchant = $1 AND o.member_person = $2 AND d.kind = 'reward' AND d.removed_at IS NULL AND o.status IN ('open','paying') AND o.id <> COALESCE($3, '')`,
    [merchant, personId, exceptOrderId ?? null],
  );
  return Number(rows[0]!.p);
}

export async function entriesFor(q: Queryable, merchant: string, personId: string): Promise<LoyaltyEntry[]> {
  const { rows } = await q.query<{ id: string; kind: Kind; points: number; order_id: string | null; reward_id: string | null; rules_version: number; reason: string | null; by_staff: string | null; at: Date | string }>(
    'SELECT * FROM rewards.loyalty_entries WHERE merchant = $1 AND person_id = $2 ORDER BY at, id',
    [merchant, personId],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, points: r.points, orderId: r.order_id, rewardId: r.reward_id, rulesVersion: r.rules_version, reason: r.reason, by: r.by_staff, at: new Date(r.at).toISOString() }));
}

// ---- What an order earns ------------------------------------------------------------------------

interface MembershipRow {
  merchant: string;
  person_id: string;
  referred_by: string | null;
  carry_cents: string | number;
  last_visit_at: Date | string | null;
  joined_at: Date | string;
}

export async function membershipOf(q: Queryable, merchant: string, personId: string): Promise<MembershipRow | null> {
  const { rows } = await q.query<MembershipRow>('SELECT * FROM rewards.loyalty_memberships WHERE merchant = $1 AND person_id = $2', [merchant, personId]);
  return rows[0] ?? null;
}

/** "HH:MM" and the weekday (Monday 0) in the shop's own time. */
export function shopClock(at: Date, timeZone: string): { weekday: number; time: string; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday!);
  return { weekday, time: `${parts.hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}

const TAKEN = ['authorised', 'approved', 'captured', 'partly_refunded', 'refunded'];

/** The order's lines as earning sees them, and its Clear and total paid, before tip. */
async function orderForEarning(q: Queryable, orderId: string) {
  const { rows: lines } = await q.query<{ line_cents: string | number; discount_cents: string | number; category: string | null }>(
    `SELECT l.line_cents, l.discount_cents, i.category FROM commerce.order_lines l LEFT JOIN commerce.catalog_items i ON i.id = l.item_id
      WHERE l.order_id = $1 AND l.removed_at IS NULL`,
    [orderId],
  );
  const { rows: tenders } = await q.query<{ method: string; status: string; amount_cents: string | number }>('SELECT method, status, amount_cents FROM payments.tenders WHERE order_id = $1', [orderId]);
  const taken = tenders.filter((t) => TAKEN.includes(t.status));
  return {
    lines: lines.map((l) => ({ netCents: Math.max(0, Number(l.line_cents) - Number(l.discount_cents)), category: l.category })),
    clearCents: taken.filter((t) => t.method === 'clear').reduce((s, t) => s + Number(t.amount_cents), 0),
    paidCents: taken.reduce((s, t) => s + Number(t.amount_cents), 0),
  };
}

async function timezoneOf(q: Queryable, merchant: string): Promise<string> {
  const { rows } = await q.query<{ timezone: string | null }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [merchant]).catch(() => ({ rows: [] as { timezone: string | null }[] }));
  return rows[0]?.timezone ?? 'America/Los_Angeles';
}

/** What this order would earn this person now, without writing anything (the cart's "Earns 12 points"). */
export async function previewEarn(q: Queryable, merchant: string, orderId: string, personId: string, opts: { clear?: boolean; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const rules = await rulesAt(q, merchant, now);
  const m = await membershipOf(q, merchant, personId);
  const o = await orderForEarning(q, orderId);
  const { rows } = await q.query<{ total_cents: string | number }>('SELECT total_cents FROM commerce.orders WHERE id = $1', [orderId]);
  const total = Number(rows[0]?.total_cents ?? 0);
  const clock = shopClock(now, await timezoneOf(q, merchant));
  return earnPoints({
    rules,
    lines: o.lines,
    at: clock,
    clearCents: opts.clear ? total : 0,
    paidCents: total,
    carryCents: m ? Number(m.carry_cents) : 0,
    stampedToday: rules.unit === 'visits' && (await stampedOn(q, merchant, personId, clock.date, await timezoneOf(q, merchant), now)),
  }).points;
}

async function stampedOn(q: Queryable, merchant: string, personId: string, date: string, timeZone: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const { rows } = await q.query<{ at: Date | string }>(`SELECT at FROM rewards.loyalty_entries WHERE merchant = $1 AND person_id = $2 AND kind = 'earn' AND at > $3`, [merchant, personId, since]);
  return rows.some((r) => shopClock(new Date(r.at), timeZone).date === date);
}

/**
 * The order just became paid (attempt `attempt`): write what it earns, the reward it used, and a
 * referral bonus on a friend's first visit. Only for someone added to the order who has joined the
 * shop; anyone else can join afterwards and have this visit counted (`creditOrderOnJoin`).
 */
export async function onOrderPaid(q: Queryable, input: { merchant: string; orderId: string; attempt: number; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const { rows } = await q.query<{ member_person: string | null }>('SELECT member_person FROM commerce.orders WHERE id = $1 AND merchant = $2', [input.orderId, input.merchant]);
  const personId = rows[0]?.member_person;
  if (!personId) return;
  const m = await membershipOf(q, input.merchant, personId);
  if (!m) return;
  const rules = await rulesAt(q, input.merchant, now);

  // The reward on it comes off now, not when it was applied or claimed.
  const { rows: rewardRows } = await q.query<{ reward_id: string; reward_points: number; claim_id: string | null }>(
    `SELECT reward_id, reward_points, claim_id FROM commerce.order_discounts WHERE order_id = $1 AND kind = 'reward' AND removed_at IS NULL`,
    [input.orderId],
  );
  const reward = rewardRows[0];
  if (reward) {
    await addEntry(q, { merchant: input.merchant, personId, kind: 'redeem', points: -reward.reward_points, rulesVersion: rules.version, rewardId: reward.reward_id, orderId: input.orderId, dedupeKey: `redeem:${input.orderId}:${input.attempt}`, at: now });
    if (reward.claim_id) await q.query('UPDATE rewards.reward_claims SET used_at = COALESCE(used_at, $2), order_id = $3 WHERE id = $1', [reward.claim_id, now.toISOString(), input.orderId]);
  }

  await earnFor(q, { merchant: input.merchant, personId, orderId: input.orderId, rules, membership: m, key: `earn:${input.orderId}:${input.attempt}`, now });
}

/** True the first time a key is seen, false after. */
async function once(q: Queryable, key: string): Promise<boolean> {
  const { rows } = await q.query('INSERT INTO rewards.processed_events (dedupe_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING dedupe_key', [key]);
  return Boolean(rows[0]);
}

async function earnFor(q: Queryable, input: { merchant: string; personId: string; orderId: string; rules: EarnRules; membership: MembershipRow; key: string; now: Date }): Promise<number> {
  const { merchant, personId, rules, now } = input;
  if (!(await once(q, input.key))) return 0;
  const tz = await timezoneOf(q, merchant);
  const clock = shopClock(now, tz);
  const o = await orderForEarning(q, input.orderId);
  const earned = earnPoints({
    rules,
    lines: o.lines,
    at: clock,
    clearCents: o.clearCents,
    paidCents: o.paidCents,
    carryCents: Number(input.membership.carry_cents),
    stampedToday: rules.unit === 'visits' && (await stampedOn(q, merchant, personId, clock.date, tz, now)),
  });
  const wrote = await addEntry(q, { merchant, personId, kind: 'earn', points: earned.points, rulesVersion: rules.version, orderId: input.orderId, dedupeKey: input.key, at: now });
  // A visit is a visit even when it earns nothing (under the minimum): it keeps their points alive.
  await q.query('UPDATE rewards.loyalty_memberships SET carry_cents = $3, last_visit_at = $4 WHERE merchant = $1 AND person_id = $2', [merchant, personId, earned.carryCents, now.toISOString()]);
  if (wrote) await referralOnFirstVisit(q, { merchant, personId, rules, referredBy: input.membership.referred_by, now });
  return wrote ? earned.points : 0;
}

/** Bring a friend: both get the bonus when the friend first pays. Once per friend, per shop. */
async function referralOnFirstVisit(q: Queryable, input: { merchant: string; personId: string; rules: EarnRules; referredBy: string | null; now: Date }): Promise<void> {
  if (!input.referredBy || !input.rules.referralBonus) return;
  const { rows } = await q.query<{ n: string | number }>(`SELECT count(*) AS n FROM rewards.loyalty_entries WHERE merchant = $1 AND person_id = $2 AND kind = 'earn'`, [input.merchant, input.personId]);
  if (Number(rows[0]!.n) !== 1) return;
  const friend = await membershipOf(q, input.merchant, input.referredBy);
  const base = `referral:${input.merchant}:${input.personId}`;
  await addEntry(q, { merchant: input.merchant, personId: input.personId, kind: 'bonus_referral', points: input.rules.referralBonus, rulesVersion: input.rules.version, dedupeKey: `${base}:friend`, at: input.now });
  if (friend) await addEntry(q, { merchant: input.merchant, personId: input.referredBy, kind: 'bonus_referral', points: input.rules.referralBonus, rulesVersion: input.rules.version, dedupeKey: `${base}:referrer`, at: input.now });
}

/**
 * Paid somewhere new, then joined: this order's points count, as if they'd joined first. Only an
 * order that's theirs (they were on it) and paid.
 */
export async function creditOrderOnJoin(q: Queryable, input: { merchant: string; personId: string; orderId: string; now?: Date }): Promise<number> {
  const now = input.now ?? new Date();
  const { rows } = await q.query<{ status: string; member_person: string | null }>('SELECT status, member_person FROM commerce.orders WHERE id = $1 AND merchant = $2', [input.orderId, input.merchant]);
  const o = rows[0];
  if (!o || o.member_person !== input.personId || !['paid', 'partly_refunded'].includes(o.status)) return 0;
  const m = await membershipOf(q, input.merchant, input.personId);
  if (!m) return 0;
  // The same key the paid event would have used, so a late paid event can't earn it twice.
  return earnFor(q, { merchant: input.merchant, personId: input.personId, orderId: input.orderId, rules: await rulesAt(q, input.merchant, now), membership: m, key: `earn:${input.orderId}:0`, now });
}

// ---- Taking points back -------------------------------------------------------------------------

/** A void: everything the order earned and used is reversed, once per entry. */
export async function onOrderUnpaid(q: Queryable, input: { merchant: string; orderId: string; now?: Date }): Promise<void> {
  const { rows } = await q.query<{ id: string; person_id: string; points: number; reward_id: string | null; rules_version: number }>(
    `SELECT id, person_id, points, reward_id, rules_version FROM rewards.loyalty_entries WHERE merchant = $1 AND order_id = $2 AND kind IN ('earn','redeem')`,
    [input.merchant, input.orderId],
  );
  for (const e of rows) {
    await addEntry(q, { merchant: input.merchant, personId: e.person_id, kind: 'refund', points: -e.points, rulesVersion: e.rules_version, orderId: input.orderId, rewardId: e.reward_id, reason: 'Voided', dedupeKey: `void:${e.id}`, at: input.now });
  }
}

/** What's been refunded on an order so far: card and cash on the tenders, Clear in its own flow. */
async function refundedCents(q: Queryable, orderId: string): Promise<number> {
  const { rows: t } = await q.query<{ c: string | number }>('SELECT COALESCE(sum(refunded_cents), 0) AS c FROM payments.tenders WHERE order_id = $1', [orderId]);
  let cents = Number(t[0]!.c);
  const { rows: has } = await q.query<{ r: string | null }>(`SELECT to_regclass('merchant.refunds')::text AS r`);
  if (has[0]?.r) {
    const { rows: c } = await q.query<{ c: string | number }>(
      `SELECT COALESCE(sum(r.amount_cents), 0) AS c FROM merchant.refunds r JOIN payments.tenders t ON t.clear_charge_code = r.charge_code
        WHERE t.order_id = $1 AND r.state IN ('approved','settled')`,
      [orderId],
    );
    cents += Number(c[0]!.c);
  }
  return cents;
}

/**
 * A refund takes back what was earned on the refunded part. Everything refunded also gives back the
 * points the reward used. `key` names this refund, so it's applied once.
 */
export async function onOrderRefunded(q: Queryable, input: { merchant: string; orderId: string; key: string; now?: Date }): Promise<void> {
  const { rows: o } = await q.query<{ total_cents: string | number; member_person: string | null }>('SELECT total_cents, member_person FROM commerce.orders WHERE id = $1 AND merchant = $2', [input.orderId, input.merchant]);
  const total = Number(o[0]?.total_cents ?? 0);
  if (!o[0] || total <= 0) return;
  const { rows: entries } = await q.query<{ id: string; person_id: string; kind: Kind; points: number; reward_id: string | null; rules_version: number; reason: string | null; dedupe_key: string }>(
    `SELECT * FROM rewards.loyalty_entries WHERE merchant = $1 AND order_id = $2`,
    [input.merchant, input.orderId],
  );
  const earn = entries.filter((e) => e.kind === 'earn');
  if (!earn.length && !entries.some((e) => e.kind === 'redeem')) return;
  const refunded = await refundedCents(q, input.orderId);
  const byPerson = new Map<string, { earned: number; reversed: number; version: number }>();
  for (const e of earn) {
    const p = byPerson.get(e.person_id) ?? { earned: 0, reversed: 0, version: e.rules_version };
    p.earned += e.points;
    byPerson.set(e.person_id, p);
  }
  for (const e of entries.filter((x) => x.kind === 'refund' && x.dedupe_key.startsWith('refund:'))) {
    const p = byPerson.get(e.person_id);
    if (p) p.reversed += -e.points;
  }
  for (const [personId, p] of byPerson) {
    const due = refundPoints(p.earned, total, refunded) - p.reversed;
    if (due > 0) await addEntry(q, { merchant: input.merchant, personId, kind: 'refund', points: -due, rulesVersion: p.version, orderId: input.orderId, reason: 'Refunded', dedupeKey: `refund:${input.key}:${personId}`, at: input.now });
  }
  if (refunded >= total) {
    for (const r of entries.filter((e) => e.kind === 'redeem')) {
      await addEntry(q, { merchant: input.merchant, personId: r.person_id, kind: 'refund', points: -r.points, rulesVersion: r.rules_version, orderId: input.orderId, rewardId: r.reward_id, reason: 'Refunded: reward returned', dedupeKey: `refund-reward:${r.id}`, at: input.now });
    }
  }
}

// ---- Joining ------------------------------------------------------------------------------------

export async function joinBonus(q: Queryable, input: { merchant: string; personId: string; rules: EarnRules; now?: Date }): Promise<number> {
  if (input.rules.joinBonus <= 0) return 0;
  const wrote = await addEntry(q, { merchant: input.merchant, personId: input.personId, kind: 'bonus_join', points: input.rules.joinBonus, rulesVersion: input.rules.version, dedupeKey: `join:${input.merchant}:${input.personId}`, at: input.now });
  return wrote ? input.rules.joinBonus : 0;
}

// ---- Jobs ---------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = { '12m': 12, '6m': 6 };

/**
 * Points expire from the last visit, by the rules each was earned under, so a change of expiry
 * applies only to points earned after it. What expires is at most the balance.
 */
export async function expirePoints(q: Queryable, now = new Date()): Promise<number> {
  const { rows: members } = await q.query<{ merchant: string; person_id: string; last_visit_at: Date | string | null; joined_at: Date | string }>('SELECT merchant, person_id, last_visit_at, joined_at FROM rewards.loyalty_memberships');
  let expired = 0;
  for (const m of members) {
    const since = new Date(m.last_visit_at ?? m.joined_at);
    const { rows: entries } = await q.query<{ points: number; rules_version: number; kind: Kind }>(
      `SELECT points, rules_version, kind FROM rewards.loyalty_entries WHERE merchant = $1 AND person_id = $2`,
      [m.merchant, m.person_id],
    );
    const versions = new Map<number, EarnRules | null>();
    let lapsed = 0;
    for (const e of entries.filter((x) => x.points > 0 && x.kind !== 'refund')) {
      if (!versions.has(e.rules_version)) versions.set(e.rules_version, await rulesByVersion(q, m.merchant, e.rules_version));
      const months = MONTHS[versions.get(e.rules_version)?.expiry ?? 'never'];
      if (!months) continue;
      const until = new Date(since);
      until.setMonth(until.getMonth() + months);
      if (until <= now) lapsed += e.points;
    }
    const already = -entries.filter((e) => e.kind === 'expire').reduce((s, e) => s + e.points, 0);
    const bal = entries.reduce((s, e) => s + e.points, 0);
    const due = Math.min(bal, lapsed - already);
    if (due > 0) {
      const rules = await rulesAt(q, m.merchant, now);
      const wrote = await addEntry(q, { merchant: m.merchant, personId: m.person_id, kind: 'expire', points: -due, rulesVersion: rules.version, reason: 'No visit since', dedupeKey: `expire:${m.merchant}:${m.person_id}:${since.toISOString()}:${lapsed}`, at: now });
      if (wrote) expired += due;
    }
  }
  return expired;
}

/**
 * Birthday: on the first of the month, everyone at a shop with a birthday reward whose month it is
 * gets that reward's points, once a year, marked with the reward.
 */
export async function birthdayRewards(q: Queryable, now = new Date()): Promise<number> {
  const month = now.getUTCMonth() + 1;
  const { rows } = await q.query<{ merchant: string; person_id: string }>('SELECT merchant, person_id FROM rewards.loyalty_memberships WHERE birth_month = $1', [month]);
  let given = 0;
  for (const m of rows) {
    const rules = await rulesAt(q, m.merchant, now);
    if (!rules.birthdayRewardId) continue;
    const { rows: r } = await q.query<{ cost: number }>('SELECT cost FROM rewards.rewards WHERE id = $1 AND archived_at IS NULL', [rules.birthdayRewardId]);
    if (!r[0]) continue;
    const wrote = await addEntry(q, { merchant: m.merchant, personId: m.person_id, kind: 'bonus_birthday', points: r[0].cost, rulesVersion: rules.version, rewardId: rules.birthdayRewardId, dedupeKey: `birthday:${m.merchant}:${m.person_id}:${now.getUTCFullYear()}`, at: now });
    if (wrote) given += 1;
  }
  return given;
}
