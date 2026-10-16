import { randomUUID } from 'node:crypto';
import {
  AddParty,
  CreateAlert,
  HOLD_SECONDS,
  JoinWaitlist,
  MoveTable,
  ORDER_READY_SECONDS,
  PointEvent,
  SeatParty,
  SeatTable,
  TABLE_READY_SECONDS,
  TABLE_REQUEST_SECONDS,
  TableInput,
  UpdateParty,
  type Alert,
  type Floor,
  type PartySeated,
  type PickupOrder,
  type PointSettings,
  type ShopSettings,
  type TableMoved,
  type TableRequest,
  type TableView,
  type Waitlist,
  type WaitlistJoined,
  type WaitlistParty,
} from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { phoneE164 } from '../orders/payments.js';
import { businessDate } from '../orders/orderService.js';
import { audit } from '../security/audit.js';
import { getSettings } from '../shop/shopService.js';
import { touchShop } from './bus.js';
import { TerminalError } from './errors.js';
import type { PointIdentity } from './hardware.js';
import { pointStateFor, setBase, showOnPoint } from './pointState.js';
import { lastFour, orderReadyText, tableReadyNotice, tableReadyText, waitlistAlmostText, waitlistJoinedText, type Texter } from './texts.js';

/**
 * Tables, the wait list, seating, Call and Bill, alerts and Order ready (terminal reference,
 * sections 8, 8b, 9 and 13b; the seating and Pay case addenda).
 */

const iso = (d: Date | string) => new Date(d).toISOString();
const isoOrNull = (d: Date | string | null | undefined) => (d ? iso(d) : null);
const plus = (now: Date, s: number) => new Date(now.getTime() + s * 1000);
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name.trim();
const issue = (r: { error: { issues: Array<{ message: string }> } }, fallback: string) => r.error.issues[0]?.message ?? fallback;
const PAID = ['paid', 'refunded', 'partly_refunded'];
/** Before a week has three visits to go on: five minutes a party ahead, and theirs. */
const MINUTES_PER_PARTY = 5;
/** Visits a week needs before its table times set the estimate. */
const VISITS_FOR_ESTIMATE = 3;
const WEEK_MS = 7 * 24 * 60 * 60_000;
const TEXTS_OFF = 'Texting the wait list is off in Settings › Counter';
/** A second press of Call within this long is the same press (the firmware debounces 50ms; people press twice). */
const REPEAT_PRESS_MS = 3_000;
/** A press made offline is kept if it reaches us within two minutes. */
const STALE_PRESS_MS = 2 * 60_000;

// ---- Tables -----------------------------------------------------------------------------------------------

interface TableRow {
  id: string;
  merchant: string;
  number: number;
  label: string | null;
  area: string | null;
  seats: number;
  seated_at: Date | string | null;
  tab_order_id: string | null;
  hold_party_id: string | null;
  hold_show_name: boolean | null;
  hold_seated_at: Date | string | null;
  hold_expires_at: Date | string | null;
  party_name: string | null;
  party_size: number | null;
}

interface RequestRow {
  id: string;
  table_id: string;
  point_id: string;
  kind: 'call' | 'bill';
  at: Date | string;
  state: TableRequest['state'];
  answered_by: string | null;
  answered_at: Date | string | null;
  bill_cents: string | number | null;
  expires_at: Date | string;
}

const toRequest = (r: RequestRow): TableRequest => ({
  id: r.id,
  tableId: r.table_id,
  pointId: r.point_id,
  kind: r.kind,
  at: iso(r.at),
  state: r.state,
  answeredBy: r.answered_by,
  answeredAt: isoOrNull(r.answered_at),
  billCents: r.bill_cents === null ? null : Number(r.bill_cents),
});

