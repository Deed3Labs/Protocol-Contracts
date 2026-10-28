import { DAY, SEED_TODAY } from '@clear/command-types';
import { z } from 'zod';
import type { Queryable } from '../../db/db.js';
import { PROPOSE, type Level, type Section } from './levels.js';
import { providerFor } from './sections.js';
import { addToCatalog, adoptSiteProduct, deletePhoto, isProductPhoto, siteProductRow, type CatalogColour, type CatalogProduct, type CatalogVariant } from './catalog.js';
import { productCost, readBook, runUses } from './costing.js';
import type { Person } from './store.js';
import { requestSync } from './feeds.js';
import { sendBatch } from './waitlist.js';
import { ActionError } from './actionError.js';
import { overLimit, settingsActions } from './settings.js';

/*
 * Each section's own actions (docs/command-center-plan.md: the step after Phase 3).
 *
 * An action is one of three things:
 * - Command's own record (a scan, a board card, a filing's status): saved here, with an audit row.
 * - Something outside Command (pay, refund, sign on-chain, send for e-signature, message members):
 *   recorded in command.outbox and not carried out. Phases 4–7 connect the systems that do it.
 * - Either of those, when the action's own rule says so (money over its limit in Settings, two of three signers, a
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
  /** Changes the store's catalog (Phase 11): once it's done, the site is told to read it again. */
  revalidates?: boolean;
  /** Runs once the change has committed, never holding up the answer (a photo's file deleted). */
  after?: (b: B) => Promise<unknown>;
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

