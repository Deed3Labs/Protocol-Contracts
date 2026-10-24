import { DAY, SEED_TODAY } from '@clear/command-types';
import { z } from 'zod';
import type { Queryable } from '../../db/db.js';
import { PROPOSE, type Level, type Section } from './levels.js';
import { providerFor } from './sections.js';
import type { Person } from './store.js';
import { requestSync } from './feeds.js';

/*
 * Each section's own actions (docs/command-center-plan.md: the step after Phase 3).
 *
 * An action is one of three things:
 * - Command's own record (a scan, a board card, a filing's status): saved here, with an audit row.
 * - Something outside Command (pay, refund, sign on-chain, send for e-signature, message members):
 *   recorded in command.outbox and not carried out. Phases 4–7 connect the systems that do it.
 * - Either of those, when the action's own rule says so (money over $50, two of three signers, a
 *   batch of invites), first waits for a second person as a proposal, and runs when they approve.
 */

export interface Ctx {
  tx: Queryable;
  person: Person;
  /** The second person, when it ran from an approval. */
  approver: Person | null;
  /** When it happened: the prototype's day and time for a seeded section, else now. */
  at: Date;
}

export interface Action<B = any> {
  body: z.ZodType<B>;
  /** The level it takes to ask for it (Propose by default). */
  level?: Level;
  /** One line for the audit log and Needs you. */
  summary: (b: B, db: Queryable) => string | Promise<string>;
  /** Whether it waits for a second person. */
  second?: (b: B, db: Queryable) => boolean | Promise<boolean>;
  /** Command's own change. */
  apply?: (c: Ctx, b: B) => Promise<unknown>;
  /** Recorded for the outside system that carries it out. */
  outbox?: boolean | ((b: B) => boolean);
}

const id = z.string().trim().min(1).max(64);
const text = (max = 500) => z.string().trim().max(max);
const money = z.number().nonnegative().max(1_000_000);
const cents = (v: number) => Math.round(v * 100);
const one = async <T = any>(db: Queryable, sql: string, p: unknown[]) => (await db.query<T & Record<string, unknown>>(sql, p)).rows[0] as T | undefined;
const must = async <T = any>(db: Queryable, sql: string, p: unknown[], what: string) => {
  const r = await one<T>(db, sql, p);
  if (!r) throw new ActionError(404, 'NOT_FOUND', `No such ${what}`);
  return r;
};
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const hhmm = (d: Date) => d.toISOString().slice(11, 16);
/** How a person is written on a record: their name, as the audit log writes it. */
const who = (p: Person) => p.name || p.email || 'Someone';

export class ActionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** When a section's action happens: the prototype's 21 Oct, 14:00, while it reads seeded data. */
export const actionTime = (section: Section, now: Date) => (providerFor(section) === 'seed' ? new Date(SEED_TODAY + 14 * 3600e3) : now);

// ── Growth ──────────────────────────────────────────────────────────────────

