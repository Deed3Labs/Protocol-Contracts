import { DAY, SEED_TODAY, mask, type MemberRow, type MembersPayload, type NextBatch } from '@clear/command-types';
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
