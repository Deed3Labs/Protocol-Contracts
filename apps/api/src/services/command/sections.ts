import { DAY, SEED_TODAY, mask, type FieldPayload, type FormRow, type GrowthPayload, type MemberRow, type MembersPayload, type NextBatch, type PosterRow } from '@clear/command-types';
import type { Queryable } from '../../db/db.js';
import { SEE, TOTALS, type Level } from './levels.js';
import { deployedName, inventory, releasesLive, shortAddress, yieldPoolLive, type ChainReader } from './onchain.js';
import { codeChanges, codeConfig } from './github.js';

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
  /** The contracts' own reads, for the sections that are live from the chain. */
  chain?: ChainReader;
}

const chainOf = (o: ReadOptions, source: string) => {
  if (!o.chain) throw new Error(`PROVIDER_${source.toUpperCase()}=live reads the chain, and no chain reader was given`);
  return o.chain;
};

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

// ── Merchants ───────────────────────────────────────────────────────────────

export interface MerchantsPayload {
  TX: unknown[][];
  SIGNED: string[][];
  PROSPECTS: unknown[][];
  OWED: Record<string, number>;
  BOARD: Array<Record<string, unknown>>;
  FLEET: unknown[][];
  figures: Record<string, unknown>;
  asOf: number;
}

const dollars = (c: number | string | null) => (c == null ? null : Number(c) / 100);

/** The transacting partners, as the prototype's TX rows. Money reads them too (credit spent by shop). */
async function partnerRows(db: Queryable) {
  const { rows: ms } = await db.query<{ id: string; name: string; kind: string; city: string; status: string; founding: boolean; fee_pct: string | null; terms: string | null; cap_cents: number | null; hardware: string | null; cap_hits_7d: number | null; originations: number | null; losses: number | null }>(
    `SELECT m.*, s.cap_hits_7d, s.originations, s.losses FROM command.merchants m LEFT JOIN command.merchant_stats s ON s.merchant_id = m.id ORDER BY m.position`,
  );
  const { rows: months } = await db.query<{ merchant_id: string; month: Date; cleared_cents: string; sales: number }>('SELECT * FROM command.merchant_months');
  const month = (id: string, y: number, m: number) => months.find((r) => r.merchant_id === id && new Date(r.month).getUTCFullYear() === y && new Date(r.month).getUTCMonth() === m - 1);
  const TX = ms
    .filter((m) => m.status === 'transacting')
    .map((m) => {
      const oct = month(m.id, 2026, 10),
        sept = month(m.id, 2026, 9);
      return [m.id, m.name, m.kind, m.city, m.founding ? 1 : 0, Number(m.fee_pct), m.terms, dollars(m.cap_cents), m.cap_hits_7d ?? 0, m.originations ?? 0, m.losses ?? 0, dollars(oct?.cleared_cents ?? 0), oct?.sales ?? 0, dollars(sept?.cleared_cents ?? 0), m.hardware];
    });
  return { ms, TX };
}

