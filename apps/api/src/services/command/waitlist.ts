import { randomBytes } from 'node:crypto';
import { DAY } from '@clear/command-types';
import type { Queryable } from '../../db/db.js';
import { memberAppUrl } from '../memberAppUrl.js';

/*
 * The waitlist and batches (docs/command-center-plan.md, question 10b; Phase 7b).
 *
 *   join    the site's join form posts here (clearpath-website, NEXT_PUBLIC_JOIN_ENDPOINT). "I want to
 *           join" is a place on the waitlist; the other three answers are kept as form submissions.
 *   batch   proposed and approved by two people: the next people waiting each get an invite code and
 *           an email. The code rides in the invite link, and the member app sends it back at
 *           onboarding, so a sign-up is matched to its invite (Kai, 2026-10-24: tracked, not gated).
 *   send    a job emails what a batch queued, after the approval and outside it, retrying a failure.
 */

// ── Where a ZIP is ──────────────────────────────────────────────────────────

/** The Inland Empire's ZIPs, by city: enough for the waitlist's cities. Anything else shows as its ZIP. */
const ZIPS: Record<string, string[]> = {
  Redlands: ['92373', '92374', '92375'],
  'San Bernardino': ['92401', '92402', '92403', '92404', '92405', '92406', '92407', '92408', '92410', '92411', '92415', '92427'],
  Riverside: ['92501', '92502', '92503', '92504', '92505', '92506', '92507', '92508', '92509', '92521'],
  Highland: ['92346'],
  'Loma Linda': ['92354'],
  Yucaipa: ['92399'],
  Mentone: ['92359'],
  Colton: ['92324'],
  'Grand Terrace': ['92313'],
  Fontana: ['92334', '92335', '92336', '92337'],
  Rialto: ['92376', '92377'],
  'Moreno Valley': ['92551', '92552', '92553', '92554', '92555', '92556', '92557'],
  Ontario: ['91761', '91762', '91764'],
  'Rancho Cucamonga': ['91701', '91729', '91730', '91737', '91739'],
  Upland: ['91784', '91786'],
  Chino: ['91708', '91710'],
  Corona: ['92877', '92878', '92879', '92880', '92881', '92882', '92883'],
};
const CITY_OF = new Map(Object.entries(ZIPS).flatMap(([city, zips]) => zips.map((z) => [z, city] as const)));
export const cityOfZip = (zip: string) => (zip ? (CITY_OF.get(zip.slice(0, 5)) ?? `ZIP ${zip.slice(0, 5)}`) : '');

// ── Joining ─────────────────────────────────────────────────────────────────

export type JoinAs = 'member' | 'shop' | 'land' | 'work';
const FORM: Record<JoinAs, string> = { member: 'Waitlist', shop: 'Shop enquiry', land: 'Land offer', work: 'Work with us' };

export interface Join {
  as: JoinAs;
  name: string;
  email: string;
  zip?: string;
  note?: string;
  poster?: string;
  /** The rest of what that answer asks (a shop's business and industry, a land offer's property). */
  details?: Record<string, string>;
}

/**
 * Someone answered the site's join form. Every answer is kept as a form submission; "I want to join"
 * is also a place on the waitlist, the first one per email (asking again keeps their place).
 */
export async function join(db: Queryable, j: Join, now: Date): Promise<void> {
  const email = j.email.trim().toLowerCase();
  const zip = (j.zip ?? '').trim();
  const city = cityOfZip(zip);
  const [first, ...rest] = j.name.trim().split(/\s+/);
  const source = j.poster ? 'Poster' : 'Website';
  await db.query(
    `INSERT INTO command.form_submissions (first_name, last_name, email, form, city, source, received_at, status, zip, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'New', $8, $9)`,
    [first ?? '', rest.join(' '), email, FORM[j.as], city, source, now, zip || null, j.details && Object.keys(j.details).length ? JSON.stringify(j.details) : null],
  );
  if (j.as !== 'member') return;
  await db.query(
    `INSERT INTO command.waitlist (email, name, zip, city, source, poster, note, joined_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) DO NOTHING`,
    [email, j.name.trim(), zip, city, j.poster ? 'poster' : 'website', j.poster ?? null, (j.note ?? '').trim(), now],
  );
}

// ── Batches ─────────────────────────────────────────────────────────────────

