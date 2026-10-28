import { z } from 'zod';
import type { Queryable } from '../../db/db.js';
import { ActionError } from './actionError.js';
import type { Action } from './actions.js';
import { FEED_NAMES } from './feeds.js';

/*
 * Settings → Rules and limits (docs/ui-redesign-plan.md, Security; the reference's SETS). The numbers
 * the app enforces are stored in command.settings (migration 0057) and read where they apply: a refund
 * or a shop buy over its limit waits for a second person. Changing one is itself a proposal a second
 * person approves, and nobody approves their own (the proposals' rule, and a CHECK on the table).
 *
 * Locked rules are set somewhere else (a vote, the bylaws, the law, the server itself): they aren't
 * stored or changeable here, only shown, with where they're decided.
 */

export type SettingKind = 'money' | 'num' | 'pct' | 'hours' | 'days' | 'choice' | 'on' | 'text' | 'lock';
/** What a text setting holds, so it's checked as one. */
export type TextFormat = 'name' | 'url' | 'email' | 'tz' | 'currency';

export interface SettingDef {
  id: string;
  /** Its group on the page: money, chain, members, shop, gov, signin, privacy, records, notify, org (the profile). */
  sec: string;
  t: string;
  d: string;
  kind: SettingKind;
  /** A lock's value, as words. */
  v?: string;
  unit?: string;
  opts?: string[];
  /** A text setting's format. */
  fmt?: TextFormat;
  /** Why it's locked, and the page where it's decided. */
  why?: string;
  where?: string;
  /** The pages that read it. */
  used: string[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const SETTINGS: SettingDef[] = [
  { id: 'money', sec: 'money', t: 'Second person on money moves', d: 'Every move out of a co-op account, any amount', kind: 'lock', v: 'Always', why: 'Set by the two-person rule policy', where: 'records/docs', used: ['money'] },
  { id: 'shopbuy', sec: 'money', t: 'Shop buys need a second person over', d: 'Supplier orders and recorded buys', kind: 'money', used: ['shop', 'money'] },
  { id: 'refund', sec: 'money', t: 'Shop refunds need a second person over', d: 'Smaller refunds go back right away', kind: 'money', used: ['shop'] },
  { id: 'spend', sec: 'money', t: 'Spending the co-op balance', d: 'Member discounts collected at partner shops', kind: 'lock', v: 'Member vote', why: 'Set by the co-op agreement', where: 'governance/proposals', used: ['money', 'governance'] },
  { id: 'safe', sec: 'chain', t: 'Ops Safe signatures', d: 'Upgrades, caps and shop terms', kind: 'lock', v: '2 of 3', why: 'Changed by a board vote, then in the Ops Safe', where: 'governance/proposals', used: ['build'] },
  { id: 'wait', sec: 'chain', t: 'Wait before a change goes live', d: 'After the last signature', kind: 'hours', used: ['build'] },
  { id: 'cap', sec: 'chain', t: 'Starting cap for a new shop', d: 'What a partner can extend before a raise', kind: 'money', used: ['merchants', 'build'] },
  { id: 'batch', sec: 'members', t: 'Invite batch size', d: 'Oldest on the waitlist first', kind: 'num', unit: 'people', used: ['members'] },
  { id: 'exports', sec: 'members', t: 'Data exports need a second person', d: 'Any list with names, emails or phone numbers', kind: 'lock', v: 'Always', why: 'Set by the privacy policy', where: 'records/docs', used: ['members', 'records'] },
  { id: 'margin', sec: 'shop', t: 'Target margin', d: 'Products under it are flagged', kind: 'pct', used: ['shop'] },
  { id: 'buffer', sec: 'shop', t: 'Reorder buffer', d: 'On top of the supplier’s lead time', kind: 'num', unit: 'week', used: ['shop'] },
  { id: 'hold', sec: 'shop', t: 'Pickup hold', d: 'Then we message the member', kind: 'days', used: ['shop'] },
  { id: 'ship', sec: 'shop', t: 'Flat shipping charged', d: 'What a shipped order is charged', kind: 'money', used: ['shop'] },
  { id: 'cosign', sec: 'gov', t: 'Co-signers to take a board decision to a vote', d: 'Any member can start one', kind: 'lock', v: '10 members', why: 'Set by the bylaws', where: 'governance/proposals', used: ['governance', 'community'] },
  { id: 'quiet', sec: 'gov', t: 'Discussion before a vote opens', d: 'Proposals stay open for comment', kind: 'days', used: ['governance', 'community'] },
  { id: 'passkey', sec: 'signin', t: 'Passkey for anyone who can propose or approve', d: 'Read-only people can use an emailed code', kind: 'on', used: ['team'] },
  { id: 'session', sec: 'signin', t: 'Stay signed in for', d: 'On a trusted device', kind: 'hours', used: ['team'] },
  { id: 'again', sec: 'signin', t: 'Ask again before money moves and signing', d: 'Passkey every time', kind: 'on', used: ['money', 'build'] },
  { id: 'rotate', sec: 'signin', t: 'Rotate connection keys every', d: 'A reminder, then a second person swaps it', kind: 'days', used: ['settings'] },
  { id: 'newdev', sec: 'signin', t: 'New devices need a confirmation', d: 'From someone who can confirm devices', kind: 'on', used: ['team'] },
  { id: 'mask', sec: 'privacy', t: 'Personal details masked everywhere', d: 'Names, emails, phones and addresses', kind: 'lock', v: 'Always', why: 'The server enforces it on every request', where: 'records/reveals', used: ['members', 'merchants', 'records'] },
  { id: 'reason', sec: 'privacy', t: 'Ask for a reason on every reveal', d: 'Skipping it is allowed in a rush, then flagged', kind: 'on', used: ['members', 'records'] },
  { id: 'revealers', sec: 'privacy', t: 'Who can reveal', d: 'Groups at Approve on the section', kind: 'lock', v: 'Approve on the section', why: 'Follows each group’s levels in Team', where: 'team/groups', used: ['members'] },
  { id: 'retain', sec: 'records', t: 'Keep records for', d: 'Documents, the audit log and reveals', kind: 'lock', v: '7 years', why: 'Required for the co-op and the money program', where: 'records/docs', used: ['records'] },
  { id: 'digest', sec: 'notify', t: 'Daily digest', d: 'What’s waiting, alerts and the day’s numbers', kind: 'choice', opts: ['06:00', '07:00', '08:00', 'Off'], used: ['home'] },
  // Settings → Organization → Profile (migration 0068): stored, unset until someone (and a second person) sets them
  { id: 'org_name', sec: 'org', t: 'Name', d: 'The organization’s name', kind: 'text', fmt: 'name', used: [] },
  { id: 'org_site', sec: 'org', t: 'Website', d: 'Its address on the web', kind: 'text', fmt: 'url', used: [] },
  { id: 'org_help', sec: 'org', t: 'Help email', d: 'Where members write for help', kind: 'text', fmt: 'email', used: [] },
  { id: 'org_tz', sec: 'org', t: 'Time zone', d: 'A time zone name, like America/Los_Angeles', kind: 'text', fmt: 'tz', used: [] },
  { id: 'org_fy', sec: 'org', t: 'Fiscal year starts', d: 'The first month of the books’ year', kind: 'choice', opts: MONTHS, used: [] },
  { id: 'org_cur', sec: 'org', t: 'Currency', d: 'The three-letter code, like USD', kind: 'text', fmt: 'currency', used: [] },
];

const DEF = new Map(SETTINGS.map((s) => [s.id, s]));

/**
 * The stored settings the server reads where they apply: the shop's buy and refund limits (actions.ts),
 * shipping, the reorder buffer and the pickup hold (shopModel.ts), and asking for a reveal's reason
 * (store.ts, logReveal). The others are stored and can be changed, but nothing enforces them yet, so
 * the page says so rather than claiming a page uses them.
 */
export const ENFORCED = new Set(['shopbuy', 'refund', 'ship', 'buffer', 'hold', 'reason']);

/** What a setting of each kind may be set to. */
const VALUE: Record<Exclude<SettingKind, 'lock' | 'choice' | 'text'>, z.ZodType<number | boolean>> = {
  money: z.number().nonnegative().max(100_000),
  num: z.number().int().positive().max(10_000),
  pct: z.number().min(0).max(100),
  hours: z.number().int().positive().max(24 * 90),
  days: z.number().int().positive().max(3650),
  on: z.boolean(),
};

/** Whether a text is a real time zone or currency: what the runtime's Intl knows. */
const intlOk = (make: () => unknown) => {
  try {
    make();
    return true;
  } catch {
    return false;
  }
};
/** What each text format may be, and the words when it isn't. */
const TEXT: Record<TextFormat, [(v: string) => boolean, string]> = {
  name: [(v) => v.length >= 2 && v.length <= 120, 'A name of 2 to 120 characters'],
  url: [(v) => v.length <= 200 && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(v), 'A web address, like useclear.org'],
  email: [(v) => v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'An email address'],
  tz: [(v) => /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(v) && intlOk(() => new Intl.DateTimeFormat('en-US', { timeZone: v })), 'A time zone name, like America/Los_Angeles'],
  currency: [(v) => /^[A-Z]{3}$/.test(v) && intlOk(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: v })), 'A three-letter currency code, like USD'],
};