export async function merchantsSection(db: Queryable, o: ReadOptions): Promise<MerchantsPayload> {
  const provider = providerFor('merchants');
  if (provider === 'live') throw new NotLiveYet('merchants');
  const { ms, TX } = await partnerRows(db);
  const SIGNED = ms.filter((m) => m.status !== 'transacting').map((m) => (m.status === 'signing' ? [m.id, m.name, m.kind, m.city, 'signing'] : [m.id, m.name, m.kind, m.city]));
  const { rows: owedRows } = await db.query<{ merchant_id: string; owed_cents: number }>('SELECT * FROM command.redemptions_owed');
  const OWED = Object.fromEntries(owedRows.map((r) => [r.merchant_id, dollars(r.owed_cents)!]));

  const { rows: cards } = await db.query<{ id: string; merchant_id: string | null; name: string; kind: string; city: string; stage: string; owner: string | null; per_month_cents: number | null; next_step: string | null; due_on: Date | null; last_contact_at: Date | null; contact: Record<string, string>; source: string; address: string; flag: boolean; founding: boolean; posters: number | null; notes: string }>(
    'SELECT * FROM command.merchant_stage WHERE removed_at IS NULL ORDER BY position',
  );
  // a shop's contact is a person: at Totals the board keeps its cards, not their details
  const blank = { name: '', role: '', phone: '', email: '' };
  // what was logged on each card in the app, newest first, as the panel draws it
  const { rows: acts } = await db.query<{ stage_id: string; at: Date; kind: string; text: string; who: string }>('SELECT stage_id, at, kind, text, who FROM command.merchant_activity ORDER BY at DESC, id DESC');
  const BOARD = cards.map((c) => {
    const base: Record<string, unknown> = { id: c.id, name: c.name, kind: c.kind, city: c.city };
    if (c.stage === 'prospect' || c.stage === 'talking') Object.assign(base, { val: dollars(c.per_month_cents), owner: c.owner, next: c.next_step, stage: c.stage, flag: c.flag });
    else if (c.stage === 'signing') Object.assign(base, { stage: c.stage, founding: c.founding ? 1 : 0, m: c.merchant_id });
    else Object.assign(base, { stage: c.stage, m: c.merchant_id, posters: c.posters, owed: OWED[c.merchant_id ?? ''] ?? 0 });
    return Object.assign(base, {
      due: c.due_on ? ms_(c.due_on) : null,
      last: c.last_contact_at ? ms_(c.last_contact_at) : null,
      contact: o.level <= TOTALS ? blank : c.contact,
      source: c.source,
      addr: o.level <= TOTALS ? '' : c.address,
      ...(c.notes && o.level > TOTALS ? { note: c.notes } : {}),
      ...(acts.some((a) => a.stage_id === c.id) && o.level > TOTALS ? { log: acts.filter((a) => a.stage_id === c.id).map((a) => [ms_(a.at), a.text, a.who, a.kind]) } : {}),
    });
  });
  const PROSPECTS = cards.filter((c) => !c.merchant_id).map((c) => [c.name, c.kind, c.city, dollars(c.per_month_cents), c.owner, c.next_step, c.stage]);

  const { rows: devs } = await db.query<{ merchant_id: string; kind: string; seq: number; status: string }>('SELECT * FROM command.device_fleet ORDER BY merchant_id, kind, seq');
  const { rows: chk } = await db.query<{ merchant_id: string; issue: string; last_seen: string }>('SELECT * FROM command.fleet_checkins ORDER BY position');
  const FLEET = chk.map((c) => {
    const kinds: Record<string, string[]> = {};
    for (const d of devs.filter((d) => d.merchant_id === c.merchant_id)) (kinds[d.kind] ??= []).push(d.status);
    return [c.merchant_id, kinds, c.issue, c.last_seen];
  });

  return { TX, SIGNED, PROSPECTS, OWED, BOARD, FLEET, figures: await figures(db, 'merchants'), asOf: asOfFor(provider, o.now) };
}
const ms_ = (d: Date) => new Date(d).getTime();

// ── Money ───────────────────────────────────────────────────────────────────

/**
 * Money: the accounts, their weeks and activity, the bonds, the yield pool and the credit book, and
 * what the page works out from them. The headline numbers (M) and the yield pool (Y) are worked out
 * here, with the prototype's own formulas: the update to the brief says rates are never computed in
 * the browser, and Phase 5 swaps these sums for the contracts' own reads.
 */