export { ActionError };

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
  // live (Phase 7b): once a second person approves, the next people waiting get their codes and the
  // emails are queued for the invite job; on the seed it's recorded, as before
  batch: {
    body: z.object({ size: z.number().int().positive().max(500), order: text(40).default('oldest') }),
    summary: (b) => `Send the next batch of ${b.size} invites`,
    second: () => true,
    apply: async ({ tx, person, at }, b) => {
      if (providerFor('members') !== 'live') return;
      const order = (['oldest', 'posters', 'city'] as const).find((o) => o === b.order) ?? 'oldest';
      try {
        return await sendBatch(tx, b.size, order, who(person), at);
      } catch (e: any) {
        if (e?.code === 'NOBODY_WAITING') throw new ActionError(409, e.code, e.message);
        throw e;
      }
    },
    outbox: () => providerFor('members') !== 'live',
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

/** A slug: lowercase letters, numbers and dashes. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Live, a change to the catalog is made in Command's (Phase 11), not queued for the site; seeded, it's queued as before. */
const catalogOutbox = () => providerFor('shop') !== 'live';
/** Whether a change to this product's price is one the store would charge: live, a product in Command's catalog and on the shelf, and the change real. */
const livePriceChange = async (db: Queryable, pid: string, changed: (p: { price_cents: number }) => boolean) => {
  if (providerFor('shop') !== 'live') return false;
  const p = await one<{ price_cents: number; status: string; in_catalog: boolean }>(db, 'SELECT price_cents, status, in_catalog FROM command.shop_products WHERE id = $1', [pid]);
  return !!p && p.in_catalog && p.status === 'on' && changed(p);
};
/** A product's new slug: the old one is kept as moved (and any slug moved to it follows), so links, bags and orders still find it. */
const moveSlug = async (tx: Queryable, pid: string, slug: string) => {
  const p = (await one<{ slug: string }>(tx, 'SELECT slug FROM command.shop_products WHERE id = $1', [pid]))!;
  if (p.slug === slug) return;
  if (await one(tx, 'SELECT 1 FROM command.shop_products WHERE slug = $1', [slug])) throw new ActionError(409, 'TAKEN', `Another product has the slug ${slug}`);
  await tx.query('UPDATE command.shop_products SET slug = $2 WHERE id = $1', [pid, slug]);
  await tx.query('DELETE FROM command.shop_moved WHERE old_slug = $1', [slug]);
  await tx.query('UPDATE command.shop_moved SET new_slug = $2 WHERE new_slug = $1', [p.slug, slug]);
  await tx.query('INSERT INTO command.shop_moved (old_slug, new_slug) VALUES ($1, $2) ON CONFLICT (old_slug) DO UPDATE SET new_slug = $2, moved_at = now()', [p.slug, slug]);
};
type ProductRow = { id: string; name: string; variant: string; status: string; price_cents: number };
/**
 * A product, as Command records it. Live, a product the site sells that Command has no record of yet
 * is read from the catalog; given an action (`c`), its record is made then, so the action has one to
 * change (adoptSiteProduct).
 */
const prod = async (db: Queryable, pid: string, c?: Ctx): Promise<ProductRow> => {
  const own = () => one<ProductRow>(db, 'SELECT * FROM command.shop_products WHERE id = $1', [pid]);
  const r = await own();
  if (r || providerFor('shop') !== 'live') return r ?? must<ProductRow>(db, 'SELECT * FROM command.shop_products WHERE id = $1', [pid], 'product');
  if (c && (await adoptSiteProduct(db, pid, c.at, who(c.person)))) {
    const made = await own();
    if (made) return made;
  }
  const site = c ? null : await siteProductRow(db, pid);
  if (!site) throw new ActionError(404, 'NOT_FOUND', 'No such product');
  return site;
};
const history = (c: Ctx, pid: string, what: string) => c.tx.query('INSERT INTO command.shop_history (product_id, at, what, who) VALUES ($1, $2, $3, $4)', [pid, c.at, what, who(c.person)]);
/** Closes the open shelf period and starts a new one. */
const shelve = async (c: Ctx, pid: string, state: string) => {
  await c.tx.query('UPDATE command.shop_shelf SET ends_at = $2 WHERE product_id = $1 AND ends_at IS NULL', [pid, c.at]);
  await c.tx.query('INSERT INTO command.shop_shelf (product_id, position, state, starts_at, ends_at) VALUES ($1, (SELECT coalesce(max(position), -1) + 1 FROM command.shop_shelf WHERE product_id = $1), $2, $3, NULL)', [pid, state, c.at]);
};
/** A product in Command's catalog (Phase 11), for the actions that change what the store sells. */
const catalogRecord = async (tx: Queryable, pid: string) => {
  const p = await must<{ in_catalog: boolean }>(tx, 'SELECT in_catalog FROM command.shop_products WHERE id = $1', [pid], 'product');
  if (!p.in_catalog) throw new ActionError(409, 'NOT_IN_CATALOG', 'It isn’t in Command’s catalog yet');
};
/** A garment's sizes, in the order its variants list them ([] for a product with no sizes). */
const sizesOf = async (tx: Queryable, pid: string) => {
  const { rows } = await tx.query<{ size: string }>('SELECT size FROM command.shop_variants WHERE product_id = $1 AND size IS NOT NULL ORDER BY position', [pid]);
  return [...new Set(rows.map((r) => r.size))];
};
const addVariant = (tx: Queryable, pid: string, v: CatalogVariant) =>
  tx.query(
    'INSERT INTO command.shop_variants (product_id, id, position, label, colour, size, price_cents, deposit_cents, per, sold_out) VALUES ($1, $2, (SELECT coalesce(max(position), -1) + 1 FROM command.shop_variants WHERE product_id = $1), $3, $4, $5, $6, $7, $8, false)',
    [pid, v.id, v.label, v.colour ?? null, v.size ?? null, v.priceCents ?? null, v.depositCents ?? null, v.per ?? null],
  );
/** A catalog product's photos, in order, and its store name (a photo's description until one's written). */
const photosOf = async (tx: Queryable, pid: string) => {
  await catalogRecord(tx, pid);
  return (await one<{ images: Array<{ src: string; alt: string }>; title: string }>(tx, 'SELECT images, coalesce(title, name) AS title FROM command.shop_products WHERE id = $1', [pid]))!;
};
const setPhotos = (tx: Queryable, pid: string, images: Array<{ src: string; alt: string }>) => tx.query('UPDATE command.shop_products SET images = $2 WHERE id = $1', [pid, JSON.stringify(images)]);
const STOCK_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
/** A new colour or option: on the product's list, with its stock at 0 (each of the six sizes for a garment). */
const addOption = async (tx: Queryable, pid: string, option: string, sized: boolean) => {
  await tx.query('UPDATE command.shop_products SET options = array_append(options, $2) WHERE id = $1 AND NOT ($2 = ANY(options))', [pid, option]);
  const { rows } = await tx.query<{ n: number }>('SELECT coalesce(max(option_pos), -1) + 1 AS n FROM command.shop_stock WHERE product_id = $1', [pid]);
  for (const [si, size] of (sized ? STOCK_SIZES : ['']).entries())
    await tx.query('INSERT INTO command.shop_stock (product_id, option, option_pos, size, size_pos, on_hand) VALUES ($1, $2, $3, $4, $5, 0) ON CONFLICT DO NOTHING', [pid, option, rows[0].n, size, si]);
};
/** A colour or option going: refused while any of it is on hand; its stock rows and its place on the list go with it. */
const dropOption = async (tx: Queryable, pid: string, option: string) => {
  const { rows } = await tx.query<{ n: string }>('SELECT coalesce(sum(on_hand), 0) AS n FROM command.shop_stock WHERE product_id = $1 AND option = $2', [pid, option]);
  if (Number(rows[0].n) > 0) throw new ActionError(409, 'ON_HAND', `${option} still has ${rows[0].n} on hand`);
  await tx.query('DELETE FROM command.shop_stock WHERE product_id = $1 AND option = $2', [pid, option]);
  await tx.query('UPDATE command.shop_products SET options = array_remove(options, $2) WHERE id = $1', [pid, option]);
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

// ── Shop: what goes into a product (Phase 10) ───────────────────────────────
//
// Command's own records, so they run at Propose with nobody else: none of this moves money. Money
// in a body is dollars, as the rest of the shop's are; a unit cost or a line's cost keeps its
// fractions of a cent (services/command/costing.ts rounds only where money is shown or stored).

/** Dollars to cents, keeping fractions of a cent ($0.0425 is 4.25¢) but not float dust. */
const fcents = (v: number) => Math.round(v * 1e8) / 1e6;
/** A quantity to the millionth: 0.1 × 3 is 0.3, not 0.30000000000000004. */
const qty = (v: number) => Math.round(v * 1e6) / 1e6;
const amount = z.number().positive().max(1_000_000);
const unitText = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{1,12}$/, 'A unit is a short word: each, m, g, ml, h…');
type InputRow = { id: string; name: string; kind: string; unit: string; stocked: boolean; unit_cost_cents: string | null; archived_at: Date | null };
const inputRow = (db: Queryable, iid: string) => must<InputRow>(db, 'SELECT * FROM command.shop_inputs WHERE id = $1', [iid], 'input');
const liveInput = async (db: Queryable, iid: string) => {
  const i = await inputRow(db, iid);
  if (i.archived_at) throw new ActionError(409, 'ARCHIVED', `${i.name} is archived: restore it first`);
  return i;
};
/** A line or override as typed: the amount when there is one (it wins over a cost), else the cost. */
const entered = (b: { amount?: number; cost?: number }) =>
  b.amount != null ? { amount: qty(b.amount), cost: null, entered: 'amount' as const } : { amount: null, cost: fcents(b.cost!), entered: 'cost' as const };
/**
 * A cost typed is kept with the amount it works out to, whenever the input has a unit cost, so a later
 * change to that unit cost flows into the recipe (Phase 10: "a change to an input's cost flows into
 * every recipe that uses it"). With no unit cost yet it stays a cost until one comes (pinLines).
 */
const pinned = (e: ReturnType<typeof entered>, unitCostCents: unknown) => {
  const u = Number(unitCostCents ?? 0);
  return e.amount == null && u > 0 && e.cost! > 0 ? { ...e, amount: e.cost! / u } : e;
};
/** An input's first unit cost gives its cost-only lines and overrides their amounts. */
const pinLines = async (tx: Queryable, iid: string) => {
  for (const t of ['shop_recipe_lines', 'shop_recipe_overrides'])
    await tx.query(
      `UPDATE command.${t} SET amount = ${t}.cost_cents / i.unit_cost_cents FROM command.shop_inputs i
        WHERE i.id = $1 AND ${t}.input_id = $1 AND ${t}.amount IS NULL AND ${t}.cost_cents > 0 AND i.unit_cost_cents > 0`,
      [iid],
    );
};
const eitherWay = <T extends { amount?: number; cost?: number; remove?: boolean }>(b: T) => !!b.remove || b.amount != null || b.cost != null;
const EITHER = 'Give an amount used or a cost per product';
const ofVariant = (o: string, s: string) => [o, s].filter(Boolean).join(' ') || 'one size';
/** Sets a recipe line, keeping its place when it's there already. */
const setLine = (tx: Queryable, pid: string, iid: string, e: { amount: number | null; cost: number | null; entered: 'amount' | 'cost' }) =>
  tx.query(
    `INSERT INTO command.shop_recipe_lines (product_id, input_id, position, amount, cost_cents, entered)
     VALUES ($1, $2, (SELECT coalesce(max(position), -1) + 1 FROM command.shop_recipe_lines WHERE product_id = $1), $3, $4, $5)
     ON CONFLICT (product_id, input_id) DO UPDATE SET amount = $3, cost_cents = $4, entered = $5`,
    [pid, iid, e.amount, e.cost, e.entered],
  );

const inputBody = z
  .object({
    /** An existing input to edit; left out (or new), one is added. */
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,47}$/).optional(),
    name: text(80).min(1),
    kind: z.enum(['material', 'service', 'labour']),
    unit: unitText,
    stocked: z.boolean().default(false),
    /** Dollars a unit. Left out keeps what it is; null clears it (the latest purchase's, then). */
    unitCost: z.number().nonnegative().max(100_000).nullable().optional(),
    lowMark: z.number().nonnegative().max(1_000_000).nullable().default(null),
    note: text(500).default(''),
  })
  .superRefine((b, ctx) => {
    if (b.kind === 'labour' && b.unit !== 'h') ctx.addIssue({ code: 'custom', message: 'Labour is costed by the hour (h)' });
    if (b.stocked && b.kind !== 'material') ctx.addIssue({ code: 'custom', message: 'Only a material is kept on hand' });
    if (b.lowMark != null && !b.stocked) ctx.addIssue({ code: 'custom', message: 'A low mark is for an input kept on hand' });
  });

