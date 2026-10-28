import { DAY, SEED_TODAY, mask, type BatchRow, type FieldPayload, type FormRow, type GrowthPayload, type MemberRow, type MembersPayload, type NextBatch, type PosterRow, type WaitingRow } from '@clear/command-types';
import type { Queryable } from '../../db/db.js';
import { getPostgresPool } from '../../config/postgres.js';
import { SEE, TOTALS, type Level } from './levels.js';
import { assurancePoolLive, bondVaultLive, bondsLive, deployedName, inventory, releasesLive, reserveLive, shortAddress, yieldPoolLive, type ChainReader } from './onchain.js';
import { feedRows } from './feeds.js';
import { bankLive, cardSpend, depositRail } from './moneyFeeds.js';
import { catalogPayload, catalogProducts, siteProduct, variantParts, type ShopProduct, type SiteProduct } from './catalog.js';
import type { MemberSource } from './memberSource.js';
import { BATCH_ORDERS, WAITING_ID, WINDOW_DAYS, pickFrom, waitNo, waitlistFigures } from './waitlist.js';
import { codeActivity, codeChanges, codeConfig } from './github.js';
import { safeConfig } from './safe.js';
import { costHistory, costingPayload, lowMaterials, noCosting, orderCosts, productCost, readBook, readHistory, roundCents, shown, type Book } from './costing.js';
import { shopModelPayload } from './shopModel.js';

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
  /** The member app's records, for Members when it's live (Phase 7b). */
  memberSource?: MemberSource;
  /** Where the Clear charges are (charge_requests), for Merchants live: the main database unless given. */
  charges?: Pick<Queryable, 'query'>;
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


type Names = MembersPayload['names'];
/** A name as this level gets it: none at Totals, masked unless asked for. */
const nameFor = (names: Names) => (n: string | null) => (names === 'none' ? null : names === 'shown' ? n : n ? mask(n) : null);
/** "Ana Maria Ruiz" is Ana and Maria Ruiz; a missing part is null. */
const splitName = (n: string | null) => {
  const [first, ...rest] = (n ?? '').trim().split(/\s+/);
  return [first || null, rest.join(' ') || null] as const;
};
interface WaitlistDbRow {
  id: number;
  name: string;
  city: string;
  source: string;
  poster: string | null;
  joined_at: Date;
  batch: number | null;
  invite_code: string | null;
  invited_at: Date | null;
}
const readWaitlist = async (db: Queryable) =>
  (await db.query<WaitlistDbRow>('SELECT id, name, city, source, poster, joined_at, batch, invite_code, invited_at FROM command.waitlist ORDER BY joined_at, id')).rows;
/** Everyone not invited yet, in line: never at Totals (a place in line and a join time point to one person). */
function waitingRows(wl: WaitlistDbRow[], names: Names): WaitingRow[] | null {
  if (names === 'none') return null;
  const shown = nameFor(names);
  return wl
    .filter((w) => w.batch == null)
    .map((w, i) => {
      const [first, last] = splitName(w.name);
      return { id: WAITING_ID + w.id, no: waitNo(w.id), first: shown(first), last: shown(last), pos: i + 1, joined: ms(w.joined_at)!, city: w.city, src: w.source === 'poster' ? 'Poster' : 'Website', poster: w.poster };
    });
}
/** Each batch sent, and how far its people got, counted from the full rows. */
const batchRows = (sent: { number: number; size: number; sent_at: Date | null }[], rows: MemberRow[]): BatchRow[] =>
  sent.map((b) => {
    const in_ = rows.filter((m) => m.batch === b.number);
    return { number: b.number, sentAt: ms(b.sent_at)!, size: b.size, opened: in_.filter((m) => m.status !== 'invited').length, active: in_.filter((m) => m.status === 'active').length, spent: in_.filter((m) => m.spend != null || m.spentAt != null).length };
  });
/**
 * The join form's last 30 days, newest first (20 of them, and how many in all): a list of people, so
 * none at Totals, masked unless asked for.
 */
