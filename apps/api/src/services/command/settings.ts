import { z } from 'zod';
import type { Queryable } from '../../db/db.js';
import { ActionError } from './actionError.js';
import type { Action } from './actions.js';

/*
 * Settings → Rules and limits (docs/ui-redesign-plan.md, Security; the reference's SETS). The numbers
 * the app enforces are stored in command.settings (migration 0057) and read where they apply: a refund
 * or a shop buy over its limit waits for a second person. Changing one is itself a proposal a second
 * person approves, and nobody approves their own (the proposals' rule, and a CHECK on the table).
 *
 * Locked rules are set somewhere else (a vote, the bylaws, the law, the server itself): they aren't
 * stored or changeable here, only shown, with where they're decided.
 */

export type SettingKind = 'money' | 'num' | 'pct' | 'hours' | 'days' | 'choice' | 'on' | 'lock';

export interface SettingDef {
  id: string;
  /** Its group on the page: money, chain, members, shop, gov, signin, privacy, records, notify. */
  sec: string;
  t: string;
  d: string;
  kind: SettingKind;
  /** A lock's value, as words. */
  v?: string;
  unit?: string;
  opts?: string[];
  /** Why it's locked, and the page where it's decided. */
  why?: string;
  where?: string;
  /** The pages that read it. */
  used: string[];
}

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
];

const DEF = new Map(SETTINGS.map((s) => [s.id, s]));

/** What a setting of each kind may be set to. */
const VALUE: Record<Exclude<SettingKind, 'lock' | 'choice'>, z.ZodType<number | boolean>> = {
  money: z.number().nonnegative().max(100_000),
  num: z.number().int().positive().max(10_000),
  pct: z.number().min(0).max(100),
  hours: z.number().int().positive().max(24 * 90),
  days: z.number().int().positive().max(3650),
  on: z.boolean(),
};

/** Checks a new value against its setting: the parsed value, or an ActionError naming what's wrong. */
export function checkValue(id: string, value: unknown): number | boolean | string {
  const s = DEF.get(id);
  if (!s) throw new ActionError(404, 'NOT_FOUND', 'No such setting');
  if (s.kind === 'lock') throw new ActionError(400, 'LOCKED', `${s.t} is set elsewhere: ${s.why ?? 'not here'}`);
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
  s.kind === 'money' ? `$${Number(v).toFixed(2)}` : s.kind === 'pct' ? `${v}%` : s.kind === 'on' ? (v ? 'on' : 'off') : s.kind === 'hours' ? `${v} hours` : s.kind === 'days' ? `${v} days` : `${v}${s.unit ? ' ' + s.unit : ''}`;

/** Settings' own action: changing a value always waits for a second person. */
export const settingsActions: Record<string, Action> = {
  change: {
    body: z.object({ id: z.string().trim().min(1).max(32), value: z.union([z.number(), z.boolean(), z.string().max(20)]), why: z.string().trim().max(500).default('') }),
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
};

export interface SettingRow extends SettingDef {
  /** The stored value; a lock's is its words. */
  value: number | boolean | string;
  changedAt: number | null;
  changedBy: string | null;
  approvedBy: string | null;
  /** A change waiting for a second person. */
  pending: { id: string; to: unknown; by: string; why: string; at: number } | null;
}

/** Settings' page: every rule with its value, who last changed it, and any change waiting. At Totals, no one's name. */
export async function settingsSection(db: Queryable, level: number): Promise<{ SETTINGS: SettingRow[] }> {
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
  return {
    SETTINGS: SETTINGS.map((s) => {
      const r = stored.get(s.id);
      const w = waiting.find((p) => p.payload.body.id === s.id);
      return {
        ...s,
        value: s.kind === 'lock' ? s.v! : (r?.value as number | boolean | string),
        // the first value was there before anyone set it: no one changed it
        changedAt: r?.changed_by ? r.changed_at.getTime() : null,
        changedBy: named ? (r?.changed_by ?? null) : null,
        approvedBy: named ? (r?.approved_by ?? null) : null,
        pending: w ? { id: w.id, to: w.payload.body.value, by: named ? w.by : '', why: w.payload.body.why, at: w.created_at.getTime() } : null,
      };
    }),
  };
}