export type BatchOrder = 'oldest' | 'posters' | 'city';
/** Who goes first: the longest waiting, posters' joiners, or Redlands (the page's three choices). */
const ORDER_BY: Record<BatchOrder, string> = {
  oldest: 'joined_at, id',
  posters: `(source = 'poster') DESC, joined_at, id`,
  city: `(city = 'Redlands') DESC, joined_at, id`,
};
export const WINDOW_DAYS = 90;

/** An invite code: 10 characters from an alphabet with nothing to misread (no 0/O, 1/I/L). */
export function inviteCode(): string {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  return [...bytes].map((b) => A[b % A.length]).join('').replace(/^(.{5})/, '$1-');
}

/**
 * Sends a batch, once two people have agreed: the next `size` people waiting, in the chosen order, each
 * get a code, and their emails are queued for the job. Returns the batch's number and how many it took.
 */
export async function sendBatch(tx: Queryable, size: number, order: BatchOrder, proposedBy: string, at: Date): Promise<{ number: number; size: number }> {
  const { rows: next } = await tx.query<{ id: number; joined_at: Date; source: string }>(
    `SELECT id, joined_at, source FROM command.waitlist WHERE batch IS NULL ORDER BY ${ORDER_BY[order]} LIMIT $1 FOR UPDATE`,
    [size],
  );
  if (!next.length) throw Object.assign(new Error('Nobody is waiting, so there’s no batch to send'), { status: 409, code: 'NOBODY_WAITING' });
  const { rows: n } = await tx.query<{ number: number }>('SELECT coalesce(max(number), 0) + 1 AS number FROM command.batches');
  const number = n[0].number;
  const times = next.map((r) => new Date(r.joined_at).getTime());
  await tx.query(
    `INSERT INTO command.batches (number, size, status, sent_at, proposed_by, joined_from, joined_to, from_posters, from_website, window_ends, live)
     VALUES ($1, $2, 'sent', $3, $4, $5, $6, $7, $8, $9, true)`,
    [number, next.length, at, proposedBy, new Date(Math.min(...times)), new Date(Math.max(...times)), next.filter((r) => r.source === 'poster').length, next.filter((r) => r.source !== 'poster').length, new Date(at.getTime() + WINDOW_DAYS * DAY)],
  );
  for (const r of next) {
    // a code can collide, astronomically rarely: ask again rather than fail the batch
    for (let tries = 0; ; tries++) {
      const ok = await tx.query(
        `UPDATE command.waitlist SET batch = $2, invite_code = $3, invited_at = $4, email_state = 'queued', email_tries = 0, email_error = NULL
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM command.waitlist WHERE invite_code = $3) RETURNING email`,
        [r.id, number, inviteCode(), at],
      );
      if (ok.rows.length) {
        await tx.query(`UPDATE command.form_submissions SET status = 'Invited' WHERE form = 'Waitlist' AND email = $1 AND status = 'New'`, [ok.rows[0].email]);
        break;
      }
      if (tries > 5) throw new Error('Couldn’t make a unique invite code');
    }
  }
  return { number, size: next.length };
}

/** Where an invite takes someone: the member app, carrying the code (COMMAND_INVITE_URL to change it). */
export const inviteLink = (code: string, env: Record<string, string | undefined> = process.env) => `${(env.COMMAND_INVITE_URL || memberAppUrl()).replace(/\/+$/, '')}/?invite=${encodeURIComponent(code)}`;

