import { DAY, SEED_TODAY, mask, type FieldPayload, type FormRow, type GrowthPayload, type MemberRow, type MembersPayload, type NextBatch, type PosterRow } from '@clear/command-types';
import type { Queryable } from '../../db/db.js';
import { SEE, TOTALS, type Level } from './levels.js';

/*
 * What each section draws, built from the database (docs/command-center-plan.md, Phase 3).
 *
 * Every source sits behind a provider, picked per source by env (PROVIDER_MEMBERS=seed|live). The
 * seed provider reads the command tables the seed filled, as of the prototype's day, so the pages
 * draw the design. Live providers arrive with their sources (Phases 5–7).
 *
 * Personal details are decided here, never in the browser: at Totals (1) no names leave the server;
 * at See (2) and up names leave masked, and in full only when asked for, which is logged.
 */

export type Provider = 'seed' | 'live';
export const providerFor = (source: string): Provider => (process.env[`PROVIDER_${source.toUpperCase()}`] === 'live' ? 'live' : 'seed');

export class NotLiveYet extends Error {
  constructor(source: string) {
    super(`The live ${source} source isn’t built yet. Set PROVIDER_${source.toUpperCase()}=seed.`);
  }
}

export interface ReadOptions {
  level: Level;
  /** Names in full: only at See and above, and only when asked. */
  reveal: boolean;
  now: Date;
}