/** Checks a new value against its setting: the parsed value, or an ActionError naming what's wrong. */
export function checkValue(id: string, value: unknown): number | boolean | string {
  const s = DEF.get(id);
  if (!s) throw new ActionError(404, 'NOT_FOUND', 'No such setting');
  if (s.kind === 'lock') throw new ActionError(400, 'LOCKED', `${s.t} is set elsewhere: ${s.why ?? 'not here'}`);
  if (s.kind === 'text') {
    const v = typeof value === 'string' ? value.trim() : '';
    const [ok, words] = TEXT[s.fmt!];
    if (!ok(v)) throw new ActionError(400, 'BAD_VALUE', `${s.t}: ${words}`);
    return v;
  }
  if (s.kind === 'choice') {
    if (typeof value !== 'string' || !s.opts!.includes(value)) throw new ActionError(400, 'BAD_VALUE', `Pick one of ${s.opts!.join(', ')}`);
    return value;
  }
  const r = VALUE[s.kind].safeParse(value);
  if (!r.success) throw new ActionError(400, 'BAD_VALUE', `That isn’t a valid value for “${s.t}”`);
  return r.data;
}

/** A stored setting's value. Every setting that isn't a lock has a row (migration 0057). */
export async function readSetting<T = number>(db: Queryable, id: string): Promise<T> {
  const { rows } = await db.query<{ value: T }>('SELECT value FROM command.settings WHERE id = $1', [id]);
  if (!rows[0]) throw new Error(`command.settings has no ${id}`);
  return rows[0].value;
}