export function inviteEmail(r: { name: string; joined_at: Date; invite_code: string }, env: Record<string, string | undefined> = process.env) {
  const first = r.name.trim().split(/\s+/)[0] || 'there';
  const joined = new Date(r.joined_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  return {
    subject: 'Your place in Clear is ready',
    text: [
      `Hi ${first},`,
      '',
      `You joined the Clear waitlist on ${joined}. Your place is ready.`,
      '',
      `Open your account here: ${inviteLink(r.invite_code, env)}`,
      '',
      `Your invite code is ${r.invite_code}. The invite is open for ${WINDOW_DAYS} days.`,
      '',
      'Clear, a member-owned cooperative',
    ].join('\n'),
  };
}

const MAX_TRIES = 5;

/** Emails the invites a batch queued, and retries those that failed (up to 5 tries, 10 minutes apart). */
export async function sendInvites(db: Queryable, mail: (m: { to: string; subject: string; text: string }) => Promise<void>, now: Date, limit = 25): Promise<{ sent: number; failed: number }> {
  const { rows } = await db.query<{ id: number; email: string; name: string; joined_at: Date; invite_code: string }>(
    `SELECT id, email, name, joined_at, invite_code FROM command.waitlist
      WHERE email_state = 'queued' OR (email_state = 'failed' AND email_tries < $1 AND emailed_at < $2)
      ORDER BY invited_at, id LIMIT $3`,
    [MAX_TRIES, new Date(now.getTime() - 10 * 60_000), limit],
  );
  let sent = 0,
    failed = 0;
  for (const r of rows) {
    try {
      await mail({ to: r.email, ...inviteEmail(r) });
      await db.query(`UPDATE command.waitlist SET email_state = 'sent', emailed_at = $2, email_error = NULL, email_tries = email_tries + 1 WHERE id = $1`, [r.id, now]);
      sent++;
    } catch (e) {
      await db.query(`UPDATE command.waitlist SET email_state = 'failed', emailed_at = $2, email_error = $3, email_tries = email_tries + 1 WHERE id = $1`, [r.id, now, String((e as Error)?.message ?? e).slice(0, 300)]);
      failed++;
    }
  }
  return { sent, failed };
}

// ── What Members draws from it ──────────────────────────────────────────────

/**
 * The waitlist's figures, as the Members page reads them: how many wait and how long, where from,
 * the 12 weeks' running total, and who a batch of each size would take.
 */
export async function waitlistFigures(db: Queryable, now: number): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ joined_at: Date; source: string; city: string; batch: number | null }>('SELECT joined_at, source, city, batch FROM command.waitlist ORDER BY joined_at, id');
  const waiting = rows.filter((r) => r.batch == null);
  const days = waiting.map((r) => (now - new Date(r.joined_at).getTime()) / DAY).sort((a, b) => a - b);
  const median = days.length ? Math.round(days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) : 0;
  const bucket = (lo: number, hi: number) => days.filter((d) => d >= lo && d < hi).length;
  const count = <T,>(list: T[], key: (x: T) => string) => [...list.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const week = Math.floor(now / (7 * DAY)) * 7 * DAY;
  const weekly = Array.from({ length: 12 }, (_, i) => rows.filter((r) => new Date(r.joined_at).getTime() < week + 7 * DAY - (11 - i) * 7 * DAY).length);
  const cities = count(waiting, (r) => r.city || 'Unknown');
  const top = cities.slice(0, 3).map(([c]) => c);
  // who the next batch would take at each size the page offers, oldest first
  const preview = Object.fromEntries(
    [25, 50, 75, 100].map((n) => {
      const take = waiting.slice(0, n);
      const wk = (lo: number, hi: number) => take.filter((r) => {
        const d = (now - new Date(r.joined_at).getTime()) / DAY;
        return d >= lo * 7 && d < hi * 7;
      }).length;
      return [n, { wk: [wk(0, 4), wk(4, 6), wk(6, 1e9)], src: [take.filter((r) => r.source === 'poster').length, take.filter((r) => r.source !== 'poster').length], city: [...top.map((c) => take.filter((r) => r.city === c).length), take.filter((r) => !top.includes(r.city)).length] }];
    }),
  );
  return {
    'members.waitlist.total': waiting.length,
    'members.waitlist.median_days': median,
    'members.waitlist.over_4_weeks': days.filter((d) => d >= 28).length,
    'members.waitlist.wait_buckets': [['< 1 wk', bucket(0, 7)], ['1–2 wks', bucket(7, 14)], ['2–3 wks', bucket(14, 21)], ['3–4 wks', bucket(21, 28)], ['4–6 wks', bucket(28, 42)], ['6 wks +', bucket(42, 1e9)]],
    'members.waitlist.sources': [['Poster', waiting.filter((r) => r.source === 'poster').length], ['Website', waiting.filter((r) => r.source !== 'poster').length]],
    // the three biggest cities, then everyone else, as the page's bar draws them
    'members.waitlist.cities': [...cities.slice(0, 3), ['Other', cities.slice(3).reduce((a, [, n]) => a + n, 0)]],
    'members.weekly.waitlist_total': weekly,
    'members.next_batch.preview': preview,
  };
}
