import {
  POINT_PAID_SECONDS,
  PublicPoint,
  ShowOnPoint,
  pointLit,
  pointShowing,
  type PointIdleMode,
  type PointScreen,
  type PointSettings,
  type PointState,
  type PublicBill,
  type PublicMenu,
} from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { cardAvailability } from '../cards/availability.js';
import { connectorStore } from '../cards/connectorStore.js';
import { buildReceipt, ensureReceiptCode } from '../orders/receipts.js';
import { getSettings } from '../shop/shopService.js';
import { touchShop } from './bus.js';
import { TerminalError } from './errors.js';

/**
 * What a Point shows, worked out in one place (`pointStateFor`) so the Point, the phone page and the
 * tablet can't disagree. The last thing sent to it is a row in `merchant.point_states`; holds, Call
 * and Bill, and alerts come from their own tables; `pointShowing` (the contracts) decides which shows.
 * Times are worked out when asked, so nothing has to run for a paid bill or a hold to lapse.
 */

type Kind<K extends PointState['kind']> = Extract<PointState, { kind: K }>;

/** The test screen goes back by itself after a minute. */
const TEST_SECONDS = 60;
/** Where the Point and the phone page send people: what the Point prints under its code. */
export const publicHost = () => (process.env.POINT_PUBLIC_HOST || 'useclear.org').replace(/^https?:\/\//, '').replace(/\/+$/, '');

const iso = (d: Date | string) => new Date(d).toISOString();
const plus = (d: Date | string, s: number) => new Date(new Date(d).getTime() + s * 1000).toISOString();
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name.trim();

interface PointRow {
  id: string;
  merchant: string;
  name: string;
  settings: PointSettings | string;
  removed_at: Date | string | null;
}

export interface PointContext {
  point: { id: string; merchant: string; name: string; settings: PointSettings };
  state: PointState;
  /** When what it shows changes by itself next (a paid bill lapsing, a hold or alert expiring). */
  nextChangeAt: Date | null;
}

const PAID = ['paid', 'refunded', 'partly_refunded'];

/** The one answer: what this Point shows at `now`. */
export async function pointStateFor(q: Queryable, pointId: string, now = new Date()): Promise<PointContext> {
  const { rows } = await q.query<PointRow>(`SELECT id, merchant, name, settings, removed_at FROM merchant.hardware WHERE id = $1 AND kind = 'point'`, [pointId]);
  const row = rows[0];
  if (!row) throw new TerminalError('No such Point', 'not_found');
  const settings = typeof row.settings === 'string' ? (JSON.parse(row.settings) as PointSettings) : row.settings;
  const t = now.getTime();
  const changes: number[] = [];
  const at = (iso: string) => {
    const ms = Date.parse(iso);
    if (ms > t) changes.push(ms);
    return iso;
  };

  // What was last sent.
  const { rows: sent } = await q.query<{ kind: 'idle' | 'bill' | 'paid' | 'test'; order_id: string | null; since: Date | string }>(
    'SELECT kind, order_id, since FROM merchant.point_states WHERE device_id = $1',
    [pointId],
  );
  let base: Kind<'idle'> | Kind<'bill'> | Kind<'paid'> | Kind<'test'> = { kind: 'idle', mode: settings.idleMode };
  const s = sent[0];
  if (s?.kind === 'test' && t - new Date(s.since).getTime() < TEST_SECONDS * 1000) {
    base = { kind: 'test', since: iso(s.since) };
    at(plus(s.since, TEST_SECONDS));
  } else if ((s?.kind === 'bill' || s?.kind === 'paid') && s.order_id) {
    const { rows: o } = await q.query<{ status: string }>('SELECT status FROM commerce.orders WHERE id = $1', [s.order_id]);
    const status = o[0]?.status;
    if (status && PAID.includes(status)) {
      // Paid since the last tender that took money; the bill turns to Paid by itself.
      const { rows: p } = await q.query<{ at: Date | string | null }>(
        `SELECT max(updated_at) AS at FROM payments.tenders WHERE order_id = $1 AND status IN ('approved','authorised','captured','partly_refunded','refunded')`,
        [s.order_id],
      );
      const since = iso(p[0]?.at ?? s.since);
      base = { kind: 'paid', orderId: s.order_id, since };
      at(plus(since, POINT_PAID_SECONDS));
    } else if (status === 'open' || status === 'paying') {
      base = { kind: 'bill', orderId: s.order_id, since: iso(s.since) };
    }
  }

  // Held for a party: until the first item lands on the tab, staff seat them, or it lapses.
  let hold: Kind<'held'> | null = null;
  if (settings.tableId) {
    const { rows: tb } = await q.query<{
      hold_party_id: string | null;
      hold_show_name: boolean | null;
      hold_seated_at: Date | string | null;
      hold_expires_at: Date | string | null;
      tab_order_id: string | null;
      name: string | null;
      size: number | null;
      lines: string | number;
    }>(
      `SELECT t.hold_party_id, t.hold_show_name, t.hold_seated_at, t.hold_expires_at, t.tab_order_id, p.name, p.size,
              (SELECT count(*) FROM commerce.order_lines l WHERE l.order_id = t.tab_order_id AND l.removed_at IS NULL) AS lines
         FROM merchant.tables t LEFT JOIN merchant.waitlist_parties p ON p.id = t.hold_party_id
        WHERE t.id = $1 AND t.removed_at IS NULL`,
      [settings.tableId],
    );
    const h = tb[0];
    if (h?.hold_party_id && h.hold_expires_at && h.hold_seated_at && Number(h.lines) === 0) {
      hold = {
        kind: 'held',
        tableId: settings.tableId,
        partyName: h.hold_show_name && h.name ? firstName(h.name) : null,
        partySize: h.size ?? 1,
        seatedAt: iso(h.hold_seated_at),
        expiresAt: at(iso(h.hold_expires_at)),
      };
    }
  }

  // Call or Bill, open and not lapsed.
  const { rows: req } = await q.query<{ id: string; kind: 'call' | 'bill'; at: Date | string; expires_at: Date | string }>(
    `SELECT id, kind, at, expires_at FROM merchant.table_requests WHERE point_id = $1 AND state = 'open' AND expires_at > $2 ORDER BY at DESC LIMIT 1`,
    [pointId, now],
  );
  const request: Kind<'called'> | Kind<'bill_asked'> | null = req[0]
    ? { kind: req[0].kind === 'call' ? 'called' : 'bill_asked', requestId: req[0].id, since: iso(req[0].at), expiresAt: at(iso(req[0].expires_at)) }
    : null;

  // An alert on it, the newest live one.
  const { rows: al } = await q.query<{ id: string; created_at: Date | string; expires_at: Date | string }>(
    `SELECT id, created_at, expires_at FROM merchant.alerts WHERE point_id = $1 AND cleared_at IS NULL AND expires_at > $2 ORDER BY created_at DESC LIMIT 1`,
    [pointId, now],
  );
  const alert: Kind<'alert'> | null = al[0] ? { kind: 'alert', alertId: al[0].id, since: iso(al[0].created_at), expiresAt: at(iso(al[0].expires_at)) } : null;

  const state = pointShowing({ base, hold, request, alert, idleMode: settings.idleMode }, now);
  return {
    point: { id: row.id, merchant: row.merchant, name: row.name, settings },
    state,
    nextChangeAt: changes.length ? new Date(Math.min(...changes)) : null,
  };
}

// ---- Sending to a Point ----------------------------------------------------------------------------------

/**
 * Put an order, an alert or the test screen on a Point, or clear it. A bill sent to a table clears
 * the table's hold first, and answers its open Bill request.
 */
export async function showOnPoint(db: Db, input: { merchant: string; staffId: string; pointId: string; request: unknown; now?: Date }): Promise<PointContext> {
  const parsed = ShowOnPoint.safeParse(input.request);
  if (!parsed.success) throw new TerminalError(parsed.error.issues[0]?.message ?? 'Send an order, an alert, the test screen, or clear', 'invalid');
  const now = input.now ?? new Date();
  const ctx = await pointStateFor(db, input.pointId, now);
  if (ctx.point.merchant !== input.merchant) throw new TerminalError('No such Point', 'not_found');
  const show = parsed.data;
  await db.transaction(async (tx) => {
    if (show.kind === 'order') {
      const { rows } = await tx.query<{ status: string; total_cents: string | number; table_id: string | null }>(
        'SELECT status, total_cents, table_id FROM commerce.orders WHERE id = $1 AND merchant = $2 FOR UPDATE',
        [show.orderId, input.merchant],
      );
      const o = rows[0];
      if (!o) throw new TerminalError('No such order', 'not_found');
      if (o.status !== 'open' && o.status !== 'paying') throw new TerminalError('That order is already settled', 'conflict');
      await setBase(tx, input.pointId, 'bill', show.orderId, now);
      await tx.query('UPDATE commerce.orders SET bill_sent_at = $2 WHERE id = $1', [show.orderId, now]);
      const tableId = o.table_id ?? ctx.point.settings.tableId;
      if (tableId) {
        await tx.query('UPDATE merchant.tables SET hold_party_id = NULL, hold_show_name = NULL, hold_seated_at = NULL, hold_expires_at = NULL WHERE id = $1', [tableId]);
        await tx.query(
          `UPDATE merchant.table_requests SET state = 'bill_sent', answered_by = $2, answered_at = $3, bill_cents = $4 WHERE table_id = $1 AND kind = 'bill' AND state = 'open'`,
          [tableId, input.staffId, now, Number(o.total_cents)],
        );
      }
    } else if (show.kind === 'alert') {
      const { rows } = await tx.query('UPDATE merchant.alerts SET point_id = $2 WHERE id = $1 AND merchant = $3 AND cleared_at IS NULL RETURNING id', [show.alertId, input.pointId, input.merchant]);
      if (!rows[0]) throw new TerminalError('No such alert', 'not_found');
    } else if (show.kind === 'test') {
      await setBase(tx, input.pointId, 'test', null, now);
    } else {
      // Take the bill back (section 8b): a bill still unpaid is no longer out, so its table is
      // Ordered again. A paid one stays paid.
      const { rows } = await tx.query<{ kind: string; order_id: string | null }>('SELECT kind, order_id FROM merchant.point_states WHERE device_id = $1', [input.pointId]);
      if (rows[0]?.kind === 'bill' && rows[0].order_id) {
        await tx.query(`UPDATE commerce.orders SET bill_sent_at = NULL WHERE id = $1 AND status IN ('open','paying')`, [rows[0].order_id]);
      }
      await setBase(tx, input.pointId, 'idle', null, now);
    }
  });
  touchShop(input.merchant);
  return pointStateFor(db, input.pointId, now);
}

export async function setBase(tx: Queryable, pointId: string, kind: 'idle' | 'bill' | 'paid' | 'test', orderId: string | null, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO merchant.point_states (device_id, kind, order_id, since) VALUES ($1,$2,$3,$4)
     ON CONFLICT (device_id) DO UPDATE SET kind = EXCLUDED.kind, order_id = EXCLUDED.order_id, since = EXCLUDED.since`,
    [pointId, kind, orderId, now],
  );
}

// ---- The menu --------------------------------------------------------------------------------------------

/** What phones and Points show: items on the menu, in the shop's category order, then A–Z. */
export async function menuFor(q: Queryable, merchant: string, only?: string[]): Promise<PublicMenu> {
  const { rows } = await q.query<{ id: string; name: string; detail: string | null; category: string; price_cents: string | number }>(
    `SELECT id, name, detail, category, price_cents FROM commerce.catalog_items
      WHERE merchant = $1 AND archived_at IS NULL AND on_menu ORDER BY name`,
    [merchant],
  );
  const { rows: ord } = await q.query<{ names: string[] }>('SELECT names FROM commerce.category_order WHERE merchant = $1', [merchant]);
  const order = ord[0]?.names ?? [];
  const byCat = new Map<string, PublicMenu['categories'][number]['items']>();
  for (const r of rows) {
    if (only && !only.includes(r.category)) continue;
    const list = byCat.get(r.category) ?? [];
    list.push({ id: r.id, name: r.name, detail: r.detail, priceCents: Number(r.price_cents) });
    byCat.set(r.category, list);
  }
  const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
  const cats = [...byCat.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { categories: cats.map((name) => ({ name, items: byCat.get(name)! })) };
}

/** "A random few from those groups, every few minutes": the same few for three minutes at a time. */
function mixed(menu: PublicMenu, now: Date): PublicMenu {
  let seed = Math.floor(now.getTime() / 180_000);
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const all = menu.categories.flatMap((c) => c.items.map((i) => ({ c: c.name, i })));
  const picked = all.sort(() => rand() - 0.5).slice(0, 4);
  const cats = [...new Set(picked.map((p) => p.c))];
  return { categories: cats.map((name) => ({ name, items: picked.filter((p) => p.c === name).map((p) => p.i) })) };
}

/** "Menu at lunch, Pay here after 9pm" (DECISIONS: by time of day). */
function timeOfDayMode(mode: PointIdleMode, byTimeOfDay: boolean, now: Date, timezone: string): PointIdleMode {
  if (!byTimeOfDay) return mode;
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hour >= 21 || hour < 5 ? 'pay' : 'menu';
}

// ---- The screen and the phone page ---------------------------------------------------------------------------

async function waitQuote(q: Queryable, merchant: string): Promise<number> {
  const { rows } = await q.query<{ n: string | number }>(`SELECT count(*) AS n FROM merchant.waitlist_parties WHERE merchant = $1 AND state = 'waiting'`, [merchant]);
  return Number(rows[0]?.n ?? 0) * 5;
}

async function billFor(q: Queryable, orderId: string, sentAt: string): Promise<PublicBill> {
  const { rows: o } = await q.query<{ number: number | null; discount_cents: string | number; tax_cents: string | number; tip_cents: string | number; total_cents: string | number }>(
    'SELECT number, discount_cents, tax_cents, tip_cents, total_cents FROM commerce.orders WHERE id = $1',
    [orderId],
  );
  const { rows: lines } = await q.query<{ name: string; quantity: number; line_cents: string | number }>(
    'SELECT name, quantity, line_cents FROM commerce.order_lines WHERE order_id = $1 AND removed_at IS NULL ORDER BY position, id',
    [orderId],
  );
  const { rows: paid } = await q.query<{ cents: string | number | null }>(
    `SELECT sum(amount_cents) AS cents FROM payments.tenders WHERE order_id = $1 AND status IN ('approved','authorised','captured','partly_refunded','refunded')`,
    [orderId],
  );
  const total = Number(o[0]!.total_cents);
  return {
    orderNumber: o[0]!.number,
    lines: lines.map((l) => ({ name: l.name, quantity: l.quantity, lineCents: Number(l.line_cents) })),
    discountCents: Number(o[0]!.discount_cents),
    taxCents: Number(o[0]!.tax_cents),
    tipCents: Number(o[0]!.tip_cents),
    totalCents: total,
    remainingCents: Math.max(0, total - Number(paid[0]?.cents ?? 0)),
    sentAt,
  };
}

/** Everything a Point draws (`GET /api/device/point/state`): the phone page's answer and the screen's own parts. */
export async function screenFor(q: Queryable, pointId: string, now = new Date()): Promise<{ screen: PointScreen; nextChangeAt: Date | null }> {
  const ctx = await pointStateFor(q, pointId, now);
  const { point, state } = ctx;
  const merchant = point.merchant;
  const { rows: shop } = await q.query<{ name: string; timezone: string }>('SELECT name, timezone FROM merchant.profiles WHERE merchant = $1', [merchant]);
  const { rows: code } = await q.query<{ code: string }>('SELECT code FROM merchant.point_keys WHERE device_id = $1', [pointId]);
  const { rows: table } = point.settings.tableId
    ? await q.query<{ number: number; label: string | null }>('SELECT number, label FROM merchant.tables WHERE id = $1', [point.settings.tableId])
    : { rows: [] as Array<{ number: number; label: string | null }> };
  const settings = await getSettings(q, merchant);
  const cards = cardAvailability(await connectorStore.latest(q, merchant)).available && settings.paymentMethods.card;
  const menu = await menuFor(q, merchant);
  const hasMenu = menu.categories.length > 0;

  let view: PointScreen['view'];
  let bill: PublicBill | null = null;
  let paid: PointScreen['paid'] = null;
  if (state.kind === 'bill') {
    view = 'bill';
    bill = await billFor(q, state.orderId, state.since);
  } else if (state.kind === 'paid') {
    view = 'paid';
    paid = { paidAt: state.since, receipt: await buildReceipt(q, merchant, state.orderId) };
  } else if (point.settings.placement === 'door') {
    view = 'waitlist';
  } else {
    const mode = timeOfDayMode(point.settings.idleMode, point.settings.byTimeOfDay, now, shop[0]?.timezone ?? 'America/Los_Angeles');
    view = mode === 'pay' || !hasMenu ? 'pay_here' : 'menu';
  }

  let alert: PointScreen['alert'] = null;
  if (state.kind === 'alert') {
    const { rows } = await q.query<{ kind: 'table_ready' | 'order_ready'; label: string }>('SELECT kind, label FROM merchant.alerts WHERE id = $1', [state.alertId]);
    if (rows[0]) alert = rows[0];
  }
  const showcase = state.kind === 'idle' && point.settings.idleMode === 'showcase' ? await menuFor(q, merchant, point.settings.showcaseCategories) : null;

  const t = table[0];
  // A shop with an app: where a rewards app opens this bill (rewards DECISIONS, Phase 4).
  const { rows: app } = await q.query<{ slug: string }>('SELECT slug FROM rewards.shop_apps WHERE merchant = $1 AND enabled', [merchant]);
  const screen: PointScreen = {
    code: code[0]!.code,
    shop: app[0] ? { name: shop[0]?.name ?? '', slug: app[0].slug } : { name: shop[0]?.name ?? '' },
    table: t ? (t.label ?? `Table ${t.number}`) : null,
    placement: point.settings.placement,
    view,
    bill,
    paid,
    waitlist: view === 'waitlist' ? { quotedMinutes: await waitQuote(q, merchant) } : null,
    pay: { clear: true, card: cards },
    state,
    lit: pointLit(state),
    tableNumber: t?.number ?? null,
    alert,
    showcase: showcase && point.settings.mixUp ? mixed(showcase, now) : showcase,
    url: `${publicHost()}/p/${code[0]!.code}`,
    pollSeconds: 30,
  };
  return { screen, nextChangeAt: ctx.nextChangeAt };
}

/** The Point a code names, live and paired. */
export async function pointByCode(q: Queryable, code: string): Promise<{ deviceId: string; merchant: string } | null> {
  if (!/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{4}$/.test(code)) return null;
  const { rows } = await q.query<{ device_id: string; merchant: string }>(
    `SELECT k.device_id, h.merchant FROM merchant.point_keys k JOIN merchant.hardware h ON h.id = k.device_id WHERE k.code = $1 AND h.removed_at IS NULL`,
    [code.toUpperCase()],
  );
  return rows[0] ? { deviceId: rows[0].device_id, merchant: rows[0].merchant } : null;
}

/**
 * `GET /api/p/:code`: the phone page. Built from the Point's screen and passed through the public
 * schema, which keeps only what it names: the Point's state, and a held party's name with it, never
 * leave.
 */
export async function publicPoint(db: Db, code: string, now = new Date()) {
  const p = await pointByCode(db, code);
  if (!p) throw new TerminalError('No Point has that code', 'not_found');
  const { screen } = await screenFor(db, p.deviceId, now);
  // The paid page offers "Email me this receipt", which goes by the receipt's own code: make it now.
  if (screen.paid && !screen.paid.receipt.code && screen.state.kind === 'paid') {
    const made = await ensureReceiptCode(db, { merchant: p.merchant, orderId: screen.state.orderId, staffId: null });
    screen.paid.receipt.code = made;
  }
  return PublicPoint.parse(screen);
}