/** Whether an amount is over a money limit, so it waits for a second person. */
export const overLimit = async (db: Queryable, id: 'refund' | 'shopbuy', amount: number) => amount > (await readSetting<number>(db, id));

const words = (s: SettingDef, v: unknown) =>
  s.kind === 'text' || (s.kind === 'choice' && v === '') ? (v === '' ? 'not set' : `“${v}”`) : s.kind === 'money' ? `$${Number(v).toFixed(2)}` : s.kind === 'pct' ? `${v}%` : s.kind === 'on' ? (v ? 'on' : 'off') : s.kind === 'hours' ? `${v} hours` : s.kind === 'days' ? `${v} days` : `${v}${s.unit ? ' ' + s.unit : ''}`;

/** Settings' own action: changing a value always waits for a second person. */
export const settingsActions: Record<string, Action> = {
  change: {
    body: z.object({ id: z.string().trim().min(1).max(32), value: z.union([z.number(), z.boolean(), z.string().max(200)]), why: z.string().trim().max(500).default('') }),
    summary: (b) => {
      const s = DEF.get(b.id);
      return s ? `Change “${s.t}” to ${words(s, b.value)}` : `Change ${b.id}`;
    },
    second: (b) => {
      // a value that could never be set is refused before it waits for anyone
      checkValue(b.id, b.value);
      return true;
    },
    apply: async ({ tx, person, approver, at }, b) => {
      const value = checkValue(b.id, b.value);
      const before = await readSetting(tx, b.id);
      await tx.query('UPDATE command.settings SET value = $2, changed_at = $3, changed_by = $4, approved_by = $5 WHERE id = $1', [
        b.id,
        JSON.stringify(value),
        at,
        person.id,
        approver?.id ?? null,
      ]);
      return { id: b.id, before, after: value };
    },
  },
  /**
   * A connection's key swapped, recorded (Settings → Connections → Key age). The swap itself happens in
   * Railway's env, which Command can't see; this is the record of when, by whom and why. A day in the
   * past can be given for a swap made before it was recorded, never one to come.
   */
  'key-rotated': {
    body: z.object({
      connection: z.enum(Object.keys(FEED_NAMES) as [keyof typeof FEED_NAMES, ...(keyof typeof FEED_NAMES)[]]),
      on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      note: z.string().trim().max(300).default(''),
    }),
    summary: (b) => `Recorded a new ${FEED_NAMES[b.connection as keyof typeof FEED_NAMES]} key${b.note ? ` · ${b.note}` : ''}`,
    apply: async ({ tx, person, at }, b) => {
      // a day given is that day's noon UTC, so it reads as that day anywhere the page is opened
      const when = b.on ? new Date(`${b.on}T12:00:00Z`) : at;
      if (Number.isNaN(when.getTime()) || when.getTime() > at.getTime() + 864e5 || when.getUTCFullYear() < 2020)
        throw new ActionError(400, 'BAD_DATE', 'Give the day the key was swapped: today or before');
      await tx.query('INSERT INTO command.key_rotations (connection, rotated_at, person_id, note, recorded_at) VALUES ($1, $2, $3, $4, $5)', [
        b.connection,
        when,
        person.id,
        b.note,
        at,
      ]);
    },
  },
};

