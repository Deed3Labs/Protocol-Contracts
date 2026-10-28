import { createHash, randomBytes } from 'node:crypto';
import type { Db, Queryable } from '../../db/db.js';
import { parseLevels, zero, type Levels } from './levels.js';

/** The Command Center's tables (migrations/0032_command.sql). Plain SQL, one function per need. */

export const TERMS_VERSION = 'data-room-v1';
export const SESSION_HOURS = 12;
export const INVITE_DAYS = 7;

export interface Group {
  id: string;
  key: string;
  name: string;
  description: string;
  levels: Levels;
  auto: boolean;
}

export interface Person {
  id: string;
  privyId: string | null;
  name: string;
  email: string | null;
  title: string;
  /** The wallet they sign with, once linked (lowercase). */
  wallet?: string | null;
}

export interface Access {
  groupId: string | null;
  custom: Levels | null;
  off: boolean;
  expiresAt: Date | null;
  expiresAfterDays: number | null;
}

type GroupRow = { id: string; key: string; name: string; description: string; levels: unknown; auto: boolean };
const group = (r: GroupRow): Group => ({ id: r.id, key: r.key, name: r.name, description: r.description, levels: parseLevels(r.levels) ?? zero(), auto: r.auto });
type PersonRow = { id: string; privy_id: string | null; name: string; email: string | null; title: string; wallet_address?: string | null };
const person = (r: PersonRow): Person => ({ id: r.id, privyId: r.privy_id, name: r.name, email: r.email, title: r.title, wallet: r.wallet_address ?? null });

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(24).toString('base64url');

export async function groups(db: Queryable): Promise<Group[]> {
  const { rows } = await db.query<GroupRow>('SELECT id, key, name, description, levels, auto FROM command.groups ORDER BY created_at, key');
  return rows.map(group);
}

export async function groupByKey(db: Queryable, key: string): Promise<Group | null> {
  const { rows } = await db.query<GroupRow>('SELECT id, key, name, description, levels, auto FROM command.groups WHERE key = $1', [key]);
  return rows[0] ? group(rows[0]) : null;
}

export async function personByPrivy(db: Queryable, privyId: string): Promise<Person | null> {
  const { rows } = await db.query<PersonRow>('SELECT id, privy_id, name, email, title, wallet_address FROM command.people WHERE privy_id = $1', [privyId]);
  return rows[0] ? person(rows[0]) : null;
}

export async function personById(db: Queryable, id: string): Promise<Person | null> {
  const { rows } = await db.query<PersonRow>('SELECT id, privy_id, name, email, title, wallet_address FROM command.people WHERE id = $1', [id]);
  return rows[0] ? person(rows[0]) : null;
}

/** Someone invited by email, or added before they ever signed in, who isn't tied to a login yet. */
export async function unboundPersonByEmail(db: Queryable, emails: string[]): Promise<Person | null> {
  if (!emails.length) return null;
  const { rows } = await db.query<PersonRow>('SELECT id, privy_id, name, email, title, wallet_address FROM command.people WHERE privy_id IS NULL AND email = ANY($1) LIMIT 1', [emails]);
  return rows[0] ? person(rows[0]) : null;
}

export async function bindPrivy(db: Queryable, personId: string, privyId: string): Promise<void> {
  await db.query('UPDATE command.people SET privy_id = $2, updated_at = now() WHERE id = $1 AND privy_id IS NULL', [personId, privyId]);
}

export async function createPerson(db: Queryable, p: { privyId?: string | null; name?: string; email?: string | null; title?: string }): Promise<Person> {
  const { rows } = await db.query<PersonRow>(
    'INSERT INTO command.people (privy_id, name, email, title) VALUES ($1, $2, $3, $4) RETURNING id, privy_id, name, email, title, wallet_address',
    [p.privyId ?? null, p.name ?? '', p.email?.toLowerCase() ?? null, p.title ?? ''],
  );
  return person(rows[0]);
}

export async function accessOf(db: Queryable, personId: string): Promise<Access | null> {
  const { rows } = await db.query<{ group_id: string | null; custom_levels: unknown; off: boolean; expires_at: Date | null; expires_after_days: number | null }>(
    'SELECT group_id, custom_levels, off, expires_at, expires_after_days FROM command.person_access WHERE person_id = $1',
    [personId],
  );
  const r = rows[0];
  if (!r) return null;
  return { groupId: r.group_id, custom: r.custom_levels == null ? null : parseLevels(r.custom_levels), off: r.off, expiresAt: r.expires_at ? new Date(r.expires_at) : null, expiresAfterDays: r.expires_after_days };
}