async function joinForm(db: Queryable, provider: Provider, names: Names, until: number): Promise<{ rows: FormRow[] | null; month: number }> {
  const since = new Date(until - 30 * DAY);
  const live = provider === 'live' ? ' AND live' : '';
  const { rows: n } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM command.form_submissions WHERE form = 'Waitlist' AND received_at >= $1 AND received_at <= $2${live}`, [since, new Date(until)]);
  if (names === 'none') return { rows: null, month: n[0].n };
  const { rows } = await db.query<{ first_name: string; last_name: string; email: string; city: string; source: string; received_at: Date; status: string }>(
    `SELECT first_name, last_name, email, city, source, received_at, status FROM command.form_submissions WHERE form = 'Waitlist' AND received_at >= $1 AND received_at <= $2${live} ORDER BY received_at DESC, id DESC LIMIT 20`,
    [since, new Date(until)],
  );
  const shown = nameFor(names);
  return {
    rows: rows.map((r) => ({ who: [shown(r.first_name) ?? '', shown(r.last_name) ?? ''], mail: names === 'shown' ? r.email : maskMail(r.email), type: 'Waitlist', city: r.city, src: r.source, when: hhmm(r.received_at), st: r.status, at: ms(r.received_at)! })),
    month: n[0].n,
  };
}

export async function membersSection(db: Queryable, o: ReadOptions): Promise<MembersPayload> {
  const provider = providerFor('members');
  if (provider === 'live') return membersLive(db, o);
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

  const full: MemberRow[] = rows.map((r) => {
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
    return m;
  });
  const MEMBERS = names === 'none' ? full.map(totalsOnly) : full;

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
  // the seed's join form, as of the prototype's day
  const form = await joinForm(db, provider, names, asOf + DAY);
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
    WAITLIST: waitingRows(await readWaitlist(db), names),
    BATCHES: batchRows(sent, full),
    FORMS: form.rows,
    // the seed's figures are the prototype's own, exactly: the join form's count is the rows'
    figures: await figures(db, 'members'),
    asOf,
    names,
  };
}

/**
 * Members, live (Phase 7b): everyone the waitlist invited, and everyone with an account in the member
 * app. An account is matched to its invite by the code its onboarding sent back, which gives it its
 * batch, when it was invited and where it heard of Clear; one without a code joined some other way
 * (batch 0). Opened is the account; active is the first deposit, which says how they funded; the
 * first spend is a card purchase or a charge code, whichever came first. The waitlist's own figures
 * are worked out from it, and a batch waiting for its second person is the next batch.
 */
async function membersLive(db: Queryable, o: ReadOptions, keep?: { rows?: MemberRow[] }): Promise<MembersPayload> {
  if (!o.memberSource) throw new Error('PROVIDER_MEMBERS=live reads the member app, and no member source was given');
  const now = o.now.getTime();
  const asOf = asOfFor('live', o.now);
  const names: MembersPayload['names'] = o.level <= TOTALS ? 'none' : o.reveal && o.level >= SEE ? 'shown' : 'masked';
  const roster = await o.memberSource.roster({ names: names !== 'none' });
  const miles = await o.memberSource.milestones([...new Set(roster.flatMap((m) => m.wallets))]);
  // oldest first: the order the line is in
  const wl = await readWaitlist(db);
  const invite = new Map(wl.filter((w) => w.invite_code).map((w) => [w.invite_code!, w]));
  const joinedCodes = new Set(roster.map((m) => m.inviteCode).filter(Boolean));
  const shown = nameFor(names);
  const split = splitName;
  const row = (m: Omit<MemberRow, 'left' | 'quiet'>): MemberRow => ({ ...m, left: WINDOW_DAYS - Math.round((asOf - m.invited) / DAY), quiet: m.status === 'invited' && (asOf - m.invited) / DAY >= 21 });

  // invited by a batch, and not signed up yet
  const waiting = wl.filter((w) => w.invite_code && !joinedCodes.has(w.invite_code)).map((w) => {
    const [first, last] = split(w.name);
    return row({ id: WAITING_ID + w.id, no: waitNo(w.id), first: shown(first), last: shown(last), batch: w.batch!, invited: ms(w.invited_at)!, joined: ms(w.joined_at)!, city: w.city, src: w.source === 'poster' ? 'Poster' : 'Website', status: 'invited', poster: w.poster, last_: ms(w.invited_at)! });
  });
  const members = roster.map((m) => {
    const w = m.inviteCode ? invite.get(m.inviteCode) : undefined;
    const got = m.wallets.map((x) => miles.get(x)).filter(Boolean) as Array<NonNullable<ReturnType<typeof miles.get>>>;
    const funded = got.map((g) => g.funded).filter(Boolean).sort((a, b) => a!.at - b!.at)[0];
    const spend = got.map((g) => g.spend).filter(Boolean).sort((a, b) => a!.at - b!.at)[0];
    const [first, last] = split(m.name);
    const r: Omit<MemberRow, 'left' | 'quiet'> = {
      id: m.id,
      no: `M-${String(m.id).padStart(4, '0')}`,
      first: shown(first),
      last: shown(last),
      batch: w?.batch ?? 0,
      invited: w ? ms(w.invited_at)! : m.createdAt,
      joined: w ? ms(w.joined_at)! : m.createdAt,
      city: m.city ?? w?.city ?? '',
      src: w?.source === 'poster' ? 'Poster' : 'Website',
      status: funded ? 'active' : 'opened',
      poster: w?.poster ?? null,
      last_: m.lastSeen ?? m.createdAt,
      opened: m.createdAt,
    };
    if (funded) Object.assign(r, { fund: FUND[funded.with], activeAt: funded.at });
    if (spend) Object.assign(r, { spend: spend.shop, spentAt: spend.at });
    return row(r);
  });
  // the figures are worked out from the full rows; at Totals the rows then leave without names or dates
  const all = [...members, ...waiting];
  const MEMBERS = names === 'none' ? all.map(totalsOnly) : all;
  if (keep) keep.rows = all;

  const { rows: batches } = await db.query<{ number: number; size: number; sent_at: Date }>(`SELECT number, size, sent_at FROM command.batches WHERE live AND status = 'sent' ORDER BY number`);
  const count = (n: number, s: string) => all.filter((m) => m.batch === n && m.status === s).length;
  // a batch someone proposed, waiting for a second person: who it would take, in its order
  const { rows: p } = await db.query<{ payload: { body: { size: number; order?: string; cities?: string[]; posters?: string[]; ids?: number[] } }; who: string; created_at: Date }>(
    `SELECT p.payload, p.created_at, coalesce(nullif(pp.name, ''), pp.email) AS who FROM command.proposals p JOIN command.people pp ON pp.id = p.proposed_by
      WHERE p.kind = 'action' AND p.status = 'waiting' AND p.payload->>'section' = 'members' AND p.payload->>'kind' = 'batch' ORDER BY p.created_at DESC LIMIT 1`,
  );
  // the next batch's number: after every batch, the seed's samples among them
  const { rows: n } = await db.query<{ number: number }>('SELECT coalesce(max(number), 0) + 1 AS number FROM command.batches');
  let NEXT_BATCH: NextBatch | null = null;
  if (p.length) {
    const body = p[0].payload.body;
    const size = Number(body.size);
    const order = BATCH_ORDERS.find((o) => o === body.order) ?? 'oldest';
    const take = pickFrom(wl.filter((w) => w.batch == null), size, order, body);
    NEXT_BATCH = {
      number: n[0].number,
      size,
      proposedBy: p[0].who,
      joinedFrom: take.length ? Math.min(...take.map((w) => ms(w.joined_at)!)) : now,
      joinedTo: take.length ? Math.max(...take.map((w) => ms(w.joined_at)!)) : now,
      fromPosters: take.filter((w) => w.source === 'poster').length,
      fromWebsite: take.filter((w) => w.source !== 'poster').length,
      windowEnds: now + WINDOW_DAYS * DAY,
      proposedAt: ms(p[0].created_at)!,
      order,
      // who, by the id their waitlist row has on the page: never at Totals
      ...(names === 'none' ? {} : { ids: take.map((w) => WAITING_ID + w.id) }),
    };
  }
  const form = await joinForm(db, 'live', names, now);

  // the 12 weeks' members figures, from the rows
  const week = Math.floor(now / (7 * DAY)) * 7 * DAY;
  const ends = Array.from({ length: 12 }, (_, i) => week + 7 * DAY - (11 - i) * 7 * DAY);
  const before = (t: number | undefined, end: number) => t != null && t < end;
  const live = {
    ...(await waitlistFigures(db, now)),
    'members.weekly.opened': ends.map((end) => all.filter((m) => m.opened != null && m.opened < end && m.opened >= end - 7 * DAY).length),
    'members.weekly.active_total': ends.map((end) => all.filter((m) => before(m.activeAt, end)).length),
    'members.weekly.first_spend_total': ends.map((end) => all.filter((m) => before(m.spentAt, end)).length),
    // no source says which first spends were a poster's $10 yet
    'members.first_spends.poster_ten': 0,
    'members.next_batch.number': n[0].number + (NEXT_BATCH ? 1 : 0),
    'members.forms.month': form.month,
  };
  return {
    MEMBERS,
    BATCH_DATE: batches.map((b) => ms(b.sent_at)!),
    B_ACT: batches.map((b) => count(b.number, 'active')),
    B_OPEN: batches.map((b) => count(b.number, 'opened')),
    NEXT_BATCH,
    WAITLIST: waitingRows(wl, names),
    BATCHES: batchRows(batches, all),
    FORMS: form.rows,
    figures: { ...(await figures(db, 'members')), ...live },
    asOf,
    names,
  };
}

/** The members' counts the other sections show: the member app's when Members is live, else Command's table. */
async function memberCounts(db: Queryable, o: ReadOptions): Promise<{ invited: number; opened: number; active: number; notOpened: number; funded: { bank: number; five: number; deposit: number }; rows: MemberRow[] | null }> {
  if (providerFor('members') === 'live' && o.memberSource) {
    // the full rows, dates and all: only counts leave this function
    const keep: { rows?: MemberRow[] } = {};
    await membersLive(db, { ...o, level: TOTALS, reveal: false }, keep);
    const rows = keep.rows!;
    const by = (s: string) => rows.filter((m) => m.status === s).length;
    const fund = (label: string) => rows.filter((m) => m.status === 'active' && m.fund === label).length;
    return { invited: rows.length, opened: by('opened'), active: by('active'), notOpened: by('invited'), funded: { bank: fund('Bank'), five: fund('$5'), deposit: fund('Deposit') }, rows };
  }
  const { rows } = await db.query<any>(`SELECT count(*)::int AS invited,
      count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'opened')::int AS opened, count(*) FILTER (WHERE status = 'invited')::int AS not_opened,
      count(*) FILTER (WHERE status = 'active' AND funded_with = 'bank')::int AS bank, count(*) FILTER (WHERE status = 'active' AND funded_with = 'five')::int AS five,
      count(*) FILTER (WHERE status = 'active' AND funded_with = 'deposit')::int AS deposit
    FROM command.members`);
  const m = rows[0];
  return { invited: m.invited, opened: m.opened, active: m.active, notOpened: m.not_opened, funded: { bank: m.bank, five: m.five, deposit: m.deposit }, rows: null };
}

const FORM_ORDER = ['Waitlist', 'Shop enquiry', 'Land offer', 'Work with us'];

/**
 * Today, 7 days and 30 days as Growth and Home draw them (Phase 7c): the visits, their sources, cities
 * and top page from Plausible (the site feed), and from Command's own records the forms the site's
 * join form sent in each period, the join rate the period before, and the members who became active.
 */
async function liveRange(db: Queryable, site: Record<string, any>, now: number, members: MemberRow[] | null): Promise<Record<string, unknown>> {
  const today = Math.floor(now / DAY) * DAY;
  const span: Record<string, number> = { today: 1, week: 7, month: 30 };
  const out: Record<string, unknown> = {};
  for (const [k, n] of Object.entries(span)) {
    const r = site[k];
    if (!r) continue;
    const from = today - (n - 1) * DAY,
      prevFrom = from - n * DAY;
    const { rows } = await db.query<{ form: string; n: number; prev: number }>(
      `SELECT form, count(*) FILTER (WHERE received_at >= $1)::int AS n, count(*) FILTER (WHERE received_at >= $2 AND received_at < $1)::int AS prev
         FROM command.form_submissions WHERE live AND received_at >= $2 AND received_at <= $3 GROUP BY form`,
      [new Date(from), new Date(prevFrom), new Date(now)],
    );
    const forms = FORM_ORDER.map((f) => rows.find((x) => x.form === f)?.n ?? 0);
    const prevJoins = rows.find((x) => x.form === 'Waitlist')?.prev ?? 0;
    const { prevVisits, ...rest } = r;
    out[k] = {
      ...rest,
      forms,
      scans: r.src[0],
      // which poster's shop each scan came from isn't in the visits yet
      top: [],
      act: members ? members.filter((m) => m.activeAt != null && m.activeAt >= from).length : 0,
      joinPrev: prevVisits ? Math.round((prevJoins / prevVisits) * 1000) / 10 : 0,
    };
  }
  return out;
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

/** The middle value, rounded to a day; null with none. */
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

/** Growth's live parts: the site feed's visits, and the 12 weeks of joins, invites and activations from the waitlist and members. */
async function growthLive(db: Queryable, o: ReadOptions, members: MemberRow[] | null) {
  const now = o.now.getTime();
  const site = (await feedRows(db)).get('site')?.figures as Record<string, any> | null | undefined;
  const { rows: wl } = await db.query<{ joined_at: Date; invited_at: Date | null; batch: number | null }>('SELECT joined_at, invited_at, batch FROM command.waitlist');
  const week = Math.floor(now / (7 * DAY)) * 7 * DAY;
  const weeks = Array.from({ length: 12 }, (_, i) => week - (11 - i) * 7 * DAY);
  const per = (times: number[]) => weeks.map((w) => times.filter((t) => t >= w && t < w + 7 * DAY).length);
  const { rows: p } = await db.query(`SELECT 1 FROM command.proposals WHERE kind = 'action' AND status = 'waiting' AND payload->>'section' = 'members' AND payload->>'kind' = 'batch' LIMIT 1`);
  const { rows: n } = await db.query<{ number: number }>('SELECT coalesce(max(number), 0) + 1 AS number FROM command.batches');
  const { range, ...visits } = site ?? {};
  return {
    next: p.length ? { number: n[0].number } : null,
    figures: {
      'growth.weekly.joined': per(wl.map((w) => ms_(w.joined_at))),
      'growth.weekly.invited': per(wl.filter((w) => w.invited_at).map((w) => ms_(w.invited_at!))),
      'growth.weekly.activated': per((members ?? []).filter((m) => m.activeAt != null).map((m) => m.activeAt!)),
      // the waitlist now: who's waiting, everyone who joined it, and the median wait of those invited
      'growth.waitlist': {
        waiting: wl.filter((w) => !w.invited_at).length,
        joined: wl.length,
        medianDays: median(wl.filter((w) => w.invited_at).map((w) => (ms_(w.invited_at!) - ms_(w.joined_at)) / DAY)),
      },
      ...(site ? { ...visits, 'growth.range': await liveRange(db, range, now, members) } : {}),
    },
  };
}

export async function growthSection(db: Queryable, o: ReadOptions): Promise<GrowthPayload> {
  const provider = providerFor('growth');
  const names: GrowthPayload['names'] = o.level <= TOTALS ? 'none' : o.reveal && o.level >= SEE ? 'shown' : 'masked';
  const list = await posters(db);

  // the inbox is a list of people: not sent at Totals, masked unless asked for
  let INBOX: FormRow[] | null = null;
  if (names !== 'none') {
    const { rows } = await db.query<{ first_name: string; last_name: string; email: string; form: string; city: string; source: string; received_at: Date; status: string }>(
      `SELECT * FROM command.form_submissions ${provider === 'live' ? 'WHERE live ' : ''}ORDER BY received_at DESC`,
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

  const counts = await memberCounts(db, o);
  const next = await db.query<{ number: number }>(`SELECT number FROM command.batches WHERE status = 'proposed' ORDER BY number LIMIT 1`);
  const fig = await figures(db, 'growth');
  const median = await db.query<{ value: unknown }>(`SELECT value FROM command.figures WHERE key = 'members.waitlist.median_days'`);
  // live, the visits are the site's from Plausible, and the weeks of joins, invites and activations Command's own (Phase 7c)
  const live = provider === 'live' ? await growthLive(db, o, counts.rows) : null;

  return {
    POSTERS: list,
    DESIGNS: await designs(db, list),
    INBOX,
    NEXT_BATCH: live ? live.next : next.rows[0] ? { number: next.rows[0].number } : null,
    MEMBER_SUMMARY: {
      invited: counts.invited,
      opened: counts.opened,
      active: counts.active,
      funded: { Bank: counts.funded.bank, $5: counts.funded.five, Deposit: counts.funded.deposit },
    },
    figures: { ...fig, ...(median.rows[0] ? { 'members.waitlist.median_days': median.rows[0].value } : {}), ...(live?.figures ?? {}) },
    asOf: asOfFor(provider, o.now),
    names,
  };
}

export async function fieldSection(db: Queryable, o: ReadOptions): Promise<FieldPayload> {
  const provider = providerFor('field');
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
  if (provider === 'live') return merchantsLive(db, o);
  const { ms, TX } = await partnerRows(db);
  const SIGNED = ms.filter((m) => m.status !== 'transacting').map((m) => (m.status === 'signing' ? [m.id, m.name, m.kind, m.city, 'signing'] : [m.id, m.name, m.kind, m.city]));
  const { rows: owedRows } = await db.query<{ merchant_id: string; owed_cents: number }>('SELECT * FROM command.redemptions_owed');
  const OWED = Object.fromEntries(owedRows.map((r) => [r.merchant_id, dollars(r.owed_cents)!]));
  const { BOARD, PROSPECTS } = await merchantBoard(db, o, OWED);

  const { rows: devs } = await db.query<{ merchant_id: string; kind: string; seq: number; status: string }>('SELECT * FROM command.device_fleet ORDER BY merchant_id, kind, seq');
  const { rows: chk } = await db.query<{ merchant_id: string; issue: string; last_seen: string }>('SELECT * FROM command.fleet_checkins ORDER BY position');
  const FLEET = chk.map((c) => {
    const kinds: Record<string, string[]> = {};
    for (const d of devs.filter((d) => d.merchant_id === c.merchant_id)) (kinds[d.kind] ??= []).push(d.status);
    return [c.merchant_id, kinds, c.issue, c.last_seen];
  });

  return { TX, SIGNED, PROSPECTS, OWED, BOARD, FLEET, figures: await figures(db, 'merchants'), asOf: asOfFor(provider, o.now) };
}

/**
 * The pipeline board and its prospects: Command's own CRM, read the same way seed or live. `full` (live) sends
 * every card's owner, value, next step and flag whatever its stage, so a page that saves a signing or signed card
 * whole (card-save) keeps them; the seed keeps the prototype's shape.
 */
async function merchantBoard(db: Queryable, o: ReadOptions, OWED: Record<string, number>, full = false) {
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
    if (full) Object.assign(base, { val: dollars(c.per_month_cents), owner: c.owner, next: c.next_step, flag: c.flag });
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
  return { BOARD, PROSPECTS };
}

/** A Point is online while heard from in the last ten minutes, and low under 20% on battery: the merchant app's own rule (pointChip). */
const POINT_HEARD_MS = 10 * 60_000;
const POINT_LOW_BATTERY = 20;

/** "Now", "4 min ago", "08:40" earlier today, "22 Oct" before that, in the shop's own time. */
function heardAt(t: number, now: number, timeZone: string): string {
  if (now - t < 60_000) return 'Now';
  if (now - t < 3600_000) return `${Math.floor((now - t) / 60_000)} min ago`;
  const fmt = (o: Intl.DateTimeFormatOptions, at: number) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone, ...o }).format(at);
    } catch {
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }).format(at);
    }
  };
  const day: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
  return fmt(day, t) === fmt(day, now) ? fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, t) : fmt({ day: 'numeric', month: 'short' }, t);
}

/**
 * Merchants, live: every shop in the merchant app (merchant.profiles), keyed by its address.
 *
 * A shop is transacting once a Clear charge of its has gone through; until then it's signed, or
 * signing while its onboarding hasn't put Clear's signer on its wallet yet. Its fee is its tier's
 * pay-over-time rate and its terms its payout terms; the month's figures are its approved Clear
 * charges in this and last calendar month, and originations every plan a charge opened. The cap is
 * on chain (MerchantRegistry), cap hits and losses aren't recorded anywhere the API reads, and
 * nothing in the merchant app is a $10 redemption owed, so those stay empty rather than guessed.
 *
 * The fleet is the shops' Points, the only devices that check in (merchant.point_keys); readers,
 * tablets, printers and drawers are named in the shop's hardware but have no status to show. The
 * board and its prospects are Command's own CRM, as on the seed.
 */
export async function merchantsLive(db: Queryable, o: ReadOptions): Promise<MerchantsPayload> {
  const now = o.now.getTime();
  const y = o.now.getUTCFullYear(),
    mo = o.now.getUTCMonth();
  const iso = (t: number) => new Date(t).toISOString();
  const [thisMonth, lastMonth, nextMonth] = [Date.UTC(y, mo, 1), Date.UTC(y, mo - 1, 1), Date.UTC(y, mo + 1, 1)];

  const { rows: shops } = await db.query<{ merchant: string; name: string; kind: string; city: string; founding: boolean; terms: string | null; over_time_bps: number | null; signer: boolean; joined_ms: string | number; timezone: string | null }>(
    `SELECT p.merchant, p.name, coalesce(p.category, '') AS kind, coalesce(p.town, p.address_city, '') AS city, p.founding, p.payout_terms AS terms, p.timezone,
            p.clear_signer_quorum_id IS NOT NULL AS signer, t.over_time_bps,
            extract(epoch FROM coalesce(p.partner_since::timestamp AT TIME ZONE 'UTC', p.created_at)) * 1000 AS joined_ms
       FROM merchant.profiles p LEFT JOIN merchant.clear_tiers t ON t.tier = p.clear_tier
      ORDER BY joined_ms, p.merchant`,
  );
  const ids = shops.map((s) => s.merchant.toLowerCase());

  // a charge that went through: approved, or since refunded or disputed (it was still a sale, and a plan was opened)
  const charges = o.charges ?? getPostgresPool() ?? db;
  const { rows: sales } = ids.length
    ? await charges.query<{ merchant: string; ever: string | number; plans: string | number; this_cents: string | number; this_n: string | number; last_cents: string | number }>(
        `SELECT merchant,
                count(*) FILTER (WHERE status IN ('approved', 'refunded', 'disputed')) AS ever,
                count(*) FILTER (WHERE status IN ('approved', 'refunded', 'disputed') AND plan_id IS NOT NULL) AS plans,
                coalesce(sum(amount_cents) FILTER (WHERE status = 'approved' AND at >= $2 AND at < $3), 0) AS this_cents,
                count(*) FILTER (WHERE status = 'approved' AND at >= $2 AND at < $3) AS this_n,
                coalesce(sum(amount_cents) FILTER (WHERE status = 'approved' AND at >= $4 AND at < $2), 0) AS last_cents
           FROM (SELECT lower(merchant_address) AS merchant, status, plan_id, amount_cents, coalesce(resolved_at, created_at) AS at FROM charge_requests WHERE lower(merchant_address) = ANY($1)) c
          GROUP BY merchant`,
        [ids, iso(thisMonth), iso(nextMonth), iso(lastMonth)],
      )
    : { rows: [] };
  const saleOf = new Map(sales.map((s) => [s.merchant, s]));

  // what each shop has out, for its hardware line
  const { rows: hw } = await db.query<{ merchant: string; kind: string; n: string | number }>(
    `SELECT merchant, CASE WHEN kind = 'point' AND settings->>'placement' = 'table' THEN 'table' ELSE kind END AS kind, count(*) AS n
       FROM merchant.hardware WHERE removed_at IS NULL GROUP BY 1, 2
     UNION ALL
     SELECT merchant, 'reader', count(*) FROM merchant.readers WHERE removed_at IS NULL AND type IN ('m2', 'smart') GROUP BY 1
     UNION ALL
     SELECT merchant, 'tablet', count(*) FROM merchant.devices WHERE revoked_at IS NULL GROUP BY 1`,
  );
  const HW: Array<[string, string]> = [['point', 'Point'], ['table', 'Table Point'], ['reader', 'Tap'], ['tablet', 'Counter'], ['printer', 'Printer'], ['drawer', 'Drawer']];
  const hardware = (id: string) =>
    HW.flatMap(([k, label]) => {
      const n = Number(hw.find((h) => h.merchant.toLowerCase() === id && h.kind === k)?.n ?? 0);
      return n === 0 ? [] : [n === 1 ? label : `${n} ${label}s`];
    }).join(' · ');

  const TX: unknown[][] = [];
  const SIGNED: string[][] = [];
  for (const s of shops) {
    const id = s.merchant.toLowerCase();
    const c = saleOf.get(id);
    if (c && Number(c.ever) > 0)
      TX.push([id, s.name, s.kind, s.city, s.founding ? 1 : 0, s.over_time_bps == null ? 0 : s.over_time_bps / 100, (s.terms ?? '').toUpperCase(), null, 0, Number(c.plans), 0, dollars(c.this_cents), Number(c.this_n), dollars(c.last_cents), hardware(id)]);
    else SIGNED.push(s.signer ? [id, s.name, s.kind, s.city] : [id, s.name, s.kind, s.city, 'signing']);
  }
  const OWED: Record<string, number> = {};
  const { BOARD, PROSPECTS } = await merchantBoard(db, o, OWED, true);

  const { rows: points } = await db.query<{ merchant: string; name: string; placement: string | null; health: { batteryPercent?: number; pluggedIn?: boolean } | string | null; last_seen_at: Date | string | null }>(
    `SELECT h.merchant, h.name, h.settings->>'placement' AS placement, k.health, k.last_seen_at
       FROM merchant.hardware h LEFT JOIN merchant.point_keys k ON k.device_id = h.id
      WHERE h.kind = 'point' AND h.removed_at IS NULL
      ORDER BY h.created_at, h.id`,
  );
  const RANK: Record<string, number> = { off: 0, low: 1, on: 2 };
  const FLEET = shops
    .flatMap((s) => {
      const id = s.merchant.toLowerCase();
      const mine = points.filter((p) => p.merchant.toLowerCase() === id);
      if (!mine.length) return [];
      const tz = s.timezone ?? 'UTC';
      const kinds: Record<string, string[]> = {};
      const issues: string[] = [];
      let last: number | null = null;
      for (const p of mine) {
        const health = typeof p.health === 'string' ? JSON.parse(p.health) : p.health;
        const seen = p.last_seen_at == null ? null : new Date(p.last_seen_at).getTime();
        if (seen != null && (last == null || seen > last)) last = seen;
        // as the merchant app shows it: no report yet, or nothing for ten minutes, is offline
        const status = !health || seen == null || now - seen > POINT_HEARD_MS ? 'off' : !health.pluggedIn && Number(health.batteryPercent) < POINT_LOW_BATTERY ? 'low' : 'on';
        (kinds[p.placement === 'table' ? 't' : 'P'] ??= []).push(status);
        if (status === 'off') issues.push(!health || seen == null ? `${p.name} not heard from yet` : `${p.name} offline since ${heardAt(seen, now, tz)}`);
        if (status === 'low') issues.push(`${p.name} battery low`);
      }
      const worst = Math.min(...Object.values(kinds).flat().map((k) => RANK[k]!));
      return [{ worst, row: [id, kinds, issues.join(' · '), last == null ? 'Never' : heardAt(last, now, tz)] }];
    })
    // problems first, as the page lists them
    .sort((a, b) => a.worst - b.worst)
    .map((f) => f.row);

  const newest = shops.at(-1);
  return {
    TX,
    SIGNED,
    PROSPECTS,
    OWED,
    BOARD,
    FLEET,
    figures: { ...(await figures(db, 'merchants')), 'merchants.newest_partner': newest ? { name: newest.name, joined: Number(newest.joined_ms) } : null },
    asOf: asOfFor('live', o.now),
  };
}
const ms_ = (d: Date) => new Date(d).getTime();

// ── Money ───────────────────────────────────────────────────────────────────

/**
 * Money: the accounts, their weeks and activity, the bonds, the yield pool and the credit book, and
 * what the page works out from them. The headline numbers (M) and the yield pool (Y) are worked out
 * here, with the prototype's own formulas: the update to the brief says rates are never computed in
 * the browser, and Phase 5 swaps these sums for the contracts' own reads.
 */
/**
 * The open bonds as Money draws them: id, face value, issued, matures, term in months, the yearly rate
 * the discount works out to, and the holder (a contract by name, else the wallet, shortened; nobody at
 * Totals), then when it matures and was issued, for the ladder. A date outside this year says its year.
 */
async function bondRowsLive(db: Queryable, chain: ChainReader, o: ReadOptions): Promise<unknown[][]> {
  const year = o.now.getUTCFullYear();
  const when = (t: number) => (new Date(t).getUTCFullYear() === year ? dayMon(t) : `${dayMon(t)} ${new Date(t).getUTCFullYear()}`);
  const named = new Map([...(await inventory(db))].map(([name, c]) => [c.address.toLowerCase(), name]));
  return (await bondsLive(db, chain))
    .filter((b) => !b.closed)
    .sort((a, b) => a.maturesAt - b.maturesAt)
    .map((b) => {
      const years = (b.maturesAt - b.issuedAt) / (365.25 * DAY);
      const rate = b.price && years > 0 ? Math.round(((b.face - b.price) / b.price / years) * 1000) / 10 : 0;
      const holder = o.level <= TOTALS || !b.holder ? '' : (named.get(b.holder.toLowerCase()) ?? shortAddress(b.holder));
      return [`BB-${b.id.padStart(4, '0')}`, b.face, when(b.issuedAt), when(b.maturesAt), Math.round(years * 12), rate, holder, b.maturesAt, b.issuedAt];
    });
}

export async function moneySection(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const provider = providerFor('money');
  const f = await figures(db, 'money');
  // with no seed (Phase 9) these stored figures may not exist yet: nothing, not a crash
  const book = (f['money.book'] ?? { credit: 0, savingsBacked: 0, unsecured: 0, limits: 0, lost: 0 }) as { credit: number; savingsBacked: number; unsecured: number; limits: number; lost: number };
  const due = (f['money.payouts_due'] ?? { owed14: 0, dueMembers: 0 }) as { owed14: number; dueMembers: number };
  const pool = (f['money.yield.pool'] ?? { principal: 0, queued: 0, opened: '—', cycleDays: 30, curve: { base: 0, s1: 0, s2: 0, kink: 1 } }) as {
    principal: number;
    queued: number;
    opened: string;
    cycleDays: number;
    curve: { base: number; s1: number; s2: number; kink: number };
  };
  const hist = (f['money.yield.history'] ?? { days: [], assets: [], lent: [] }) as { days: string[]; assets: number[]; lent: number[] };
  const floor = (f['money.floor'] ?? 0) as number;

  const { rows: accts } = await db.query<{ id: string; name: string; purpose: string; owner_group: string; source: string; swatch: string }>(
    // by group, as the page brackets them (an account added later, BondVault, joins its group), then in order
    `SELECT * FROM command.accounts ORDER BY CASE owner_group WHEN 'members' THEN 0 WHEN 'set' THEN 1 ELSE 2 END, position`,
  );
  const { rows: snaps } = await db.query<{ account_id: string; balance_cents: string }>('SELECT account_id, balance_cents FROM command.account_snapshots ORDER BY as_of');
  const weeks = (id: string) => snaps.filter((s) => s.account_id === id).map((s) => Number(s.balance_cents) / 100);
  const bal = (id: string) => weeks(id).at(-1) ?? 0;
  const { rows: bondRows } = await db.query<{ id: string; face_cents: string; issued_on: Date; matures_on: Date; term_months: number; rate_pct: string; holder: string }>('SELECT * FROM command.bonds ORDER BY issued_on');
  // live, the bonds are BurnerBond's on chain, open ones only; the seed's are the tables'
  const BONDS = provider === 'live' ? await bondRowsLive(db, chainOf(o, 'money'), o) : bondRows.map((b) => [b.id, Number(b.face_cents) / 100, dayMon(ms_(b.issued_on)), dayMon(ms_(b.matures_on)), b.term_months, Number(b.rate_pct), b.holder]);
  // live, the yield pool is the LendingPool's (Phase 5b); the rest of Money is still the tables' until its sources come
  const chainPool = provider === 'live' ? await yieldPoolLive(db, chainOf(o, 'money'), o.now.getTime()) : null;
  const { rows: pos } = chainPool ? { rows: [] } : await db.query<{ depositor: string; assets_cents: string; first_deposit: Date; pledged_cents: string }>('SELECT * FROM command.yield_positions ORDER BY assets_cents DESC, position');
  const Y_DEP = chainPool
    ? chainPool.depositors.map((d) => [d.id, d.assets, dayMon(d.since), d.pledged])
    : pos.map((p) => [p.depositor, Number(p.assets_cents) / 100, dayMon(ms_(p.first_deposit)), Number(p.pledged_cents) / 100]);
  // live, the savings reserve is the vault's on chain, and the operating account the bank's at Plaid (Phase 6b)
  const reserve = provider === 'live' ? await reserveLive(db, chainOf(o, 'money'), o.now.getTime()) : null;
  const feeds = provider === 'live' ? await feedRows(db) : null;
  const bank = feeds ? await bankLive(db, feeds.get('plaid'), feeds.get('stripe'), o.now.getTime()) : null;
  // live, the AssurancePool's reserves are the contract's own
  const assurance = provider === 'live' ? await assurancePoolLive(chainOf(o, 'money')) : null;

  // the headline numbers, as the prototype's M
  const M: Record<string, number> = {
    savings: reserve ? reserve.usdc : bal('sav'), cash: bank ? bank.balance : bal('ops'), payout: bal('pay'), assurance: assurance ? assurance.total : bal('ap'), coop: bal('coop'),
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
  if (!chainPool) { Y.cash = Y.assets - Y.lent; Y.util = Y.assets ? Y.lent / Y.assets : 0; }
  Y.earned = Y.assets - Y.principal;
  // live, the price of a share; the seed has no shares, so its principal stands in
  Y.price = chainPool ? (chainPool.supply ? chainPool.assets / chainPool.supply : 1) : Y.principal ? Y.assets / Y.principal : 1;
  const borrowBps = (u: number) => (u <= Y.curve.kink ? Y.curve.base + (Y.curve.s1 * u) / Y.curve.kink : Y.curve.base + Y.curve.s1 + (Y.curve.s2 * (u - Y.curve.kink)) / (1 - Y.curve.kink));
  const apr = (bps: number) => ((bps / 10000) * 365) / Y.cycleDays;
  const apy = (bps: number) => Math.pow(1 + bps / 10000, 365 / Y.cycleDays) - 1;
  // live, the rates are the contract's own reads; the curve is only for what a draw would do to them
  Y.borrowBps = chainPool ? chainPool.borrowBps : borrowBps(Y.util); Y.supplyBps = chainPool ? chainPool.supplyBps : Y.borrowBps * Y.util;
  Y.apy = apy(Y.supplyBps); Y.apr = apr(Y.borrowBps);
  if (reserve) { M.clrusd = reserve.clrusd; M.reserveDiff = reserve.difference; }
  M.rtd = M.unsecured ? M.assurance / M.unsecured : 0;
  M.room = M.floor ? M.assurance / M.floor - M.unsecured : 0;
  // live, the gate is the contract's: its target, its exposure, and RTD on the primary reserve alone
  if (assurance) {
    M.floor = assurance.target;
    M.unsecured = assurance.exposure;
    M.rtd = assurance.rtd ?? 0;
    M.room = assurance.room;
  }
  M.short = Math.max(0, M.owed14 - M.payout - M.dueMembers);
  // live, the gap is the PayoutPool's own shortfall, never the tables' sample against real cash
  Y.toPayout = Math.min(chainPool ? chainPool.payoutShort : M.short, Y.cash); Y.utilAfter = Y.assets ? (Y.lent + Y.toPayout) / Y.assets : 0; Y.apyAfter = apy(borrowBps(Y.utilAfter) * Y.utilAfter);

  const AP_BAL = [...((f['money.ap.balance_weeks'] as number[] | undefined) ?? []), M.assurance];
  const UNSEC = [...((f['money.credit.unsecured_weeks'] as number[] | undefined) ?? []), M.unsecured];
  // live, BondVault's balance is the chain's: the bond buyers' money, held to pay them at maturity
  const vault = provider === 'live' ? await bondVaultLive(chainOf(o, 'money')) : null;
  if (vault) M.vault = vault.held;
  const live: Record<string, number> = { yld: Y.cash, ap: M.assurance, ...(reserve ? { sav: M.savings } : {}), ...(bank ? { ops: M.cash } : {}), ...(vault ? { bond: vault.held } : {}) };
  const ACCTS = accts.map((a) => {
    const w = weeks(a.id);
    const now = live[a.id] ?? w.at(-1) ?? 0;
    const series =
      a.id === 'ap' ? AP_BAL
      : a.id === 'yld' && chainPool ? chainPool.cashWeeks
      : a.id === 'sav' && reserve ? [...reserve.weeks.slice(0, -1), now]
      : a.id === 'ops' && bank ? bank.weeks
      : [...w.slice(0, -1), now];
    // the USDC behind savings is in the vault, not at Bridge: Bridge is how it arrives
    const [purpose, source] = a.id === 'sav' && reserve ? ['CLRUSD, backed 1:1 by USDC in the savings vault', 'protocol'] : [a.purpose, a.source];
    return [a.id, a.name, purpose, a.owner_group, source, now, series, a.swatch];
  });
  const { rows: ent } = await db.query<{ account_id: string; at: Date; what: string; detail: string; amount_cents: string }>('SELECT * FROM command.account_entries ORDER BY at DESC, id');
  const ENTRIES: Record<string, unknown[]> = {};
  for (const e of ent) (ENTRIES[e.account_id] ??= []).push({ at: ms_(e.at), what: e.what, detail: e.detail, amount: Number(e.amount_cents) / 100 });
  if (chainPool) ENTRIES.yld = chainPool.entries;
  if (bank) ENTRIES.ops = bank.entries;

  const counts = await memberCounts(db, o);
  return {
    M, Y, Y_DEP,
    ...(chainPool
      ? { YD: chainPool.days.map(dayMon), Y_ASSETS: chainPool.assetsByDay, Y_LENT: chainPool.lentByDay }
      : { YD: hist.days, Y_ASSETS: [...hist.assets, Y.assets], Y_LENT: [...hist.lent, Y.lent] }),
    AP_BAL, UNSEC, AP_REQ: UNSEC.map((v) => v * M.floor), RTD_W: AP_BAL.map((v, i) => (UNSEC[i] ? v / UNSEC[i] : null)),
    COOP_W: f['money.coop.weekly'] ?? [], FLOWS: f['money.flows'] ?? [], BONDS, ACCTS, ENTRIES,
    TX: (await partnerRows(db)).TX,
    MEMBER_SUMMARY: { active: counts.active },
    // live, Lithic's card spend this month and what's moving through Bridge (null until they've synced)
    ...(feeds ? { CARD_SPEND: cardSpend(feeds.get('lithic')), DEPOSIT_RAIL: depositRail(feeds.get('bridge')) } : {}),
    SET_ASIDE: await shopSetAside(db),
    // live, what the yield pane lists since the opening is the pool's own deposits and withdrawals
    figures: {
      ...f,
      ...(chainPool
        ? {
            'money.yield.since_opened': chainPool.entries.filter((e) => /^(Opened|Deposits|Withdrawals)$/.test(e.what)).reverse().map((e) => [e.at, e.what, e.detail, e.amount]),
            'money.yield.joined_this_week': chainPool.depositors.filter((d) => d.since >= o.now.getTime() - 7 * DAY).length,
          }
        : {}),
      // live, the reserve as the vault stands now: its USDC to each CLRUSD, read with this page
      ...(reserve ? { 'money.reserve': { ratio: reserveRatio(reserve.usdc, reserve.clrusd), checked: 'just now' } } : {}),
      // live, what BondVault keeps back for bondholders and what the Safe may take for the co-op's use
      ...(assurance ? { 'money.rtd': { target: assurance.target, rtd: assurance.rtd, exposure: assurance.exposure, primary: assurance.primary, buffer: assurance.buffer, excess: assurance.excess, valid: assurance.valid, gap: assurance.gap, room: assurance.room } } : {}),
      ...(vault ? { 'money.bondvault': { required: vault.required, deployable: vault.deployable, floorPct: vault.floorPct, windowDays: vault.windowDays } } : {}),
    },
    asOf: asOfFor(provider, o.now),
  };
}

/** "1 : 1" when the vault's USDC covers CLRUSD to the cent; otherwise the USDC per CLRUSD. */
const reserveRatio = (usdc: number, clrusd: number) => (clrusd === 0 ? (usdc === 0 ? '1 : 1' : 'Nothing issued') : Math.abs(usdc - clrusd) < 0.005 ? '1 : 1' : `${(usdc / clrusd).toFixed(4)} : 1`);

// ── Shop ────────────────────────────────────────────────────────────────────


/**
 * The catalog as Command keeps it. A product with a recipe (Phase 10) or a flat cost (the redesign)
 * sends that cost as the first of its four boxes, so the page's unitCost(), which sums them, uses it unchanged.
 */
async function shopProducts(db: Queryable, f: Record<string, unknown>, book?: Book): Promise<ShopProduct[]> {
  const units = (f['shop.units_weekly'] ?? {}) as Record<string, number[]>;
  const b = book ?? (await readBook(db));
  const flat = (id: string) => b.products.get(id)?.flatCents != null;
  const boxes = (r: { id: string; cost_cents: number[] | null }) => (flat(r.id) || b.lines.get(r.id)?.length ? [shown(productCost(b, r.id).costCents), 0, 0, 0] : r.cost_cents?.map((c) => c / 100));
  const { rows } = await db.query<{ id: string; name: string; variant: string; line: string; glyph: string; price_cents: number; cost_cents: number[] | null; status: string; options: string[]; lead_weeks: number | null; slug: string; why: string | null; deposit: boolean }>(
    'SELECT * FROM command.shop_products ORDER BY position',
  );
  return rows.map((r) => ({
    id: r.id, n: r.name, v: r.variant, line: r.line, g: r.glyph, price: r.price_cents / 100,
    ...(r.cost_cents || flat(r.id) ? { c: boxes(r) } : {}),
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
  if (providerFor('shop') === 'live') {
    // live, the deposits the shop holds for reserved hardware, and the tax on the last 4 weeks' orders
    // no stored rate yet (Phase 9, no seed): nothing set aside, rather than a guessed rate
    const C = (f['shop.costs'] ?? { taxRate: 0, taxable: 0 }) as { taxRate: number; taxable: number };
    const { rows: dep } = await db.query<{ cents: string }>(`SELECT coalesce(sum(deposit_cents * units), 0) AS cents FROM command.shop_live_preorders WHERE state = 'held'`);
    const { rows: rev } = await db.query<{ cents: string }>(`SELECT coalesce(sum(total_cents - refunded_cents), 0) AS cents FROM command.shop_orders WHERE source = 'stripe' AND paid_at > now() - interval '28 days'`);
    return { salesTax: (Number(rev[0].cents) / 100) * C.taxRate * C.taxable, preorderDeposits: Number(dep[0].cents) / 100 };
  }
  const PR = await shopProducts(db, f);
  const C = (f['shop.costs'] ?? { taxRate: 0, taxable: 0 }) as { taxRate: number; taxable: number };
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
  if (provider === 'live') return shopLive(db, o);
  const asOf = asOfFor(provider, o.now);
  // the prototype's "now" is 2pm on its day
  const NOW = provider === 'seed' ? SEED_TODAY + 14 * 3600e3 : o.now.getTime();
  const at = (d: Date | null) => (d == null ? NOW : ms_(d));
  const f = await figures(db, 'shop');
  const book = await readBook(db);
  const PR = await shopProducts(db, f, book);

  const { rows: stock } = await db.query<{ product_id: string; option: string; on_hand: number }>(
    'SELECT s.product_id, s.option, s.on_hand FROM command.shop_stock s JOIN command.shop_products p ON p.id = s.product_id ORDER BY p.position, s.option_pos, s.size_pos',
  );
  const STK: Record<string, Record<string, number[]>> = {};
  for (const s of stock) ((STK[s.product_id] ??= {})[s.option] ??= []).push(s.on_hand);

  const { rows: shelf } = await db.query<{ product_id: string; state: string; starts_at: Date | null; ends_at: Date | null }>('SELECT * FROM command.shop_shelf ORDER BY product_id, position');
  const SHELF_EV: Record<string, unknown[]> = {};
  for (const id of PR.map((p) => p.id)) for (const e of shelf.filter((e) => e.product_id === id)) (SHELF_EV[id] ??= []).push([e.state, at(e.starts_at), at(e.ends_at)]);

  const { rows: hist } = await db.query<{ product_id: string; at: Date; what: string; who: string }>('SELECT * FROM command.shop_history ORDER BY id DESC');
  const totals = o.level <= TOTALS;
  // who did it is a name: not at Totals
  const SHIST: Record<string, unknown[]> = {};
  for (const id of PR.map((p) => p.id)) for (const h of hist.filter((h) => h.product_id === id)) (SHIST[id] ??= []).push([ms_(h.at), h.what, totals ? '' : h.who]);

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

  // what goes into each product (Phase 10): the inputs and their history, the recipes, the materials on hand and the runs, from See
  const costing = o.level >= SEE ? costingPayload(book, undefined, await readHistory(db)) : noCosting();
  // the redesign's (shopModel.ts): suppliers, buys on order, reorders, batches, per-order costs, pickup points
  const model = await shopModelPayload(db, book, { now: NOW, sees: o.level >= SEE });
  return { PR, STK, SHELF_EV, SHIST, ORDERS, PRE, INCOMING, RETURNS, ...costing, ...model, NOW, figures: f, asOf };
}

// ── Shop, live (Phase 7a) ───────────────────────────────────────────────────

const WEEK = 7 * DAY;

/**
 * The shop, live and read-only (Kai, 2026-10-22 and 2026-10-24): what it sells from the site's
 * catalog, its orders and hardware reservations from its Stripe Checkout (synced by the shop feed),
 * and Command's own records for the rest: each product's costs and lead time, stock, the shelf, what's
 * on the way, returns. The weekly sales, the order mix and the set-asides are worked out from the
 * live orders. Until the catalog has been read, the products are Command's own.
 */
async function shopLive(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const NOW = o.now.getTime();
  const f = await figures(db, 'shop');
  const book = await readBook(db);
  const own = await shopProducts(db, f, book);
  const feeds = await feedRows(db);
  const cat = feeds.get('catalog')?.figures as { products?: SiteProduct[]; moved?: Record<string, string> } | undefined;
  const moved = cat?.moved ?? {};
  // Command's records by the site's slug, old slugs followed to their new ones
  const ownBy = new Map(own.map((p) => [moved[p.slug] ?? p.slug, p]));
  const slugOf = (s: string) => moved[s] ?? s;

  const { rows: ord } = await db.query<{ id: string; paid_at: Date; buyer: string; member: boolean; items: Array<[string, string, string, number]>; paid_with: string; fulfilment: string; pickup_at: string; state: string; city: string }>(
    `SELECT * FROM command.shop_orders WHERE source = 'stripe' ORDER BY paid_at DESC`,
  );
  const thisWeek = Math.floor(NOW / WEEK) * WEEK;
  const weekOf = (t: number) => 7 - Math.floor((thisWeek - Math.floor(t / WEEK) * WEEK) / WEEK);
  const units = new Map<string, number[]>();
  for (const r of ord.filter((r) => r.state !== 'refund')) {
    const w = weekOf(new Date(r.paid_at).getTime());
    if (w < 0 || w > 7) continue;
    for (const [slug, , , q] of r.items) ((units.get(slugOf(slug)) ?? units.set(slugOf(slug), Array(8).fill(0)).get(slugOf(slug))!)[w] += q);
  }

  // Command's own catalog first (Phase 11), its shelf status as Command keeps it; then what the site
  // sells that Command hasn't imported yet
  const catalog = await catalogProducts(db);
  const mine = new Set(catalog.map((p) => p.slug));
  const listed: Array<SiteProduct & { shelf?: string }> = [...catalog, ...(cat?.products ?? []).filter((p) => !mine.has(slugOf(p.slug)))];
  const PR = listed.length
    ? listed.map((p) => {
        const o = ownBy.get(p.slug);
        return { ...siteProduct(p, o, units.get(p.slug) ?? Array(8).fill(0)), ...(p.shelf && o ? { st: p.shelf, n: o.n, v: o.v } : {}) };
      })
    : own.map((p) => ({ ...p, wk: units.get(slugOf(p.slug)) ?? Array(8).fill(0) }));
  const idOf = new Map(PR.map((p) => [p.slug, p.id]));
  const pid = (slug: string) => idOf.get(slugOf(slug)) ?? slugOf(slug);

  const { rows: stock } = await db.query<{ product_id: string; option: string; on_hand: number }>('SELECT s.product_id, s.option, s.on_hand FROM command.shop_stock s JOIN command.shop_products p ON p.id = s.product_id ORDER BY p.position, s.option_pos, s.size_pos');
  const STK: Record<string, Record<string, number[]>> = {};
  for (const s of stock) ((STK[s.product_id] ??= {})[s.option] ??= []).push(s.on_hand);
  const { rows: shelf } = await db.query<{ product_id: string; state: string; starts_at: Date | null; ends_at: Date | null }>('SELECT * FROM command.shop_shelf ORDER BY product_id, position');
  const SHELF_EV: Record<string, unknown[]> = {};
  for (const e of shelf) (SHELF_EV[e.product_id] ??= []).push([e.state, e.starts_at ? ms_(e.starts_at) : NOW, e.ends_at ? ms_(e.ends_at) : NOW]);
  const { rows: hist } = await db.query<{ product_id: string; at: Date; what: string; who: string }>('SELECT * FROM command.shop_history ORDER BY id DESC');
  const totals = o.level <= TOTALS;
  const SHIST: Record<string, unknown[]> = {};
  for (const h of hist) (SHIST[h.product_id] ??= []).push([ms_(h.at), h.what, totals ? '' : h.who]);

  // what each line cost when it sold (Phase 10d), from See: a line not costed yet has null
  const recorded = await orderCosts(db);
  const sees = o.level >= SEE;
  const ORDERS = ord.map((r) => {
    const items = r.items.map(([slug, col, sz, q], n) => {
      const c = recorded.get(r.id)?.get(n);
      return sees ? [pid(slug), col, sz, q, c == null ? null : shown(c)] : [pid(slug), col, sz, q];
    });
    return totals ? [r.id, 0, '', 0, items, r.paid_with, r.fulfilment, r.pickup_at, r.state, ''] : [r.id, ms_(r.paid_at), r.buyer, r.member ? 1 : 0, items, r.paid_with, r.fulfilment, r.pickup_at, r.state, r.city];
  });
  const { rows: pre } = await db.query<{ payment_intent: string; line: number; shop: string; slug: string; variant: string; units: number; state: string; placed_at: Date }>('SELECT * FROM command.shop_live_preorders ORDER BY placed_at');
  const PRE = pre.map((r) => [`${r.payment_intent.slice(-6)}-${r.line}`, r.shop, pid(r.slug), variantParts(r.variant)[0], r.units, r.state, ms_(r.placed_at)]);

  const { rows: inc } = await db.query<{ what: string; units_label: string; stages: Array<[string, number | null, number | null]>; lands: string; product_id: string }>('SELECT * FROM command.shop_incoming ORDER BY position');
  const INCOMING = inc.map((r) => [r.what, r.units_label, r.stages.map(([k, a, b]) => [k, a ?? NOW, b ?? NOW]), r.lands, r.product_id]);
  const { rows: ret } = totals ? { rows: [] } : await db.query<any>('SELECT * FROM command.shop_returns ORDER BY proposed_at DESC');
  const RETURNS = ret.map((r) => ({
    order: r.order_id, item: r.item, reason: r.reason, returned: ms_(r.returned_on), condition: r.condition, proposedBy: r.proposed_by, proposedAt: ms_(r.proposed_at),
    second: r.second_person, refundedAt: r.refunded_at == null ? null : ms_(r.refunded_at), amount: r.amount_cents == null ? null : r.amount_cents / 100,
  }));

  // the order figures, from the live orders: the rest are Command's own until a source has them
  const kept = ord.filter((r) => r.state !== 'refund');
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const ordersWeekly = Array(8).fill(0);
  // the cost of what sold each week: each line's recorded cost, or today's for one not costed yet
  const costWeekly = Array(8).fill(0);
  for (const r of kept) {
    const w = weekOf(new Date(r.paid_at).getTime());
    if (w < 0 || w > 7) continue;
    ordersWeekly[w]++;
    r.items.forEach(([slug, col, sz, q], n) => {
      const c = recorded.get(r.id)?.get(n) ?? roundCents(productCost(book, pid(slug), { option: col, size: sz }).costCents);
      costWeekly[w] += q * c;
    });
  }
  const live = {
    'shop.units_weekly': Object.fromEntries(PR.map((p) => [p.id, p.wk])),
    'shop.orders_weekly': ordersWeekly,
    'shop.cost_weekly': costWeekly.map(shown),
    'shop.size_mix': sizes.map((z) => [z, kept.reduce((a, r) => a + r.items.filter(([, , sz]) => sz === z).reduce((b, [, , , q]) => b + q, 0), 0)]),
    'shop.paid_with': [['Card', kept.length]],
    'shop.buyers': [['Buyers', kept.length]],
  };
  // the costing, with margins at the site's prices
  const costing = sees ? costingPayload(book, new Map(PR.map((p) => [p.id, p.price])), await readHistory(db)) : noCosting();
  // each product's cost over time, from its sales' recorded costs
  const COST_HIST = sees ? await costHistory(db) : {};
  // what the store shows of each product in Command's catalog (Phase 11b): public, so at any level
  const CATALOG = await catalogPayload(db);
  const model = await shopModelPayload(db, book, { now: NOW, sees });
  return { PR, STK, SHELF_EV, SHIST, ORDERS, PRE, INCOMING, RETURNS, ...costing, ...model, COST_HIST, CATALOG, NOW, figures: { ...f, ...live }, asOf: asOfFor('live', o.now) };
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
 * shops, signers are the co-op's officers. Live, the Code tab's GitHub activity too: its authors are
 * public GitHub names, but Totals still gets only counts.
 */
/**
 * Live, the header Contracts draws: the chain, the newest block the indexer has read, and the Ops Safe
 * if one is set (its threshold is read from the Safe itself, in the app). There's no timelock: a change
 * goes live once it's signed.
 */
async function chainHeader(db: Queryable): Promise<{ network: string; block: number; safe: string; threshold: number; delayHours: number }> {
  const { rows } = await db.query<{ chain_id: number; indexed_to: string }>('SELECT chain_id, indexed_to FROM command.chain_cursor ORDER BY chain_id LIMIT 1');
  const chainId = rows[0]?.chain_id ?? 84532;
  return { network: chainId === 8453 ? 'Base' : 'Base Sepolia', block: Number(rows[0]?.indexed_to ?? 0), safe: safeConfig() ? 'Ops Safe' : 'No Ops Safe yet', threshold: 0, delayHours: 0 };
}

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
  // live, the Code tab: GitHub's commits, pull requests, branches and contributors; at Totals, no names
  const CODE = provider === 'live' ? await codeActivity(db, codeConfig(), NOW, o.level > TOTALS) : null;
  // live, which of the map's contracts the indexer has found deployed (Build counts and draws these as live)
  const DEPLOYED = deployed ? ctr.filter((c) => onChain(c.name)).map((c) => c.id) : null;
  return {
    AGR, CTR, CTR_NOTE, REL, RELEASES, PENDING,
    ...(DEPLOYED ? { DEPLOYED } : {}),
    CH: [...ch.filter((c) => !c.done).map(change), ...code.open], CH_DONE: [...code.done, ...ch.filter((c) => c.done).map(change)],
    ...(CODE ? { CODE } : {}),
    SIGNERS: sg.map((s) => [s.key, s.name, s.who, Number(s.median_hours), s.idle_note]),
    NOW, figures: { ...(await figures(db, 'contracts')), ...(provider === 'live' ? { 'contracts.chain': await chainHeader(db) } : {}) }, asOf: asOfFor(provider, o.now),
  };
}

// ── Governance ──────────────────────────────────────────────────────────────

/** Governance: the entities, filings, boards and seats, the agenda, resolutions, the member vote, meetings, related-party deals and who decides what. */
export async function governanceSection(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const provider = providerFor('governance');
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
 * counts, shop names and the shop's low materials leave: no member, no person.
 */
export async function homeSection(db: Queryable, o: ReadOptions): Promise<Record<string, unknown>> {
  const provider = providerFor('home');
  const asOf = asOfFor(provider, o.now);
  const q = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows;
  const m = await memberCounts(db, o);
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
  // live, the visits are the site's (Phase 7c), and nothing yet says which first spends were a poster's $10
  if (providerFor('growth') === 'live') {
    const site = (await feedRows(db)).get('site')?.figures as Record<string, any> | null | undefined;
    if (site?.range) f['growth.range'] = await liveRange(db, site.range, o.now.getTime(), m.rows);
  }
  if (m.rows) f['members.first_spends.poster_ten'] = 0;
  // the shop's materials at or under their low mark, for the alerts (Phase 10c): from See, as Shop's costing is
  const LOW_MATERIALS = o.level >= SEE ? await lowMaterials(db) : [];
  return {
    LOW_MATERIALS,
    MEMBER_SUMMARY: { invited: m.invited, active: m.active, opened: m.opened, notOpened: m.notOpened, funded: m.funded },
    OWED: Object.fromEntries(owed.map((r) => [r.merchant_id, r.owed_cents / 100])),
    SHOP_NAMES: Object.fromEntries(owed.map((r) => [r.merchant_id, r.name ?? r.merchant_id])),
    POSTERS: posters,
    DEADLINES: within.map((r) => [r.title, r.name, dayMon(ms_(r.due_on)), Math.round((ms_(r.due_on) - asOf) / DAY), r.status]),
    figures: f,
    asOf,
  };
}