/** A connection's key as Command last recorded it: when it was swapped, by whom, and the note. */
export interface KeyRow {
  connection: string;
  at: number;
  by: string | null;
  note: string;
  /** How many swaps are recorded for it. */
  n: number;
}

/** The newest recorded swap per connection. A connection with none isn't listed: the page says "Never recorded". */
async function keyAges(db: Queryable, named: boolean): Promise<KeyRow[]> {
  const { rows } = await db.query<{ connection: string; rotated_at: Date; by: string | null; note: string; n: number }>(
    `SELECT DISTINCT ON (k.connection) k.connection, k.rotated_at, COALESCE(NULLIF(p.name, ''), p.email) AS by, k.note,
            count(*) OVER (PARTITION BY k.connection)::int AS n
       FROM command.key_rotations k LEFT JOIN command.people p ON p.id = k.person_id
      ORDER BY k.connection, k.rotated_at DESC, k.id DESC`,
  );
  return rows.map((r) => ({ connection: r.connection, at: r.rotated_at.getTime(), by: named ? r.by : null, note: r.note, n: r.n }));
}

/**
 * Settings → Security → Worth a look: the sign-in and reveal events of the last 30 days that someone
 * should glance at, read from what's already kept (sign-ins, devices, people, reveals):
 * - join: someone's first sign-in;
 * - device: a sign-in from a device that person hadn't used before (nothing confirms devices yet, so
 *   it says so rather than naming who confirmed it);
 * - noreason: a reveal of someone's details with no reason given (flagged);
 * - quiet: a device last seen more than 7 days ago, within the 30.
 * Newest first. At Totals no one is named.
 */
export interface WorthRow {
  kind: 'join' | 'device' | 'noreason' | 'quiet';
  at: number;
  /** Who it's about (their command.people id) and their name; null at Totals. */
  personId: string | null;
  who: string | null;
  /** The device's label, the reveal's subject and field, or the group joined. */
  what: string;
  /** For a join, how they signed in. */
  method?: string;
}