export async function setAccess(db: Queryable, personId: string, a: Access): Promise<void> {
  await db.query(
    `INSERT INTO command.person_access (person_id, group_id, custom_levels, off, expires_at, expires_after_days)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (person_id) DO UPDATE SET group_id = $2, custom_levels = $3, off = $4, expires_at = $5, expires_after_days = $6, updated_at = now()`,
    [personId, a.groupId, a.custom ? JSON.stringify(a.custom) : null, a.off, a.expiresAt, a.expiresAfterDays],
  );
}

// ── sessions, devices, sign-ins ─────────────────────────────────────────────

export async function upsertDevice(db: Queryable, personId: string, deviceKey: string, label: string): Promise<{ id: string; isNew: boolean }> {
  const { rows } = await db.query<{ id: string; is_new: boolean }>(
    `INSERT INTO command.devices (person_id, device_key, label) VALUES ($1, $2, $3)
     ON CONFLICT (person_id, device_key) DO UPDATE SET last_seen = now(), label = $3
     RETURNING id, (xmax = 0) AS is_new`,
    [personId, deviceKey, label],
  );
  return { id: rows[0].id, isNew: rows[0].is_new };
}

export async function startSession(
  db: Queryable,
  s: { personId: string; deviceId: string; privySessionId: string | null; keep: boolean; member: boolean; now: Date },
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(s.now.getTime() + SESSION_HOURS * 3600_000);
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO command.sessions (person_id, device_id, privy_session_id, keep, member, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [s.personId, s.deviceId, s.privySessionId, s.keep, s.member, expiresAt],
  );
  return { id: rows[0].id, expiresAt };
}

export async function liveSession(db: Queryable, id: string, personId: string, now: Date): Promise<{ id: string; deviceId: string | null; member: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db.query<{ id: string; device_id: string | null; member: boolean }>(
    'SELECT id, device_id, member FROM command.sessions WHERE id = $1 AND person_id = $2 AND ended_at IS NULL AND expires_at > $3',
    [id, personId, now],
  );
  return rows[0] ? { id: rows[0].id, deviceId: rows[0].device_id, member: rows[0].member } : null;
}