const costing: Record<string, Action> = {
  input: {
    body: inputBody,
    summary: async (b, db) => ((b.id && (await one(db, 'SELECT 1 FROM command.shop_inputs WHERE id = $1', [b.id]))) ? `Updated input ${b.name}` : `Added input ${b.name}`),
    apply: async ({ tx, at }, b) => {
      const iid = b.id ?? (b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'input') + '-' + Date.now().toString(36).slice(-4);
      const cost = b.unitCost === undefined ? undefined : b.unitCost === null ? null : fcents(b.unitCost);
      await tx.query(
        `INSERT INTO command.shop_inputs (id, name, kind, unit, stocked, unit_cost_cents, low_mark, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET name = $2, kind = $3, unit = $4, stocked = $5, low_mark = $7, note = $8,
           unit_cost_cents = CASE WHEN $10 THEN command.shop_inputs.unit_cost_cents ELSE $6 END`,
        [iid, b.name, b.kind, b.unit, b.stocked, cost ?? null, b.lowMark, b.note, at, cost === undefined],
      );
      await pinLines(tx, iid);
      return { id: iid };
    },
  },
  'input-archive': {
    body: z.object({ id, archived: z.boolean().default(true) }),
    summary: async (b, db) => `${b.archived ? 'Archived' : 'Restored'} input ${(await inputRow(db, b.id)).name}`,
    // an archived input leaves the library's pickers; recipes that use it still cost it
    apply: async ({ tx, at }, b) => {
      await inputRow(tx, b.id);
      await tx.query('UPDATE command.shop_inputs SET archived_at = $2 WHERE id = $1', [b.id, b.archived ? at : null]);
    },
  },
  purchase: {
    body: z.object({
      input: id,
      quantity: amount,
      /** What was paid, in dollars. */
      total: money,
      supplier: text(120).default(''),
      note: text(500).default(''),
      on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    summary: async (b, db) => {
      const i = await inputRow(db, b.input);
      return `Bought ${qty(b.quantity)} ${i.unit} of ${i.name} · $${b.total.toFixed(2)}`;
    },
    apply: async (c, b) => {
      const i = await liveInput(c.tx, b.input);
      const at = b.on ? new Date(b.on + 'T00:00:00Z') : c.at;
      const q = qty(b.quantity);
      const { id: pid } = (await one<{ id: number }>(
        c.tx,
        'INSERT INTO command.shop_input_purchases (input_id, at, quantity, total_cents, supplier, note, who) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [i.id, at, q, cents(b.total), b.supplier, b.note, who(c.person)],
      ))!;
      // the newest purchase sets the unit cost; one dated before it is history only
      await c.tx.query(
        `UPDATE command.shop_inputs SET unit_cost_cents = $2::numeric / $3::numeric
         WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM command.shop_input_purchases WHERE input_id = $1 AND id <> $4 AND at > $5)`,
        [i.id, cents(b.total), q, pid, at],
      );
      if (i.stocked) await c.tx.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason, ref, note) VALUES ($1, $2, $3, 'purchase', $4, $5)`, [i.id, at, q, pid, b.supplier]);
      await pinLines(c.tx, i.id);
      return { id: pid, unitCost: cents(b.total) / q / 100 };
    },
  },
  'recipe-line': {
    body: z
      .object({ product: id, input: id, amount: amount.optional(), cost: money.optional(), remove: z.boolean().default(false) })
      .refine(eitherWay, EITHER),
    summary: async (b, db) => {
      const [p, i] = [await prod(db, b.product), await inputRow(db, b.input)];
      return b.remove ? `Took ${i.name} out of ${p.name}’s recipe` : `Set ${i.name} in ${p.name}’s recipe`;
    },
    apply: async (c, b) => {
      await prod(c.tx, b.product, c);
      if (b.remove) {
        const i = await inputRow(c.tx, b.input);
        const r = await c.tx.query('DELETE FROM command.shop_recipe_lines WHERE product_id = $1 AND input_id = $2 RETURNING 1', [b.product, b.input]);
        if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', `${i.name} isn’t in that recipe`);
        await history(c, b.product, `Recipe · took out ${i.name}`);
        return;
      }
      const i = await liveInput(c.tx, b.input);
      await setLine(c.tx, b.product, b.input, pinned(entered(b), i.unit_cost_cents));
      await history(c, b.product, `Recipe · set ${i.name}`);
    },
  },
  'recipe-override': {
    body: z
      .object({ product: id, input: id, option: text(40).default(''), size: SIZE.default(''), amount: amount.optional(), cost: money.optional(), remove: z.boolean().default(false) })
      .refine(eitherWay, EITHER)
      .refine((b) => b.option !== '' || b.size !== '', 'Say which colour or size it’s for'),
    summary: async (b, db) => {
      const [p, i] = [await prod(db, b.product), await inputRow(db, b.input)];
      return `${b.remove ? 'Removed' : 'Set'} ${i.name} for ${ofVariant(b.option, b.size)} in ${p.name}’s recipe`;
    },
    apply: async (c, b) => {
      await prod(c.tx, b.product, c);
      const i = await inputRow(c.tx, b.input);
      if (b.remove) {
        const r = await c.tx.query('DELETE FROM command.shop_recipe_overrides WHERE product_id = $1 AND input_id = $2 AND option = $3 AND size = $4 RETURNING 1', [b.product, b.input, b.option, b.size]);
        if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', `No ${ofVariant(b.option, b.size)} override for ${i.name}`);
        return;
      }
      await must(c.tx, 'SELECT 1 FROM command.shop_recipe_lines WHERE product_id = $1 AND input_id = $2', [b.product, b.input], `${i.name} line in that recipe`);
      await must(c.tx, `SELECT 1 FROM command.shop_stock WHERE product_id = $1 AND ($2 = '' OR option = $2) AND ($3 = '' OR size = $3) LIMIT 1`, [b.product, b.option, b.size], 'colour or size of that product');
      const e = pinned(entered(b), i.unit_cost_cents);
      await c.tx.query(
        `INSERT INTO command.shop_recipe_overrides (product_id, input_id, option, size, amount, cost_cents, entered) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (product_id, input_id, option, size) DO UPDATE SET amount = $5, cost_cents = $6, entered = $7`,
        [b.product, b.input, b.option, b.size, e.amount, e.cost, e.entered],
      );
      await history(c, b.product, `Recipe · set ${i.name} for ${ofVariant(b.option, b.size)}`);
    },
  },
  'recipe-copy': {
    body: z
      .object({
        from: id,
        to: z.array(id).min(1).max(100),
        /** replace: each product's recipe becomes the copy. merge: the lines it lacks are added; a line it has stays as it is. */
        mode: z.enum(['replace', 'merge']),
      })
      .refine((b) => !b.to.includes(b.from), 'A recipe can’t be copied onto itself'),
    summary: async (b, db) => `Copied ${(await prod(db, b.from)).name}’s recipe onto ${b.to.length} product${b.to.length === 1 ? '' : 's'} (${b.mode})`,
    apply: async (c, b) => {
      const src = await prod(c.tx, b.from, c);
      const { rows: lines } = await c.tx.query<{ input_id: string; position: number; amount: string | null; cost_cents: string | null; entered: string }>('SELECT * FROM command.shop_recipe_lines WHERE product_id = $1 ORDER BY position', [b.from]);
      if (!lines.length) throw new ActionError(409, 'NO_RECIPE', `${src.name} has no recipe to copy`);
      const { rows: ovs } = await c.tx.query<{ input_id: string; option: string; size: string; amount: string | null; cost_cents: string | null; entered: string }>('SELECT * FROM command.shop_recipe_overrides WHERE product_id = $1', [b.from]);
      let copied = 0;
      for (const to of [...new Set<string>(b.to)]) {
        await prod(c.tx, to, c);
        if (b.mode === 'replace') await c.tx.query('DELETE FROM command.shop_recipe_lines WHERE product_id = $1', [to]);
        const added: string[] = [];
        for (const l of lines) {
          const r = await c.tx.query(
            `INSERT INTO command.shop_recipe_lines (product_id, input_id, position, amount, cost_cents, entered)
             VALUES ($1, $2, (SELECT coalesce(max(position), -1) + 1 FROM command.shop_recipe_lines WHERE product_id = $1), $3, $4, $5)
             ON CONFLICT (product_id, input_id) DO NOTHING RETURNING input_id`,
            [to, l.input_id, l.amount, l.cost_cents, l.entered],
          );
          if (r.rows.length) added.push(l.input_id);
        }
        // the copied lines' overrides, for the colours and sizes this product has
        for (const o of ovs.filter((o) => added.includes(o.input_id)))
          await c.tx.query(
            `INSERT INTO command.shop_recipe_overrides (product_id, input_id, option, size, amount, cost_cents, entered)
             SELECT $1, $2, $3, $4, $5, $6, $7 WHERE EXISTS (SELECT 1 FROM command.shop_stock WHERE product_id = $1 AND ($3 = '' OR option = $3) AND ($4 = '' OR size = $4))`,
            [to, o.input_id, o.option, o.size, o.amount, o.cost_cents, o.entered],
          );
        await history(c, to, `Recipe · copied from ${src.name} (${b.mode})`);
        copied += added.length;
      }
      return { lines: copied };
    },
  },
  'input-apply': {
    body: z
      .object({ input: id, products: z.array(id).min(1).max(100), amount: amount.optional(), cost: money.optional() })
      .refine((b) => b.amount != null || b.cost != null, EITHER),
    summary: async (b, db) => `Added ${(await inputRow(db, b.input)).name} to ${b.products.length} product${b.products.length === 1 ? '' : 's'}`,
    // a product that has the input already gets the new amount or cost
    apply: async (c, b) => {
      const i = await liveInput(c.tx, b.input);
      const ps = [...new Set<string>(b.products)];
      for (const pid of ps) {
        await prod(c.tx, pid, c);
        await setLine(c.tx, pid, i.id, pinned(entered(b), i.unit_cost_cents));
        await history(c, pid, `Recipe · set ${i.name}`);
      }
      return { products: ps.length };
    },
  },
  'stock-adjust': {
    body: z
      .object({
        input: id,
        /** Signed: + found or counted in, − out. Waste is always out. */
        quantity: z.number().min(-1_000_000).max(1_000_000).refine((q) => q !== 0, 'A move of nothing'),
        reason: z.enum(['adjust', 'waste']).default('adjust'),
        note: text(300).default(''),
      })
      .refine((b) => b.reason !== 'waste' || b.quantity < 0, 'Waste takes stock out: a negative quantity'),
    summary: async (b, db) => {
      const i = await inputRow(db, b.input);
      return `${b.reason === 'waste' ? 'Wasted' : 'Adjusted'} ${i.name} · ${b.quantity > 0 ? '+' : ''}${qty(b.quantity)} ${i.unit}`;
    },
    apply: async ({ tx, at }, b) => {
      const i = await inputRow(tx, b.input);
      if (!i.stocked) throw new ActionError(409, 'NOT_STOCKED', `${i.name} is made to order: it has no stock`);
      const q = qty(b.quantity);
      const on = Number((await one<{ n: string }>(tx, 'SELECT coalesce(sum(quantity), 0) AS n FROM command.shop_input_moves WHERE input_id = $1', [i.id]))!.n);
      if (q < 0 && on + q < -1e-9) throw new ActionError(409, 'SHORT', `Only ${qty(on)} ${i.unit} of ${i.name} on hand`);
      await tx.query('INSERT INTO command.shop_input_moves (input_id, at, quantity, reason, note) VALUES ($1, $2, $3, $4, $5)', [i.id, at, q, b.reason, b.note]);
      return { onHand: qty(on + q) };
    },
  },
  run: {
    body: z.object({
      product: id,
      option: text(40).default(''),
      size: SIZE.default(''),
      units: z.number().int().positive().max(10_000),
      note: text(300).default(''),
      /** Record it even if a stocked input would go below zero (the count was off). */
      allowShort: z.boolean().default(false),
    }),
    summary: async (b, db) => `Made ${b.units} ${(await prod(db, b.product)).name}${b.option || b.size ? ' · ' + ofVariant(b.option, b.size) : ''}`,
    apply: async (c, b) => {
      const p = await prod(c.tx, b.product, c);
      await must(c.tx, 'SELECT 1 FROM command.shop_stock WHERE product_id = $1 AND option = $2 AND size = $3', [b.product, b.option, b.size], 'colour and size of that product');
      const book = await readBook(c.tx);
      const costed = productCost(book, b.product, { option: b.option, size: b.size });
      // a product with no recipe yet uses nothing it can count
      const { uses, unknown } = costed.source === 'recipe' ? runUses(costed, book.inputs, b.units) : { uses: [], unknown: [] };
      if (unknown.length)
        throw new ActionError(409, 'NO_AMOUNT', `Can’t tell how much ${unknown.map((u) => book.inputs.get(u)?.name ?? u).join(', ')} a unit uses: enter the line as an amount, or give the input a unit cost`);
      const short = uses
        .map((u) => ({ ...u, quantity: qty(u.quantity), input: book.inputs.get(u.inputId)!, on: book.onHand.get(u.inputId) ?? 0 }))
        .filter((u) => u.on - u.quantity < -1e-9);
      if (short.length && !b.allowShort)
        throw new ActionError(409, 'SHORT', `Not enough on hand: ${short.map((s) => `${s.input.name} has ${qty(s.on)} ${s.input.unit}, the run needs ${s.quantity}`).join('; ')}`);
      const { id: rid } = (await one<{ id: number }>(c.tx, 'INSERT INTO command.shop_runs (product_id, option, size, units, at, note, who, short) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id', [
        b.product,
        b.option,
        b.size,
        b.units,
        c.at,
        b.note,
        who(c.person),
        short.length > 0,
      ]))!;
      for (const u of uses) if (qty(u.quantity) > 0) await c.tx.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason, ref) VALUES ($1, $2, $3, 'run', $4)`, [u.inputId, c.at, -qty(u.quantity), rid]);
      await c.tx.query('UPDATE command.shop_stock SET on_hand = on_hand + $4 WHERE product_id = $1 AND option = $2 AND size = $3', [b.product, b.option, b.size, b.units]);
      await history(c, b.product, `Made ${b.units} · ${ofVariant(b.option, b.size)}`);
      return { id: rid, uses: uses.map((u) => ({ input: u.inputId, quantity: qty(u.quantity) })), short: short.map((s) => s.inputId) };
    },
  },
};

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
    // live, Command's catalog is the store's (Phase 11): the change is made here, not queued
    outbox: catalogOutbox,
  },
  'product-edit': {
    revalidates: true,
    body: z.object({
      id,
      name: text(80).min(1),
      variant: text(80),
      price: money.positive(),
      cost: z.array(money).length(4).nullable(),
      // the store's own fields (Phase 11), each left as it is when not sent
      title: text(120).min(1).optional(),
      tagline: text(200).optional(),
      description: text(2000).optional(),
      details: z.array(text(200).min(1)).max(20).optional(),
      category: text(60).optional(),
      alsoIn: z.array(text(60).min(1)).max(10).optional(),
      featured: z.boolean().optional(),
      weightOz: z.number().positive().max(2000).nullable().optional(),
      ships: text(40).nullable().optional(),
      fccNotice: text(1000).nullable().optional(),
      founding: text(300).nullable().optional(),
      slug: z.string().trim().regex(SLUG, 'Lowercase letters, numbers and dashes').max(80).optional(),
      // whether it keeps selling at 0 on hand (pre-order) or shows sold out there (Phase 11b)
      sellPastStock: z.boolean().optional(),
    }),
    summary: async (b, db) => {
      const p = await one<{ price_cents: number }>(db, 'SELECT price_cents FROM command.shop_products WHERE id = $1', [b.id]);
      return `Updated ${b.name}${p && p.price_cents !== cents(b.price) ? ` · price $${(p.price_cents / 100).toFixed(2)} → $${b.price.toFixed(2)}` : ''}`;
    },
    // live, a price change on a product the store sells waits for a second person (Kai, 2026-10-26)
    second: (b, db) => livePriceChange(db, b.id, (p) => p.price_cents !== cents(b.price)),
    apply: async (c, b) => {
      const p = await prod(c.tx, b.id, c);
      await c.tx.query('UPDATE command.shop_products SET name = $2, variant = $3, price_cents = $4, cost_cents = coalesce($5, cost_cents) WHERE id = $1', [b.id, b.name, b.variant, cents(b.price), b.cost ? b.cost.map(cents) : null]);
      const sets: Array<[string, unknown]> = [];
      const put = (col: string, v: unknown) => v !== undefined && sets.push([col, v]);
      put('title', b.title);
      put('tagline', b.tagline);
      put('description', b.description);
      put('details', b.details);
      put('category', b.category);
      put('also_in', b.alsoIn);
      put('featured', b.featured);
      put('weight_oz', b.weightOz);
      put('ships', b.ships);
      put('fcc_notice', b.fccNotice);
      put('founding', b.founding);
      put('sell_past_stock', b.sellPastStock);
      if (sets.length) await c.tx.query(`UPDATE command.shop_products SET ${sets.map(([k], i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [b.id, ...sets.map(([, v]) => v)]);
      if (b.slug) await moveSlug(c.tx, b.id, b.slug);
      await history(c, b.id, p.price_cents !== cents(b.price) ? `Updated the details · price $${(p.price_cents / 100).toFixed(2)} → $${b.price.toFixed(2)}` : 'Updated the details');
    },
    outbox: catalogOutbox,
  },
  'variant-edit': {
    revalidates: true,
    body: z
      .object({
        id,
        variant: z.string().trim().regex(SLUG).max(64),
        label: text(80).min(1).optional(),
        price: money.positive().nullable().optional(),
        deposit: money.positive().nullable().optional(),
        per: text(40).nullable().optional(),
        soldOut: z.boolean().optional(),
      })
      .refine((b) => b.deposit == null || (b.price ?? Infinity) >= b.deposit, 'A deposit can’t be more than the price'),
    summary: (b) =>
      `${b.id} · ${b.variant}: ${[b.label && `“${b.label}”`, b.price !== undefined && (b.price == null ? 'the product’s price' : `$${b.price.toFixed(2)}`), b.deposit !== undefined && (b.deposit == null ? 'no deposit' : `$${b.deposit.toFixed(2)} deposit`), b.soldOut !== undefined && (b.soldOut ? 'sold out' : 'back in stock')].filter(Boolean).join(', ') || 'no change'}`,
    // a variant's price or deposit on a product the store sells, the same as the product's
    second: async (b, db) => {
      if (b.price === undefined && b.deposit === undefined) return false;
      const v = await one<{ price_cents: number | null; deposit_cents: number | null }>(db, 'SELECT price_cents, deposit_cents FROM command.shop_variants WHERE product_id = $1 AND id = $2', [b.id, b.variant]);
      if (!v) return false;
      const changed = (b.price !== undefined && v.price_cents !== (b.price == null ? null : cents(b.price))) || (b.deposit !== undefined && v.deposit_cents !== (b.deposit == null ? null : cents(b.deposit)));
      return changed && livePriceChange(db, b.id, () => true);
    },
    apply: async (c, b) => {
      await prod(c.tx, b.id, c);
      await must(c.tx, 'SELECT 1 FROM command.shop_variants WHERE product_id = $1 AND id = $2', [b.id, b.variant], 'variant of that product');
      const sets: Array<[string, unknown]> = [];
      if (b.label !== undefined) sets.push(['label', b.label]);
      if (b.price !== undefined) sets.push(['price_cents', b.price == null ? null : cents(b.price)]);
      if (b.deposit !== undefined) sets.push(['deposit_cents', b.deposit == null ? null : cents(b.deposit)]);
      if (b.per !== undefined) sets.push(['per', b.per || null]);
      if (b.soldOut !== undefined) sets.push(['sold_out', b.soldOut]);
      if (sets.length) await c.tx.query(`UPDATE command.shop_variants SET ${sets.map(([k], i) => `${k} = $${i + 3}`).join(', ')} WHERE product_id = $1 AND id = $2`, [b.id, b.variant, ...sets.map(([, v]) => v)]);
      await history(c, b.id, `Variant ${b.variant} updated`);
    },
  },
  'colour-add': {
    revalidates: true,
    body: z.object({
      id,
      colour: z.object({ id: z.string().trim().regex(SLUG).max(40), label: text(40).min(1), swatch: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'A swatch is a colour like #232324'), tone: z.enum(['ink', 'land', 'paper']), fill: z.boolean().optional() }),
    }),
    summary: (b) => `Added ${b.colour.label} to ${b.id}`,
    apply: async (c, b) => {
      await catalogRecord(c.tx, b.id);
      if (await one(c.tx, 'SELECT 1 FROM command.shop_colours WHERE product_id = $1 AND (id = $2 OR lower(label) = lower($3))', [b.id, b.colour.id, b.colour.label]))
        throw new ActionError(409, 'TAKEN', `It already comes in ${b.colour.label}`);
      const sizes = await sizesOf(c.tx, b.id);
      await c.tx.query('INSERT INTO command.shop_colours (product_id, id, position, label, swatch, tone, fill) VALUES ($1, $2, (SELECT coalesce(max(position), -1) + 1 FROM command.shop_colours WHERE product_id = $1), $3, $4, $5, $6)', [
        b.id, b.colour.id, b.colour.label, b.colour.swatch, b.colour.tone, !!b.colour.fill,
      ]);
      // a garment: the colour in each of its sizes; otherwise the colour is the variant
      const vs: CatalogVariant[] = sizes.length ? sizes.map((sz) => ({ id: `${b.colour.id}-${sz}`, label: `${b.colour.label} · ${sz.toUpperCase()}`, colour: b.colour.id, size: sz })) : [{ id: b.colour.id, label: b.colour.label, colour: b.colour.id }];
      for (const v of vs) await addVariant(c.tx, b.id, v);
      await addOption(c.tx, b.id, b.colour.label, sizes.length > 0);
      await history(c, b.id, `Added the colour ${b.colour.label}`);
    },
  },
  'colour-remove': {
    revalidates: true,
    body: z.object({ id, colour: z.string().trim().regex(SLUG).max(40) }),
    summary: (b) => `Took ${b.colour} off ${b.id}`,
    apply: async (c, b) => {
      await catalogRecord(c.tx, b.id);
      const col = await must<{ label: string }>(c.tx, 'SELECT label FROM command.shop_colours WHERE product_id = $1 AND id = $2', [b.id, b.colour], 'colour of that product');
      if (!(await one(c.tx, 'SELECT 1 FROM command.shop_colours WHERE product_id = $1 AND id <> $2', [b.id, b.colour]))) throw new ActionError(409, 'LAST', 'It needs at least one colour');
      await dropOption(c.tx, b.id, col.label);
      await c.tx.query('DELETE FROM command.shop_variants WHERE product_id = $1 AND colour = $2', [b.id, b.colour]);
      await c.tx.query('DELETE FROM command.shop_colours WHERE product_id = $1 AND id = $2', [b.id, b.colour]);
      await history(c, b.id, `Took off the colour ${col.label}`);
    },
  },
  'variant-add': {
    revalidates: true,
    body: z
      .object({ id, label: text(80).min(1), price: money.positive().nullable().default(null), deposit: money.positive().nullable().default(null), per: text(40).nullable().default(null) })
      .refine((b) => b.deposit == null || (b.price ?? Infinity) >= b.deposit, 'A deposit can’t be more than the price'),
    summary: (b) => `Added ${b.label} to ${b.id}${b.price != null ? ` · $${b.price.toFixed(2)}` : ''}${b.deposit != null ? ` · $${b.deposit.toFixed(2)} deposit` : ''}`,
    // a new price on a product the store sells, the same as changing one
    second: (b, db) => (b.price != null || b.deposit != null ? livePriceChange(db, b.id, () => true) : false),
    apply: async (c, b) => {
      await catalogRecord(c.tx, b.id);
      if (await one(c.tx, 'SELECT 1 FROM command.shop_colours WHERE product_id = $1', [b.id])) throw new ActionError(409, 'COLOURS', 'It comes in colours: add a colour instead');
      const vid = b.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'option';
      if (await one(c.tx, 'SELECT 1 FROM command.shop_variants WHERE product_id = $1 AND (id = $2 OR lower(label) = lower($3))', [b.id, vid, b.label])) throw new ActionError(409, 'TAKEN', `It already has ${b.label}`);
      await addVariant(c.tx, b.id, { id: vid, label: b.label, ...(b.price != null ? { priceCents: cents(b.price) } : {}), ...(b.deposit != null ? { depositCents: cents(b.deposit) } : {}), ...(b.per ? { per: b.per } : {}) });
      await addOption(c.tx, b.id, b.label, false);
      await history(c, b.id, `Added ${b.label}`);
      return { variant: vid };
    },
  },
  'variant-remove': {
    revalidates: true,
    body: z.object({ id, variant: z.string().trim().regex(SLUG).max(64) }),
    summary: (b) => `Took ${b.variant} off ${b.id}`,
    apply: async (c, b) => {
      await catalogRecord(c.tx, b.id);
      const v = await must<{ label: string; colour: string | null }>(c.tx, 'SELECT label, colour FROM command.shop_variants WHERE product_id = $1 AND id = $2', [b.id, b.variant], 'variant of that product');
      if (v.colour) throw new ActionError(409, 'COLOURS', 'It’s one of a colour’s sizes: take the colour off instead');
      if (!(await one(c.tx, 'SELECT 1 FROM command.shop_variants WHERE product_id = $1 AND id <> $2', [b.id, b.variant]))) throw new ActionError(409, 'LAST', 'It needs at least one option to sell');
      await dropOption(c.tx, b.id, v.label);
      await c.tx.query('DELETE FROM command.shop_variants WHERE product_id = $1 AND id = $2', [b.id, b.variant]);
      await history(c, b.id, `Took off ${v.label}`);
    },
  },
  'catalog-add': {
    revalidates: true,
    body: z
      .object({
        title: text(120).min(1),
        slug: z.string().trim().regex(SLUG, 'Lowercase letters, numbers and dashes').max(80),
        section: z.enum(['goods', 'for-shops']),
        kind: z.string().trim().regex(SLUG).max(30),
        category: text(60).min(1),
        alsoIn: z.array(text(60).min(1)).max(10).default([]),
        tagline: text(200).default(''),
        description: text(2000).default(''),
        details: z.array(text(200).min(1)).max(20).default([]),
        price: money.positive(),
        // hardware is reserved: what each option holds now
        deposit: money.positive().nullable().default(null),
        variantLabel: text(40).nullable().default(null),
        colours: z.array(z.object({ id: z.string().trim().regex(SLUG).max(40), label: text(40).min(1), swatch: z.string().regex(/^#[0-9A-Fa-f]{6}$/), tone: z.enum(['ink', 'land', 'paper']), fill: z.boolean().optional() })).max(12).default([]),
        sizes: z.array(z.enum(['xs', 's', 'm', 'l', 'xl', 'xxl'])).max(6).default([]),
        options: z.array(text(80).min(1)).max(20).default([]),
        weightOz: z.number().positive().max(2000),
        ships: text(40).nullable().default(null),
      })
      .refine((b) => b.deposit == null || b.deposit <= b.price, 'A deposit can’t be more than the price')
      .refine((b) => !(b.colours.length && b.options.length), 'A product comes in colours or in options, not both'),
    summary: (b) => `Added ${b.title} to the catalog as a draft`,
    apply: async (c, b) => {
      const dep = b.deposit != null ? { depositCents: cents(b.deposit) } : {};
      // in colours: each colour in each size (or the colour alone); else each option, or one size
      const variants: CatalogVariant[] = b.colours.length
        ? b.colours.flatMap((col: CatalogColour) => (b.sizes.length ? b.sizes.map((sz: string) => ({ id: `${col.id}-${sz}`, label: `${col.label} · ${sz.toUpperCase()}`, colour: col.id, size: sz, ...dep })) : [{ id: col.id, label: col.label, colour: col.id, ...dep }]))
        : (b.options.length ? b.options : ['One size']).map((label: string) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'one', label, ...dep }));
      if (new Set(variants.map((v) => v.id)).size !== variants.length) throw new ActionError(400, 'BAD_REQUEST', 'Two options have the same name');
      const p: CatalogProduct = {
        slug: b.slug, section: b.section, name: b.title, line: b.tagline, description: b.description, priceCents: cents(b.price), kind: b.kind, category: b.category, alsoIn: b.alsoIn,
        ...(b.variantLabel ? { variantLabel: b.variantLabel } : {}), variants, colours: b.colours, details: b.details, weightOz: b.weightOz,
        ...(b.ships ? (b.section === 'for-shops' ? { preorder: { ships: b.ships, fcc: false } } : { ships: b.ships }) : {}), status: 'draft',
      };
      const pid = await addToCatalog(c.tx, p, c.at, who(c.person));
      if (!pid) throw new ActionError(409, 'TAKEN', `Another product has the address ${b.slug}`);
      await shelve(c, pid, 'draft');
      return { id: pid };
    },
  },
  // product photos (Phase 11d): stored in the site's Blob store by POST /shop/photos/:id, then held here
  'photo-add': {
    revalidates: true,
    body: z.object({ id, src: z.string().trim().url().max(500), alt: text(200).default('') }),
    summary: (b) => `Added a photo to ${b.id}`,
    apply: async (c, b) => {
      const p = await photosOf(c.tx, b.id);
      if (!isProductPhoto(b.src, b.id)) throw new ActionError(400, 'BAD_PHOTO', 'That isn’t one of this product’s photos in the store');
      if (p.images.some((i) => i.src === b.src)) return { photos: p.images.length };
      if (p.images.length >= 12) throw new ActionError(409, 'TOO_MANY', 'A product shows up to 12 photos');
      await setPhotos(c.tx, b.id, [...p.images, { src: b.src, alt: b.alt || p.title }]);
      await history(c, b.id, 'Added a photo');
      return { photos: p.images.length + 1 };
    },
  },
  'photo-remove': {
    revalidates: true,
    body: z.object({ id, src: z.string().trim().max(500) }),
    summary: (b) => `Took a photo off ${b.id}`,
    apply: async (c, b) => {
      const p = await photosOf(c.tx, b.id);
      if (!p.images.some((i) => i.src === b.src)) throw new ActionError(404, 'NOT_FOUND', 'No such photo of that product');
      await setPhotos(c.tx, b.id, p.images.filter((i) => i.src !== b.src));
      await history(c, b.id, 'Took a photo off');
    },
    // its file goes from the store once the catalog has let it go
    after: (b) => deletePhoto(b.src),
  },
  'photo-move': {
    revalidates: true,
    body: z.object({ id, src: z.string().trim().max(500), to: z.number().int().min(0).max(11) }),
    summary: (b) => `Moved a photo of ${b.id} to ${b.to + 1}`,
    apply: async (c, b) => {
      const p = await photosOf(c.tx, b.id);
      const i = p.images.findIndex((x) => x.src === b.src);
      if (i < 0) throw new ActionError(404, 'NOT_FOUND', 'No such photo of that product');
      const rest = p.images.filter((_, k) => k !== i);
      rest.splice(Math.min(b.to, rest.length), 0, p.images[i]);
      await setPhotos(c.tx, b.id, rest);
      if (b.to === 0 && i !== 0) await history(c, b.id, 'Chose the first photo');
    },
  },
  'photo-alt': {
    revalidates: true,
    body: z.object({ id, src: z.string().trim().max(500), alt: text(200).min(1) }),
    summary: (b) => `Described a photo of ${b.id}`,
    apply: async (c, b) => {
      const p = await photosOf(c.tx, b.id);
      if (!p.images.some((i) => i.src === b.src)) throw new ActionError(404, 'NOT_FOUND', 'No such photo of that product');
      await setPhotos(c.tx, b.id, p.images.map((i) => (i.src === b.src ? { ...i, alt: b.alt } : i)));
    },
  },
  'shelf-off': {
    revalidates: true,
    body: z.object({ id, why: text(120).min(1) }),
    summary: (b) => `Took ${b.id} off the shelf · ${b.why}`,
    apply: async (c, b) => {
      await prod(c.tx, b.id, c);
      await c.tx.query(`UPDATE command.shop_products SET status = 'off', why = $2 WHERE id = $1`, [b.id, b.why]);
      await shelve(c, b.id, 'off');
      await history(c, b.id, `Taken off the shelf · ${b.why.toLowerCase()}`);
    },
    outbox: catalogOutbox,
  },
  'shelf-on': {
    revalidates: true,
    body: z.object({ id }),
    summary: (b) => `Put ${b.id} on the shelf`,
    apply: async (c, b) => {
      await prod(c.tx, b.id, c);
      await c.tx.query(`UPDATE command.shop_products SET status = 'on', why = NULL WHERE id = $1`, [b.id]);
      await shelve(c, b.id, 'on');
      await history(c, b.id, 'Put on the shelf');
    },
    outbox: catalogOutbox,
  },
  archive: {
    revalidates: true,
    body: z.object({ id, why: text(120).default('Archived') }),
    summary: (b) => `Archived ${b.id}`,
    apply: async (c, b) => {
      await prod(c.tx, b.id, c);
      await c.tx.query(`UPDATE command.shop_products SET status = 'arch', why = $2 WHERE id = $1`, [b.id, b.why]);
      await c.tx.query('UPDATE command.shop_shelf SET ends_at = $2 WHERE product_id = $1 AND ends_at IS NULL', [b.id, c.at]);
      await history(c, b.id, `Archived · ${b.why.toLowerCase()}`);
    },
    outbox: catalogOutbox,
  },
  restore: {
    revalidates: true,
    body: z.object({ id }),
    summary: (b) => `Restored ${b.id} as a draft`,
    apply: async (c, b) => {
      await prod(c.tx, b.id, c);
      await c.tx.query(`UPDATE command.shop_products SET status = 'draft', why = 'Restored' WHERE id = $1`, [b.id]);
      await shelve(c, b.id, 'draft');
      await history(c, b.id, 'Restored as a draft');
    },
  },
  restock: {
    body: z.object({ id, units: z.array(z.object({ option: text(40), size: SIZE, n: z.number().int().positive().max(10000) })).min(1).max(100), cost: money }),
    summary: async (b, db) => `Restock ${(await prod(db, b.id)).name} · ${b.units.reduce((a: number, u: { n: number }) => a + u.n, 0)} units`,
    second: (b, db) => overLimit(db, 'shopbuy', b.cost),
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
    second: (b, db) => overLimit(db, 'refund', b.amount),
    apply: async (c, b) => {
      const o = await must<{ items: Array<[string, string, string, number]> }>(c.tx, 'SELECT items FROM command.shop_orders WHERE id = $1', [b.order], 'order');
      const [pid, , size] = o.items[0];
      // only its name: a live order's items carry the site's slug, which the catalog answers
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
    second: (b, db) => overLimit(db, 'refund', b.amount),
    outbox: true,
  },
  'signup-link': { body: z.object({ id }), summary: (b) => `Send pre-order ${b.id} the merchant sign-up link`, outbox: true },
  ...costing,
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
  settings: settingsActions,
};

export const actionFor = (section: string, kind: string): Action | undefined => ACTIONS[section as Section]?.[kind];
export const levelFor = (a: Action) => a.level ?? PROPOSE;