const QUIET_DAYS = 7;
async function worthALook(db: Queryable, now: number, named: boolean): Promise<WorthRow[]> {
  const since = new Date(now - 30 * 864e5);
  const name = `COALESCE(NULLIF(p.name, ''), p.email)`;
  const { rows: signs } = await db.query<{ person_id: string; who: string | null; at: Date; device: string; method: string; new_device: boolean; first: boolean; grp: string | null; custom: boolean }>(
    `SELECT s.person_id, ${name} AS who, s.at, s.device, s.method, s.new_device,
            s.at = (SELECT min(f.at) FROM command.sign_ins f WHERE f.person_id = s.person_id) AS first,
            g.name AS grp, a.custom_levels IS NOT NULL AS custom
       FROM command.sign_ins s JOIN command.people p ON p.id = s.person_id
       LEFT JOIN command.person_access a ON a.person_id = s.person_id LEFT JOIN command.groups g ON g.id = a.group_id
      WHERE s.at >= $1 AND s.at <= $2 AND (s.new_device OR s.at = (SELECT min(f.at) FROM command.sign_ins f WHERE f.person_id = s.person_id))
      ORDER BY s.at DESC LIMIT 100`,
    [since, new Date(now)],
  );
  const { rows: quiet } = await db.query<{ person_id: string; who: string | null; label: string; last_seen: Date }>(
    `SELECT d.person_id, ${name} AS who, d.label, d.last_seen FROM command.devices d JOIN command.people p ON p.id = d.person_id
      WHERE d.last_seen >= $1 AND d.last_seen < $2 ORDER BY d.last_seen DESC LIMIT 50`,
    [since, new Date(now - QUIET_DAYS * 864e5)],
  );
  const { rows: rv } = await db.query<{ person_id: string; who: string; at: Date; subject: string; field: string; section: string }>(
    `SELECT person_id, who, at, subject, field, section FROM command.reveals WHERE flagged AND reason = '' AND at >= $1 AND at <= $2 ORDER BY at DESC LIMIT 50`,
    [since, new Date(now)],
  );
  const who = (id: string, n: string | null) => (named ? { personId: id, who: n ?? 'Someone' } : { personId: null, who: null });
  const out: WorthRow[] = [
    ...signs.map((s) =>
      s.first
        ? { kind: 'join' as const, at: s.at.getTime(), ...who(s.person_id, s.who), what: s.custom ? 'Custom access' : (s.grp ?? 'Members'), method: s.method }
        : { kind: 'device' as const, at: s.at.getTime(), ...who(s.person_id, s.who), what: s.device },
    ),
    // a device goes quiet a week after it was last seen
    ...quiet.map((d) => ({ kind: 'quiet' as const, at: d.last_seen.getTime() + QUIET_DAYS * 864e5, ...who(d.person_id, d.who), what: d.label })),
    ...rv.map((r) => ({ kind: 'noreason' as const, at: r.at.getTime(), ...who(r.person_id, r.who), what: `${r.subject === '*' ? 'a whole list' : r.subject} · ${r.field}` })),
  ];
  return out.sort((a, b) => b.at - a.at).slice(0, 50);
}

export interface SettingRow extends SettingDef {
  /** The stored value; a lock's is its words. */
  value: number | boolean | string;
  /** Whether the server reads it where it applies (null for a lock, which is decided elsewhere). */
  enforced: boolean | null;
  changedAt: number | null;
  changedBy: string | null;
  approvedBy: string | null;
  /** A change waiting for a second person. */
  pending: { id: string; to: unknown; by: string; why: string; at: number } | null;
}

/**
 * Each stored setting's first value, as migration 0057 set it. Every change since is an approved
 * proposal, so a change's old value is the one before it, back to this.
 */
export const FIRST: Record<string, number | boolean | string> = {
  shopbuy: 50, refund: 50, wait: 24, cap: 100, batch: 25, margin: 60, buffer: 1, hold: 14, ship: 6, quiet: 7,
  passkey: true, session: 12, again: true, rotate: 90, newdev: true, reason: true, digest: '07:00',
  // the profile (migration 0068): unset
  org_name: '', org_site: '', org_help: '', org_tz: '', org_fy: '', org_cur: '',
};