async function tableRow(q: Queryable, merchant: string, id: string, lock = false): Promise<TableRow> {
  const { rows } = await q.query<TableRow>(`SELECT * FROM merchant.tables WHERE id = $1 AND merchant = $2 AND removed_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id, merchant]);
  if (!rows[0]) throw new TerminalError('No such table', 'not_found');
  return rows[0];
}

/** The Point placed at a table, if there is one. */
async function pointAtTable(q: Queryable, merchant: string, tableId: string): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `SELECT id FROM merchant.hardware WHERE merchant = $1 AND kind = 'point' AND removed_at IS NULL AND settings->>'tableId' = $2 ORDER BY created_at LIMIT 1`,
    [merchant, tableId],
  );
  return rows[0]?.id ?? null;
}

/** The first Point at a placement: the door's for Table ready, the counter's for Order ready. */
async function pointAt(q: Queryable, merchant: string, placement: 'door' | 'counter'): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `SELECT id FROM merchant.hardware WHERE merchant = $1 AND kind = 'point' AND removed_at IS NULL AND settings->>'placement' = $2 ORDER BY created_at LIMIT 1`,
    [merchant, placement],
  );
  return rows[0]?.id ?? null;
}

async function tableView(q: Queryable, t: TableRow, now: Date, settings?: ShopSettings): Promise<TableView> {
  const tNow = now.getTime();
  let order: { status: string; total_cents: string | number; bill_sent_at: Date | string | null; lines: string | number } | null = null;
  if (t.tab_order_id) {
    const { rows } = await q.query<{ status: string; total_cents: string | number; bill_sent_at: Date | string | null; lines: string | number }>(
      `SELECT o.status, o.total_cents, o.bill_sent_at, (SELECT count(*) FROM commerce.order_lines l WHERE l.order_id = o.id AND l.removed_at IS NULL) AS lines
         FROM commerce.orders o WHERE o.id = $1`,
      [t.tab_order_id],
    );
    order = rows[0] ?? null;
  }
  const lines = Number(order?.lines ?? 0);
  const holdLive = Boolean(t.hold_party_id && t.hold_expires_at && new Date(t.hold_expires_at).getTime() > tNow && lines === 0);
  let partyName = '';
  let heldSize: number | null = null;
  if (holdLive) {
    const { rows } = await q.query<{ name: string; size: number }>('SELECT name, size FROM merchant.waitlist_parties WHERE id = $1', [t.hold_party_id]);
    partyName = firstName(rows[0]?.name ?? '');
    heldSize = rows[0] ? Number(rows[0].size) : null;
  }
  let paidAt: string | null = null;
  if (order && PAID.includes(order.status)) {
    const { rows } = await q.query<{ at: Date | string | null }>(
      `SELECT max(updated_at) AS at FROM payments.tenders WHERE order_id = $1 AND status IN ('approved','authorised','captured','partly_refunded','refunded')`,
      [t.tab_order_id],
    );
    paidAt = isoOrNull(rows[0]?.at);
  }
  const status: TableView['status'] = holdLive
    ? 'held'
    : order && PAID.includes(order.status)
      ? 'paid'
      : order?.bill_sent_at
        ? 'bill_sent'
        : lines > 0
          ? 'ordering'
          : t.seated_at || order
            ? 'seated'
            : 'free';
  const { rows: req } = await q.query<RequestRow>(
    `SELECT * FROM merchant.table_requests WHERE table_id = $1 AND state = 'open' AND expires_at > $2 ORDER BY at DESC LIMIT 1`,
    [t.id, now],
  );
  const pointId = await pointAtTable(q, t.merchant, t.id);
  // Who is there: what seating wrote down, or the held party. A free table has nobody.
  const party = status === 'free' ? null : t.party_size ? { name: t.party_name, size: Number(t.party_size) } : heldSize ? { name: partyName || null, size: heldSize } : null;
  // A paid table clears itself under the shop's rule (Settings › Counter); by hand, it never does.
  const clearAfter = status === 'paid' && paidAt ? (settings ?? (await getSettings(q, t.merchant))).clearPaidAfterMinutes : null;
  const clearsAt = clearAfter && paidAt ? new Date(Date.parse(paidAt) + clearAfter * 60_000).toISOString() : null;
  return {
    id: t.id,
    shop: t.merchant,
    number: t.number,
    label: t.label,
    area: t.area,
    seats: t.seats,
    status,
    hold: holdLive
      ? { partyId: t.hold_party_id!, showName: Boolean(t.hold_show_name), seatedAt: iso(t.hold_seated_at!), expiresAt: iso(t.hold_expires_at!), partyName }
      : null,
    request: req[0] ? toRequest(req[0]) : null,
    seatedAt: status === 'free' ? null : isoOrNull(t.seated_at ?? t.hold_seated_at),
    orderId: status === 'free' ? null : t.tab_order_id,
    tabCents: order && status !== 'free' ? Number(order.total_cents) : null,
    billSentAt: isoOrNull(order?.bill_sent_at),
    paidAt,
    point: pointId ? { id: pointId, showing: (await pointStateFor(q, pointId, now)).state } : null,
    party,
    clearsAt,
  };
}

export async function getTable(q: Queryable, merchant: string, tableId: string, now = new Date()): Promise<TableView> {
  return tableView(q, await tableRow(q, merchant, tableId), now);
}

/** The Floor page: tables, the wait list, and the last hour's Calls and bills. */
export async function floor(q: Queryable, merchant: string, now = new Date()): Promise<Floor> {
  const { rows } = await q.query<TableRow>('SELECT * FROM merchant.tables WHERE merchant = $1 AND removed_at IS NULL ORDER BY number', [merchant]);
  const tables = [];
  const settings = await getSettings(q, merchant);
  for (const t of rows) tables.push(await tableView(q, t, now, settings));
  return { tables, waitlist: await waitlist(q, merchant), requests: await tableRequests(q, merchant, now) };
}

/** Edit tables: the set as it should be. A table with a tab or a hold can't go. */
export async function saveTables(db: Db, input: { merchant: string; staffId: string; tables: unknown }): Promise<void> {
  if (!Array.isArray(input.tables)) throw new TerminalError('The tables, as a list', 'invalid');
  const wanted = input.tables.map((t) => {
    const parsed = TableInput.safeParse(t);
    if (!parsed.success) throw new TerminalError(issue(parsed, 'A table isn’t valid'), 'invalid');
    const id = (t as { id?: unknown }).id;
    return { ...parsed.data, id: typeof id === 'string' ? id : null };
  });
  const numbers = wanted.map((t) => t.number);
  if (new Set(numbers).size !== numbers.length) throw new TerminalError('Each table number once', 'invalid');
  await db.transaction(async (tx) => {
    const { rows: current } = await tx.query<TableRow>('SELECT * FROM merchant.tables WHERE merchant = $1 AND removed_at IS NULL FOR UPDATE', [input.merchant]);
    const keep = new Set(wanted.map((t) => t.id).filter(Boolean));
    for (const t of current) {
      if (keep.has(t.id)) continue;
      if (t.tab_order_id || t.hold_party_id || t.seated_at) throw new TerminalError(`Table ${t.number} has people at it; clear it first`, 'conflict');
      // Its number is free again straight away.
      await tx.query('UPDATE merchant.tables SET removed_at = now() WHERE id = $1', [t.id]);
    }
    // Numbers can swap (6 and 7 trade places), so every kept table steps out of the number index
    // first, by being marked removed for the length of this transaction, and steps back in with its
    // new number. Its number can't go negative: the table's check is 1 to 999.
    for (const t of wanted) {
      if (t.id) {
        if (!current.some((c) => c.id === t.id)) throw new TerminalError('No such table', 'not_found');
        await tx.query('UPDATE merchant.tables SET removed_at = now() WHERE id = $1', [t.id]);
      }
    }
    for (const t of wanted) {
      const tableId = t.id ?? `tbl_${randomUUID()}`;
      if (t.id) await tx.query('UPDATE merchant.tables SET number = $2, label = $3, area = $4, seats = $5, removed_at = NULL WHERE id = $1', [t.id, t.number, t.label, t.area, t.seats]);
      else await tx.query('INSERT INTO merchant.tables (id, merchant, number, label, area, seats) VALUES ($1,$2,$3,$4,$5,$6)', [tableId, input.merchant, t.number, t.label, t.area, t.seats]);
      if (t.pointId !== undefined) await linkPoint(tx, input.merchant, tableId, t.pointId);
    }
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'tables.saved', detail: { count: wanted.length } });
  });
  touchShop(input.merchant);
}

/**
 * Edit tables' Point column (section 8): a Point linked to a table is placed there (it shows the
 * table's number and bills); the Point that was there, if another, is unlinked. A Point linked to a
 * table it wasn't at leaves that one. Null unlinks.
 */
async function linkPoint(tx: Queryable, merchant: string, tableId: string, pointId: string | null): Promise<void> {
  const current = await pointAtTable(tx, merchant, tableId);
  if (current && current !== pointId) {
    await tx.query(`UPDATE merchant.hardware SET settings = jsonb_set(settings::jsonb, '{tableId}', 'null'::jsonb) WHERE id = $1`, [current]);
  }
  if (!pointId || current === pointId) return;
  const { rows } = await tx.query<{ id: string }>(`SELECT id FROM merchant.hardware WHERE id = $1 AND merchant = $2 AND kind = 'point' AND removed_at IS NULL`, [pointId, merchant]);
  if (!rows[0]) throw new TerminalError('No such Point', 'not_found');
  await tx.query(
    `UPDATE merchant.hardware SET settings = jsonb_set(jsonb_set(settings::jsonb, '{tableId}', to_jsonb($2::text)), '{placement}', '"table"'::jsonb) WHERE id = $1`,
    [pointId, tableId],
  );
}

/**
 * Seat a table (section 8b): a held party sits down (the hold ends, their name and size stay), or a
 * walk-in at a free table, with how many and an optional name. Seating a seated table changes nothing.
 */
export async function seatTable(db: Db, input: { merchant: string; staffId: string; tableId: string; request?: unknown; now?: Date }): Promise<TableView> {
  const parsed = SeatTable.safeParse(input.request ?? {});
  if (!parsed.success) throw new TerminalError(issue(parsed, 'How many, and a name if they gave one'), 'invalid');
  const r = parsed.data;
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const t = await tableRow(tx, input.merchant, input.tableId, true);
    let name: string | null = r.name?.trim() || null;
    let size: number | null = r.size ?? null;
    if (t.hold_party_id) {
      const { rows } = await tx.query<{ name: string; size: number }>('SELECT name, size FROM merchant.waitlist_parties WHERE id = $1', [t.hold_party_id]);
      if (rows[0]) [name, size] = [firstName(rows[0].name), Number(rows[0].size)];
    }
    await tx.query(
      `UPDATE merchant.tables SET seated_at = COALESCE(seated_at, hold_seated_at, $2), party_name = CASE WHEN party_size IS NULL THEN $3 ELSE party_name END,
         party_size = COALESCE(party_size, $4), hold_party_id = NULL, hold_show_name = NULL, hold_seated_at = NULL, hold_expires_at = NULL WHERE id = $1`,
      [t.id, now, name, size],
    );
    if (!t.seated_at && !t.hold_party_id) await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'tables.walk_in', ref: { type: 'table', id: t.id }, detail: { size, named: Boolean(name) } });
  });
  touchShop(input.merchant);
  return getTable(db, input.merchant, input.tableId, now);
}

/**
 * Move (section 8b): the tab, the bill if sent, the party and their name on the Point go to a free
 * table; the one they left is free, its Point back to idle. The Point at the new table shows what the
 * old one did.
 */
export async function moveTable(db: Db, input: { merchant: string; staffId: string; tableId: string; request: unknown; now?: Date }): Promise<TableMoved> {
  const parsed = MoveTable.safeParse(input.request);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'Which table to move to'), 'invalid');
  const now = input.now ?? new Date();
  const to = parsed.data.toTableId;
  if (to === input.tableId) throw new TerminalError('That’s the table they’re at', 'invalid');
  await db.transaction(async (tx) => {
    // Locked in id order, so two moves between the same tables can't wait on each other.
    const [a, b] = [input.tableId, to].sort();
    const first = await tableRow(tx, input.merchant, a!, true);
    const second = await tableRow(tx, input.merchant, b!, true);
    const from = first.id === input.tableId ? first : second;
    const dest = first.id === to ? first : second;
    const holdLive = (t: TableRow) => Boolean(t.hold_party_id && t.hold_expires_at && new Date(t.hold_expires_at).getTime() > now.getTime());
    if (!from.tab_order_id && !from.seated_at && !holdLive(from)) throw new TerminalError(`Table ${from.number} has nobody to move`, 'conflict');
    if (dest.tab_order_id || dest.seated_at || holdLive(dest)) throw new TerminalError(`Table ${dest.number} isn’t free`, 'conflict');
    await tx.query(
      `UPDATE merchant.tables SET seated_at = $2, tab_order_id = $3, hold_party_id = $4, hold_show_name = $5, hold_seated_at = $6, hold_expires_at = $7, party_name = $8, party_size = $9 WHERE id = $1`,
      [dest.id, from.seated_at, from.tab_order_id, from.hold_party_id, from.hold_show_name, from.hold_seated_at, from.hold_expires_at, from.party_name, from.party_size],
    );
    await tx.query(
      `UPDATE merchant.tables SET seated_at = NULL, tab_order_id = NULL, hold_party_id = NULL, hold_show_name = NULL, hold_seated_at = NULL, hold_expires_at = NULL, party_name = NULL, party_size = NULL WHERE id = $1`,
      [from.id],
    );
    if (from.tab_order_id) await tx.query('UPDATE commerce.orders SET table_id = $2 WHERE id = $1', [from.tab_order_id, dest.id]);
    await tx.query(`UPDATE merchant.waitlist_parties SET table_id = $2 WHERE table_id = $1 AND state = 'seated'`, [from.id, dest.id]);
    await tx.query(`UPDATE merchant.table_requests SET state = 'answered', answered_by = $2, answered_at = $3 WHERE table_id = $1 AND state = 'open'`, [from.id, input.staffId, now]);
    const fromPoint = await pointAtTable(tx, input.merchant, from.id);
    const destPoint = await pointAtTable(tx, input.merchant, dest.id);
    if (destPoint) {
      const { rows } = fromPoint ? await tx.query<{ kind: 'idle' | 'bill' | 'paid' | 'test'; order_id: string | null }>('SELECT kind, order_id FROM merchant.point_states WHERE device_id = $1', [fromPoint]) : { rows: [] };
      const base = rows[0];
      // The bill, if it was out, follows them; anything else, the new table's Point starts from idle.
      if (base && (base.kind === 'bill' || base.kind === 'paid') && base.order_id === from.tab_order_id) await setBase(tx, destPoint, base.kind, base.order_id, now);
      else await setBase(tx, destPoint, 'idle', null, now);
    }
    if (fromPoint) await setBase(tx, fromPoint, 'idle', null, now);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'tables.moved', ref: { type: 'table', id: from.id }, detail: { to: dest.id, orderId: from.tab_order_id } });
  });
  touchShop(input.merchant);
  return { from: await getTable(db, input.merchant, input.tableId, now), to: await getTable(db, input.merchant, to, now) };
}

/**
 * A table is free again: its tab is done with, its Point back to idle, and the visit kept for wait
 * estimates. By hand (staff), or by the jobs once a paid table's time is up (`staffId` null).
 */
export async function clearTable(db: Db, input: { merchant: string; staffId: string | null; tableId: string; now?: Date }): Promise<TableView> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const t = await tableRow(tx, input.merchant, input.tableId, true);
    if (t.tab_order_id) {
      const { rows } = await tx.query<{ status: string }>('SELECT status FROM commerce.orders WHERE id = $1', [t.tab_order_id]);
      const s = rows[0]?.status;
      if (s && !PAID.includes(s) && s !== 'voided') throw new TerminalError('Its tab isn’t paid yet', 'conflict');
    }
    const seatedAt = t.seated_at ?? t.hold_seated_at;
    if (seatedAt)
      await tx.query('INSERT INTO merchant.table_visits (id, merchant, table_id, party_size, seated_at, cleared_at) VALUES ($1,$2,$3,$4,$5,$6)', [
        `vis_${randomUUID()}`,
        input.merchant,
        t.id,
        t.party_size,
        seatedAt,
        now,
      ]);
    await tx.query(
      `UPDATE merchant.tables SET seated_at = NULL, tab_order_id = NULL, hold_party_id = NULL, hold_show_name = NULL, hold_seated_at = NULL, hold_expires_at = NULL, party_name = NULL, party_size = NULL WHERE id = $1`,
      [t.id],
    );
    await tx.query(`UPDATE merchant.table_requests SET state = 'answered', answered_by = $2, answered_at = $3 WHERE table_id = $1 AND state = 'open'`, [t.id, input.staffId, now]);
    const pointId = await pointAtTable(tx, input.merchant, t.id);
    if (pointId) await setBase(tx, pointId, 'idle', null, now);
  });
  touchShop(input.merchant);
  return getTable(db, input.merchant, input.tableId, now);
}

// ---- The wait list ------------------------------------------------------------------------------------------

interface PartyRow {
  id: string;
  merchant: string;
  name: string;
  size: number;
  phone: string | null;
  text_consent: boolean;
  member_wallet: string | null;
  rank: number;
  quoted_minutes: number;
  state: WaitlistParty['state'];
  table_id: string | null;
  joined_at: Date | string;
  ready_at: Date | string | null;
  seated_at: Date | string | null;
  notified_at: Date | string | null;
}

const toParty = (r: PartyRow, position: number): WaitlistParty => ({
  id: r.id,
  name: r.name,
  size: r.size,
  phone: r.phone,
  textConsent: r.text_consent,
  position,
  quotedMinutes: r.quoted_minutes,
  state: r.state,
  tableId: r.table_id,
  joinedAt: iso(r.joined_at),
  readyAt: isoOrNull(r.ready_at),
  notifiedAt: isoOrNull(r.notified_at),
});

/**
 * The wait to tell a party with `ahead` parties in front of them (Settings › Counter › Wait
 * estimates). "From this week": the median visit this week (seated to cleared), times the parties
 * up to and including them, spread over the shop's tables, to the next five minutes. With fewer
 * than three visits to go on, five minutes a party. "A set time": that, whatever the list.
 */
export async function waitEstimate(q: Queryable, merchant: string, ahead: number, now = new Date()): Promise<number> {
  const s = await getSettings(q, merchant);
  if (typeof s.waitEstimate === 'number') return s.waitEstimate;
  const { rows } = await q.query<{ mins: string | number }>(
    'SELECT EXTRACT(EPOCH FROM (cleared_at - seated_at)) / 60 AS mins FROM merchant.table_visits WHERE merchant = $1 AND cleared_at > $2 AND cleared_at <= $3',
    [merchant, new Date(now.getTime() - WEEK_MS), now],
  );
  if (rows.length < VISITS_FOR_ESTIMATE) return (ahead + 1) * MINUTES_PER_PARTY;
  const mins = rows.map((r) => Number(r.mins)).sort((a, b) => a - b);
  const median = mins[Math.floor(mins.length / 2)]!;
  const { rows: t } = await q.query<{ n: string | number }>('SELECT count(*) AS n FROM merchant.tables WHERE merchant = $1 AND removed_at IS NULL', [merchant]);
  const tables = Math.max(1, Number(t[0]?.n ?? 1));
  return Math.max(5, Math.ceil(((ahead + 1) * median) / tables / 5) * 5);
}

/** Who is waiting, in order, and seated today; and the quote for someone joining now. */
export async function waitlist(q: Queryable, merchant: string, now = new Date()): Promise<Waitlist> {
  const { rows } = await q.query<PartyRow>(
    `SELECT * FROM merchant.waitlist_parties WHERE merchant = $1 AND (state IN ('waiting','notified') OR (state = 'seated' AND seated_at > now() - interval '12 hours'))
      ORDER BY (state = 'seated') DESC, seated_at DESC NULLS LAST, rank`,
    [merchant],
  );
  let n = 0;
  const parties = rows.map((r) => toParty(r, r.state === 'seated' ? 1 : ++n));
  return { parties, quotedMinutes: await waitEstimate(q, merchant, n, now) };
}

async function partyRow(q: Queryable, merchant: string, id: string, lock = false): Promise<PartyRow> {
  const { rows } = await q.query<PartyRow>(`SELECT * FROM merchant.waitlist_parties WHERE id = $1 AND merchant = $2${lock ? ' FOR UPDATE' : ''}`, [id, merchant]);
  if (!rows[0]) throw new TerminalError('No such party', 'not_found');
  return rows[0];
}

async function partyView(q: Queryable, merchant: string, id: string): Promise<WaitlistParty> {
  const list = await waitlist(q, merchant);
  const found = list.parties.find((p) => p.id === id);
  if (found) return found;
  return toParty(await partyRow(q, merchant, id), 1);
}

async function insertParty(
  db: Db,
  input: { merchant: string; name: string; size: number; phone: string | null; textConsent: boolean; quotedMinutes?: number; memberWallet?: string | null; now: Date; texter?: Texter },
): Promise<PartyRow> {
  let phone: string | null = null;
  if (input.phone) {
    phone = phoneE164(input.phone);
    if (!phone) throw new TerminalError('That isn’t a phone number', 'invalid');
  }
  const { rows: ahead } = await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM merchant.waitlist_parties WHERE merchant = $1 AND state IN ('waiting','notified')`, [input.merchant]);
  // "Tell them" (section 8c), or the shop's estimate for where they are in the line.
  const quoted = input.quotedMinutes ?? (await waitEstimate(db, input.merchant, Number(ahead[0]?.n ?? 0), input.now));
  const { rows } = await db.query<PartyRow>(
    `INSERT INTO merchant.waitlist_parties (id, merchant, name, size, phone, text_consent, member_wallet, rank, quoted_minutes, joined_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [`pty_${randomUUID()}`, input.merchant, input.name.trim(), input.size, phone, Boolean(phone) && input.textConsent, input.memberWallet ?? null, input.now.getTime(), quoted, input.now],
  );
  touchShop(input.merchant);
  const party = rows[0]!;
  // "They get one text now": with a number, their consent and the shop's texts on. Best effort.
  if (input.texter && party.phone && party.text_consent && (await getSettings(db, input.merchant)).textWaitlist) {
    await input.texter.send({ to: party.phone, message: waitlistJoinedText(await shopName(db, input.merchant), quoted) }).catch(() => false);
  }
  return party;
}

async function shopName(q: Queryable, merchant: string): Promise<string> {
  const { rows } = await q.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [merchant]);
  return rows[0]?.name ?? '';
}

/** Add a party, at the door (section 8c): told a wait, and texted if they left a number. */
export async function addParty(db: Db, input: { merchant: string; staffId: string; party: unknown; texter?: Texter; now?: Date }): Promise<WaitlistParty> {
  const parsed = AddParty.safeParse(input.party);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'A name and how many'), 'invalid');
  const row = await insertParty(db, { merchant: input.merchant, ...parsed.data, now: input.now ?? new Date(), texter: input.texter });
  return partyView(db, input.merchant, row.id);
}

/** From a door Point's phone page: their place, and the quote. */
export async function joinWaitlist(db: Db, input: { merchant: string; request: unknown; memberWallet?: string | null; texter?: Texter; now?: Date }): Promise<WaitlistJoined> {
  const parsed = JoinWaitlist.safeParse(input.request);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'A name and how many'), 'invalid');
  const row = await insertParty(db, { merchant: input.merchant, ...parsed.data, memberWallet: input.memberWallet ?? null, now: input.now ?? new Date(), texter: input.texter });
  const list = await waitlist(db, input.merchant);
  const p = list.parties.find((x) => x.id === row.id)!;
  return { position: p.position, quotedMinutes: row.quoted_minutes };
}

/** Move someone, mark them gone, or note the table they'll get. Seating is `seatParty`. */
export async function updateParty(db: Db, input: { merchant: string; staffId: string; partyId: string; patch: unknown; now?: Date }): Promise<WaitlistParty> {
  const parsed = UpdateParty.safeParse(input.patch);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'That change isn’t valid'), 'invalid');
  const p = parsed.data;
  await db.transaction(async (tx) => {
    const party = await partyRow(tx, input.merchant, input.partyId, true);
    if (p.tableId) await tableRow(tx, input.merchant, p.tableId);
    if (p.tableId !== undefined) await tx.query('UPDATE merchant.waitlist_parties SET table_id = $2 WHERE id = $1', [party.id, p.tableId]);
    if (p.state === 'removed') await tx.query(`UPDATE merchant.waitlist_parties SET state = 'removed', left_at = $2 WHERE id = $1`, [party.id, input.now ?? new Date()]);
    if (p.state === 'waiting') await tx.query(`UPDATE merchant.waitlist_parties SET state = 'waiting', left_at = NULL WHERE id = $1`, [party.id]);
    if (p.position !== undefined) {
      const { rows } = await tx.query<{ id: string; rank: number }>(
        `SELECT id, rank FROM merchant.waitlist_parties WHERE merchant = $1 AND state IN ('waiting','notified') AND id <> $2 ORDER BY rank`,
        [input.merchant, party.id],
      );
      const i = Math.min(p.position - 1, rows.length);
      const before = rows[i - 1]?.rank;
      const after = rows[i]?.rank;
      const rank = before === undefined ? (after ?? 0) - 1 : after === undefined ? before + 1 : (before + after) / 2;
      await tx.query('UPDATE merchant.waitlist_parties SET rank = $2 WHERE id = $1', [party.id, rank]);
    }
  });
  touchShop(input.merchant);
  return partyView(db, input.merchant, input.partyId);
}

/**
 * The Seat sheet (section 8b): the party seated, the table held for them, its Point held, Table ready
 * on the door's Point, and a text if asked. Seating them at the same table again changes nothing.
 */
export async function seatParty(db: Db, texter: Texter, input: { merchant: string; staffId: string; partyId: string; request: unknown; now?: Date }): Promise<PartySeated> {
  const parsed = SeatParty.safeParse(input.request);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'Which table, and whether to show their name and text them'), 'invalid');
  const r = parsed.data;
  const now = input.now ?? new Date();
  const outcome = await db.transaction(async (tx) => {
    const party = await partyRow(tx, input.merchant, input.partyId, true);
    if (party.state === 'seated') {
      if (party.table_id === r.tableId) return { again: true as const, party, table: null };
      throw new TerminalError('They’re already seated at another table', 'conflict');
    }
    if (party.state === 'removed' || party.state === 'no_show') throw new TerminalError('They’re off the list', 'conflict');
    const table = await tableRow(tx, input.merchant, r.tableId, true);
    if (table.tab_order_id || table.seated_at || (table.hold_party_id && table.hold_expires_at && new Date(table.hold_expires_at).getTime() > now.getTime())) {
      throw new TerminalError(`Table ${table.number} isn’t free`, 'conflict');
    }
    if (r.text && !party.phone) throw new TerminalError('They didn’t leave a number', 'invalid');
    if (r.text && !party.text_consent) throw new TerminalError('They didn’t agree to a text', 'invalid');
    if (r.text && !(await getSettings(tx, input.merchant)).textWaitlist) throw new TerminalError(TEXTS_OFF, 'conflict');
    const expires = plus(now, HOLD_SECONDS);
    await tx.query(`UPDATE merchant.waitlist_parties SET state = 'seated', seated_at = $2, table_id = $3 WHERE id = $1`, [party.id, now, table.id]);
    await tx.query('UPDATE merchant.tables SET hold_party_id = $2, hold_show_name = $3, hold_seated_at = $4, hold_expires_at = $5, party_name = $6, party_size = $7 WHERE id = $1', [
      table.id,
      party.id,
      r.showName,
      now,
      expires,
      firstName(party.name),
      party.size,
    ]);
    // A table Point left on a paid bill or the test screen goes back so the hold shows.
    const tablePoint = await pointAtTable(tx, input.merchant, table.id);
    if (tablePoint) await setBase(tx, tablePoint, 'idle', null, now);
    const door = await pointAt(tx, input.merchant, 'door');
    const alertId = `alr_${randomUUID()}`;
    await tx.query(
      `INSERT INTO merchant.alerts (id, merchant, kind, point_id, party_id, label, created_at, expires_at) VALUES ($1,$2,'table_ready',$3,$4,$5,$6,$7)`,
      [alertId, input.merchant, door, party.id, r.showName ? firstName(party.name) : `Table ${table.number}`, now, plus(now, TABLE_READY_SECONDS)],
    );
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'waitlist.seated', ref: { type: 'table', id: table.id }, detail: { partyId: party.id, text: r.text } });
    return { again: false as const, party, table, alertId };
  });
  if (!outcome.again && r.text && outcome.party.phone) {
    const ok = await texter.send({ to: outcome.party.phone, message: tableReadyText(outcome.table!) }).catch(() => false);
    if (ok) await db.query('UPDATE merchant.alerts SET texted_to = $2 WHERE id = $1', [outcome.alertId, lastFour(outcome.party.phone)]);
    await notifyMember(db, texter, { merchant: input.merchant, party: outcome.party, table: outcome.table, alertId: outcome.alertId! });
  }
  touchShop(input.merchant);
  return { party: await partyView(db, input.merchant, input.partyId), table: await getTable(db, input.merchant, r.tableId, now) };
}

/** Text: almost ready (section 8c). Only with their number, their consent and the shop's texts on. */
export async function notifyParty(db: Db, texter: Texter, input: { merchant: string; staffId: string; partyId: string; now?: Date }): Promise<WaitlistParty> {
  const now = input.now ?? new Date();
  const party = await partyRow(db, input.merchant, input.partyId);
  if (party.state !== 'waiting' && party.state !== 'notified') throw new TerminalError('They’re not waiting', 'conflict');
  if (!party.phone || !party.text_consent) throw new TerminalError('They didn’t leave a number to text', 'invalid');
  if (!(await getSettings(db, input.merchant)).textWaitlist) throw new TerminalError(TEXTS_OFF, 'conflict');
  const ok = await texter.send({ to: party.phone, message: waitlistAlmostText(await shopName(db, input.merchant)) }).catch(() => false);
  if (!ok) throw new TerminalError('The text didn’t go. Try again', 'conflict');
  await db.query(`UPDATE merchant.waitlist_parties SET state = 'notified', notified_at = $2 WHERE id = $1`, [party.id, now]);
  await audit(db, { merchant: input.merchant, actor: input.staffId, action: 'waitlist.notified', ref: { type: 'waitlist_party', id: party.id } });
  touchShop(input.merchant);
  return partyView(db, input.merchant, party.id);
}

/** No show (section 8c): off the list, kept for the day's figures. */
export async function noShowParty(db: Db, input: { merchant: string; staffId: string; partyId: string; now?: Date }): Promise<WaitlistParty> {
  const party = await partyRow(db, input.merchant, input.partyId);
  if (party.state === 'seated') throw new TerminalError('They’re seated', 'conflict');
  if (party.state === 'waiting' || party.state === 'notified') {
    await db.query(`UPDATE merchant.waitlist_parties SET state = 'no_show', left_at = $2 WHERE id = $1`, [party.id, input.now ?? new Date()]);
    await audit(db, { merchant: input.merchant, actor: input.staffId, action: 'waitlist.no_show', ref: { type: 'waitlist_party', id: party.id } });
    touchShop(input.merchant);
  }
  return partyView(db, input.merchant, party.id);
}

/** Table ready in the Clear app too, for a party whose number is a member's. Best effort, like the text. */
async function notifyMember(db: Db, texter: Texter, input: { merchant: string; party: PartyRow; table: { number: number; label: string | null; area: string | null } | null; alertId: string }) {
  if (!texter.notifyMember || !input.party.phone) return;
  const { rows } = await db.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
  await texter
    .notifyMember({ phone: input.party.phone, wallet: input.party.member_wallet, ...tableReadyNotice(rows[0]?.name ?? '', input.table), dedupeKey: `table_ready:${input.alertId}` })
    .catch(() => false);
}

// ---- Alerts ---------------------------------------------------------------------------------------------

interface AlertRow {
  id: string;
  kind: Alert['kind'];
  point_id: string | null;
  party_id: string | null;
  order_id: string | null;
  label: string;
  texted_to: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  cleared_at: Date | string | null;
}

const toAlert = (r: AlertRow): Alert => ({
  id: r.id,
  kind: r.kind,
  pointId: r.point_id,
  partyId: r.party_id,
  orderId: r.order_id,
  label: r.label,
  textedTo: r.texted_to,
  createdAt: iso(r.created_at),
  expiresAt: iso(r.expires_at),
  clearedAt: isoOrNull(r.cleared_at),
});

/** Table ready or Order ready: on a Point (the door's, the counter's, unless one is named), and a text if there's a number. */
export async function createAlert(db: Db, texter: Texter, input: { merchant: string; staffId: string; request: unknown; now?: Date }): Promise<Alert> {
  const parsed = CreateAlert.safeParse(input.request);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'Table ready or Order ready'), 'invalid');
  const a = parsed.data;
  const now = input.now ?? new Date();
  let phone: string | null = null;
  let message = '';
  // Set inside the transaction; `as` so the null it starts with isn't all the compiler sees.
  let member = null as { party: PartyRow; table: { number: number; label: string | null; area: string | null } | null } | null;
  const id = `alr_${randomUUID()}`;
  await db.transaction(async (tx) => {
    if (a.pointId) {
      const { rows } = await tx.query(`SELECT 1 FROM merchant.hardware WHERE id = $1 AND merchant = $2 AND kind = 'point' AND removed_at IS NULL`, [a.pointId, input.merchant]);
      if (!rows[0]) throw new TerminalError('No such Point', 'not_found');
    }
    if (a.kind === 'table_ready') {
      const party = await partyRow(tx, input.merchant, a.partyId, true);
      const point = a.pointId ?? (await pointAt(tx, input.merchant, 'door'));
      await tx.query(`UPDATE merchant.waitlist_parties SET state = CASE WHEN state = 'waiting' THEN 'notified' ELSE state END, ready_at = $2 WHERE id = $1`, [party.id, now]);
      await tx.query(`INSERT INTO merchant.alerts (id, merchant, kind, point_id, party_id, label, created_at, expires_at) VALUES ($1,$2,'table_ready',$3,$4,$5,$6,$7)`, [
        id,
        input.merchant,
        point,
        party.id,
        firstName(party.name),
        now,
        plus(now, TABLE_READY_SECONDS),
      ]);
      if (party.phone && party.text_consent) {
        phone = party.phone;
        const { rows: t } = party.table_id
          ? await tx.query<{ number: number; label: string | null; area: string | null }>('SELECT number, label, area FROM merchant.tables WHERE id = $1', [party.table_id])
          : { rows: [] };
        message = t[0] ? tableReadyText(t[0]) : 'Your table is ready';
        member = { party, table: t[0] ?? null };
      }
    } else {
      const { rows } = await tx.query<{ status: string; number: number | null; name: string | null; customer: string | null }>(
        'SELECT status, number, name, customer FROM commerce.orders WHERE id = $1 AND merchant = $2 FOR UPDATE',
        [a.orderId, input.merchant],
      );
      const o = rows[0];
      if (!o) throw new TerminalError('No such order', 'not_found');
      if (!PAID.includes(o.status)) throw new TerminalError('Call it once it’s paid', 'conflict');
      const point = a.pointId ?? (await pointAt(tx, input.merchant, 'counter'));
      const label = o.number !== null ? String(o.number) : (o.name ?? 'Your order');
      await tx.query('UPDATE commerce.orders SET called_at = $2 WHERE id = $1', [a.orderId, now]);
      await tx.query(`INSERT INTO merchant.alerts (id, merchant, kind, point_id, order_id, label, created_at, expires_at) VALUES ($1,$2,'order_ready',$3,$4,$5,$6,$7)`, [
        id,
        input.merchant,
        point,
        a.orderId,
        label,
        now,
        plus(now, ORDER_READY_SECONDS),
      ]);
      const asPhone = o.customer ? phoneE164(o.customer) : null;
      if (asPhone) {
        phone = asPhone;
        const { rows: shop } = await tx.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
        message = orderReadyText(shop[0]?.name ?? '', label);
      }
    }
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: `alert.${a.kind}`, ref: { type: 'alert', id } });
  });
  if (phone) {
    const ok = await texter.send({ to: phone, message }).catch(() => false);
    if (ok) await db.query('UPDATE merchant.alerts SET texted_to = $2 WHERE id = $1', [id, lastFour(phone)]);
  }
  if (member) await notifyMember(db, texter, { merchant: input.merchant, ...member, alertId: id });
  touchShop(input.merchant);
  const { rows } = await db.query<AlertRow>('SELECT * FROM merchant.alerts WHERE id = $1', [id]);
  return toAlert(rows[0]!);
}

export async function clearAlert(db: Db, input: { merchant: string; alertId: string; now?: Date }): Promise<Alert> {
  const { rows } = await db.query<AlertRow>('UPDATE merchant.alerts SET cleared_at = COALESCE(cleared_at, $3) WHERE id = $1 AND merchant = $2 RETURNING *', [
    input.alertId,
    input.merchant,
    input.now ?? new Date(),
  ]);
  if (!rows[0]) throw new TerminalError('No such alert', 'not_found');
  touchShop(input.merchant);
  return toAlert(rows[0]);
}

// ---- Order ready ---------------------------------------------------------------------------------------------

/** Home's Order ready cell: today's paid counter orders, the newest first. */
export async function pickups(q: Queryable, merchant: string, now = new Date()): Promise<PickupOrder[]> {
  const { rows: shop } = await q.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [merchant]);
  const day = businessDate(shop[0]?.timezone ?? 'America/Los_Angeles', now);
  const { rows } = await q.query<{
    id: string;
    number: number | null;
    name: string | null;
    service_type: PickupOrder['serviceType'];
    called_at: Date | string | null;
    picked_up_at: Date | string | null;
    paid_at: Date | string | null;
    items: string | number | null;
  }>(
    `SELECT o.id, o.number, o.name, o.service_type, o.called_at, o.picked_up_at,
            (SELECT max(t.updated_at) FROM payments.tenders t WHERE t.order_id = o.id AND t.status IN ('approved','authorised','captured','partly_refunded','refunded')) AS paid_at,
            (SELECT sum(l.quantity) FROM commerce.order_lines l WHERE l.order_id = o.id AND l.removed_at IS NULL) AS items
       FROM commerce.orders o
      WHERE o.merchant = $1 AND o.business_date = $2 AND o.table_id IS NULL AND o.status IN ('paid','partly_refunded')
      ORDER BY o.created_at DESC LIMIT 30`,
    [merchant, day],
  );
  return rows
    .filter((r) => r.paid_at)
    .map((r) => ({
      orderId: r.id,
      number: r.number,
      name: r.name,
      paidAt: iso(r.paid_at!),
      itemCount: Number(r.items ?? 0),
      serviceType: r.service_type,
      calledAt: isoOrNull(r.called_at),
      pickedUpAt: isoOrNull(r.picked_up_at),
    }));
}

/** Picked up: its Order ready clears. */
export async function markPickedUp(db: Db, input: { merchant: string; staffId: string; orderId: string; now?: Date }): Promise<PickupOrder> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const { rows } = await tx.query('UPDATE commerce.orders SET picked_up_at = COALESCE(picked_up_at, $3) WHERE id = $1 AND merchant = $2 RETURNING id', [input.orderId, input.merchant, now]);
    if (!rows[0]) throw new TerminalError('No such order', 'not_found');
    await tx.query('UPDATE merchant.alerts SET cleared_at = $2 WHERE order_id = $1 AND cleared_at IS NULL', [input.orderId, now]);
  });
  touchShop(input.merchant);
  const found = (await pickups(db, input.merchant, now)).find((p) => p.orderId === input.orderId);
  if (!found) throw new TerminalError('That order isn’t one to pick up', 'not_found');
  return found;
}

// ---- Call and Bill (the Pay case) ---------------------------------------------------------------------------

/** Calls and bills: open ones, and the last hour's. */
export async function tableRequests(q: Queryable, merchant: string, now = new Date()): Promise<TableRequest[]> {
  const { rows } = await q.query<RequestRow>(
    `SELECT * FROM merchant.table_requests WHERE merchant = $1 AND ((state = 'open' AND expires_at > $2) OR at > $2::timestamptz - interval '1 hour') ORDER BY at DESC`,
    [merchant, now],
  );
  return rows.map(toRequest);
}

/** On my way: the request closes, the ring goes off, the Point goes back to what it showed. */
export async function answerTableRequest(db: Db, input: { merchant: string; staffId: string; requestId: string; now?: Date }): Promise<TableRequest> {
  const { rows } = await db.query<RequestRow>(
    `UPDATE merchant.table_requests SET state = CASE WHEN state = 'open' THEN 'answered' ELSE state END,
            answered_by = COALESCE(answered_by, $3), answered_at = COALESCE(answered_at, $4)
      WHERE id = $1 AND merchant = $2 RETURNING *`,
    [input.requestId, input.merchant, input.staffId, input.now ?? new Date()],
  );
  if (!rows[0]) throw new TerminalError('No such request', 'not_found');
  touchShop(input.merchant);
  return toRequest(rows[0]);
}

/**
 * A Pay case button, from the Point. Call opens a request (a repeat within a few seconds is the same
 * press; a later one cancels, as the screen says). Bill sends the tab's bill when the Point is set to
 * and there is one with items; otherwise it tells staff. Presses over two minutes old are dropped.
 */
export async function pointButton(db: Db, input: { point: PointIdentity; event: unknown; now?: Date }): Promise<TableRequest | null> {
  const parsed = PointEvent.safeParse(input.event);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'That event isn’t valid'), 'invalid');
  const e = parsed.data;
  const now = input.now ?? new Date();
  const pressedAt = new Date(Math.min(Date.parse(e.at), now.getTime()));
  if (now.getTime() - pressedAt.getTime() > STALE_PRESS_MS) return null;
  const merchant = input.point.merchant;
  const { point } = await pointStateFor(db, input.point.deviceId, now);
  const settings: PointSettings = point.settings;
  if (!settings.tableId) return null;
  if (e.button === 'call' && !settings.buttons.call) return null;
  const kind = e.button;

  const { rows: open } = await db.query<RequestRow>(
    `SELECT * FROM merchant.table_requests WHERE table_id = $1 AND kind = $2 AND state = 'open' AND expires_at > $3`,
    [settings.tableId, kind, now],
  );
  if (open[0]) {
    if (kind === 'call' && pressedAt.getTime() - new Date(open[0].at).getTime() > REPEAT_PRESS_MS) {
      const { rows } = await db.query<RequestRow>(`UPDATE merchant.table_requests SET state = 'answered', answered_at = $2 WHERE id = $1 RETURNING *`, [open[0].id, now]);
      touchShop(merchant);
      return toRequest(rows[0]!);
    }
    return toRequest(open[0]);
  }

  if (kind === 'bill' && settings.buttons.bill === 'send_bill') {
    const { rows: tab } = await db.query<{ tab_order_id: string | null; status: string | null; total_cents: string | number | null; lines: string | number }>(
      `SELECT t.tab_order_id, o.status, o.total_cents,
              (SELECT count(*) FROM commerce.order_lines l WHERE l.order_id = t.tab_order_id AND l.removed_at IS NULL) AS lines
         FROM merchant.tables t LEFT JOIN commerce.orders o ON o.id = t.tab_order_id WHERE t.id = $1`,
      [settings.tableId],
    );
    const t = tab[0];
    if (t?.tab_order_id && (t.status === 'open' || t.status === 'paying') && Number(t.lines) > 0) {
      const id = `treq_${randomUUID()}`;
      await db.query(
        `INSERT INTO merchant.table_requests (id, merchant, table_id, point_id, kind, at, state, answered_at, bill_cents, expires_at)
         VALUES ($1,$2,$3,$4,'bill',$5,'bill_sent',$6,$7,$8)`,
        [id, merchant, settings.tableId, input.point.deviceId, pressedAt, now, Number(t.total_cents ?? 0), plus(now, TABLE_REQUEST_SECONDS)],
      );
      // The same path as staff sending it: the bill shows, any hold clears.
      const { rows: raiser } = await db.query<{ raised_by: string }>('SELECT raised_by FROM commerce.orders WHERE id = $1', [t.tab_order_id]);
      await showOnPoint(db, { merchant, staffId: raiser[0]!.raised_by, pointId: input.point.deviceId, request: { kind: 'order', orderId: t.tab_order_id }, now });
      const { rows } = await db.query<RequestRow>('SELECT * FROM merchant.table_requests WHERE id = $1', [id]);
      return toRequest(rows[0]!);
    }
  }

  const id = `treq_${randomUUID()}`;
  const { rows } = await db.query<RequestRow>(
    `INSERT INTO merchant.table_requests (id, merchant, table_id, point_id, kind, at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (table_id, kind) WHERE state = 'open' DO NOTHING RETURNING *`,
    [id, merchant, settings.tableId, input.point.deviceId, kind, pressedAt, plus(now, TABLE_REQUEST_SECONDS)],
  );
  touchShop(merchant);
  if (rows[0]) return toRequest(rows[0]);
  // Another press won the race: that one is the request.
  const { rows: won } = await db.query<RequestRow>(`SELECT * FROM merchant.table_requests WHERE table_id = $1 AND kind = $2 AND state = 'open'`, [settings.tableId, kind]);
  return won[0] ? toRequest(won[0]) : null;
}

// ---- What lapses by itself --------------------------------------------------------------------------------------

/**
 * The jobs' sweep: holds past their time or whose tab has its first item are cleared from their
 * tables, lapsed Calls and Bills are closed, and each shop touched so its Points redraw.
 */
export async function sweepLapsed(db: Db, now = new Date()): Promise<number> {
  const { rows: holds } = await db.query<{ merchant: string }>(
    `UPDATE merchant.tables t SET seated_at = COALESCE(t.seated_at, t.hold_seated_at), hold_party_id = NULL, hold_show_name = NULL, hold_seated_at = NULL, hold_expires_at = NULL
      WHERE t.hold_party_id IS NOT NULL AND (t.hold_expires_at <= $1 OR EXISTS (
        SELECT 1 FROM commerce.order_lines l WHERE l.order_id = t.tab_order_id AND l.removed_at IS NULL))
      RETURNING t.merchant`,
    [now],
  );
  const { rows: reqs } = await db.query<{ merchant: string }>(`UPDATE merchant.table_requests SET state = 'answered' WHERE state = 'open' AND expires_at <= $1 RETURNING merchant`, [now]);
  const cleared = await clearPaidTables(db, now);
  const shops = new Set([...holds, ...reqs].map((r) => r.merchant));
  for (const m of shops) touchShop(m);
  return holds.length + reqs.length + cleared;
}

/**
 * Settings › Counter › Clear paid tables: a paid table clears itself this many minutes after it was
 * paid ("Clears itself in 8 minutes"). Shops that clear by hand are left alone.
 */
async function clearPaidTables(db: Db, now: Date): Promise<number> {
  const { rows } = await db.query<{ id: string; merchant: string; minutes: number; paid_at: Date | string }>(
    `SELECT t.id, t.merchant, COALESCE(s.clear_paid_after_minutes, 10) AS minutes, max(tn.updated_at) AS paid_at
       FROM merchant.tables t
       JOIN commerce.orders o ON o.id = t.tab_order_id AND o.status IN ('paid','refunded','partly_refunded')
       JOIN payments.tenders tn ON tn.order_id = o.id AND tn.status IN ('approved','authorised','captured','partly_refunded','refunded')
       LEFT JOIN merchant.shop_settings s ON s.merchant = t.merchant
      WHERE t.removed_at IS NULL AND (s.merchant IS NULL OR s.clear_paid_after_minutes IS NOT NULL)
      GROUP BY t.id, t.merchant, s.clear_paid_after_minutes`,
  );
  let n = 0;
  for (const r of rows) {
    if (new Date(r.paid_at).getTime() + Number(r.minutes) * 60_000 > now.getTime()) continue;
    await clearTable(db, { merchant: r.merchant, staffId: null, tableId: r.id, now }).catch(() => undefined);
    n += 1;
  }
  return n;
}
