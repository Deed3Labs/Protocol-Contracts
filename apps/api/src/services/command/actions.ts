import { DAY, SEED_TODAY } from '@clear/command-types';
import { z } from 'zod';
import type { Queryable } from '../../db/db.js';
import { APPROVE, PROPOSE, type Level, type Levels, type Section } from './levels.js';
import { providerFor, startPlannedRoute } from './sections.js';
import { addToCatalog, adoptSiteProduct, deletePhoto, isProductPhoto, siteProductRow, type CatalogColour, type CatalogProduct, type CatalogVariant } from './catalog.js';
import { productCost, readBook, roundCents, runUses } from './costing.js';
import { recordOverhead, type OrderRow } from './shopModel.js';
import type { Person } from './store.js';
import { requestSync } from './feeds.js';
import { BATCH_ORDERS, sendBatch } from './waitlist.js';
import { ActionError } from './actionError.js';
import { overLimit, readSetting, settingsActions } from './settings.js';

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
  /** The proposal it ran from, when it did. */
  proposal?: string | null;
  /** When it happened: the prototype's day and time for a seeded section, else now. */
  at: Date;
  /** The asker's levels, when they asked for it themselves (not from an approval): Field's routes are their own unless they approve there. */
  levels?: Levels;
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

/** How long an approved export can be used: once, within a day of the approval. */
export const EXPORT_HOURS = 24;

/**
 * Asking for a whole list with names (Settings → Data exports need a second person): Approve on the
 * section to ask, always a second person, and the approval writes a grant only the asker can use, once.
 */
const exportAction = (section: 'members' | 'growth', what: string): Action => ({
  level: APPROVE,
  body: z.object({ reason: text(300).min(1) }),
  summary: (b) => `Export ${what} with names · ${b.reason}`,
  second: () => true,
  apply: async ({ tx, person, approver }, b) => {
    if (!approver) throw new ActionError(403, 'SECOND_PERSON', 'An export needs a second person');
    // its day runs on the real clock, even where a seeded section dates its actions on the prototype's day
    const at = new Date();
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO command.export_grants (section, person_id, reason, approved_by, approved_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [section, person.id, b.reason, approver.id, at, new Date(at.getTime() + EXPORT_HOURS * 3600e3)],
    );
    return { grant: rows[0].id };
  },
});

const COST_KIND: Record<string, string> = { print: 'printing', ads: 'ads', offer: '$10 offers', credit: 'referral credit' };
/** A campaign as people say it: "poster design A", or the tagged link's name. */
const campaignName = (c: string) => (c.startsWith('design:') ? `poster design ${c.slice(7)}` : c.slice(4));

const growth: Record<string, Action> = {
  export: exportAction('growth', 'the join forms'),
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
  // what a campaign cost, as someone records it: Command's own record, nothing is paid from here
  'campaign-cost': {
    body: z.object({
      campaign: z.string().trim().regex(/^(design|utm):.+$/).max(140),
      kind: z.enum(['print', 'ads', 'offer', 'credit']),
      amount: money.positive(),
      spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: text(200).default(''),
    }),
    summary: (b) => `Recorded $${b.amount.toFixed(2)} of ${COST_KIND[b.kind]} for ${campaignName(b.campaign)}`,
    apply: async ({ tx, person }, b) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO command.campaign_costs (campaign, kind, amount_cents, spent_on, note, recorded_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [b.campaign, b.kind, cents(b.amount), b.spentOn, b.note, person.id],
      );
      return { id: Number(rows[0].id) };
    },
  },
  'campaign-cost-remove': {
    body: z.object({ id: z.number().int().positive() }),
    summary: async (b, db) => {
      const c = await one<{ campaign: string; kind: string; amount_cents: number }>(db, 'SELECT campaign, kind, amount_cents FROM command.campaign_costs WHERE id = $1', [b.id]);
      return c ? `Removed $${(c.amount_cents / 100).toFixed(2)} of ${COST_KIND[c.kind]} from ${campaignName(c.campaign)}` : `Removed campaign cost ${b.id}`;
    },
    apply: async ({ tx }, b) => {
      await must(tx, 'DELETE FROM command.campaign_costs WHERE id = $1 RETURNING id', [b.id], 'campaign cost');
    },
  },
};