/** The day a section is read for: the prototype's for the seed, today for live data. */
const asOfFor = (provider: Provider, now: Date) => (provider === 'seed' ? SEED_TODAY : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

async function figures(db: Queryable, prefix: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM command.figures WHERE key LIKE $1', [`${prefix}.%`]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const ms = (d: Date | string | null) => (d == null ? undefined : new Date(d).getTime());
const FUND: Record<string, string> = { bank: 'Bank', five: '$5', deposit: 'Deposit' };

// ── Members ─────────────────────────────────────────────────────────────────

/**
 * At Totals a member is only what the overview's charts count: their batch, stage, city, how they
 * funded and where they first spent. No name, no member number, no poster, no dates: each of those
 * could point back to one person.
 */
function totalsOnly(m: MemberRow): MemberRow {
  return { id: m.id, no: '', first: null, last: null, batch: m.batch, invited: 0, joined: 0, city: m.city, src: m.src, status: m.status, poster: null, fund: m.fund, spend: m.spend, last_: 0, left: m.left, quiet: m.quiet };
}


export async function membersSection(db: Queryable, o: ReadOptions): Promise<MembersPayload> {
  const provider = providerFor('members');
  if (provider === 'live') throw new NotLiveYet('members');
  const asOf = asOfFor(provider, o.now);
  const names: MembersPayload['names'] = o.level <= TOTALS ? 'none' : o.reveal && o.level >= SEE ? 'shown' : 'masked';

  const { rows } = await db.query<{
    id: number;
    number: string;
    first_name: string;
    last_name: string;
    batch: number;
    joined_at: Date;
    invited_at: Date;
    city: string;
    source: string;
    poster: string | null;
    status: MemberRow['status'];
    opened_at: Date | null;
    funded_with: string | null;
    active_at: Date | null;
    first_spend_shop: string | null;
    first_spend_at: Date | null;
    last_seen_at: Date;
  }>('SELECT * FROM command.members ORDER BY id');

  const MEMBERS: MemberRow[] = rows.map((r) => {
    const invited = ms(r.invited_at)!;
    const m: MemberRow = {
      id: r.id,
      no: r.number,
      first: names === 'none' ? null : names === 'shown' ? r.first_name : mask(r.first_name),
      last: names === 'none' ? null : names === 'shown' ? r.last_name : mask(r.last_name),
      batch: r.batch,
      invited,
      joined: ms(r.joined_at)!,
      city: r.city,
      src: r.source === 'poster' ? 'Poster' : 'Website',
      status: r.status,
      poster: r.poster,
      last_: ms(r.last_seen_at)!,
      left: 90 - Math.round((asOf - invited) / DAY),
      quiet: r.status === 'invited' && (asOf - invited) / DAY >= 21,
    };
    if (r.opened_at) m.opened = ms(r.opened_at);
    if (r.funded_with) m.fund = FUND[r.funded_with];
    if (r.active_at) m.activeAt = ms(r.active_at);
    if (r.first_spend_shop) m.spend = r.first_spend_shop;
    if (r.first_spend_at) m.spentAt = ms(r.first_spend_at);
    return names === 'none' ? totalsOnly(m) : m;
  });

  const { rows: batches } = await db.query<{
    number: number;
    size: number;
    status: string;
    sent_at: Date | null;
    proposed_by: string | null;
    joined_from: Date | null;
    joined_to: Date | null;
    from_posters: number | null;
    from_website: number | null;
    window_ends: Date | null;
  }>('SELECT * FROM command.batches ORDER BY number');
  const sent = batches.filter((b) => b.status === 'sent');
  const count = (n: number, s: string) => MEMBERS.filter((m) => m.batch === n && m.status === s).length;
  const p = batches.find((b) => b.status === 'proposed');
  const NEXT_BATCH: NextBatch | null = p
    ? {
        number: p.number,
        size: p.size,
        // a staff name: who did what stays visible at every level
        proposedBy: p.proposed_by ?? '',
        joinedFrom: ms(p.joined_from)!,
        joinedTo: ms(p.joined_to)!,
        fromPosters: p.from_posters ?? 0,
        fromWebsite: p.from_website ?? 0,
        windowEnds: ms(p.window_ends)!,
      }
    : null;

  return {
    MEMBERS,
    BATCH_DATE: sent.map((b) => ms(b.sent_at)!),
    B_ACT: sent.map((b) => count(b.number, 'active')),
    B_OPEN: sent.map((b) => count(b.number, 'opened')),
    NEXT_BATCH,
    figures: await figures(db, 'members'),
    asOf,
    names,
  };
}

// ── Growth and Field ────────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMon = (t: number) => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
const hhmm = (d: Date) => new Date(d).toISOString().slice(11, 16);
/** An email as the page masks it (idempotent, like `mask`). */
const maskMail = (m: string) => {
  const [u, d] = m.split('@');
  return u[0] + '•••@' + d[0] + '•••.' + d.split('.').pop();
};

async function posters(db: Queryable): Promise<PosterRow[]> {
  const { rows } = await db.query<{ n: number; place: string; place_id: string; city: string; board: boolean; design: string; scans_30d: number; hung_at: Date; checked_at: Date; swap_at: Date; status: PosterRow['status'] }>(
    'SELECT * FROM command.posters ORDER BY n',
  );
  return rows.map((r) => {
    const p: PosterRow = { shop: r.place, shopId: r.place_id, city: r.city, scans: r.scans_30d, n: r.n, design: r.design, hung: ms(r.hung_at)!, checked: ms(r.checked_at)!, status: r.status, swap: ms(r.swap_at)! };
    if (r.board) p.board = true;
    return p;
  });
}

/** Each design: its name, how many posters wear it (counted), and its 30-day scans and joins (figures). */
async function designs(db: Queryable, list: PosterRow[]): Promise<GrowthPayload['DESIGNS']> {
  const { rows } = await db.query<{ code: string; name: string }>('SELECT code, name FROM command.poster_designs ORDER BY code');
  const f = (await figures(db, 'growth'))['growth.designs'] as Record<string, { scans: number; joined: number }> | undefined;
  return Object.fromEntries(rows.map((d) => [d.code, { name: d.name, posters: list.filter((p) => p.design === d.code).length, scans: f?.[d.code]?.scans ?? 0, joined: f?.[d.code]?.joined ?? 0 }]));
}

export async function growthSection(db: Queryable, o: ReadOptions): Promise<GrowthPayload> {
  const provider = providerFor('growth');
  if (provider === 'live') throw new NotLiveYet('growth');
  const names: GrowthPayload['names'] = o.level <= TOTALS ? 'none' : o.reveal && o.level >= SEE ? 'shown' : 'masked';
  const list = await posters(db);

  // the inbox is a list of people: not sent at Totals, masked unless asked for
  let INBOX: FormRow[] | null = null;
  if (names !== 'none') {
    const { rows } = await db.query<{ first_name: string; last_name: string; email: string; form: string; city: string; source: string; received_at: Date; status: string }>(
      'SELECT * FROM command.form_submissions ORDER BY received_at DESC',
    );
    INBOX = rows.map((r) => ({
      who: names === 'shown' ? [r.first_name, r.last_name] : [mask(r.first_name), mask(r.last_name)],
      mail: names === 'shown' ? r.email : maskMail(r.email),
      type: r.form,
      city: r.city,
      src: r.source,
      when: hhmm(r.received_at),
      st: r.status,
    }));
  }

  const { rows: m } = await db.query<{ status: string; funded_with: string | null; n: number }>(
    'SELECT status, funded_with, count(*)::int AS n FROM command.members GROUP BY status, funded_with',
  );
  const sum = (f: (r: { status: string; funded_with: string | null }) => boolean) => m.filter(f).reduce((a, r) => a + r.n, 0);
  const FUNDED: Record<string, string> = { bank: 'Bank', five: '$5', deposit: 'Deposit' };
  const next = await db.query<{ number: number }>(`SELECT number FROM command.batches WHERE status = 'proposed' ORDER BY number LIMIT 1`);
  const fig = await figures(db, 'growth');
  const median = await db.query<{ value: unknown }>(`SELECT value FROM command.figures WHERE key = 'members.waitlist.median_days'`);

  return {
    POSTERS: list,
    DESIGNS: await designs(db, list),
    INBOX,
    NEXT_BATCH: next.rows[0] ? { number: next.rows[0].number } : null,
    MEMBER_SUMMARY: {
      invited: sum(() => true),
      opened: sum((r) => r.status === 'opened'),
      active: sum((r) => r.status === 'active'),
      funded: Object.fromEntries(Object.entries(FUNDED).map(([k, v]) => [v, sum((r) => r.funded_with === k)])),
    },
    figures: { ...fig, ...(median.rows[0] ? { 'members.waitlist.median_days': median.rows[0].value } : {}) },
    asOf: asOfFor(provider, o.now),
    names,
  };
}

export async function fieldSection(db: Queryable, o: ReadOptions): Promise<FieldPayload> {
  const provider = providerFor('field');
  if (provider === 'live') throw new NotLiveYet('field');
  const asOf = asOfFor(provider, o.now);
  const { rows: rr } = await db.query<{ day: Date; staff: string; staff_key: string; loaded_at: string; started_at: string; miles: number; back_by: string; minutes_per_stop: number }>(
    'SELECT * FROM command.routes WHERE day <= $1 ORDER BY day DESC LIMIT 1',
    [new Date(asOf).toISOString()],
  );
  const r = rr[0];
  const stops = r ? (await db.query<{ id: string; name: string; city: string; street: string; eta: string; closes: string | null; contact: string | null; last_visit: Date | null }>('SELECT * FROM command.route_stops WHERE day = $1 ORDER BY position', [r.day])).rows : [];
  const tasks = r ? (await db.query<{ stop_id: string; kind: 'poster' | 'device'; poster: number | null; title: string; note: string | null; done_at: string | null; outcome: string | null; photo: boolean }>('SELECT * FROM command.route_tasks WHERE day = $1 ORDER BY stop_id, position', [r.day])).rows : [];
  const later = (await db.query<Record<string, string>>('SELECT * FROM command.route_later ORDER BY id')).rows;
  const list = await posters(db);
  return {
    ROUTE: r
      ? { staff: r.staff, staffKey: r.staff_key, day: ms(r.day)!, loaded: r.loaded_at, started: r.started_at, miles: r.miles, backBy: r.back_by, minutesPerStop: r.minutes_per_stop }
      : { staff: '', staffKey: '', day: asOf, loaded: '', started: '', miles: 0, backBy: '', minutesPerStop: 0 },
    STOPS: stops.map((s) => ({
      id: s.id,
      name: s.name,
      city: s.city,
      where: s.street,
      eta: s.eta,
      tasks: tasks
        .filter((t) => t.stop_id === s.id)
        .map((t) => {
          const out: FieldPayload['STOPS'][number]['tasks'][number] = { kind: t.kind, t: t.title };
          if (t.poster != null) out.n = t.poster;
          if (t.note) out.note = t.note;
          if (t.done_at) out.done = t.done_at;
          if (t.outcome) out.out = t.outcome;
          if (t.photo) out.photo = 1;
          return out;
        }),
    })),
    LATER: later.map((l) => [l.shop, l.city, l.note, l.state, l.poster, l.wrong, l.todo, l.due, l.detour, l.last_visit]),
    // a shop's contact is a person: their name stays off Totals
    SHOP_INFO: Object.fromEntries(stops.map((s) => [s.id, [s.closes ?? '', o.level <= TOTALS ? '' : (s.contact ?? ''), s.last_visit ? dayMon(ms(s.last_visit)!) : '']])) as FieldPayload['SHOP_INFO'],
    POSTERS: list,
    DESIGNS: await designs(db, list),
    asOf,
  };
}