export async function endSessions(db: Queryable, personId: string, reason: string, only?: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE command.sessions SET ended_at = now(), ended_reason = $2 WHERE person_id = $1 AND ended_at IS NULL ${only ? 'AND id = $3' : ''} RETURNING id`,
    only ? [personId, reason, only] : [personId, reason],
  );
  return rows.length;
}

export async function logSignIn(db: Queryable, s: { personId: string; deviceId: string; method: string; device: string; city: string | null; newDevice: boolean }) {
  await db.query('INSERT INTO command.sign_ins (person_id, device_id, method, device, city, new_device) VALUES ($1, $2, $3, $4, $5, $6)', [
    s.personId,
    s.deviceId,
    s.method,
    s.device,
    s.city,
    s.newDevice,
  ]);
}

/** Where a request comes from, for the audit log: its device and city at sign-in. */
export async function whereFrom(db: Queryable, sessionId: string | null): Promise<string> {
  if (!sessionId) return '';
  const { rows } = await db.query<{ device: string; city: string | null }>(
    `SELECT s.device, s.city FROM command.sign_ins s JOIN command.sessions x ON x.device_id = s.device_id AND x.person_id = s.person_id
     WHERE x.id = $1 ORDER BY s.at DESC LIMIT 1`,
    [sessionId],
  );
  const r = rows[0];
  return r ? [r.device, r.city].filter(Boolean).join(' · ') : '';
}

// ── terms and page views ────────────────────────────────────────────────────

export async function acceptedTerms(db: Queryable, personId: string, version = TERMS_VERSION): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM command.terms_acceptances WHERE person_id = $1 AND version = $2', [personId, version]);
  return rows.length > 0;
}

export async function acceptTerms(db: Queryable, personId: string, version = TERMS_VERSION): Promise<void> {
  await db.query('INSERT INTO command.terms_acceptances (person_id, version) VALUES ($1, $2) ON CONFLICT DO NOTHING', [personId, version]);
}

export async function logView(db: Queryable, v: { personId: string; sessionId: string; route: string; pane: string | null; panel: string | null }) {
  await db.query('INSERT INTO command.page_views (person_id, session_id, route, pane, panel) VALUES ($1, $2, $3, $4, $5)', [v.personId, v.sessionId, v.route, v.pane, v.panel]);
}

// ── invites ─────────────────────────────────────────────────────────────────

export async function createInvite(db: Queryable, personId: string, invitedBy: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86400_000);
  // one live invite per person: a resend replaces the last
  await db.query('DELETE FROM command.invites WHERE person_id = $1 AND accepted_at IS NULL', [personId]);
  await db.query('INSERT INTO command.invites (person_id, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4)', [personId, hashToken(token), invitedBy, expiresAt]);
  return { token, expiresAt };
}

export async function takeInvite(db: Queryable, token: string, now: Date): Promise<string | null> {
  const { rows } = await db.query<{ person_id: string }>(
    'UPDATE command.invites SET accepted_at = $2 WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > $2 RETURNING person_id',
    [hashToken(token), now],
  );
  return rows[0]?.person_id ?? null;
}

export async function markInviteAccepted(db: Queryable, personId: string, now: Date): Promise<void> {
  await db.query('UPDATE command.invites SET accepted_at = $2 WHERE person_id = $1 AND accepted_at IS NULL', [personId, now]);
}

// ── the team list ───────────────────────────────────────────────────────────

export interface TeamRow {
  id: string;
  name: string;
  email: string | null;
  title: string;
  group: string | null;
  custom: Levels | null;
  off: boolean;
  expiresAt: string | null;
  since: string;
  invited: { expiresAt: string } | null;
  lastSignIn: string | null;
  devices: { label: string; lastSeen: string; firstSeen: string }[];
  signIns: { at: string; device: string; city: string | null; newDevice: boolean }[];
  passkey: boolean;
  termsAccepted: boolean;
}

/** Everyone with team access or an invite. Members with nothing beyond the Members row aren't listed. */
export async function team(db: Queryable): Promise<TeamRow[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    email: string | null;
    title: string;
    group_key: string | null;
    custom_levels: unknown;
    off: boolean;
    expires_at: Date | null;
    created_at: Date;
    invite_expires: Date | null;
    terms: boolean;
  }>(
    `SELECT p.id, p.name, p.email, p.title, g.key AS group_key, a.custom_levels, a.off, a.expires_at, p.created_at,
            (SELECT max(i.expires_at) FROM command.invites i WHERE i.person_id = p.id AND i.accepted_at IS NULL) AS invite_expires,
            EXISTS (SELECT 1 FROM command.terms_acceptances t WHERE t.person_id = p.id AND t.version = $1) AS terms
       FROM command.people p
       JOIN command.person_access a ON a.person_id = p.id
       LEFT JOIN command.groups g ON g.id = a.group_id
      WHERE a.group_id IS NOT NULL OR a.custom_levels IS NOT NULL
      ORDER BY p.created_at`,
    [TERMS_VERSION],
  );
  const ids = rows.map((r) => r.id);
  const devs = ids.length
    ? (await db.query<{ person_id: string; label: string; last_seen: Date; first_seen: Date }>('SELECT person_id, label, last_seen, first_seen FROM command.devices WHERE person_id = ANY($1) ORDER BY last_seen DESC', [ids])).rows
    : [];
  const ins = ids.length
    ? (
        await db.query<{ person_id: string; at: Date; device: string; city: string | null; new_device: boolean; method: string }>(
          `SELECT person_id, at, device, city, new_device, method FROM (
             SELECT *, row_number() OVER (PARTITION BY person_id ORDER BY at DESC) AS n FROM command.sign_ins WHERE person_id = ANY($1)
           ) x WHERE n <= 20 ORDER BY at DESC`,
          [ids],
        )
      ).rows
    : [];
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return rows.map((r) => {
    const mine = ins.filter((s) => s.person_id === r.id);
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      title: r.title,
      group: r.group_key,
      custom: r.custom_levels == null ? null : parseLevels(r.custom_levels),
      off: r.off,
      expiresAt: iso(r.expires_at),
      since: iso(r.created_at)!,
      invited: r.invite_expires ? { expiresAt: iso(r.invite_expires)! } : null,
      lastSignIn: iso(mine[0]?.at ?? null),
      devices: devs.filter((d) => d.person_id === r.id).map((d) => ({ label: d.label, lastSeen: iso(d.last_seen)!, firstSeen: iso(d.first_seen)! })),
      signIns: mine.map((s) => ({ at: iso(s.at)!, device: s.device, city: s.city, newDevice: s.new_device })),
      passkey: mine.some((s) => s.method === 'passkey'),
      termsAccepted: r.terms,
    };
  });
}

// ── proposals ───────────────────────────────────────────────────────────────

export interface Proposal {
  id: string;
  kind: string;
  area: string;
  summary: string;
  payload: Record<string, unknown>;
  proposedBy: string;
  status: string;
  approvedBy: string | null;
  createdAt: string;
  approvedAt: string | null;
}

type ProposalRow = {
  id: string;
  kind: string;
  area: string;
  summary: string;
  payload: Record<string, unknown>;
  proposed_by: string;
  status: string;
  approved_by: string | null;
  created_at: Date;
  approved_at: Date | null;
};
const proposal = (r: ProposalRow): Proposal => ({
  id: r.id,
  kind: r.kind,
  area: r.area,
  summary: r.summary,
  payload: r.payload,
  proposedBy: r.proposed_by,
  status: r.status,
  approvedBy: r.approved_by,
  createdAt: new Date(r.created_at).toISOString(),
  approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
});

export async function propose(db: Queryable, p: { kind: string; area: string; summary: string; payload: unknown; by: string }): Promise<Proposal> {
  const { rows } = await db.query<ProposalRow>(
    'INSERT INTO command.proposals (kind, area, summary, payload, proposed_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [p.kind, p.area, p.summary, JSON.stringify(p.payload), p.by],
  );
  return proposal(rows[0]);
}

export async function proposals(db: Queryable, area: string, status = 'waiting'): Promise<Proposal[]> {
  const { rows } = await db.query<ProposalRow>('SELECT * FROM command.proposals WHERE area = $1 AND status = $2 ORDER BY created_at', [area, status]);
  return rows.map(proposal);
}

/** What a second person approved since a time, for the two-person rule's counts and waits. */
export async function approvedSince(db: Queryable, area: string, since: Date): Promise<Proposal[]> {
  const { rows } = await db.query<ProposalRow>(
    `SELECT * FROM command.proposals WHERE area = $1 AND status = 'approved' AND approved_at >= $2 ORDER BY approved_at`,
    [area, since],
  );
  return rows.map(proposal);
}

/** Locks the proposal for the rest of the transaction, so two approvals can't both go through. */
export async function proposalForUpdate(db: Queryable, id: string): Promise<Proposal | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db.query<ProposalRow>('SELECT * FROM command.proposals WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ? proposal(rows[0]) : null;
}

export async function settleProposal(db: Queryable, id: string, status: 'approved' | 'declined' | 'withdrawn', by: string, now: Date): Promise<void> {
  if (status === 'approved')
    await db.query(`UPDATE command.proposals SET status = 'approved', approved_by = $2, approved_at = $3, updated_at = now() WHERE id = $1`, [id, by, now]);
  else await db.query('UPDATE command.proposals SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
}

// ── the audit log ───────────────────────────────────────────────────────────

export interface AuditEntry {
  personId: string | null;
  who: string;
  area: string;
  action: string;
  detail?: string;
  fromWhere?: string;
  before?: unknown;
  after?: unknown;
  result: 'done' | 'waiting' | 'approved' | 'declined' | 'refused';
  approver?: string | null;
  /** The entry this one corrects: a mistake is never edited, it's corrected by a new entry (migration 0058). */
  corrects?: number | null;
}

export async function audit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO command.audit_log (person_id, who, area, action, detail, from_where, before, after, result, approver, corrects)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      e.personId,
      e.who,
      e.area,
      e.action,
      e.detail ?? '',
      e.fromWhere ?? '',
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      e.result,
      e.approver ?? null,
      e.corrects ?? null,
    ],
  );
}

export async function auditLog(db: Queryable, limit = 200): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query(
    `SELECT a.id, a.seq, a.at, a.person_id, a.who, a.area, a.action, a.detail, a.from_where, a.result, COALESCE(NULLIF(ap.name, ''), ap.email) AS approver, a.corrects, a.hash, a.prev_hash
       FROM command.audit_log a LEFT JOIN command.people ap ON ap.id = a.approver
      ORDER BY a.seq DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Whether the audit log's chain holds (migration 0058): how many entries it has, and the first that doesn't follow, if any. */
export async function auditChain(db: Queryable): Promise<{ ok: boolean; entries: number; brokenAt: number | null; head: string | null }> {
  const { rows } = await db.query<{ broken: string | null; n: string; head: string | null }>(
    'SELECT command.audit_verify() AS broken, (SELECT count(*) FROM command.audit_log) AS n, (SELECT hash FROM command.audit_log ORDER BY seq DESC LIMIT 1) AS head',
  );
  const r = rows[0];
  return { ok: r.broken == null, entries: Number(r.n), brokenAt: r.broken == null ? null : Number(r.broken), head: r.head };
}

// ── reveals ─────────────────────────────────────────────────────────────────

export interface Reveal {
  person: Person;
  section: string;
  /** The row shown, or '*' for a whole list. */
  subject: string;
  field: string;
  rows?: number;
  reason: string;
}

/**
 * Logs a reveal of personal details (migration 0059), and its audit entry. A reveal with no reason is
 * refused when Settings asks for one and the person didn't say it was a rush; with `rush`, it's shown
 * and flagged. Returns false when it's refused.
 */
export async function logReveal(db: Queryable, r: Reveal & { rush?: boolean; fromWhere?: string }): Promise<{ ok: boolean; flagged: boolean }> {
  const reason = r.reason.trim();
  const { rows } = await db.query<{ value: boolean }>(`SELECT value FROM command.settings WHERE id = 'reason'`);
  const ask = rows[0]?.value !== false;
  if (ask && !reason && !r.rush) return { ok: false, flagged: false };
  const flagged = ask && !reason;
  const who = r.person.name || r.person.email || 'Someone';
  await db.query('INSERT INTO command.reveals (person_id, who, section, subject, field, rows, reason, flagged) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
    r.person.id,
    who,
    r.section,
    r.subject,
    r.field,
    r.rows ?? 1,
    reason,
    flagged,
  ]);
  await audit(db, {
    personId: r.person.id,
    who,
    area: r.section,
    action: r.subject === '*' ? `Showed ${r.field} for ${r.rows ?? 0} rows` : `Showed ${r.field} for ${r.subject}`,
    detail: reason ? `Reason: ${reason}` : 'No reason given: flagged',
    fromWhere: r.fromWhere,
    result: 'done',
  });
  return { ok: true, flagged };
}