/** A change a second person approved: from what, to what, who proposed it and who approved it. */
export interface SettingChange {
  /** The proposal's id. */
  id: string;
  set: string;
  at: number;
  from: unknown;
  to: unknown;
  by: string | null;
  approvedBy: string | null;
  why: string;
}

/** Settings' page: every rule with its value, who last changed it, and any change waiting. At Totals, no one's name. */
export async function settingsSection(
  db: Queryable,
  level: number,
  now = Date.now(),
): Promise<{ SETTINGS: SettingRow[]; HISTORY: SettingChange[]; KEYS: KeyRow[]; WORTH: WorthRow[] }> {
  const named = level > 1;
  const { rows } = await db.query<{ id: string; value: unknown; changed_at: Date; changed_by: string | null; approved_by: string | null }>(
    `SELECT s.id, s.value, s.changed_at, COALESCE(NULLIF(c.name, ''), c.email) AS changed_by, COALESCE(NULLIF(a.name, ''), a.email) AS approved_by
       FROM command.settings s LEFT JOIN command.people c ON c.id = s.changed_by LEFT JOIN command.people a ON a.id = s.approved_by`,
  );
  const stored = new Map(rows.map((r) => [r.id, r]));
  const { rows: waiting } = await db.query<{ id: string; payload: { body: { id: string; value: unknown; why: string } }; by: string; created_at: Date }>(
    `SELECT p.id, p.payload, COALESCE(NULLIF(pp.name, ''), pp.email) AS by, p.created_at
       FROM command.proposals p JOIN command.people pp ON pp.id = p.proposed_by
      WHERE p.status = 'waiting' AND p.kind = 'action' AND p.payload->>'section' = 'settings' AND p.payload->>'kind' = 'change'
      ORDER BY p.created_at`,
  );
  // the changes a second person approved, oldest first, so each one's old value is the one before it
  const { rows: done } = await db.query<{ id: string; payload: { body: { id: string; value: unknown; why?: string } }; approved_at: Date; by: string; approver: string | null }>(
    `SELECT p.id, p.payload, p.approved_at, COALESCE(NULLIF(pp.name, ''), pp.email) AS by, COALESCE(NULLIF(pa.name, ''), pa.email) AS approver
       FROM command.proposals p JOIN command.people pp ON pp.id = p.proposed_by LEFT JOIN command.people pa ON pa.id = p.approved_by
      WHERE p.status = 'approved' AND p.kind = 'action' AND p.payload->>'section' = 'settings' AND p.payload->>'kind' = 'change'
      ORDER BY p.approved_at, p.created_at, p.id`,
  );
  const was = new Map<string, unknown>(Object.entries(FIRST));
  const HISTORY = done
    .map((p) => {
      const b = p.payload.body;
      const from = was.get(b.id) ?? null;
      was.set(b.id, b.value);
      return { id: p.id, set: b.id, at: p.approved_at.getTime(), from, to: b.value, by: named ? p.by : null, approvedBy: named ? p.approver : null, why: b.why ?? '' };
    })
    .reverse()
    .slice(0, 50);
  return {
    HISTORY,
    KEYS: await keyAges(db, named),
    WORTH: await worthALook(db, now, named),
    SETTINGS: SETTINGS.map((s) => {
      const r = stored.get(s.id);
      const w = waiting.find((p) => p.payload.body.id === s.id);
      return {
        ...s,
        value: s.kind === 'lock' ? s.v! : (r?.value as number | boolean | string),
        enforced: s.kind === 'lock' ? null : ENFORCED.has(s.id),
        // the first value was there before anyone set it: no one changed it
        changedAt: r?.changed_by ? r.changed_at.getTime() : null,
        changedBy: named ? (r?.changed_by ?? null) : null,
        approvedBy: named ? (r?.approved_by ?? null) : null,
        pending: w ? { id: w.id, to: w.payload.body.value, by: named ? w.by : '', why: w.payload.body.why, at: w.created_at.getTime() } : null,
      };
    }),
  };
}