export async function moneySection(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const provider = providerFor('money');
  const f = await figures(db, 'money');
  const book = f['money.book'] as { credit: number; savingsBacked: number; unsecured: number; limits: number; lost: number };
  const due = f['money.payouts_due'] as { owed14: number; dueMembers: number };
  const pool = f['money.yield.pool'] as { principal: number; queued: number; opened: string; cycleDays: number; curve: { base: number; s1: number; s2: number; kink: number } };
  const hist = f['money.yield.history'] as { days: string[]; assets: number[]; lent: number[] };
  const floor = f['money.floor'] as number;

  const { rows: accts } = await db.query<{ id: string; name: string; purpose: string; owner_group: string; source: string; swatch: string }>('SELECT * FROM command.accounts ORDER BY position');
  const { rows: snaps } = await db.query<{ account_id: string; balance_cents: string }>('SELECT account_id, balance_cents FROM command.account_snapshots ORDER BY as_of');
  const weeks = (id: string) => snaps.filter((s) => s.account_id === id).map((s) => Number(s.balance_cents) / 100);
  const bal = (id: string) => weeks(id).at(-1) ?? 0;
  const { rows: bondRows } = await db.query<{ id: string; face_cents: string; issued_on: Date; matures_on: Date; term_months: number; rate_pct: string; holder: string }>('SELECT * FROM command.bonds ORDER BY issued_on');
  const BONDS = bondRows.map((b) => [b.id, Number(b.face_cents) / 100, dayMon(ms_(b.issued_on)), dayMon(ms_(b.matures_on)), b.term_months, Number(b.rate_pct), b.holder]);
  // live, the yield pool is the LendingPool's (Phase 5b); the rest of Money is still the tables' until its sources come
  const chainPool = provider === 'live' ? await yieldPoolLive(db, chainOf(o, 'money'), o.now.getTime()) : null;
  const { rows: pos } = chainPool ? { rows: [] } : await db.query<{ depositor: string; assets_cents: string; first_deposit: Date; pledged_cents: string }>('SELECT * FROM command.yield_positions ORDER BY assets_cents DESC, position');
  const Y_DEP = chainPool
    ? chainPool.depositors.map((d) => [d.id, d.assets, dayMon(d.since), d.pledged])
    : pos.map((p) => [p.depositor, Number(p.assets_cents) / 100, dayMon(ms_(p.first_deposit)), Number(p.pledged_cents) / 100]);

  // the headline numbers, as the prototype's M
  const M: Record<string, number> = {
    savings: bal('sav'), cash: bal('ops'), payout: bal('pay'), assurance: bal('ap'), coop: bal('coop'),
    ...book, ...due, bonds: BONDS.reduce((a, b) => a + (b[1] as number), 0), floor,
  };
  // the yield pool, as the prototype's Y: assets and pledges are the depositors'; it lends to unsecured credit
  const pledged = Y_DEP.reduce((a, r) => a + (r[3] as number), 0);
  const Y: Record<string, any> = chainPool
    ? {
        assets: chainPool.assets, principal: chainPool.principal, lent: chainPool.lent, depositors: Y_DEP.length, pledged, queued: chainPool.queued,
        opened: chainPool.opened == null ? '—' : dayMon(chainPool.opened), cycleDays: chainPool.cycleDays, curve: chainPool.curve,
        cash: chainPool.cash, util: chainPool.utilBps / 10000, toPayouts: chainPool.toPayouts,
      }
    : {
        assets: Y_DEP.reduce((a, r) => a + (r[1] as number), 0), principal: pool.principal, lent: M.unsecured, depositors: Y_DEP.length,
        pledged, queued: pool.queued, opened: pool.opened, cycleDays: pool.cycleDays, curve: pool.curve,
      };
  if (!chainPool) { Y.cash = Y.assets - Y.lent; Y.util = Y.lent / Y.assets; }
  Y.earned = Y.assets - Y.principal;
  // live, the price of a share; the seed has no shares, so its principal stands in
  Y.price = chainPool ? (chainPool.supply ? chainPool.assets / chainPool.supply : 1) : Y.assets / Y.principal;
  const borrowBps = (u: number) => (u <= Y.curve.kink ? Y.curve.base + (Y.curve.s1 * u) / Y.curve.kink : Y.curve.base + Y.curve.s1 + (Y.curve.s2 * (u - Y.curve.kink)) / (1 - Y.curve.kink));
  const apr = (bps: number) => ((bps / 10000) * 365) / Y.cycleDays;
  const apy = (bps: number) => Math.pow(1 + bps / 10000, 365 / Y.cycleDays) - 1;
  // live, the rates are the contract's own reads; the curve is only for what a draw would do to them
  Y.borrowBps = chainPool ? chainPool.borrowBps : borrowBps(Y.util); Y.supplyBps = chainPool ? chainPool.supplyBps : Y.borrowBps * Y.util;
  Y.apy = apy(Y.supplyBps); Y.apr = apr(Y.borrowBps);
  M.rtd = M.assurance / M.unsecured;
  M.room = M.assurance / M.floor - M.unsecured;
  M.short = Math.max(0, M.owed14 - M.payout - M.dueMembers);
  // live, the gap is the PayoutPool's own shortfall, never the tables' sample against real cash
  Y.toPayout = Math.min(chainPool ? chainPool.payoutShort : M.short, Y.cash); Y.utilAfter = Y.assets ? (Y.lent + Y.toPayout) / Y.assets : 0; Y.apyAfter = apy(borrowBps(Y.utilAfter) * Y.utilAfter);

  const AP_BAL = [...(f['money.ap.balance_weeks'] as number[]), M.assurance];
  const UNSEC = [...(f['money.credit.unsecured_weeks'] as number[]), M.unsecured];
  const live: Record<string, number> = { yld: Y.cash, ap: M.assurance };
  const ACCTS = accts.map((a) => {
    const w = weeks(a.id);
    const now = live[a.id] ?? w.at(-1)!;
    const series = a.id === 'ap' ? AP_BAL : a.id === 'yld' && chainPool ? chainPool.cashWeeks : [...w.slice(0, -1), now];
    return [a.id, a.name, a.purpose, a.owner_group, a.source, now, series, a.swatch];
  });
  const { rows: ent } = await db.query<{ account_id: string; at: Date; what: string; detail: string; amount_cents: string }>('SELECT * FROM command.account_entries ORDER BY at DESC, id');
  const ENTRIES: Record<string, unknown[]> = {};
  for (const e of ent) (ENTRIES[e.account_id] ??= []).push({ at: ms_(e.at), what: e.what, detail: e.detail, amount: Number(e.amount_cents) / 100 });
  if (chainPool) ENTRIES.yld = chainPool.entries;

  const { rows: m } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM command.members WHERE status = 'active'`);
  return {
    M, Y, Y_DEP,
    ...(chainPool
      ? { YD: chainPool.days.map(dayMon), Y_ASSETS: chainPool.assetsByDay, Y_LENT: chainPool.lentByDay }
      : { YD: hist.days, Y_ASSETS: [...hist.assets, Y.assets], Y_LENT: [...hist.lent, Y.lent] }),
    AP_BAL, UNSEC, AP_REQ: UNSEC.map((v) => v * M.floor), RTD_W: AP_BAL.map((v, i) => (UNSEC[i] ? v / UNSEC[i] : null)),
    COOP_W: f['money.coop.weekly'], FLOWS: f['money.flows'], BONDS, ACCTS, ENTRIES,
    TX: (await partnerRows(db)).TX,
    MEMBER_SUMMARY: { active: m[0].n },
    SET_ASIDE: await shopSetAside(db),
    // live, what the yield pane lists since the opening is the pool's own deposits and withdrawals
    figures: chainPool
      ? {
          ...f,
          'money.yield.since_opened': chainPool.entries.filter((e) => /^(Opened|Deposits|Withdrawals)$/.test(e.what)).reverse().map((e) => [e.at, e.what, e.detail, e.amount]),
          'money.yield.joined_this_week': chainPool.depositors.filter((d) => d.since >= o.now.getTime() - 7 * DAY).length,
        }
      : f,
    asOf: asOfFor(provider, o.now),
  };
}

// ── Shop ────────────────────────────────────────────────────────────────────

type ShopProduct = { id: string; n: string; v: string; line: string; g: string; price: number; c?: number[]; st: string; cols: string[]; wk: number[]; lead?: number; slug: string; why?: string; dep?: number };

async function shopProducts(db: Queryable, f: Record<string, unknown>): Promise<ShopProduct[]> {
  const units = f['shop.units_weekly'] as Record<string, number[]>;
  const { rows } = await db.query<{ id: string; name: string; variant: string; line: string; glyph: string; price_cents: number; cost_cents: number[] | null; status: string; options: string[]; lead_weeks: number | null; slug: string; why: string | null; deposit: boolean }>(
    'SELECT * FROM command.shop_products ORDER BY position',
  );
  return rows.map((r) => ({
    id: r.id, n: r.name, v: r.variant, line: r.line, g: r.glyph, price: r.price_cents / 100,
    ...(r.cost_cents ? { c: r.cost_cents.map((c) => c / 100) } : {}),
    ...(r.deposit ? { dep: 1 } : {}),
    st: r.status, cols: r.options, wk: units[r.id] ?? [],
    ...(r.lead_weeks != null ? { lead: r.lead_weeks } : {}),
    slug: r.slug,
    ...(r.why ? { why: r.why } : {}),
  }));
}

/** What the shop's money holds for others: sales tax on the last 4 weeks' sales, and the hardware deposits. */
async function shopSetAside(db: Queryable): Promise<{ salesTax: number; preorderDeposits: number }> {
  const f = await figures(db, 'shop');
  const PR = await shopProducts(db, f);
  const C = f['shop.costs'] as { taxRate: number; taxable: number };
  const weeks = Math.max(0, ...PR.map((p) => p.wk.length));
  const REV_W = Array.from({ length: weeks }, (_, i) => PR.filter((p) => !p.dep).reduce((a, p) => a + (p.wk[i] ?? 0) * p.price, 0));
  const rev = REV_W.slice(-4).reduce((a, b) => a + b, 0);
  const { rows } = await db.query<{ price_cents: number; units: number }>(`SELECT p.price_cents, o.units FROM command.shop_preorders o JOIN command.shop_products p ON p.id = o.product_id WHERE o.state = 'held' ORDER BY o.id`);
  return { salesTax: rev * C.taxRate * C.taxable, preorderDeposits: rows.reduce((a, r) => a + (r.price_cents / 100) * r.units, 0) };
}

/**
 * Shop: the catalog with each product's weekly sales, stock by size, the shelf's history, the recent
 * orders, hardware pre-orders, what's on the way and the returns. The page works out its totals from
 * these with the prototype's formulas. Orders are personal: at Totals they leave with no buyer, city
 * or time (the overview only counts them), and the returns aren't sent.
 */
export async function shopSection(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const provider = providerFor('shop');
  if (provider === 'live') throw new NotLiveYet('shop');
  const asOf = asOfFor(provider, o.now);
  // the prototype's "now" is 2pm on its day
  const NOW = provider === 'seed' ? SEED_TODAY + 14 * 3600e3 : o.now.getTime();
  const at = (d: Date | null) => (d == null ? NOW : ms_(d));
  const f = await figures(db, 'shop');
  const PR = await shopProducts(db, f);

  const { rows: stock } = await db.query<{ product_id: string; option: string; on_hand: number }>(
    'SELECT s.product_id, s.option, s.on_hand FROM command.shop_stock s JOIN command.shop_products p ON p.id = s.product_id ORDER BY p.position, s.option_pos, s.size_pos',
  );
  const STK: Record<string, Record<string, number[]>> = {};
  for (const s of stock) ((STK[s.product_id] ??= {})[s.option] ??= []).push(s.on_hand);

  const { rows: shelf } = await db.query<{ product_id: string; state: string; starts_at: Date | null; ends_at: Date | null }>('SELECT * FROM command.shop_shelf ORDER BY product_id, position');
  const SHELF_EV: Record<string, unknown[]> = {};
  for (const id of PR.map((p) => p.id)) for (const e of shelf.filter((e) => e.product_id === id)) (SHELF_EV[id] ??= []).push([e.state, at(e.starts_at), at(e.ends_at)]);

  const { rows: hist } = await db.query<{ product_id: string; at: Date; what: string; who: string }>('SELECT * FROM command.shop_history ORDER BY id DESC');
  const SHIST: Record<string, unknown[]> = {};
  for (const id of PR.map((p) => p.id)) for (const h of hist.filter((h) => h.product_id === id)) (SHIST[id] ??= []).push([ms_(h.at), h.what, h.who]);

  const totals = o.level <= TOTALS;
  const { rows: ord } = await db.query<{ id: string; paid_at: Date; buyer: string; member: boolean; items: unknown[]; paid_with: string; fulfilment: string; pickup_at: string; state: string; city: string }>(
    'SELECT * FROM command.shop_orders ORDER BY id DESC',
  );
  const ORDERS = ord.map((r) =>
    totals ? [r.id, 0, '', 0, r.items, r.paid_with, r.fulfilment, r.pickup_at, r.state, ''] : [r.id, ms_(r.paid_at), r.buyer, r.member ? 1 : 0, r.items, r.paid_with, r.fulfilment, r.pickup_at, r.state, r.city],
  );

  const { rows: pre } = await db.query<{ id: string; shop: string; product_id: string; option: string; units: number; state: string; placed_at: Date }>('SELECT * FROM command.shop_preorders ORDER BY id');
  const PRE = pre.map((r) => [r.id, r.shop, r.product_id, r.option, r.units, r.state, ms_(r.placed_at)]);

  const { rows: inc } = await db.query<{ what: string; units_label: string; stages: Array<[string, number | null, number | null]>; lands: string; product_id: string }>('SELECT * FROM command.shop_incoming ORDER BY position');
  const INCOMING = inc.map((r) => [r.what, r.units_label, r.stages.map(([k, a, b]) => [k, a ?? NOW, b ?? NOW]), r.lands, r.product_id]);

  const { rows: ret } = totals
    ? { rows: [] }
    : await db.query<{ order_id: string; item: string; reason: string; returned_on: Date; condition: string; proposed_by: string; proposed_at: Date; second_person: string | null; refunded_at: Date | null; amount_cents: number | null }>(
        'SELECT * FROM command.shop_returns ORDER BY proposed_at DESC',
      );
  const RETURNS = ret.map((r) => ({
    order: r.order_id, item: r.item, reason: r.reason, returned: ms_(r.returned_on), condition: r.condition, proposedBy: r.proposed_by, proposedAt: ms_(r.proposed_at),
    second: r.second_person, refundedAt: r.refunded_at == null ? null : ms_(r.refunded_at), amount: r.amount_cents == null ? null : r.amount_cents / 100,
  }));

  return { PR, STK, SHELF_EV, SHIST, ORDERS, PRE, INCOMING, RETURNS, NOW, figures: f, asOf };
}

// ── Contracts ───────────────────────────────────────────────────────────────

/** The prototype's "now" for the seed (2pm on its day), the real one live. */
const nowFor = (provider: Provider, now: Date) => (provider === 'seed' ? SEED_TODAY + 14 * 3600e3 : now.getTime());
/** Lane events with a null time are "now". */
const evAt = (ev: unknown[][], NOW: number) => ev.map((e) => e.map((v) => (v === null ? NOW : v)));
const msOr = (d: Date | null, empty: number | null = null) => (d == null ? empty : ms_(d));

/**
 * Contracts: every agreement, the contracts and how they connect, their releases, the changes in
 * flight and done, and the Safe's signers. Nothing here is personal: parties are companies and
 * shops, signers are the co-op's officers.
 */
export async function contractsSection(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const provider = providerFor('contracts');
  // live, each contract's address, version and releases are the chain's (Phase 5b); the map and the changes are still the tables'
  const deployed = provider === 'live' ? await inventory(db) : null;
  const releases = provider === 'live' ? await releasesLive(db) : null;
  const onChain = (name: string) => (deployed ? deployedName(name, new Set(deployed.keys())) : null);
  const NOW = nowFor(provider, o.now);
  const { rows: agr } = await db.query<any>('SELECT * FROM command.agreements ORDER BY position');
  const AGR = agr.map((a) => ({
    id: a.id, name: a.name, party: a.party, type: a.kind, st: a.status, a: msOr(a.signed_at), b: msOr(a.ends_at), ver: a.version, note: a.note,
    ...(a.rolls ? { roll: 1 } : {}),
    ...(a.sent_at ? { sent: ms_(a.sent_at) } : {}),
    ...(a.events ? { ev: evAt(a.events, NOW) } : {}),
  }));
  const { rows: ctr } = await db.query<any>('SELECT * FROM command.contracts ORDER BY position');
  const CTR = ctr.map((c) => {
    const n = onChain(c.name);
    const [version, address] = n ? [releases!.get(n)?.at(-1)?.version ?? 'v1.0', shortAddress(deployed!.get(n)!.address)] : [c.version, c.address];
    return [c.id, c.name, version, c.layer, c.status, address, c.purpose, Number(c.map_x), Number(c.map_y), c.band];
  });
  const CTR_NOTE = Object.fromEntries(ctr.filter((c) => c.note).map((c) => [c.id, c.note]));
  const { rows: links } = await db.query<any>('SELECT * FROM command.contract_links ORDER BY position');
  const REL = links.map((l) => [l.from_id, l.to_id, l.kind, l.verb, l.label, ...(l.label_side != null ? [Number(l.label_side)] : [])]);
  const { rows: rel } = await db.query<any>('SELECT r.* FROM command.contract_releases r JOIN command.contracts c ON c.id = r.contract_id ORDER BY r.released_at, c.position');
  const RELEASES: Record<string, unknown[]> = {};
  const PENDING: Record<string, unknown> = {};
  if (releases) {
    // nothing Command proposes upgrades a contract yet, so live there's nothing pending
    for (const c of ctr) {
      const list = releases.get(onChain(c.name) ?? '');
      if (list) RELEASES[c.id] = list.map((r) => [r.version, r.at, r.implementation]);
    }
  } else
    for (const r of rel) {
      if (r.pending) PENDING[r.contract_id] = [r.version, ms_(r.released_at)];
      else (RELEASES[r.contract_id] ??= []).push([r.version, ms_(r.released_at)]);
    }
  const { rows: ch } = await db.query<any>('SELECT * FROM command.contract_changes ORDER BY done, position');
  const change = (c: any) => ({ id: c.id, t: c.title, c: c.contract, ...(c.proposed_by ? { by: c.proposed_by } : {}), ...c.detail, ev: evAt(c.events, NOW) });
  // live, the code changes are GitHub's (Phase 5c): commits since a release in flight, the commits before it what it shipped
  const code = releases
    ? await codeChanges(db, codeConfig(), ctr.map((c) => {
        const n = onChain(c.name);
        return { name: c.name, deployed: n, deployedAt: n ? deployed!.get(n)!.deployedAt : null };
      }), releases, NOW)
    : { open: [], done: [] };
  const { rows: sg } = await db.query<any>('SELECT * FROM command.signers ORDER BY position');
  return {
    AGR, CTR, CTR_NOTE, REL, RELEASES, PENDING,
    CH: [...ch.filter((c) => !c.done).map(change), ...code.open], CH_DONE: [...code.done, ...ch.filter((c) => c.done).map(change)],
    SIGNERS: sg.map((s) => [s.key, s.name, s.who, Number(s.median_hours), s.idle_note]),
    NOW, figures: await figures(db, 'contracts'), asOf: asOfFor(provider, o.now),
  };
}

// ── Governance ──────────────────────────────────────────────────────────────

/** Governance: the entities, filings, boards and seats, the agenda, resolutions, the member vote, meetings, related-party deals and who decides what. */
export async function governanceSection(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const provider = providerFor('governance');
  if (provider === 'live') throw new NotLiveYet('governance');
  const q = async (sql: string) => (await db.query<any>(sql)).rows;
  const ents = await q('SELECT * FROM command.entities ORDER BY position');
  const ENT = ents.map((e) => [e.id, e.name, e.kind, e.status, e.role, Number(e.map_x), Number(e.map_y)]);
  const pick = (k: string) => Object.fromEntries(ents.filter((e) => e[k] != null).map((e) => [e.id, e[k]]));
  const FILINGS = (await q('SELECT * FROM command.filings ORDER BY position')).map((f) => [f.id, f.entity_id, f.title, ms_(f.due_on), f.status, f.owner]);
  const seats = await q('SELECT * FROM command.board_seats ORDER BY board, position');
  const GBOARDS = (await q('SELECT * FROM command.boards ORDER BY position')).map((b) => [
    b.name, b.entity_id,
    seats.filter((s) => s.board === b.name).map((s) => [s.class, s.holder, msOr(s.starts_at, 0), msOr(s.ends_at, 0), ...(s.note != null ? [s.note] : [])]),
    b.note,
  ]);
  const [v] = await q('SELECT * FROM command.member_votes ORDER BY opens_at DESC LIMIT 1');
  return {
    ENT, PARENT: Object.fromEntries(ents.map((e) => [e.id, e.parent_id])), OWN: pick('owned'), UNDER: pick('under'), ENTF: pick('facts'),
    FILINGS, GBOARDS,
    AGENDA: (await q('SELECT * FROM command.agenda_items ORDER BY position')).map((a) => [a.title, a.minutes, a.owner, a.kind]),
    RESOS: (await q('SELECT * FROM command.resolutions ORDER BY position')).map((r) => [ms_(r.passed_on), r.body, r.title, r.votes]),
    PEOPLE: (await q('SELECT * FROM command.board_people ORDER BY position')).map((p) => [p.name, p.boards, p.note]),
    VOTE: v ? { t: v.title, open: ms_(v.opens_at), close: ms_(v.closes_at), elig: v.eligible, quorum: Number(v.quorum), days: v.cast_daily, yes: v.yes, no: v.no, abs: v.abstain } : null,
    MEETS: (await q('SELECT * FROM command.meetings ORDER BY position')).map((m) => [m.body, m.events]),
    RP: (await q('SELECT * FROM command.related_party ORDER BY position')).map((r) => [r.payer, r.payee, r.what, r.paid_on.map((d: Date) => ms_(d)), r.amount_cents / 100, ...(r.opens_on ? [ms_(r.opens_on)] : [])]),
    MATTERS: (await q('SELECT * FROM command.reserved_matters ORDER BY position')).map((m) => [m.decision, m.roles, ...(m.open ? [m.open] : [])]),
    figures: await figures(db, 'governance'),
    asOf: asOfFor(provider, o.now),
  };
}

// ── Records ─────────────────────────────────────────────────────────────────

/* the log's areas, as Records draws them */
const LOG_AREA: Record<string, string> = { members: 'members', growth: 'field', field: 'field', merchants: 'field', money: 'money', shop: 'shop', contracts: 'chain', governance: 'gov', alert: 'alert' };

/**
 * Records: the documents, and the app's own log of what people did here (command.audit_log), its
 * approvals (command.proposals) and nothing seeded: the log is a record, so it only ever holds what
 * happened. At Totals only the documents and counts are sent; the log names people.
 */
export async function recordsSection(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const provider = providerFor('records');
  const q = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows;
  const DOCS = (await q('SELECT * FROM command.documents ORDER BY position')).map((d) => [d.id, d.title, d.kind, d.entity_id, ms_(d.dated), d.status, d.version, d.by_whom, d.pages]);
  const people = o.level > TOTALS;
  const since = new Date(o.now.getTime() - 30 * DAY);
  const log = people
    ? await q(
        `SELECT a.id, a.at, a.person_id, a.who, a.area, a.action, a.detail, a.from_where, a.result, a.approver, p.name AS approver_name
         FROM command.audit_log a LEFT JOIN command.people p ON p.id = a.approver ORDER BY a.at DESC, a.id DESC LIMIT 200`,
      )
    : [];
  const LOG = log.map((l) => ({
    id: 'l' + l.id, at: ms_(l.at), person: l.person_id, who: l.who, area: LOG_AREA[l.area] ?? 'system', action: l.action, detail: l.detail, from: l.from_where, result: l.result,
    note: l.result === 'waiting' ? 'Needs a second person' : l.approver_name ? `Approved by ${l.approver_name}` : '',
  }));
  const APPROVALS = people
    ? (
        await q(
          `SELECT a.proposed_by, pa.name AS proposer, a.approved_by, pb.name AS approver, count(*)::int AS n
           FROM command.proposals a JOIN command.people pa ON pa.id = a.proposed_by JOIN command.people pb ON pb.id = a.approved_by
           WHERE a.status = 'approved' AND a.approved_at >= $1 GROUP BY 1, 2, 3, 4`,
          [since],
        )
      ).map((r) => ({ proposer: { id: r.proposed_by, name: r.proposer }, approver: { id: r.approved_by, name: r.approver }, n: r.n }))
    : [];
  return { DOCS, LOG, APPROVALS, people: people ? 'shown' : 'none', figures: await figures(db, 'records'), asOf: asOfFor(provider, o.now) };
}

// ── Home ────────────────────────────────────────────────────────────────────

/**
 * Home: what the other sections add up to, counted here so Home needs none of them loaded. Only
 * counts and shop names leave: no member, no person.
 */
export async function homeSection(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const provider = providerFor('home');
  const asOf = asOfFor(provider, o.now);
  const q = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows;
  const [m] = await q(`SELECT count(*)::int AS invited,
      count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'opened')::int AS opened, count(*) FILTER (WHERE status = 'invited')::int AS not_opened,
      count(*) FILTER (WHERE status = 'active' AND funded_with = 'bank')::int AS bank, count(*) FILTER (WHERE status = 'active' AND funded_with = 'five')::int AS five,
      count(*) FILTER (WHERE status = 'active' AND funded_with = 'deposit')::int AS deposit
    FROM command.members`);
  const owed = await q('SELECT o.merchant_id, o.owed_cents, coalesce(m.name, s.name) AS name FROM command.redemptions_owed o LEFT JOIN command.merchants m ON m.id = o.merchant_id LEFT JOIN command.merchant_stage s ON s.merchant_id = o.merchant_id');
  const [{ n: posters }] = await q('SELECT count(*)::int AS n FROM command.posters');
  const within = await q(
    `SELECT f.title, e.name, f.due_on, f.status FROM command.filings f JOIN command.entities e ON e.id = f.entity_id
     WHERE f.status NOT IN ('later', 'done') AND f.due_on >= $1 AND f.due_on <= $2 ORDER BY f.due_on, f.position`,
    [new Date(asOf), new Date(asOf + 30 * DAY)],
  );
  const f = { ...(await figures(db, 'home')) };
  for (const k of ['growth.range', 'merchants.payouts.schedule', 'members.first_spends.poster_ten']) {
    const { rows } = await db.query<{ value: unknown }>('SELECT value FROM command.figures WHERE key = $1', [k]);
    if (rows[0]) f[k] = rows[0].value;
  }
  return {
    MEMBER_SUMMARY: { invited: m.invited, active: m.active, opened: m.opened, notOpened: m.not_opened, funded: { bank: m.bank, five: m.five, deposit: m.deposit } },
    OWED: Object.fromEntries(owed.map((r) => [r.merchant_id, r.owed_cents / 100])),
    SHOP_NAMES: Object.fromEntries(owed.map((r) => [r.merchant_id, r.name ?? r.merchant_id])),
    POSTERS: posters,
    DEADLINES: within.map((r) => [r.title, r.name, dayMon(ms_(r.due_on)), Math.round((ms_(r.due_on) - asOf) / DAY), r.status]),
    figures: f,
    asOf,
  };
}