const growth: Record<string, Action> = {
  'poster-replaced': {
    body: z.object({ n: z.number().int().positive() }),
    summary: (b) => `Replaced poster P-${String(b.n).padStart(3, '0')}`,
    apply: async ({ tx, at }, b) => {
      await must(tx, 'SELECT n FROM command.posters WHERE n = $1', [b.n], 'poster');
      await tx.query(`UPDATE command.posters SET status = 'up', hung_at = $2, checked_at = $2, swap_at = $3 WHERE n = $1`, [b.n, dayStart(at), new Date(dayStart(at).getTime() + 60 * DAY)]);
    },
  },
  'poster-add': {
    body: z.object({ place: text(120).min(1), city: text(80).min(1), design: z.string().regex(/^[A-Z]$/), hungOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    summary: (b) => `Added a poster at ${b.place}`,
    apply: async ({ tx, at }, b) => {
      await must(tx, 'SELECT code FROM command.poster_designs WHERE code = $1', [b.design], 'design');
      const hung = b.hungOn ? new Date(b.hungOn + 'T00:00:00Z') : dayStart(at);
      const { n } = (await one<{ n: number }>(tx, 'SELECT coalesce(max(n), 0) + 1 AS n FROM command.posters', []))!;
      const place = b.place.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'new';
      await tx.query(
        `INSERT INTO command.posters (n, place, place_id, city, board, design, scans_30d, hung_at, checked_at, swap_at, status) VALUES ($1, $2, $3, $4, false, $5, 0, $6, $6, $7, 'up')`,
        [n, b.place, place, b.city, b.design, hung, new Date(hung.getTime() + 60 * DAY)],
      );
      return { n };
    },
  },
  swap: { body: z.object({ shop: text(120).min(1), design: z.string().regex(/^[A-Z]$/).optional() }), summary: (b) => `Planned a poster swap at ${b.shop}`, outbox: true },
  nudge: { body: z.object({ who: z.enum(['opened', 'invited']).default('opened'), count: z.number().int().nonnegative() }), summary: (b) => `Nudge ${b.count} members to finish joining`, outbox: true },
  pace: { body: z.object({ perBatch: z.number().int().positive().max(500) }), summary: (b) => `Raise the invite pace to ${b.perBatch} a batch`, second: () => true, outbox: true },
};

// ── Field ───────────────────────────────────────────────────────────────────

const OUT = { checked: 'up', damaged: 'faded', replaced: 'up', missing: 'missing' } as const;
const field: Record<string, Action> = {
  scan: {
    body: z.object({ n: z.number().int().positive(), outcome: z.enum(['checked', 'damaged', 'replaced', 'missing']), note: text(500).default(''), photo: z.string().uuid().nullable().default(null) }),
    summary: (b) => `Logged P-${String(b.n).padStart(3, '0')} as ${b.outcome}`,
    apply: async ({ tx, at }, b) => {
      await must(tx, 'SELECT n FROM command.posters WHERE n = $1', [b.n], 'poster');
      const d = dayStart(at);
      if (b.outcome === 'replaced') await tx.query(`UPDATE command.posters SET status = 'up', checked_at = $2, hung_at = $2, swap_at = $3 WHERE n = $1`, [b.n, d, new Date(d.getTime() + 60 * DAY)]);
      else await tx.query('UPDATE command.posters SET status = $2, checked_at = $3 WHERE n = $1', [b.n, OUT[b.outcome as keyof typeof OUT], d]);
      // the day's route task for this poster, if it's on the route
      await tx.query(
        `UPDATE command.route_tasks SET done_at = $3, outcome = $4, note = nullif($5, ''), photo = $6, photo_file = $7 WHERE day = $1 AND poster = $2`,
        [d, b.n, hhmm(at), b.outcome[0].toUpperCase() + b.outcome.slice(1), b.note, !!b.photo, b.photo],
      );
    },
  },
  'task-done': {
    body: z.object({ stop: id, position: z.number().int().nonnegative() }),
    summary: () => 'Marked a route task fixed',
    apply: async ({ tx, at }, b) => {
      const r = await tx.query(`UPDATE command.route_tasks SET done_at = $4, outcome = 'Fixed' WHERE day = $1 AND stop_id = $2 AND position = $3 RETURNING 1`, [dayStart(at), b.stop, b.position, hhmm(at)]);
      if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', 'No such task on today’s route');
    },
  },
  skip: {
    body: z.object({ stop: id }),
    summary: () => 'Moved a stop to the end of the route',
    apply: async ({ tx, at }, b) => {
      const d = dayStart(at);
      const r = await tx.query('UPDATE command.route_stops SET position = (SELECT coalesce(max(position), 0) + 1 FROM command.route_stops WHERE day = $1) WHERE day = $1 AND id = $2 RETURNING 1', [d, b.stop]);
      if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', 'No such stop on today’s route');
    },
  },
  'add-later': {
    body: z.object({ shop: text(120).min(1) }),
    summary: (b) => `Added ${b.shop} to today’s route`,
    apply: async ({ tx, at }, b) => {
      const d = dayStart(at);
      await must(tx, 'SELECT day FROM command.routes WHERE day = $1', [d], 'route for today');
      const l = await must<any>(tx, 'DELETE FROM command.route_later WHERE id = (SELECT id FROM command.route_later WHERE shop = $1 ORDER BY id LIMIT 1) RETURNING *', [b.shop], 'shop due later');
      const poster = Number(/P-(\d+)/.exec(l.poster)?.[1]) || null;
      const sid = 'x' + l.id;
      await tx.query(
        `INSERT INTO command.route_stops (day, id, position, name, city, street, eta, closes, contact, last_visit)
         VALUES ($1, $2, (SELECT coalesce(max(position), 0) + 1 FROM command.route_stops WHERE day = $1), $3, $4, '', '', NULL, NULL, NULL)`,
        [d, sid, l.shop, l.city],
      );
      await tx.query(`INSERT INTO command.route_tasks (day, stop_id, position, kind, poster, title, note) VALUES ($1, $2, 0, 'poster', $3, $4, $5)`, [
        d,
        sid,
        poster,
        `${l.state === 'missing' ? 'Replace' : 'Swap'} ${l.poster}`,
        l.state === 'missing' ? 'Missing' : 'Faded',
      ]);
    },
  },
};

// ── Members ─────────────────────────────────────────────────────────────────

const member = z.object({ id: z.number().int().positive() });
const members: Record<string, Action> = {
  resend: { body: member, summary: () => 'Resend a member’s invite', outbox: true },
  nudge: { body: member, summary: () => 'Nudge a member to finish joining', outbox: true },
  off: { body: member.extend({ reason: text(200).default('') }), summary: () => 'Turn off a member’s access', outbox: true },
  batch: {
    body: z.object({ size: z.number().int().positive().max(500), order: text(40).default('longest') }),
    summary: (b) => `Send the next batch of ${b.size} invites`,
    second: () => true,
    outbox: true,
  },
};

// ── Merchants ───────────────────────────────────────────────────────────────

const STAGES = ['prospect', 'talking', 'signing', 'signed'] as const;
const contact = z.object({ name: text(80), role: text(80), phone: text(40), email: text(120) });
const card = z.object({
  id: id,
  name: text(120).min(1),
  kind: text(80).default(''),
  city: text(80).default(''),
  stage: z.enum(STAGES),
  owner: text(40).nullable().default(null),
  val: money.nullable().default(null),
  next: text(200).nullable().default(null),
  due: z.number().int().nullable().default(null),
  contact: contact.default({ name: '', role: '', phone: '', email: '' }),
  source: text(80).default(''),
  addr: text(200).default(''),
  note: text(2000).default(''),
  flag: z.boolean().default(false),
  /** Log lines added since it was last saved, oldest first. */
  log: z.array(z.object({ text: text(500).min(1), type: z.enum(['note', 'call', 'visit', 'demo', 'stage', 'edit']) })).max(50).default([]),
});
const merchants: Record<string, Action> = {
  'card-save': {
    body: card,
    summary: (b) => `Updated ${b.name} on the pipeline`,
    apply: async ({ tx, person, at }, b) => {
      const cur = await one<{ position: number }>(tx, 'SELECT position FROM command.merchant_stage WHERE id = $1 AND removed_at IS NULL', [b.id]);
      const pos = cur?.position ?? (await one<{ p: number }>(tx, 'SELECT coalesce(min(position), 0) - 1 AS p FROM command.merchant_stage', []))!.p;
      const touched = b.log.some((l: { type: string }) => ['call', 'visit', 'demo', 'note'].includes(l.type));
      await tx.query(
        `INSERT INTO command.merchant_stage (id, position, name, kind, city, stage, owner, per_month_cents, next_step, due_on, contact, source, address, notes, flag, last_contact_at, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (id) DO UPDATE SET name = $3, kind = $4, city = $5, stage = $6, owner = $7, per_month_cents = $8, next_step = $9, due_on = $10, contact = $11,
           source = $12, address = $13, notes = $14, flag = $15, last_contact_at = coalesce($16, command.merchant_stage.last_contact_at)`,
        [b.id, pos, b.name, b.kind, b.city, b.stage, b.owner, b.val == null ? null : cents(b.val), b.next, b.due == null ? null : new Date(b.due), JSON.stringify(b.contact), b.source, b.addr, b.note, b.flag, touched ? dayStart(at) : null, at],
      );
      for (const l of b.log) await tx.query('INSERT INTO command.merchant_activity (stage_id, at, kind, text, who) VALUES ($1, $2, $3, $4, $5)', [b.id, at, l.type, l.text, who(person)]);
    },
  },
  'board-order': {
    body: z.object({ ids: z.array(id).min(1).max(500) }),
    summary: () => 'Reordered the pipeline',
    apply: async ({ tx }, b) => {
      for (const [i, cid] of b.ids.entries()) await tx.query('UPDATE command.merchant_stage SET position = $2 WHERE id = $1', [cid, i]);
    },
  },
  'card-remove': {
    body: z.object({ id, reason: text(200).min(1) }),
    summary: (b) => `Took a card off the pipeline · ${b.reason}`,
    apply: async ({ tx, person, at }, b) => {
      const r = await tx.query('UPDATE command.merchant_stage SET removed_at = $2, removed_reason = $3 WHERE id = $1 AND removed_at IS NULL RETURNING 1', [b.id, at, b.reason]);
      if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', 'No such card on the board');
      await tx.query(`INSERT INTO command.merchant_activity (stage_id, at, kind, text, who) VALUES ($1, $2, 'edit', $3, $4)`, [b.id, at, `Taken off the board · ${b.reason}`, who(person)]);
    },
  },
  'card-restore': {
    body: z.object({ id }),
    summary: () => 'Put a card back on the pipeline',
    apply: async ({ tx }, b) => {
      await tx.query('UPDATE command.merchant_stage SET removed_at = NULL, removed_reason = NULL WHERE id = $1', [b.id]);
    },
  },
  'send-agreement': { body: z.object({ id, party: text(120) }), summary: (b) => `Send ${b.party} the merchant agreement`, outbox: true },
  cap: { body: z.object({ id, cap: money.positive() }), summary: (b) => `Raise ${b.id}’s cap to $${b.cap.toFixed(2)}`, second: () => true, outbox: true },
  off: { body: z.object({ id, reason: text(200).default('') }), summary: (b) => `Turn off payments for ${b.id}`, outbox: true },
  on: { body: z.object({ id }), summary: (b) => `Turn on Clear payments for ${b.id}`, outbox: true },
  run: { body: z.object({ total: money, shops: z.number().int().nonnegative() }), summary: (b) => `Monthly payout run · ${b.shops} shops · $${b.total.toFixed(2)}`, second: () => true, outbox: true },
};

// ── Shop ────────────────────────────────────────────────────────────────────

const over50 = (amount: number) => amount > 50;
const prod = async (db: Queryable, pid: string) => must<{ id: string; name: string; variant: string; status: string; price_cents: number }>(db, 'SELECT * FROM command.shop_products WHERE id = $1', [pid], 'product');
const history = (c: Ctx, pid: string, what: string) => c.tx.query('INSERT INTO command.shop_history (product_id, at, what, who) VALUES ($1, $2, $3, $4)', [pid, c.at, what, who(c.person)]);
/** Closes the open shelf period and starts a new one. */
const shelve = async (c: Ctx, pid: string, state: string) => {
  await c.tx.query('UPDATE command.shop_shelf SET ends_at = $2 WHERE product_id = $1 AND ends_at IS NULL', [pid, c.at]);
  await c.tx.query('INSERT INTO command.shop_shelf (product_id, position, state, starts_at, ends_at) VALUES ($1, (SELECT coalesce(max(position), -1) + 1 FROM command.shop_shelf WHERE product_id = $1), $2, $3, NULL)', [pid, state, c.at]);
};
const order = z.object({ order: z.string().regex(/^[0-9]+$/) });
const orderState = (to: string, from: string[], line: string, tell: boolean): Action => ({
  body: order,
  summary: (b) => `#${b.order} · ${line}`,
  apply: async ({ tx }, b) => {
    const r = await tx.query('UPDATE command.shop_orders SET state = $2 WHERE id = $1 AND state = ANY($3) RETURNING 1', [b.order, to, from]);
    if (!r.rows.length) throw new ActionError(409, 'WRONG_STATE', `Order #${b.order} can’t be ${line.toLowerCase()} from where it is`);
  },
  // telling the buyer, or buying the label, is the outside part
  outbox: tell,
});
const SIZE = z.enum(['', 'XS', 'S', 'M', 'L', 'XL', 'XXL']);
const shop: Record<string, Action> = {
  'product-add': {
    body: z.object({
      line: z.enum(['logo', 'graphic', 'layers', 'patch', 'hw']),
      name: text(80).min(1),
      variant: text(80).default(''),
      glyph: text(20).default('tee'),
      price: money.positive(),
      cost: z.array(money).length(4).nullable().default(null),
      options: z.array(text(40).min(1)).min(1).max(12),
      sizes: z.array(SIZE).min(1).max(7),
    }),
    summary: (b) => `Added ${b.name}${b.variant ? ' · ' + b.variant : ''} as a draft`,
    apply: async (c, b) => {
      const base = (b.name + ' ' + b.variant).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
      const pid = base.replace(/-/g, '').slice(0, 12) + Date.now().toString(36).slice(-4);
      await c.tx.query(
        `INSERT INTO command.shop_products (id, position, name, variant, line, glyph, price_cents, cost_cents, status, options, lead_weeks, slug, why, deposit)
         VALUES ($1, (SELECT coalesce(max(position), -1) + 1 FROM command.shop_products), $2, $3, $4, $5, $6, $7, 'draft', $8, 3, $9, NULL, $10)`,
        [pid, b.name, b.variant, b.line, b.glyph, cents(b.price), b.line === 'hw' ? null : (b.cost ?? [0, 0, 0, 0]).map(cents), b.options, `${base}-${pid.slice(-4)}`, b.line === 'hw'],
      );
      for (const [oi, opt] of b.options.entries())
        for (const [si, size] of b.sizes.entries()) await c.tx.query('INSERT INTO command.shop_stock (product_id, option, option_pos, size, size_pos, on_hand) VALUES ($1, $2, $3, $4, $5, 0)', [pid, opt, oi, size, si]);
      await shelve(c, pid, 'draft');
      await history(c, pid, 'Added as a draft');
      return { id: pid };
    },
    // the live shop's catalog is a content file: the change goes there in Phase 7
    outbox: true,
  },
  'product-edit': {
    body: z.object({ id, name: text(80).min(1), variant: text(80), price: money.positive(), cost: z.array(money).length(4).nullable() }),
    summary: (b) => `Updated ${b.name}`,
    apply: async (c, b) => {
      await prod(c.tx, b.id);
      await c.tx.query('UPDATE command.shop_products SET name = $2, variant = $3, price_cents = $4, cost_cents = coalesce($5, cost_cents) WHERE id = $1', [b.id, b.name, b.variant, cents(b.price), b.cost ? b.cost.map(cents) : null]);
      await history(c, b.id, 'Updated the details');
    },
    outbox: true,
  },
  'shelf-off': {
    body: z.object({ id, why: text(120).min(1) }),
    summary: (b) => `Took ${b.id} off the shelf · ${b.why}`,
    apply: async (c, b) => {
      await prod(c.tx, b.id);
      await c.tx.query(`UPDATE command.shop_products SET status = 'off', why = $2 WHERE id = $1`, [b.id, b.why]);
      await shelve(c, b.id, 'off');
      await history(c, b.id, `Taken off the shelf · ${b.why.toLowerCase()}`);
    },
    outbox: true,
  },
  'shelf-on': {
    body: z.object({ id }),
    summary: (b) => `Put ${b.id} on the shelf`,
    apply: async (c, b) => {
      await prod(c.tx, b.id);
      await c.tx.query(`UPDATE command.shop_products SET status = 'on', why = NULL WHERE id = $1`, [b.id]);
      await shelve(c, b.id, 'on');
      await history(c, b.id, 'Put on the shelf');
    },
    outbox: true,
  },
  archive: {
    body: z.object({ id, why: text(120).default('Archived') }),
    summary: (b) => `Archived ${b.id}`,
    apply: async (c, b) => {
      await prod(c.tx, b.id);
      await c.tx.query(`UPDATE command.shop_products SET status = 'arch', why = $2 WHERE id = $1`, [b.id, b.why]);
      await c.tx.query('UPDATE command.shop_shelf SET ends_at = $2 WHERE product_id = $1 AND ends_at IS NULL', [b.id, c.at]);
      await history(c, b.id, `Archived · ${b.why.toLowerCase()}`);
    },
    outbox: true,
  },
  restore: {
    body: z.object({ id }),
    summary: (b) => `Restored ${b.id} as a draft`,
    apply: async (c, b) => {
      await prod(c.tx, b.id);
      await c.tx.query(`UPDATE command.shop_products SET status = 'draft', why = 'Restored' WHERE id = $1`, [b.id]);
      await shelve(c, b.id, 'draft');
      await history(c, b.id, 'Restored as a draft');
    },
  },
  restock: {
    body: z.object({ id, units: z.array(z.object({ option: text(40), size: SIZE, n: z.number().int().positive().max(10000) })).min(1).max(100), cost: money }),
    summary: async (b, db) => `Restock ${(await prod(db, b.id)).name} · ${b.units.reduce((a: number, u: { n: number }) => a + u.n, 0)} units`,
    second: (b) => over50(b.cost),
    outbox: true,
  },
  pack: orderState('packed', ['paid'], 'Packed', true),
  ship: orderState('shipped', ['packed'], 'Shipped', true),
  ready: orderState('ready', ['packed'], 'Ready for pickup', true),
  picked: orderState('picked', ['ready'], 'Picked up', false),
  labels: { body: z.object({ orders: z.array(z.string().regex(/^[0-9]+$/)).min(1).max(100) }), summary: (b) => `Buy postage for ${b.orders.length} labels`, outbox: true },
  remind: { body: order, summary: (b) => `Remind the buyer of #${b.order}`, outbox: true },
  refund: {
    body: order.extend({ reason: z.enum(['Wrong size', 'Damaged in shipping', 'Changed their mind']), amount: money.positive() }),
    summary: (b) => `Refund #${b.order} · $${b.amount.toFixed(2)} · ${b.reason.toLowerCase()}`,
    second: (b) => over50(b.amount),
    apply: async (c, b) => {
      const o = await must<{ items: Array<[string, string, string, number]> }>(c.tx, 'SELECT items FROM command.shop_orders WHERE id = $1', [b.order], 'order');
      const [pid, , size] = o.items[0];
      const p = await prod(c.tx, pid);
      await c.tx.query(
        `INSERT INTO command.shop_returns (order_id, item, reason, returned_on, condition, proposed_by, proposed_at, second_person, refunded_at, amount_cents)
         VALUES ($1, $2, $3, $4, '', $5, $4, $6, $4, $7)
         ON CONFLICT (order_id) DO UPDATE SET second_person = $6, refunded_at = $4, amount_cents = $7`,
        [b.order, `${p.name}${size ? ' · ' + size : ''}`, b.reason, c.at, who(c.person), c.approver ? who(c.approver) : null, cents(b.amount)],
      );
      await c.tx.query(`UPDATE command.shop_orders SET state = 'refund' WHERE id = $1`, [b.order]);
    },
    outbox: true,
  },
  'refund-nudge': { body: order, summary: (b) => `Nudge the second person on #${b.order}’s refund`, outbox: true },
  'deposit-refund': {
    body: z.object({ id, amount: money.positive() }),
    summary: (b) => `Refund pre-order ${b.id}’s deposit · $${b.amount.toFixed(2)}`,
    second: (b) => over50(b.amount),
    outbox: true,
  },
  'signup-link': { body: z.object({ id }), summary: (b) => `Send pre-order ${b.id} the merchant sign-up link`, outbox: true },
};

// ── Money ───────────────────────────────────────────────────────────────────

const moneyActions: Record<string, Action> = {
  top: { body: z.object({ amount: money.positive(), from: text(40).default('ops') }), summary: (b) => `Top up the PayoutPool · $${b.amount.toFixed(2)}`, second: () => true, outbox: true },
  // a sandbox feed syncs at the next tick (Phase 6a); the chain's catch-up is the indexer's own
  sync: {
    body: z.object({ source: z.enum(['plaid', 'bridge', 'lithic', 'stripe', 'chain']).default('plaid') }),
    summary: (b) => `Sync ${b.source} now`,
    apply: async ({ tx, person }, b) => (b.source === 'chain' ? undefined : requestSync(tx, b.source, who(person))),
    outbox: (b) => b.source === 'chain',
  },
  reserve: { body: z.object({}).default({}), summary: () => 'Run the reserve check again', outbox: true },
  vote: { body: z.object({ what: text(300).min(1), amount: money.nullable().default(null) }), summary: (b) => `Propose a member vote on the co-op balance · ${b.what}`, second: () => true, outbox: true },
};

// ── Contracts ───────────────────────────────────────────────────────────────

const contracts: Record<string, Action> = {
  propose: {
    body: z.object({
      contract: text(80).min(1),
      what: text(200).min(1),
      /** The call itself, checked against the contract's ABI when the Safe transaction is built. */
      fn: text(80).optional(),
      args: z.array(z.union([z.string().max(2000), z.array(z.string().max(2000)).max(50)])).max(20).optional(),
    }),
    summary: (b) => `Proposed “${b.what}” on ${b.contract}`,
    apply: async ({ tx, person, at }, b) => {
      const n = (await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM command.contract_changes', []))!.n;
      const t = at.getTime();
      await tx.query(
        `INSERT INTO command.contract_changes (id, position, done, title, contract, proposed_by, detail, events) VALUES ($1, (SELECT coalesce(max(position), -1) + 1 FROM command.contract_changes WHERE NOT done), false, $2, $3, $4, $5, $6)`,
        [
          'ch' + (n + 100),
          b.what,
          b.contract,
          who(person),
          JSON.stringify({ stage: 0, state: 'Drafted · goes to the Safe', d: b.what }),
          JSON.stringify([['seg', 'open', t, t + 20 * 3600e3], ['draft', t]]),
        ],
      );
    },
    // the transaction itself goes to the Safe in Phase 4
    outbox: true,
  },
  sign: { body: z.object({ id }), summary: (b) => `Sign change ${b.id} in the Safe`, outbox: true },
  esign: { body: z.object({ id }), summary: (b) => `Sign agreement ${b.id} in the e-signature tool`, outbox: true },
  renew: {
    body: z.object({ id }),
    summary: (b) => `Started the renewal of ${b.id}`,
    apply: async ({ tx }, b) => {
      const r = await tx.query(`UPDATE command.agreements SET status = 'sent', note = 'Renewal sent for signature today, same terms for 12 months.' WHERE id = $1 RETURNING 1`, [b.id]);
      if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', 'No such agreement');
    },
    outbox: true,
  },
};

// ── Governance ──────────────────────────────────────────────────────────────

const filing = (to: string, from: string, line: string, outbox = false): Action => ({
  body: z.object({ id, position: z.number().int().nonnegative(), owner: text(60).optional(), note: text(500).default('') }),
  summary: (b) => `${line} · filing ${b.id}`,
  apply: async ({ tx }, b) => {
    const r = await tx.query('UPDATE command.filings SET status = $2, owner = coalesce($4, owner) WHERE position = $1 AND status = $3 RETURNING 1', [b.position, to, from, b.owner ?? null]);
    if (!r.rows.length) throw new ActionError(409, 'WRONG_STATE', 'That filing has moved on already');
  },
  outbox,
});
const governance: Record<string, Action> = {
  'filing-filed': filing('done', 'ready', 'Filed'),
  'filing-ready': filing('ready', 'draft', 'Marked ready'),
  'filing-start': filing('draft', 'none', 'Started'),
  'rp-payment': {
    body: z.object({ position: z.number().int().nonnegative() }),
    summary: () => 'Logged a related-party payment',
    apply: async ({ tx, at }, b) => {
      const r = await tx.query('UPDATE command.related_party SET paid_on = array_append(paid_on, $2) WHERE position = $1 AND opens_on IS NULL RETURNING 1', [b.position, at]);
      if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', 'No such related-party deal to pay');
    },
  },
  'rp-agenda': { body: z.object({ position: z.number().int().nonnegative() }), summary: () => 'Put a related-party deal on the board’s agenda', outbox: true },
  matter: { body: z.object({ position: z.number().int().nonnegative(), what: text(200).default('') }), summary: (b) => `Start a reserved-matter approval${b.what ? ' · ' + b.what : ''}`, second: () => true },
  'formation-step': {
    body: z.object({ entity: id }),
    summary: (b) => `Marked a formation step done for ${b.entity}`,
    apply: async ({ tx }, b) => {
      const e = await must<{ facts: { steps?: Array<[string, number]> } | null }>(tx, 'SELECT facts FROM command.entities WHERE id = $1', [b.entity], 'entity');
      const steps = e.facts?.steps;
      const i = steps?.findIndex((s) => !s[1]) ?? -1;
      if (!steps || i < 0) throw new ActionError(409, 'WRONG_STATE', 'Every formation step is done');
      steps[i][1] = 1;
      await tx.query(`UPDATE command.entities SET facts = $2, status = CASE WHEN $3 THEN 'formed' ELSE status END WHERE id = $1`, [b.entity, JSON.stringify({ ...e.facts, steps }), steps.every((s) => s[1])]);
    },
  },
  remind: { body: z.object({}).default({}), summary: () => 'Remind members who haven’t voted', outbox: true },
  packet: { body: z.object({}).default({}), summary: () => 'Send the board packet', outbox: true },
  minutes: {
    body: z.object({ title: text(160).min(1), entity: id.default('coop') }),
    summary: (b) => `Started ${b.title}`,
    apply: async ({ tx, person, at }, b) => {
      const n = (await one<{ n: number }>(tx, 'SELECT count(*)::int + 1 AS n FROM command.documents', []))!.n;
      await tx.query(
        `INSERT INTO command.documents (id, position, title, kind, entity_id, dated, status, version, by_whom, pages) VALUES ($1, (SELECT coalesce(min(position), 0) - 1 FROM command.documents), $2, 'minutes', $3, $4, 'draft', 'v0.1', $5, 1)`,
        ['d' + n + Date.now().toString(36).slice(-3), b.title, b.entity, at, who(person)],
      );
    },
  },
  'agenda-item': {
    body: z.object({ title: text(160).min(1), minutes: z.number().int().positive().max(120).default(5), kind: z.enum(['vote', 'report', 'discuss']).default('vote') }),
    summary: (b) => `Added “${b.title}” to the agenda`,
    apply: async ({ tx, person }, b) => {
      await tx.query('INSERT INTO command.agenda_items (position, title, minutes, owner, kind) VALUES ((SELECT coalesce(max(position), -1) + 1 FROM command.agenda_items), $1, $2, $3, $4)', [b.title, b.minutes, who(person), b.kind]);
    },
  },
  decision: {
    body: z.object({ kind: z.enum(['rp', 'matter', 'other']), what: text(300).min(1), body: text(80).default('Co-op board') }),
    summary: (b) => `Logged a decision · ${b.what}`,
    apply: async ({ tx, at }, b) => {
      await tx.query('INSERT INTO command.resolutions (position, passed_on, body, title, votes) VALUES ((SELECT coalesce(min(position), 0) - 1 FROM command.resolutions), $1, $2, $3, $4)', [at, b.body, b.what, []]);
    },
  },
};

// ── Records (files go through routes/commandFiles.ts) ───────────────────────

const records: Record<string, Action> = {
  'document-add': {
    body: z.object({ title: text(160).min(1), kind: z.enum(['agreement', 'minutes', 'filing', 'policy', 'bond', 'report']), entity: id, file: z.string().uuid(), pages: z.number().int().positive().max(2000).default(1) }),
    summary: (b) => `Added ${b.title}`,
    apply: async ({ tx, person, at }, b) => {
      await must(tx, 'SELECT id FROM command.files WHERE id = $1', [b.file], 'file');
      await must(tx, 'SELECT id FROM command.entities WHERE id = $1', [b.entity], 'entity');
      const doc = 'd' + Date.now().toString(36);
      await tx.query(
        `INSERT INTO command.documents (id, position, title, kind, entity_id, dated, status, version, by_whom, pages, file_id) VALUES ($1, (SELECT coalesce(min(position), 0) - 1 FROM command.documents), $2, $3, $4, $5, 'final', 'v1.0', $6, $7, $8)`,
        [doc, b.title, b.kind, b.entity, at, who(person), b.pages, b.file],
      );
      await tx.query('INSERT INTO command.document_versions (document_id, version, file_id, note, added_by, added_at) VALUES ($1, $2, $3, $4, $5, $6)', [doc, 'v1.0', b.file, 'First version', person.id, at]);
      return { id: doc };
    },
  },
  'document-version': {
    body: z.object({ id, file: z.string().uuid(), note: text(300).default('') }),
    summary: (b) => `Added a new version of ${b.id}`,
    apply: async ({ tx, person, at }, b) => {
      const d = await must<{ version: string }>(tx, 'SELECT version FROM command.documents WHERE id = $1', [b.id], 'document');
      await must(tx, 'SELECT id FROM command.files WHERE id = $1', [b.file], 'file');
      const m = /^v(\d+)\.(\d+)$/.exec(d.version);
      const next = m ? `v${m[1]}.${Number(m[2]) + 1}` : 'v1.0';
      await tx.query('UPDATE command.documents SET version = $2, file_id = $3, dated = $4 WHERE id = $1', [b.id, next, b.file, at]);
      await tx.query('INSERT INTO command.document_versions (document_id, version, file_id, note, added_by, added_at) VALUES ($1, $2, $3, $4, $5, $6)', [b.id, next, b.file, b.note, person.id, at]);
      return { version: next };
    },
  },
};

export const ACTIONS: Partial<Record<Section, Record<string, Action>>> = {
  growth,
  field,
  members,
  merchants,
  shop,
  money: moneyActions,
  contracts,
  governance,
  records,
};

export const actionFor = (section: string, kind: string): Action | undefined => ACTIONS[section as Section]?.[kind];
export const levelFor = (a: Action) => a.level ?? PROPOSE;