// ── Field ───────────────────────────────────────────────────────────────────

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmmOf = z.string().regex(/^[0-2]\d:[0-5]\d$/);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayName = (day: string) => {
  const d = new Date(day + 'T00:00:00Z');
  return `${WDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
/** A stop on a planned route, as the Plan tab has it: what needs a visit it came from (`ref`), or one of its own. */
const planStop = z.object({
  ref: z.string().trim().min(1).max(80),
  kind: z.enum(['poster', 'new', 'merchant', 'device', 'visit']),
  shop: text(120).min(1),
  city: text(80).default(''),
  what: text(120).min(1),
  why: text(200).default(''),
  mins: z.number().int().min(0).max(600),
  n: z.number().int().positive().nullable().default(null),
  design: z.string().regex(/^[A-Z]$/).nullable().default(null),
  eta: hhmmOf.nullable().default(null),
});
/** The page's estimate for the route as it stands. */
const planFigures = { miles: z.number().int().min(0).max(2000).default(0), minutes: z.number().int().min(0).max(24 * 60).default(0), backBy: hhmmOf.nullable().default(null) };
const nameOf = async (db: Queryable, id: string) => (await one<{ n: string }>(db, `SELECT coalesce(nullif(name, ''), split_part(email, '@', 1), 'Someone') AS n FROM command.people WHERE id = $1`, [id]))?.n ?? 'Someone';
/** An admin on Field (Approve) plans anyone's routes; anyone else with Field access plans their own. */
const fieldAdmin = (c: Ctx) => (c.levels?.field ?? 0) >= APPROVE;
async function canPlan(c: Ctx, who: string, day: string | Date) {
  if (who !== c.person.id && !fieldAdmin(c)) throw new ActionError(403, 'NOT_YOURS', 'You can plan your own routes. To plan for someone else, ask an admin.');
  await must(c.tx, 'SELECT id FROM command.people WHERE id = $1', [who], 'person');
  if (new Date(day).getTime() < dayStart(c.at).getTime()) throw new ActionError(400, 'PAST_DAY', 'Routes are planned for today or the days ahead');
}
/** A planned route the asker can change: their own, or anyone's for an admin. */
async function planOf(c: Ctx, id: number) {
  const r = await must<{ id: number; day: Date; person_id: string; start: string; status: string }>(c.tx, 'SELECT id, day, person_id, start, status FROM command.route_plans WHERE id = $1', [id], 'planned route');
  if (r.person_id !== c.person.id && !fieldAdmin(c)) throw new ActionError(403, 'NOT_YOURS', 'Only the person whose route it is, or an admin, can change it');
  return r;
}
/** A route's stops, replaced in the order given (a poster the list doesn't have is kept as the stop's own words). */
async function putStops(tx: Queryable, plan: number, stops: z.infer<typeof planStop>[]) {
  if (new Set(stops.map((s) => s.ref)).size !== stops.length) throw new ActionError(400, 'BAD_REQUEST', 'A stop is on the route twice');
  const ns = stops.map((s) => s.n).filter((n): n is number => n != null);
  const known = new Set(ns.length ? (await tx.query<{ n: number }>('SELECT n FROM command.posters WHERE n = ANY($1)', [ns])).rows.map((r) => r.n) : []);
  await tx.query('DELETE FROM command.route_plan_stops WHERE plan_id = $1', [plan]);
  for (const [i, s] of stops.entries())
    await tx.query(
      'INSERT INTO command.route_plan_stops (plan_id, position, ref, kind, shop, city, what, why, mins, poster, design, eta) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [plan, i, s.ref, s.kind, s.shop, s.city, s.what, s.why, s.mins, s.n != null && known.has(s.n) ? s.n : null, s.design, s.eta],
    );
}

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
  // Routes planned for the coming days (Plan): a draft, sent to the person whose route it is, then accepted. Changing a
  // route someone already has makes it a draft again, so it goes again. Accepted for today, it becomes today's route.
  'route-plan': {
    body: z.object({ day: isoDay, who: z.string().uuid(), start: text(40).default('office'), stops: z.array(planStop).max(40).default([]), ...planFigures }),
    summary: async (b, db) => `Planned a route for ${await nameOf(db, b.who)} on ${dayName(b.day)}`,
    apply: async (c, b) => {
      await canPlan(c, b.who, b.day);
      const r = await one<{ id: number }>(
        c.tx,
        `INSERT INTO command.route_plans (day, person_id, start, miles, minutes, back_by, planned_by) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (day, person_id) DO NOTHING RETURNING id`,
        [b.day, b.who, b.start || 'office', b.miles, b.minutes, b.backBy, c.person.id],
      );
      if (!r) throw new ActionError(409, 'TAKEN', `${await nameOf(c.tx, b.who)} already has a route that day`);
      await putStops(c.tx, r.id, b.stops);
      return { id: r.id };
    },
  },
  'route-save': {
    body: z.object({ id: z.number().int().positive(), who: z.string().uuid().optional(), start: text(40).optional(), stops: z.array(planStop).max(40), ...planFigures }),
    summary: () => 'Changed a planned route',
    apply: async (c, b) => {
      const r = await planOf(c, b.id);
      const to = b.who ?? r.person_id;
      if (to !== r.person_id) {
        await canPlan(c, to, r.day);
        if (await one(c.tx, 'SELECT 1 FROM command.route_plans WHERE day = $1 AND person_id = $2 AND id <> $3', [r.day, to, r.id]))
          throw new ActionError(409, 'TAKEN', `${await nameOf(c.tx, to)} already has a route that day`);
      }
      // a route that's been sent or saved goes again once it's changed
      await c.tx.query(
        `UPDATE command.route_plans SET person_id = $2, start = $3, miles = $4, minutes = $5, back_by = $6,
           changed = (status <> 'draft') OR changed, status = 'draft' WHERE id = $1`,
        [r.id, to, b.start || r.start, b.miles, b.minutes, b.backBy],
      );
      await putStops(c.tx, r.id, b.stops);
    },
  },
  'route-send': {
    body: z.object({ id: z.number().int().positive(), note: text(500).default('') }),
    summary: () => 'Sent a planned route',
    // Command keeps the route; putting it on their phone is the outside system's
    outbox: true,
    apply: async (c, b) => {
      const r = await planOf(c, b.id);
      if (!(await one(c.tx, 'SELECT 1 FROM command.route_plan_stops WHERE plan_id = $1', [r.id]))) throw new ActionError(400, 'NO_STOPS', 'Add a stop before sending the route');
      await c.tx.query(`UPDATE command.route_plans SET status = 'sent', changed = false, sent_at = $2, sent_by = $3, note = nullif($4, '') WHERE id = $1`, [r.id, c.at, c.person.id, b.note]);
    },
  },
  'route-take-back': {
    body: z.object({ id: z.number().int().positive() }),
    summary: () => 'Took back a sent route',
    apply: async (c, b) => {
      const r = await planOf(c, b.id);
      if (r.status !== 'sent') throw new ActionError(409, 'NOT_SENT', 'That route isn’t waiting to be accepted');
      await c.tx.query(`UPDATE command.route_plans SET status = 'draft' WHERE id = $1`, [r.id]);
    },
  },
  // the person accepting their route (or saving their own), or an admin marking it accepted on their word
  'route-accept': {
    body: z.object({ id: z.number().int().positive() }),
    summary: () => 'Accepted a planned route',
    apply: async (c, b) => {
      const r = await planOf(c, b.id);
      if (!(await one(c.tx, 'SELECT 1 FROM command.route_plan_stops WHERE plan_id = $1', [r.id]))) throw new ActionError(400, 'NO_STOPS', 'A route needs a stop before it’s accepted');
      await c.tx.query(`UPDATE command.route_plans SET status = 'accepted', changed = false, accepted_at = $2, accepted_by = $3 WHERE id = $1`, [r.id, c.at, c.person.id]);
      // accepted for today, it's today's route (when there isn't one already)
      return { today: await startPlannedRoute(c.tx, isoOf(dayStart(c.at))) };
    },
  },
  // the van's load this morning (Today): posters by design, spare batteries and receipt rolls; recorded again, it's replaced
  van: {
    body: z.object({
      posters: z.record(z.string().regex(/^[A-Z]$/), z.number().int().min(0).max(500)).default({}),
      batteries: z.number().int().min(0).max(100).default(0),
      rolls: z.number().int().min(0).max(200).default(0),
      note: text(300).default(''),
      at: hhmmOf.optional(),
    }),
    summary: (b) => `Loaded the van · ${Object.values(b.posters).reduce((s: number, n) => s + (n as number), 0)} posters, ${b.batteries} batteries, ${b.rolls} receipt rolls`,
    apply: async ({ tx, at, person }, b) => {
      const d = dayStart(at),
        when = b.at ?? hhmm(at);
      const posters = Object.fromEntries(Object.entries(b.posters as Record<string, number>).filter(([, n]) => n > 0));
      await tx.query(
        `INSERT INTO command.van_loads (day, loaded_at, posters, batteries, rolls, note, recorded_by, recorded_at) VALUES ($1, $2, $3, $4, $5, nullif($6, ''), $7, $8)
         ON CONFLICT (day) DO UPDATE SET loaded_at = EXCLUDED.loaded_at, posters = EXCLUDED.posters, batteries = EXCLUDED.batteries, rolls = EXCLUDED.rolls, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by, recorded_at = EXCLUDED.recorded_at`,
        [d, when, JSON.stringify(posters), b.batteries, b.rolls, b.note, person.id, at],
      );
      // today's route says when the van was loaded
      await tx.query('UPDATE command.routes SET loaded_at = $2 WHERE day = $1', [d, when]);
    },
  },
  // a shop said yes to a poster (Placement): on a visit, from the pipeline, or by hand
  'poster-yes': {
    body: z.object({ shop: text(120).min(1), city: text(80).default(''), card: id.nullable().default(null), source: z.enum(['visit', 'pipeline', 'hand']).default('hand'), design: z.string().regex(/^[A-Z]$/).nullable().default(null), note: text(300).default('') }),
    summary: (b) => `${b.shop} said yes to a poster`,
    apply: async ({ tx, at, person }, b) => {
      if (b.design) await must(tx, 'SELECT code FROM command.poster_designs WHERE code = $1', [b.design], 'design');
      const r = await one<{ id: number }>(
        tx,
        `INSERT INTO command.poster_yes (shop, city, card_id, source, agreed_on, agreed_by, design, note) VALUES ($1, $2, $3, $4, $5, $6, $7, nullif($8, ''))
         ON CONFLICT (lower(shop), lower(city)) WHERE placed_on IS NULL AND dropped_at IS NULL DO NOTHING RETURNING id`,
        [b.shop, b.city, b.card, b.source, dayStart(at), person.id, b.design, b.note],
      );
      if (!r) throw new ActionError(409, 'ALREADY', `${b.shop} has already said yes`);
      return { id: r.id };
    },
  },
  // the poster is up: it joins the posters (as Growth's poster-add puts one up), and the shop is placed
  'poster-placed': {
    body: z.object({ id: z.number().int().positive(), design: z.string().regex(/^[A-Z]$/) }),
    summary: () => 'Put up a first poster at a shop that said yes',
    apply: async (c, b) => {
      const y = await must<{ id: number; shop: string; city: string }>(c.tx, 'SELECT id, shop, city FROM command.poster_yes WHERE id = $1 AND placed_on IS NULL AND dropped_at IS NULL', [b.id], 'shop waiting for a poster');
      const { n } = (await growth['poster-add'].apply!(c, { place: y.shop, city: y.city || '–', design: b.design })) as { n: number };
      await c.tx.query('UPDATE command.poster_yes SET placed_on = $2, poster = $3, design = $4 WHERE id = $1', [y.id, dayStart(c.at), n, b.design]);
      return { n };
    },
  },
  'poster-no': {
    body: z.object({ id: z.number().int().positive(), reason: text(200).default('') }),
    summary: (b) => `A shop no longer wants a poster${b.reason ? ` · ${b.reason}` : ''}`,
    apply: async ({ tx, at }, b) => {
      const r = await tx.query('UPDATE command.poster_yes SET dropped_at = $2 WHERE id = $1 AND placed_on IS NULL AND dropped_at IS NULL RETURNING 1', [b.id, at]);
      if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', 'No such shop waiting for a poster');
    },
  },
};

// ── Members ─────────────────────────────────────────────────────────────────

const member = z.object({ id: z.number().int().positive() });
/** A person on Members, by the masked number the page shows: M-0001 for a member, W-0001 for someone waiting. */
const subject = z.string().trim().regex(/^[MW]-\d{4,9}$/, 'A member number, like M-0001');
/** A note or tag holds no contact details: they stay masked, and a reveal is the only way to see them. */
const noContact = (v: string) => !/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(v) && !/(\d[\s().-]*){7,}/.test(v);
const NO_CONTACT = 'Leave out emails and phone numbers: they stay masked, and Show name is the way to see them';

const members: Record<string, Action> = {
  export: exportAction('members', 'the member list'),
  // notes and tags, Command's own record of a person (migration 0068), by their masked number
  note: {
    body: z.object({ subject, text: text(1000).min(1).refine(noContact, NO_CONTACT) }),
    summary: (b) => `Added a note on ${b.subject}`,
    apply: async ({ tx, person, at }, b) => {
      await tx.query('INSERT INTO command.member_notes (subject, body, person_id, at) VALUES ($1, $2, $3, $4)', [b.subject, b.text, person.id, at]);
    },
  },
  tag: {
    body: z.object({ subject, tag: text(40).min(1).refine(noContact, NO_CONTACT) }),
    summary: (b) => `Tagged ${b.subject} “${b.tag}”`,
    apply: async ({ tx, person, at }, b) => {
      await tx.query('INSERT INTO command.member_tags (subject, tag, person_id, at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [b.subject, b.tag, person.id, at]);
    },
  },
  untag: {
    body: z.object({ subject, tag: text(40).min(1) }),
    summary: (b) => `Took the tag “${b.tag}” off ${b.subject}`,
    apply: async ({ tx }, b) => {
      const r = await tx.query('DELETE FROM command.member_tags WHERE subject = $1 AND tag = $2 RETURNING 1', [b.subject, b.tag]);
      if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', 'That tag isn’t on them');
    },
  },
  resend: { body: member, summary: () => 'Resend a member’s invite', outbox: true },
  nudge: { body: member, summary: () => 'Nudge a member to finish joining', outbox: true },
  off: { body: member.extend({ reason: text(200).default('') }), summary: () => 'Turn off a member’s access', outbox: true },
  // live (Phase 7b): once a second person approves, the next people waiting get their codes and the
  // emails are queued for the invite job; on the seed it's recorded, as before. Who goes first: the old
  // page's oldest, posters or city (Redlands first), or the redesign's cities, shops (their posters) or
  // people picked by hand, which take no one else; `why` is what was said for skipping people who waited longer.
  batch: {
    body: z
      .object({
        size: z.number().int().positive().max(500),
        order: text(40).default('oldest'),
        cities: z.array(text(80).min(1)).max(50).optional(),
        posters: z.array(text(120).min(1)).max(200).optional(),
        ids: z.array(z.number().int().positive()).max(500).optional(),
        why: text(300).default(''),
      })
      .refine((b) => (b.order !== 'cities' || b.cities?.length) && (b.order !== 'shops' || b.posters?.length) && (b.order !== 'picked' || b.ids?.length), 'Say which cities, shops or people the batch takes'),
    summary: (b) => `Send the next batch of ${b.size} invites${BATCH_FROM[b.order as string]?.(b) ?? ''}`,
    second: () => true,
    apply: async ({ tx, person, at }, b) => {
      if (providerFor('members') !== 'live') return;
      const order = BATCH_ORDERS.find((o) => o === b.order) ?? 'oldest';
      try {
        return await sendBatch(tx, b.size, order, who(person), at, { cities: b.cities, posters: b.posters, ids: b.ids });
      } catch (e: any) {
        if (e?.code === 'NOBODY_WAITING') throw new ActionError(409, e.code, e.message);
        throw e;
      }
    },
    outbox: () => providerFor('members') !== 'live',
  },
};
/** What a limited batch says it takes, for the audit log and Needs you. */
const BATCH_FROM: Record<string, (b: { cities?: string[]; posters?: string[]; ids?: number[] }) => string> = {
  cities: (b) => ` from ${b.cities!.join(', ')}`,
  shops: (b) => ` from ${b.posters!.length === 1 ? 'one poster' : `${b.posters!.length} posters`}`,
  picked: (b) => `, picked by hand`,
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
  /** Where the shop sells: in person (a storefront, on Field's routes at its address) or online (e-commerce, for the API). Left out, a saved card keeps its own. */
  sells: z.enum(['in_person', 'online']).optional(),
  note: text(2000).default(''),
  flag: z.boolean().default(false),
  /** Log lines added since it was last saved, oldest first. */
  log: z.array(z.object({ text: text(500).min(1), type: z.enum(['note', 'call', 'visit', 'demo', 'stage', 'edit']) })).max(50).default([]),
  /** The shop enquiry it was added from (a form submission): marked added, with this card. */
  enquiry: z.number().int().positive().optional(),
});
/** A shop enquiry from the site's join form, by its id. */
const enquiryId = z.number().int().positive();
const ENQUIRY_STATE = { replied: 'Replied', notfit: 'Not a fit', new: 'New' } as const;
const markEnquiry = async (tx: Queryable, eid: number, status: string, by: Person, at: Date, extra: { card?: string; why?: string } = {}) => {
  const r = await tx.query(
    `UPDATE command.form_submissions SET status = $2, card_id = $3, why = $4, handled_by = $5, handled_at = $6 WHERE id = $1 AND form = 'Shop enquiry' RETURNING 1`,
    [eid, status, extra.card ?? null, extra.why ?? '', status === 'New' ? null : who(by), status === 'New' ? null : at],
  );
  if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', 'No such shop enquiry');
};

/** A payout run's month of sales ('2026-09'), and the line each shop has in it, as the page drew them. */
const PERIOD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const ISO_DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const runLine = z.object({ id, name: text(200), sales: money, fee: money, red: money, total: money });
/** The month before `at`'s, as a period. */
const lastPeriod = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
/**
 * When a NET-30 run for a month's sales goes: 30 days after the month's last day, or the weekday after
 * when that's a weekend. The page sends what it showed; this is the same rule, for a run sent without.
 */
export const runGoes = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0) + 30 * DAY);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** The refurb line's stages, in order. */
export const REFURB_STAGES = ['bought', 'repair', 'testing', 'ready', 'shipped'] as const;
const refurbUnit = (db: Queryable, uid: number) => must<{ id: number; model: string; stage: string; shop_name: string | null }>(db, 'SELECT id, model, stage, shop_name FROM command.refurb_units WHERE id = $1', [uid], 'refurb unit');
const merchants: Record<string, Action> = {
  'card-save': {
    body: card,
    summary: (b) => `Updated ${b.name} on the pipeline`,
    apply: async ({ tx, person, at }, b) => {
      const cur = await one<{ position: number }>(tx, 'SELECT position FROM command.merchant_stage WHERE id = $1 AND removed_at IS NULL', [b.id]);
      const pos = cur?.position ?? (await one<{ p: number }>(tx, 'SELECT coalesce(min(position), 0) - 1 AS p FROM command.merchant_stage', []))!.p;
      const touched = b.log.some((l: { type: string }) => ['call', 'visit', 'demo', 'note'].includes(l.type));
      await tx.query(
        `INSERT INTO command.merchant_stage (id, position, name, kind, city, stage, owner, per_month_cents, next_step, due_on, contact, source, address, notes, flag, last_contact_at, added_at, sells)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, coalesce($18, 'in_person'))
         ON CONFLICT (id) DO UPDATE SET name = $3, kind = $4, city = $5, stage = $6, owner = $7, per_month_cents = $8, next_step = $9, due_on = $10, contact = $11,
           source = $12, address = $13, notes = $14, flag = $15, last_contact_at = coalesce($16, command.merchant_stage.last_contact_at),
           sells = coalesce($18, command.merchant_stage.sells)`,
        [b.id, pos, b.name, b.kind, b.city, b.stage, b.owner, b.val == null ? null : cents(b.val), b.next, b.due == null ? null : new Date(b.due), JSON.stringify(b.contact), b.source, b.addr, b.note, b.flag, touched ? dayStart(at) : null, at, b.sells ?? null],
      );
      for (const l of b.log) await tx.query('INSERT INTO command.merchant_activity (stage_id, at, kind, text, who) VALUES ($1, $2, $3, $4, $5)', [b.id, at, l.type, l.text, who(person)]);
      if (b.enquiry) await markEnquiry(tx, b.enquiry, 'Added', person, at, { card: b.id });
    },
  },
  // ── shop enquiries (the site's join form, "I run a shop"): answered, or turned down; added is card-save's
  enquiry: {
    body: z.object({ id: enquiryId, state: z.enum(['replied', 'notfit', 'new']), why: text(200).default('') }),
    summary: (b) => (b.state === 'replied' ? `Answered shop enquiry #${b.id}` : b.state === 'notfit' ? `Turned down shop enquiry #${b.id}${b.why ? ` · ${b.why}` : ''}` : `Opened shop enquiry #${b.id} again`),
    apply: async ({ tx, person, at }, b) => markEnquiry(tx, b.id, ENQUIRY_STATE[b.state as keyof typeof ENQUIRY_STATE], person, at, { why: b.state === 'notfit' ? b.why : '' }),
  },
  // ── the refurb line: Command's own record, so no second person (nothing here moves money)
  'refurb-add': {
    body: z.object({ model: text(120).min(1), serial: text(80).default(''), cost: money.nullable().default(null), note: text(500).default('') }),
    summary: (b) => `Added a ${b.model} to the refurb line`,
    apply: async ({ tx, person, at }, b) => {
      const { rows } = await tx.query<{ id: number }>(
        'INSERT INTO command.refurb_units (model, serial, cost_cents, note, added_by, added_at, moved_at) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id',
        [b.model, b.serial, b.cost == null ? null : cents(b.cost), b.note, who(person), at],
      );
      return { id: rows[0].id };
    },
  },
  'refurb-move': {
    body: z.object({ id: z.number().int().positive(), stage: z.enum(REFURB_STAGES) }),
    summary: (b) => `Moved refurb unit #${b.id} to ${b.stage}`,
    apply: async ({ tx, at }, b) => {
      const u = await refurbUnit(tx, b.id);
      if (b.stage === 'shipped' && !u.shop_name) throw new ActionError(409, 'NO_SHOP', 'Say which shop it goes to first');
      await tx.query(`UPDATE command.refurb_units SET stage = $2, moved_at = $3, shipped_at = CASE WHEN $2 = 'shipped' THEN coalesce(shipped_at, $3) END WHERE id = $1`, [b.id, b.stage, at]);
    },
  },
  'refurb-assign': {
    body: z.object({ id: z.number().int().positive(), shop: id.nullable(), name: text(200).default(''), ships: ISO_DAY.nullable().default(null) }),
    summary: (b) => (b.shop ? `Refurb unit #${b.id} goes to ${b.name || b.shop}` : `Refurb unit #${b.id} isn’t going to a shop`),
    apply: async ({ tx }, b) => {
      const u = await refurbUnit(tx, b.id);
      if (u.stage === 'shipped' && !b.shop) throw new ActionError(409, 'SHIPPED', 'It’s shipped: move it back a stage first');
      await tx.query('UPDATE command.refurb_units SET shop_id = $2, shop_name = $3, ships_on = $4 WHERE id = $1', [b.id, b.shop, b.shop ? b.name || b.shop : null, b.shop ? b.ships : null]);
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
  /**
   * The monthly (NET-30) run: always a second person. Approved, it's recorded as the month's run (one a
   * month) and goes to the outbox for the Ops Safe; waiting or sent back, it's only its proposal.
   */
  run: {
    body: z.object({ total: money, shops: z.number().int().nonnegative(), period: PERIOD.optional(), goes: ISO_DAY.optional(), lines: z.array(runLine).max(500).default([]) }),
    summary: (b) => `Monthly payout run${b.period ? ` for ${b.period}` : ''} · ${b.shops} shops · $${b.total.toFixed(2)}`,
    second: () => true,
    apply: async ({ tx, person, approver, at, proposal }, b) => {
      if (!approver || !proposal) throw new ActionError(403, 'SECOND_PERSON', 'A payout run needs a second person');
      const period = b.period ?? lastPeriod(at);
      if (await one(tx, 'SELECT 1 FROM command.payout_runs WHERE period = $1', [period])) throw new ActionError(409, 'RUN_DONE', `${period}’s run is already approved`);
      const p = (await one<{ created_at: Date }>(tx, 'SELECT created_at FROM command.proposals WHERE id = $1', [proposal]))!;
      await tx.query(
        `INSERT INTO command.payout_runs (proposal_id, period, goes_on, lines, total_cents, shops, proposed_by, proposed_at, approved_by, approved_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [proposal, period, b.goes ?? runGoes(period), JSON.stringify(b.lines), cents(b.total), b.shops, person.id, p.created_at, approver.id, at],
      );
    },
    outbox: true,
  },
  /** A run the Ops Safe has executed: marked paid (Command doesn't hear the Safe's execution yet). */
  'run-paid': {
    body: z.object({ run: z.string().uuid() }),
    summary: async (b, db) => `Marked ${(await one<{ period: string }>(db, 'SELECT period FROM command.payout_runs WHERE proposal_id = $1', [b.run]))?.period ?? 'a'} payout run paid`,
    apply: async ({ tx, person, at }, b) => {
      const r = await must<{ paid_at: Date | null }>(tx, 'SELECT paid_at FROM command.payout_runs WHERE proposal_id = $1 FOR UPDATE', [b.run], 'approved run');
      if (r.paid_at) throw new ActionError(409, 'PAID', 'That run is marked paid already');
      await tx.query('UPDATE command.payout_runs SET paid_at = $2, paid_by = $3 WHERE proposal_id = $1', [b.run, at, person.id]);
    },
  },
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
const orderState = (to: string, from: string[], line: string, tell: boolean, then?: (c: Ctx, order: string) => Promise<unknown>): Action => ({
  body: order,
  summary: (b) => `#${b.order} · ${line}`,
  apply: async (c, b) => {
    const r = await c.tx.query('UPDATE command.shop_orders SET state = $2 WHERE id = $1 AND state = ANY($3) RETURNING 1', [b.order, to, from]);
    if (!r.rows.length) throw new ActionError(409, 'WRONG_STATE', `Order #${b.order} can’t be ${line.toLowerCase()} from where it is`);
    if (then) await then(c, b.order);
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
type InputRow = { id: string; name: string; kind: string; unit: string; stocked: boolean; unit_cost_cents: string | null; archived_at: Date | null; per_order: boolean; on_pickup: boolean; supplier_id: string | null };
const inputRow = (db: Queryable, iid: string) => must<InputRow>(db, 'SELECT * FROM command.shop_inputs WHERE id = $1', [iid], 'input');
const liveInput = async (db: Queryable, iid: string) => {
  const i = await inputRow(db, iid);
  if (i.archived_at) throw new ActionError(409, 'ARCHIVED', `${i.name} is archived: restore it first`);
  return i;
};
/** An input a recipe can use: not archived, and not once per order (that's the order's, not an item's). */
const recipeInput = async (db: Queryable, iid: string) => {
  const i = await liveInput(db, iid);
  if (i.per_order) throw new ActionError(409, 'PER_ORDER', `${i.name} is used once per order, not in a product`);
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
    /** Once per order (packing for the whole order); left out keeps what it is. */
    perOrder: z.boolean().optional(),
    /** A once-per-order input a pickup uses too; left out keeps what it is. */
    onPickup: z.boolean().optional(),
    /** Its supplier's id; null clears it, left out keeps it. */
    supplier: id.nullable().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.onPickup && b.perOrder === false) ctx.addIssue({ code: 'custom', message: 'Only a once-per-order input is used on a pickup' });
    if (b.kind === 'labour' && b.unit !== 'h') ctx.addIssue({ code: 'custom', message: 'Labour is costed by the hour (h)' });
    if (b.stocked && b.kind !== 'material') ctx.addIssue({ code: 'custom', message: 'Only a material is kept on hand' });
    if (b.lowMark != null && !b.stocked) ctx.addIssue({ code: 'custom', message: 'A low mark is for an input kept on hand' });
  });

// ── Shop: the redesign's data model (docs/ui-redesign-plan.md, the Shop gaps) ─
//
// Suppliers, buys ordered and received, extras by size or colour, the three kinds, flat costs, batches,
// pickup points and an order's own costs. Command's own records, at Propose; a buy over Settings'
// `shopbuy` waits for a second person. The arithmetic is services/command/costing.ts and shopModel.ts.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateOf = (d: string) => new Date(d + 'T00:00:00Z');
const slugId = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,47}$/);
const idFrom = (name: string, fallback: string) => (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || fallback) + '-' + Date.now().toString(36).slice(-4);
/** The next batch's id: B-001, B-002… */
const NEXT_BATCH = `'B-' || lpad(nextval('command.shop_batch_number')::text, 3, '0')`;
const supplierOf = async (db: Queryable, sid: string | null | undefined) => (sid ? must<{ id: string; name: string; lead_days: number | null }>(db, 'SELECT * FROM command.shop_suppliers WHERE id = $1', [sid], 'supplier') : null);
const onHandOf = async (db: Queryable, iid: string) => Number((await one<{ n: string }>(db, 'SELECT coalesce(sum(quantity), 0) AS n FROM command.shop_input_moves WHERE input_id = $1', [iid]))!.n);

/**
 * A buy received. Kept on hand: the stock comes in and the unit cost becomes the average of what's on
 * hand (on hand at the old average, plus what was paid, over the new total; with nothing on hand, the
 * price paid). Made to order: the unit cost is the price paid. Either way the newest buy received is the
 * last price paid; one dated before it goes into the average but isn't the last price.
 */
async function receiveBuy(tx: Queryable, i: InputRow, pid: number, q: number, totalCents: number, at: Date, note: string) {
  const newest = !(await one(tx, `SELECT 1 FROM command.shop_input_purchases WHERE input_id = $1 AND id <> $2 AND state = 'received' AND coalesce(received_at, at) > $3`, [i.id, pid, at]));
  if (i.stocked) {
    const on = await onHandOf(tx, i.id);
    await tx.query(
      `UPDATE command.shop_inputs SET unit_cost_cents = CASE WHEN $2::numeric <= 0 OR unit_cost_cents IS NULL THEN $3::numeric / $4::numeric
         ELSE ($2::numeric * unit_cost_cents + $3::numeric) / ($2::numeric + $4::numeric) END WHERE id = $1`,
      [i.id, on, totalCents, q],
    );
    await tx.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason, ref, note) VALUES ($1, $2, $3, 'purchase', $4, $5)`, [i.id, at, q, pid, note]);
  } else if (newest) await tx.query('UPDATE command.shop_inputs SET unit_cost_cents = $2::numeric / $3::numeric WHERE id = $1', [i.id, totalCents, q]);
  if (newest) await tx.query('UPDATE command.shop_inputs SET last_cost_cents = $2::numeric / $3::numeric WHERE id = $1', [i.id, totalCents, q]);
  await pinLines(tx, i.id);
  const avg = Number((await one<{ u: string }>(tx, 'SELECT unit_cost_cents AS u FROM command.shop_inputs WHERE id = $1', [i.id]))!.u);
  return { unitCost: totalCents / q / 100, avg: avg / 100 };
}

/** Packing an order uses one of each once-per-order input counted on hand: all of them shipped, those marked for pickups picked up. */
async function usePacking({ tx, at }: Ctx, order: string) {
  const o = (await one<{ fulfilment: string }>(tx, 'SELECT fulfilment FROM command.shop_orders WHERE id = $1', [order]))!;
  const { rows } = await tx.query<{ id: string }>(`SELECT id FROM command.shop_inputs WHERE per_order AND stocked AND archived_at IS NULL AND ($1 = 'ship' OR on_pickup) ORDER BY id`, [o.fulfilment]);
  // never held up by a count that's off: on hand can go under nothing, as a run made short can
  for (const r of rows) await tx.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason, ref) VALUES ($1, $2, -1, 'order', $3)`, [r.id, at, Number(order)]);
}

type RunRow = { id: number; product_id: string; option: string; size: string; units: number; state: string; batch_id: string };
/** A batch's planned runs, or why it has none. */
const plannedRuns = async (db: Queryable, batch: string) => {
  const { rows } = await db.query<RunRow>('SELECT * FROM command.shop_runs WHERE batch_id = $1 ORDER BY id', [batch]);
  if (!rows.length) throw new ActionError(404, 'NOT_FOUND', `No batch ${batch}`);
  const planned = rows.filter((r) => r.state === 'planned');
  if (!planned.length) throw new ActionError(409, 'WRONG_STATE', `Batch ${batch} is made already`);
  return planned;
};

const shopModel: Record<string, Action> = {
  supplier: {
    body: z.object({
      /** An existing supplier to edit (the whole record); left out, one is added. */
      id: slugId.optional(),
      name: text(120).min(1),
      city: text(80).default(''),
      sells: text(200).default(''),
      leadDays: z.number().int().nonnegative().max(365).nullable().default(null),
      terms: text(80).default(''),
      minimum: text(80).default(''),
      note: text(500).default(''),
    }),
    summary: async (b, db) => ((b.id && (await one(db, 'SELECT 1 FROM command.shop_suppliers WHERE id = $1', [b.id]))) ? `Updated supplier ${b.name}` : `Added supplier ${b.name}`),
    apply: async ({ tx, at }, b) => {
      const sid = b.id ?? idFrom(b.name, 'supplier');
      await tx.query(
        `INSERT INTO command.shop_suppliers (id, name, city, sells, lead_days, terms, minimum, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET name = $2, city = $3, sells = $4, lead_days = $5, terms = $6, minimum = $7, note = $8`,
        [sid, b.name, b.city, b.sells, b.leadDays, b.terms, b.minimum, b.note, at],
      );
      return { id: sid };
    },
  },
  'supplier-breaks': {
    body: z.object({
      supplier: id,
      /** The whole list: from this many units, this much off (0.04 is 4%). Empty clears it. */
      breaks: z
        .array(z.object({ quantity: amount, discount: z.number().min(0).lt(1) }))
        .max(12)
        .refine((xs) => new Set(xs.map((x) => x.quantity)).size === xs.length, 'One break a quantity'),
    }),
    summary: async (b, db) => `Set ${(await supplierOf(db, b.supplier))!.name}’s price breaks · ${b.breaks.length}`,
    apply: async ({ tx }, b) => {
      await supplierOf(tx, b.supplier);
      await tx.query('DELETE FROM command.shop_supplier_breaks WHERE supplier_id = $1', [b.supplier]);
      for (const x of b.breaks) await tx.query('INSERT INTO command.shop_supplier_breaks (supplier_id, quantity, discount) VALUES ($1, $2, $3)', [b.supplier, qty(x.quantity), x.discount]);
    },
  },
  'input-supplier': {
    body: z.object({ input: id, supplier: id.nullable() }),
    summary: async (b, db) => {
      const i = await inputRow(db, b.input);
      return b.supplier ? `${i.name} comes from ${(await supplierOf(db, b.supplier))!.name}` : `${i.name} has no supplier`;
    },
    apply: async ({ tx }, b) => {
      await inputRow(tx, b.input);
      await supplierOf(tx, b.supplier);
      await tx.query('UPDATE command.shop_inputs SET supplier_id = $2 WHERE id = $1', [b.input, b.supplier]);
    },
  },
  'input-extra': {
    body: z
      .object({ input: id, size: SIZE.default(''), option: text(40).default(''), extra: z.number().nonnegative().max(100_000).optional(), remove: z.boolean().default(false) })
      .refine((b) => (b.size === '') !== (b.option === ''), 'Give a size or a colour, one of them')
      .refine((b) => b.remove || b.extra != null, 'Give what it adds, in dollars'),
    summary: async (b, db) => {
      const i = await inputRow(db, b.input);
      return b.remove ? `${i.name} costs the same in ${b.size || b.option}` : `${i.name} costs $${b.extra!.toFixed(2)} more in ${b.size || b.option}`;
    },
    apply: async ({ tx }, b) => {
      const i = await inputRow(tx, b.input);
      if (b.remove) {
        const r = await tx.query('DELETE FROM command.shop_input_extras WHERE input_id = $1 AND option = $2 AND size = $3 RETURNING 1', [b.input, b.option, b.size]);
        if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', `${i.name} has no extra for ${b.size || b.option}`);
        return;
      }
      await tx.query(
        'INSERT INTO command.shop_input_extras (input_id, option, size, extra_cents) VALUES ($1, $2, $3, $4) ON CONFLICT (input_id, option, size) DO UPDATE SET extra_cents = $4',
        [b.input, b.option, b.size, fcents(b.extra!)],
      );
    },
  },
  'input-kind': {
    body: z.object({
      input: id,
      /** Kept on hand, made to order, or once per order. */
      kind: z.enum(['stock', 'mto', 'order']),
      /** Once per order: whether it's also counted on hand (mailers are). Left out keeps what it is. */
      stocked: z.boolean().optional(),
      /** Once per order: whether a pickup uses it too. Left out keeps what it is. */
      onPickup: z.boolean().optional(),
    }),
    summary: async (b, db) => `${(await inputRow(db, b.input)).name} is ${{ stock: 'kept on hand', mto: 'made to order', order: 'used once per order' }[b.kind as 'stock']}`,
    apply: async ({ tx }, b) => {
      const i = await inputRow(tx, b.input);
      const stocked = b.kind === 'stock' ? true : b.kind === 'mto' ? false : (b.stocked ?? i.stocked);
      if (stocked && i.kind !== 'material') throw new ActionError(409, 'NOT_MATERIAL', 'Only a material is kept on hand');
      if (!stocked && i.stocked && Math.abs(await onHandOf(tx, i.id)) > 1e-9) throw new ActionError(409, 'ON_HAND', `${i.name} still has stock: use it up or adjust it to nothing first`);
      if (b.kind === 'order') {
        const n = (await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM command.shop_recipe_lines WHERE input_id = $1', [i.id]))!.n;
        if (n) throw new ActionError(409, 'IN_RECIPE', `${i.name} is in ${n} recipe${n === 1 ? '' : 's'}: take it out first`);
      }
      const perOrder = b.kind === 'order';
      await tx.query('UPDATE command.shop_inputs SET stocked = $2, per_order = $3, on_pickup = $4, low_mark = CASE WHEN $2 THEN low_mark END WHERE id = $1', [
        i.id,
        stocked,
        perOrder,
        perOrder && (b.onPickup ?? i.on_pickup),
      ]);
    },
  },
  'order-in': {
    body: z.object({
      input: id,
      quantity: amount,
      /** What it will cost, in dollars. */
      total: money,
      /** Left out, the input's own supplier. */
      supplierId: id.optional(),
      /** When it's due; left out, the supplier's lead time from today. */
      due: DATE.optional(),
      note: text(500).default(''),
    }),
    summary: async (b, db) => {
      const i = await inputRow(db, b.input);
      return `Ordered ${qty(b.quantity)} ${i.unit} of ${i.name} · $${b.total.toFixed(2)}`;
    },
    second: (b, db) => overLimit(db, 'shopbuy', b.total),
    // ordered, not here: stock and the average change when it's received
    apply: async (c, b) => {
      const i = await liveInput(c.tx, b.input);
      const s = await supplierOf(c.tx, b.supplierId ?? i.supplier_id);
      const due = b.due ? dateOf(b.due) : s?.lead_days != null ? new Date(c.at.getTime() + s.lead_days * DAY) : null;
      const { id: pid } = (await one<{ id: number }>(
        c.tx,
        `INSERT INTO command.shop_input_purchases (input_id, at, quantity, total_cents, supplier, note, who, supplier_id, state, due_on) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ordered', $9) RETURNING id`,
        [i.id, c.at, qty(b.quantity), cents(b.total), s?.name ?? '', b.note, who(c.person), s?.id ?? null, due],
      ))!;
      return { id: pid, due: due ? due.getTime() : null };
    },
  },
  receive: {
    body: z.object({
      id: z.number().int().positive(),
      /** What came and what it cost, when either differs from the order. */
      quantity: amount.optional(),
      total: money.optional(),
      on: DATE.optional(),
    }),
    summary: async (b, db) => {
      const p = await must<{ input_id: string; quantity: string }>(db, 'SELECT * FROM command.shop_input_purchases WHERE id = $1', [b.id], 'buy');
      const i = await inputRow(db, p.input_id);
      return `Received ${qty(b.quantity ?? Number(p.quantity))} ${i.unit} of ${i.name}`;
    },
    // what was approved was the order: only a higher price over the limit waits again
    second: async (b, db) => {
      if (b.total == null) return false;
      const p = await one<{ total_cents: number }>(db, 'SELECT total_cents FROM command.shop_input_purchases WHERE id = $1', [b.id]);
      return !!p && cents(b.total) > p.total_cents && (await overLimit(db, 'shopbuy', b.total));
    },
    apply: async (c, b) => {
      const p = await must<{ input_id: string; quantity: string; total_cents: number; state: string; supplier: string }>(c.tx, 'SELECT * FROM command.shop_input_purchases WHERE id = $1', [b.id], 'buy');
      if (p.state !== 'ordered') throw new ActionError(409, 'WRONG_STATE', `That buy is ${p.state} already`);
      const i = await inputRow(c.tx, p.input_id);
      const q = b.quantity != null ? qty(b.quantity) : Number(p.quantity);
      const total = b.total != null ? cents(b.total) : p.total_cents;
      const at = b.on ? dateOf(b.on) : c.at;
      await c.tx.query(`UPDATE command.shop_input_purchases SET state = 'received', received_at = $2, quantity = $3, total_cents = $4 WHERE id = $1`, [b.id, at, q, total]);
      return { id: b.id, ...(await receiveBuy(c.tx, i, b.id, q, total, at, p.supplier)) };
    },
  },
  'order-cancel': {
    body: z.object({ id: z.number().int().positive() }),
    summary: (b) => `Cancelled buy ${b.id}`,
    apply: async ({ tx }, b) => {
      const r = await tx.query(`UPDATE command.shop_input_purchases SET state = 'cancelled' WHERE id = $1 AND state = 'ordered' RETURNING 1`, [b.id]);
      if (!r.rows.length) throw new ActionError(409, 'WRONG_STATE', 'Only a buy still on order can be cancelled');
    },
  },
  'flat-cost': {
    body: z.object({
      product: id,
      /** One cost for the product, in dollars; null goes back to its materials (and drops its colours' and sizes' own). */
      cost: money.nullable(),
      estimate: z.boolean().default(false),
      note: text(500).default(''),
    }),
    summary: async (b, db) => `${(await prod(db, b.product)).name} ${b.cost == null ? 'costed from its materials' : `costs $${b.cost.toFixed(2)}${b.estimate ? ' (estimate)' : ''}`}`,
    apply: async (c, b) => {
      await prod(c.tx, b.product, c);
      await c.tx.query('UPDATE command.shop_products SET flat_cost_cents = $2, cost_estimate = $3, cost_note = $4 WHERE id = $1', [b.product, b.cost == null ? null : fcents(b.cost), b.cost != null && b.estimate, b.cost == null ? '' : b.note]);
      if (b.cost == null) await c.tx.query('DELETE FROM command.shop_flat_overrides WHERE product_id = $1', [b.product]);
      await history(c, b.product, b.cost == null ? 'Cost · from materials' : `Cost · flat $${b.cost.toFixed(2)}${b.estimate ? ', an estimate' : ''}`);
    },
  },
  'flat-override': {
    body: z
      .object({ product: id, option: text(40).default(''), size: SIZE.default(''), cost: money.optional(), remove: z.boolean().default(false) })
      .refine((b) => b.option !== '' || b.size !== '', 'Say which colour or size it’s for')
      .refine((b) => b.remove || b.cost != null, 'Give its cost'),
    summary: async (b, db) => `${b.remove ? 'Removed' : 'Set'} ${(await prod(db, b.product)).name}’s flat cost for ${ofVariant(b.option, b.size)}`,
    apply: async (c, b) => {
      await prod(c.tx, b.product, c);
      if (b.remove) {
        const r = await c.tx.query('DELETE FROM command.shop_flat_overrides WHERE product_id = $1 AND option = $2 AND size = $3 RETURNING 1', [b.product, b.option, b.size]);
        if (!r.rows.length) throw new ActionError(404, 'NOT_FOUND', `No ${ofVariant(b.option, b.size)} cost to remove`);
        return;
      }
      await must(c.tx, 'SELECT 1 FROM command.shop_products WHERE id = $1 AND flat_cost_cents IS NOT NULL', [b.product], 'flat cost on that product (set one first)');
      await must(c.tx, `SELECT 1 FROM command.shop_stock WHERE product_id = $1 AND ($2 = '' OR option = $2) AND ($3 = '' OR size = $3) LIMIT 1`, [b.product, b.option, b.size], 'colour or size of that product');
      await c.tx.query(
        'INSERT INTO command.shop_flat_overrides (product_id, option, size, cost_cents) VALUES ($1, $2, $3, $4) ON CONFLICT (product_id, option, size) DO UPDATE SET cost_cents = $4',
        [b.product, b.option, b.size, fcents(b.cost!)],
      );
      await history(c, b.product, `Cost · $${b.cost!.toFixed(2)} for ${ofVariant(b.option, b.size)}`);
    },
  },
  'batch-plan': {
    body: z.object({
      product: id,
      option: text(40).default(''),
      /** How many of each size. */
      units: z
        .array(z.object({ size: SIZE, n: z.number().int().positive().max(10_000) }))
        .min(1)
        .max(7)
        .refine((xs) => new Set(xs.map((x) => x.size)).size === xs.length, 'One line a size'),
      on: DATE.optional(),
      note: text(300).default(''),
    }),
    summary: async (b, db) => `Planned ${b.units.reduce((a: number, u: { n: number }) => a + u.n, 0)} ${(await prod(db, b.product)).name}${b.option ? ' · ' + b.option : ''}`,
    // planned: nothing's used or added until it's made
    apply: async (c, b) => {
      await prod(c.tx, b.product, c);
      for (const u of b.units) await must(c.tx, 'SELECT 1 FROM command.shop_stock WHERE product_id = $1 AND option = $2 AND size = $3', [b.product, b.option, u.size], 'colour and size of that product');
      const { batch } = (await one<{ batch: string }>(c.tx, `SELECT ${NEXT_BATCH} AS batch`, []))!;
      const on = b.on ? dateOf(b.on) : null;
      for (const u of b.units)
        await c.tx.query(`INSERT INTO command.shop_runs (product_id, option, size, units, at, note, who, state, batch_id, planned_on) VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned', $8, $9)`, [
          b.product,
          b.option,
          u.size,
          u.n,
          on ?? c.at,
          b.note,
          who(c.person),
          batch,
          on,
        ]);
      await history(c, b.product, `Planned batch ${batch}`);
      return { batch };
    },
  },
  'batch-done': {
    body: z.object({ batch: z.string().regex(/^B-\d+$/), allowShort: z.boolean().default(false) }),
    summary: (b) => `Made batch ${b.batch}`,
    // as a run: the stocked inputs are used up, the units added, and each size's unit cost locked
    apply: async (c, b) => {
      const runs = await plannedRuns(c.tx, b.batch);
      const book = await readBook(c.tx);
      const need = new Map<string, number>();
      const made = runs.map((r) => {
        const costed = productCost(book, r.product_id, { option: r.option, size: r.size });
        const { uses, unknown } = costed.source === 'recipe' ? runUses(costed, book.inputs, r.units) : { uses: [], unknown: [] };
        if (unknown.length) throw new ActionError(409, 'NO_AMOUNT', `Can’t tell how much ${unknown.map((u) => book.inputs.get(u)?.name ?? u).join(', ')} a unit uses`);
        for (const u of uses) need.set(u.inputId, (need.get(u.inputId) ?? 0) + u.quantity);
        return { r, uses, cost: roundCents(costed.costCents) };
      });
      const short = [...need].filter(([iid, n]) => (book.onHand.get(iid) ?? 0) - qty(n) < -1e-9);
      if (short.length && !b.allowShort)
        throw new ActionError(409, 'SHORT', `Not enough on hand: ${short.map(([iid, n]) => `${book.inputs.get(iid)!.name} has ${qty(book.onHand.get(iid) ?? 0)} ${book.inputs.get(iid)!.unit}, the batch needs ${qty(n)}`).join('; ')}`);
      for (const { r, uses, cost } of made) {
        for (const u of uses) if (qty(u.quantity) > 0) await c.tx.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason, ref) VALUES ($1, $2, $3, 'run', $4)`, [u.inputId, c.at, -qty(u.quantity), r.id]);
        await c.tx.query('UPDATE command.shop_stock SET on_hand = on_hand + $4 WHERE product_id = $1 AND option = $2 AND size = $3', [r.product_id, r.option, r.size, r.units]);
        await c.tx.query(`UPDATE command.shop_runs SET state = 'done', at = $2, unit_cost_cents = $3, short = $4, who = $5 WHERE id = $1`, [r.id, c.at, cost, short.length > 0, who(c.person)]);
      }
      await history(c, runs[0].product_id, `Made batch ${b.batch} · ${runs.reduce((a, r) => a + r.units, 0)}`);
      return { batch: b.batch, short: short.map(([iid]) => iid) };
    },
  },
  'batch-cancel': {
    body: z.object({ batch: z.string().regex(/^B-\d+$/) }),
    summary: (b) => `Dropped planned batch ${b.batch}`,
    apply: async (c, b) => {
      const runs = await plannedRuns(c.tx, b.batch);
      await c.tx.query(`DELETE FROM command.shop_runs WHERE batch_id = $1 AND state = 'planned'`, [b.batch]);
      await history(c, runs[0].product_id, `Dropped planned batch ${b.batch}`);
    },
  },
  'pickup-point': {
    body: z.object({ id: slugId.optional(), name: text(120).min(1), city: text(80).default(''), active: z.boolean().default(true) }),
    summary: async (b, db) => ((b.id && (await one(db, 'SELECT 1 FROM command.shop_pickup_points WHERE id = $1', [b.id]))) ? `Updated pickup point ${b.name}` : `Added pickup point ${b.name}`),
    apply: async ({ tx, at }, b) => {
      const pid = b.id ?? idFrom(b.name, 'point');
      await tx.query(
        `INSERT INTO command.shop_pickup_points (id, position, name, city, active, created_at) VALUES ($1, (SELECT coalesce(max(position), -1) + 1 FROM command.shop_pickup_points), $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = $2, city = $3, active = $4`,
        [pid, b.name, b.city, b.active, at],
      );
      // an order held there shows the new name
      await tx.query('UPDATE command.shop_orders SET pickup_at = $2 WHERE pickup_point = $1', [pid, b.name]);
      return { id: pid };
    },
  },
  'order-pickup': {
    body: order.extend({ point: id }),
    summary: async (b, db) => `#${b.order} · held at ${(await must<{ name: string }>(db, 'SELECT name FROM command.shop_pickup_points WHERE id = $1', [b.point], 'pickup point')).name}`,
    apply: async ({ tx }, b) => {
      const pt = await must<{ name: string; active: boolean }>(tx, 'SELECT * FROM command.shop_pickup_points WHERE id = $1', [b.point], 'pickup point');
      if (!pt.active) throw new ActionError(409, 'INACTIVE', `${pt.name} isn’t holding orders now`);
      const o = await must<{ fulfilment: string }>(tx, 'SELECT fulfilment FROM command.shop_orders WHERE id = $1', [b.order], 'order');
      if (o.fulfilment !== 'pickup') throw new ActionError(409, 'SHIPPED', `Order #${b.order} is shipped, not picked up`);
      await tx.query('UPDATE command.shop_orders SET pickup_point = $2, pickup_at = $3 WHERE id = $1', [b.order, b.point, pt.name]);
    },
  },
  'order-label': {
    body: order.extend({ cost: money }),
    summary: (b) => `#${b.order} · label $${b.cost.toFixed(2)}`,
    // what the postage label cost, beside the shipping charged; an order with no record of its own costs gets one now
    apply: async ({ tx }, b) => {
      const o = await must<OrderRow>(tx, 'SELECT id, items, paid_with, fulfilment, total_cents, shipping_cents FROM command.shop_orders WHERE id = $1', [b.order], 'order');
      if (o.fulfilment !== 'ship') throw new ActionError(409, 'PICKUP', `Order #${b.order} is picked up: it has no label`);
      if (!(await recordOverhead(tx, o, await readBook(tx), await readSetting<number>(tx, 'ship'), cents(b.cost))))
        await tx.query('UPDATE command.shop_order_overheads SET label_cents = $2 WHERE order_id = $1', [b.order, cents(b.cost)]);
    },
  },
};

const costing: Record<string, Action> = {
  input: {
    body: inputBody,
    summary: async (b, db) => ((b.id && (await one(db, 'SELECT 1 FROM command.shop_inputs WHERE id = $1', [b.id]))) ? `Updated input ${b.name}` : `Added input ${b.name}`),
    apply: async ({ tx, at }, b) => {
      const iid = b.id ?? (b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'input') + '-' + Date.now().toString(36).slice(-4);
      const cost = b.unitCost === undefined ? undefined : b.unitCost === null ? null : fcents(b.unitCost);
      if (b.supplier) await must(tx, 'SELECT 1 FROM command.shop_suppliers WHERE id = $1', [b.supplier], 'supplier');
      if (b.perOrder && (await one(tx, 'SELECT 1 FROM command.shop_recipe_lines WHERE input_id = $1 LIMIT 1', [iid]))) throw new ActionError(409, 'IN_RECIPE', `${b.name} is in a recipe: take it out first`);
      await tx.query(
        `INSERT INTO command.shop_inputs (id, name, kind, unit, stocked, unit_cost_cents, low_mark, note, created_at, per_order, on_pickup, supplier_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($11, false), coalesce($11, false) AND coalesce($12, false), $13)
         ON CONFLICT (id) DO UPDATE SET name = $2, kind = $3, unit = $4, stocked = $5, low_mark = $7, note = $8,
           unit_cost_cents = CASE WHEN $10 THEN command.shop_inputs.unit_cost_cents ELSE $6 END,
           per_order = coalesce($11, command.shop_inputs.per_order),
           on_pickup = CASE WHEN coalesce($11, command.shop_inputs.per_order) THEN coalesce($12, command.shop_inputs.on_pickup) ELSE false END,
           supplier_id = CASE WHEN $14 THEN command.shop_inputs.supplier_id ELSE $13 END`,
        [iid, b.name, b.kind, b.unit, b.stocked, cost ?? null, b.lowMark, b.note, at, cost === undefined, b.perOrder ?? null, b.onPickup ?? null, b.supplier ?? null, b.supplier === undefined],
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
      /** The supplier it came from; left out, the input's own. */
      supplierId: id.optional(),
      note: text(500).default(''),
      on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    summary: async (b, db) => {
      const i = await inputRow(db, b.input);
      return `Bought ${qty(b.quantity)} ${i.unit} of ${i.name} · $${b.total.toFixed(2)}`;
    },
    // a buy over Settings' limit waits for a second person (the redesign's two-person rule)
    second: (b, db) => overLimit(db, 'shopbuy', b.total),
    apply: async (c, b) => {
      const i = await liveInput(c.tx, b.input);
      const at = b.on ? new Date(b.on + 'T00:00:00Z') : c.at;
      const q = qty(b.quantity);
      const s = await supplierOf(c.tx, b.supplierId ?? i.supplier_id);
      const { id: pid } = (await one<{ id: number }>(
        c.tx,
        `INSERT INTO command.shop_input_purchases (input_id, at, quantity, total_cents, supplier, note, who, supplier_id, state, received_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'received', $2) RETURNING id`,
        [i.id, at, q, cents(b.total), b.supplier || s?.name || '', b.note, who(c.person), s?.id ?? null],
      ))!;
      return { id: pid, ...(await receiveBuy(c.tx, i, pid, q, cents(b.total), at, b.supplier || s?.name || '')) };
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
      const i = await recipeInput(c.tx, b.input);
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
      const i = await recipeInput(c.tx, b.input);
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
      // a batch of its own, its unit cost locked as it is now
      const { id: rid, batch_id: batch } = (await one<{ id: number; batch_id: string }>(
        c.tx,
        `INSERT INTO command.shop_runs (product_id, option, size, units, at, note, who, short, state, unit_cost_cents, batch_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'done', $9, ${NEXT_BATCH}) RETURNING id, batch_id`,
        [b.product, b.option, b.size, b.units, c.at, b.note, who(c.person), short.length > 0, roundCents(costed.costCents)],
      ))!;
      for (const u of uses) if (qty(u.quantity) > 0) await c.tx.query(`INSERT INTO command.shop_input_moves (input_id, at, quantity, reason, ref) VALUES ($1, $2, $3, 'run', $4)`, [u.inputId, c.at, -qty(u.quantity), rid]);
      await c.tx.query('UPDATE command.shop_stock SET on_hand = on_hand + $4 WHERE product_id = $1 AND option = $2 AND size = $3', [b.product, b.option, b.size, b.units]);
      await history(c, b.product, `Made ${b.units} · ${ofVariant(b.option, b.size)}`);
      return { id: rid, batch, uses: uses.map((u) => ({ input: u.inputId, quantity: qty(u.quantity) })), short: short.map((s) => s.inputId) };
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
  pack: orderState('packed', ['paid'], 'Packed', true, usePacking),
  ship: orderState('shipped', ['packed'], 'Shipped', true),
  // the pickup point's hold (Settings' `hold`) runs from here
  ready: orderState('ready', ['packed'], 'Ready for pickup', true, ({ tx, at }, o) => tx.query('UPDATE command.shop_orders SET ready_at = $2 WHERE id = $1', [o, at])),
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
  ...shopModel,
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
  ...buildRecords(),
};

/*
 * Build's own records (migration 0066): incidents and their timelines, security findings, and audits.
 * Each is Command's own record at Propose. Accepting a critical finding (it won't be fixed) waits for a
 * second person.
 */
function buildRecords(): Record<string, Action> {
  const SEVERITY = z.enum(['low', 'medium', 'high', 'critical']);
  const rid = z.number().int().positive();
  /** A moment the asker gives (when it began, when it was found): never after now, and within a year. */
  const when = (at: Date, ms: number | undefined) => {
    if (ms == null) return at;
    if (ms > at.getTime() + 5 * 60e3 || ms < at.getTime() - 366 * DAY) throw new ActionError(400, 'BAD_TIME', 'That time is in the future or over a year ago');
    return new Date(Math.min(ms, at.getTime()));
  };
  const contract = async (tx: Queryable, c: string | null | undefined) => {
    if (c) await must(tx, 'SELECT id FROM command.contracts WHERE id = $1', [c], 'contract');
    return c || null;
  };
  /** Someone who can work on Build: on the team, not turned off, and at Propose or more on it. */
  const builder = async (tx: Queryable, personId: string, at: Date) =>
    must<{ id: string; name: string }>(
      tx,
      `SELECT p.id, coalesce(nullif(p.name, ''), p.email, 'Someone') AS name FROM command.people p
         JOIN command.person_access a ON a.person_id = p.id LEFT JOIN command.groups g ON g.id = a.group_id
        WHERE p.id = $1 AND NOT a.off AND (a.expires_at IS NULL OR a.expires_at > $2)
          AND coalesce((a.custom_levels ->> 'contracts')::int, (g.levels ->> 'contracts')::int, 0) >= ${PROPOSE}`,
      [personId, at],
      'person on Build',
    );
  const incident = async (tx: Queryable, id: number) => {
    const i = await must<{ resolved_at: Date | null }>(tx, 'SELECT resolved_at FROM command.build_incidents WHERE id = $1 FOR UPDATE', [id], 'incident');
    if (i.resolved_at) throw new ActionError(409, 'WRONG_STATE', 'That incident is resolved');
  };
  const line = (tx: Queryable, id: number, at: Date, text: string, by: string | null) =>
    tx.query('INSERT INTO command.build_incident_updates (incident_id, at, line, by_id) VALUES ($1, $2, $3, $4)', [id, at, text, by]);
  const finding = (tx: Queryable, id: number) => must<{ state: string; severity: string }>(tx, 'SELECT state, severity FROM command.build_findings WHERE id = $1 FOR UPDATE', [id], 'finding');
  const STATE: Record<string, string> = { open: 'open', fixing: 'fix in progress', fixed: 'fixed', accepted: 'accepted (won’t fix)' };
  return {
    'incident-open': {
      body: z.object({
        title: text(160).min(1),
        severity: SEVERITY.default('low'),
        area: text(80).default(''),
        contract: id.optional(),
        note: text(1000).default(''),
        /** Who's on it (a team member at Propose on Build); nobody yet when left out. */
        owner: z.string().uuid().optional(),
        /** When it began (ms), if before now. */
        at: z.number().int().optional(),
        reached: z.boolean().default(false),
      }),
      summary: (b) => `Opened an incident · ${b.title}`,
      apply: async ({ tx, person, at }, b) => {
        const c = await contract(tx, b.contract);
        const owner = b.owner ? await builder(tx, b.owner, at) : null;
        const began = when(at, b.at);
        const r = await one<{ id: number }>(
          tx,
          `INSERT INTO command.build_incidents (title, severity, area, contract_id, note, owner_id, reached_members, started_at, opened_by, opened_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [b.title, b.severity, b.area, c, b.note, owner?.id ?? null, b.reached, began, person.id, at],
        );
        if (began < at) await line(tx, r!.id, began, 'Began', null);
        await line(tx, r!.id, at, `Opened by ${who(person)}${owner ? (owner.id === person.id ? ', who is on it' : ` · ${owner.name} is on it`) : ''}`, person.id);
        return { id: r!.id };
      },
    },
    'incident-update': {
      body: z.object({ id: rid, line: text(500).min(1) }),
      summary: (b) => `Added an update to incident I${b.id}`,
      apply: async ({ tx, person, at }, b) => {
        await incident(tx, b.id);
        await line(tx, b.id, at, b.line, person.id);
      },
    },
    'incident-assign': {
      body: z.object({ id: rid, owner: z.string().uuid().nullable() }),
      summary: (b) => (b.owner ? `Gave incident I${b.id} to someone on Build` : `Took incident I${b.id} off its owner`),
      apply: async ({ tx, person, at }, b) => {
        await incident(tx, b.id);
        const owner = b.owner ? await builder(tx, b.owner, at) : null;
        await tx.query('UPDATE command.build_incidents SET owner_id = $2 WHERE id = $1', [b.id, owner?.id ?? null]);
        await line(tx, b.id, at, owner ? (owner.id === person.id ? `${who(person)} is on it` : `${who(person)} gave it to ${owner.name}`) : `${who(person)} took it off its owner`, person.id);
      },
    },
    'incident-resolve': {
      body: z.object({ id: rid, resolution: text(500).default(''), reached: z.boolean().optional() }),
      summary: (b) => `Resolved incident I${b.id}`,
      apply: async ({ tx, person, at }, b) => {
        await incident(tx, b.id);
        await tx.query('UPDATE command.build_incidents SET resolved_at = greatest($2::timestamptz, started_at), resolution = $3, reached_members = coalesce($4, reached_members) WHERE id = $1', [
          b.id,
          at,
          b.resolution,
          b.reached ?? null,
        ]);
        await line(tx, b.id, at, `Resolved by ${who(person)}${b.resolution ? ': ' + b.resolution : ''}`, person.id);
      },
    },
    'finding-add': {
      body: z.object({
        title: text(160).min(1),
        severity: SEVERITY,
        contract: id.optional(),
        area: text(160).default(''),
        note: text(2000).default(''),
        foundBy: text(80).min(1),
        /** When it was found (ms), if before now. */
        at: z.number().int().optional(),
      }),
      summary: (b) => `Recorded a ${b.severity} finding · ${b.title}`,
      apply: async ({ tx, person, at }, b) => {
        const c = await contract(tx, b.contract);
        const r = await one<{ id: number }>(
          tx,
          `INSERT INTO command.build_findings (title, severity, contract_id, area, note, found_by, found_at, recorded_by, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [b.title, b.severity, c, b.area, b.note, b.foundBy, when(at, b.at), person.id, at],
        );
        return { id: r!.id };
      },
    },
    'finding-state': {
      body: z
        .object({ id: rid, state: z.enum(['open', 'fixing', 'fixed', 'accepted']), note: text(500).default('') })
        .refine((b) => b.state !== 'accepted' || b.note.length > 0, { message: 'Say why it won’t be fixed', path: ['note'] }),
      summary: (b) => `Marked finding F${b.id} ${STATE[b.state]}`,
      // won't fix on a critical finding is two people's call
      second: async (b, db) => b.state === 'accepted' && (await one<{ severity: string }>(db, 'SELECT severity FROM command.build_findings WHERE id = $1', [b.id]))?.severity === 'critical',
      apply: async ({ tx, at }, b) => {
        const f = await finding(tx, b.id);
        if (f.state === b.state) throw new ActionError(409, 'WRONG_STATE', `That finding is ${STATE[b.state]} already`);
        await tx.query('UPDATE command.build_findings SET state = $2, state_at = $3, state_note = $4 WHERE id = $1', [b.id, b.state, at, b.note]);
      },
    },
    'finding-fix': {
      body: z
        .object({ id: rid, pr: z.number().int().positive().max(1e7).optional(), change: text(200).min(1).optional() })
        .refine((b) => !(b.pr && b.change), { message: 'A pull request or a change, not both', path: ['change'] }),
      summary: (b) => (b.pr ? `Linked #${b.pr} as finding F${b.id}’s fix` : b.change ? `Linked a change as finding F${b.id}’s fix` : `Took finding F${b.id}’s fix off`),
      apply: async ({ tx, at }, b) => {
        const f = await finding(tx, b.id);
        // a fix linked to an open finding means one is in progress
        const st = f.state === 'open' && (b.pr || b.change) ? 'fixing' : f.state;
        await tx.query('UPDATE command.build_findings SET fix_pr = $2, fix_change = $3, state = $4, state_at = CASE WHEN state <> $4 THEN $5 ELSE state_at END WHERE id = $1', [
          b.id,
          b.pr ?? null,
          b.change ?? null,
          st,
          at,
        ]);
        return { state: st };
      },
    },
    audit: {
      body: z.object({
        kind: z.enum(['internal', 'external']),
        auditor: text(120).min(1),
        contracts: z.array(id).min(1).max(100),
        scope: text(300).default(''),
        /** The day it was done, or is booked for (YYYY-MM-DD). */
        on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        report: z.string().trim().max(500).url().startsWith('https://').optional(),
        note: text(1000).default(''),
      }),
      summary: (b) => `Recorded ${b.kind === 'external' ? 'an outside' : 'an internal'} audit · ${b.auditor} · ${b.contracts.length} ${b.contracts.length === 1 ? 'contract' : 'contracts'}`,
      apply: async ({ tx, person, at }, b) => {
        const ids = [...new Set(b.contracts)];
        const { rows } = await tx.query<{ id: string }>('SELECT id FROM command.contracts WHERE id = ANY($1)', [ids]);
        if (rows.length !== ids.length) throw new ActionError(404, 'NOT_FOUND', 'No such contract');
        const day = new Date(b.on + 'T00:00:00Z');
        if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== b.on || Math.abs(day.getTime() - at.getTime()) > 3 * 366 * DAY)
          throw new ActionError(400, 'BAD_TIME', 'That day isn’t a day within three years');
        const r = await one<{ id: number }>(
          tx,
          `INSERT INTO command.build_audits (kind, auditor, contracts, scope, on_day, report_url, note, recorded_by, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [b.kind, b.auditor, ids, b.scope, b.on, b.report ?? null, b.note, person.id, at],
        );
        return { id: r!.id };
      },
    },
  };
}

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
  /**
   * Agreements → Versions: a new version of an agreement, as a draft. What changed is a line each, starting
   * '+' (added), '~' (changed) or '-' (removed); `decidedBy` is who adopts it (the board, a member vote);
   * `terms` links it to what the apps record acceptances under (document@version), so who has accepted it is read.
   */
  'version-draft': {
    body: z.object({
      agreement: id,
      version: z.string().trim().regex(/^v?\d{1,3}(\.\d{1,3}){0,2}$/, 'A version like v2.2'),
      changes: z.array(z.string().trim().regex(/^[+~-] \S/, 'Start each change with +, ~ or -, then a space').max(300)).max(40).default([]),
      decidedBy: text(120).default(''),
      forDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      terms: z.string().trim().regex(/^[a-z0-9_-]{1,64}@[A-Za-z0-9._-]{1,40}$/, 'The document and version the app records, like membership_terms@2026-03').optional(),
    }),
    summary: (b) => `Drafted ${b.version} of agreement ${b.agreement}`,
    apply: async ({ tx, person, at }, b) => {
      await must(tx, 'SELECT id FROM command.agreements WHERE id = $1', [b.agreement], 'agreement');
      const v = b.version.startsWith('v') ? b.version : `v${b.version}`;
      if (await one(tx, 'SELECT 1 FROM command.agreement_versions WHERE agreement_id = $1 AND version = $2', [b.agreement, v]))
        throw new ActionError(409, 'EXISTS', `${v} is already recorded for this agreement`);
      await tx.query(
        `INSERT INTO command.agreement_versions (agreement_id, version, decided_by, changes, terms, planned_for, drafted_by, drafted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [b.agreement, v, b.decidedBy, JSON.stringify(b.changes), b.terms ?? null, b.forDay ? new Date(`${b.forDay}T12:00:00Z`) : null, person.id, at],
      );
      return { version: v };
    },
  },
  /**
   * A drafted version adopted: always a second person. It's in force from the day given (the day it was
   * adopted outside Command, never one to come) or the approval's; the version in force before it is
   * replaced that day, and the agreement shows the new version.
   */
  'version-adopt': {
    body: z.object({ agreement: id, version: z.string().trim().min(1).max(20), onDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    summary: (b) => `Adopt ${b.version} of agreement ${b.agreement}${b.onDay ? `, in force from ${b.onDay}` : ''}`,
    second: async (b, db) => {
      // one that couldn't be adopted is refused before it waits for anyone
      const v = await must<{ status: string }>(db, 'SELECT status FROM command.agreement_versions WHERE agreement_id = $1 AND version = $2', [b.agreement, b.version], 'version');
      if (v.status !== 'draft') throw new ActionError(409, 'WRONG_STATE', `${b.version} isn’t a draft`);
      return true;
    },
    apply: async ({ tx, person, approver, at }, b) => {
      if (!approver) throw new ActionError(403, 'SECOND_PERSON', 'Adopting a version needs a second person');
      const v = await must<{ id: number; status: string }>(tx, 'SELECT id, status FROM command.agreement_versions WHERE agreement_id = $1 AND version = $2 FOR UPDATE', [b.agreement, b.version], 'version');
      if (v.status !== 'draft') throw new ActionError(409, 'WRONG_STATE', `${b.version} isn’t a draft any more`);
      const when = b.onDay ? new Date(`${b.onDay}T12:00:00Z`) : at;
      if (when.getTime() > at.getTime() + DAY) throw new ActionError(400, 'BAD_DATE', 'A version is in force from today or a day before, never one to come');
      const cur = await one<{ id: number; adopted_at: Date }>(tx, `SELECT id, adopted_at FROM command.agreement_versions WHERE agreement_id = $1 AND status = 'in' FOR UPDATE`, [b.agreement]);
      if (cur && cur.adopted_at.getTime() > when.getTime()) throw new ActionError(409, 'WRONG_ORDER', 'The version in force now was adopted after that day');
      if (cur) await tx.query(`UPDATE command.agreement_versions SET status = 'old', replaced_at = $2 WHERE id = $1`, [cur.id, when]);
      await tx.query(`UPDATE command.agreement_versions SET status = 'in', adopted_at = $2, adopted_by = $3, approved_by = $4 WHERE id = $1`, [v.id, when, person.id, approver.id]);
      await tx.query('UPDATE command.agreements SET version = $2 WHERE id = $1', [b.agreement, b.version]);
      return { replaced: cur ? cur.id : null };
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