// ── exports (migration 0064) ────────────────────────────────────────────────

/**
 * Uses an approved export: the asker's own, for this section, not used yet and not past its day. Marks
 * it used in the same statement, so it can't be used twice. The reason it was approved for, or null.
 */
export async function useExport(db: Queryable, id: string, personId: string, section: string, at: Date): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db.query<{ reason: string }>(
    `UPDATE command.export_grants SET used_at = $4
      WHERE id = $1 AND person_id = $2 AND section = $3 AND used_at IS NULL AND expires_at > $4
      RETURNING reason`,
    [id, personId, section, at],
  );
  return rows[0]?.reason ?? null;
}

/** Exports, newest first: everyone's (Records), or one person's (theirs to use). */
export async function exports(db: Queryable, personId?: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query(
    `SELECT g.id, g.section, g.reason, g.approved_at, g.expires_at, g.used_at, g.person_id,
            COALESCE(NULLIF(p.name, ''), p.email) AS who, COALESCE(NULLIF(a.name, ''), a.email) AS approved_by
       FROM command.export_grants g JOIN command.people p ON p.id = g.person_id JOIN command.people a ON a.id = g.approved_by
      ${personId ? 'WHERE g.person_id = $1' : ''} ORDER BY g.approved_at DESC LIMIT 200`,
    personId ? [personId] : [],
  );
  return rows;
}

/** Records → Reveals: every reveal, newest first. */
export async function reveals(db: Queryable, limit = 200): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query('SELECT id, at, person_id, who, section, subject, field, rows, reason, flagged FROM command.reveals ORDER BY id DESC LIMIT $1', [limit]);
  return rows;
}

export type { Db };
