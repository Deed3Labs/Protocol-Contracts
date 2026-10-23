import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { Db, Queryable } from '../db/db.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { cleanCity, deviceLabel } from '../services/command/device.js';
import {
  APPROVE,
  PROPOSE,
  SECTIONS,
  SEE,
  TOTALS,
  effectiveLevels,
  hasAny,
  newApprove,
  parseLevels,
  zero,
  type Levels,
  type Section,
} from '../services/command/levels.js';
import { NotLiveYet, fieldSection, growthSection, membersSection, merchantsSection, moneySection, shopSection } from '../services/command/sections.js';
import * as store from '../services/command/store.js';

/*
 * The Command Center's API (docs/command-center-plan.md, Phase 2): sign-in sessions, who you are and
 * what you can see, the Permissions page, and the audit log.
 *
 * Every request carries the Privy token (checked by `identify`) and, after sign-in, the Command
 * Center session in X-Command-Session. Access is checked here, on the server, per endpoint:
 * 0 None is a 403; 1 Totals gets co-op aggregates only, built here; 2 See reads; 3 Propose may only
 * propose; 4 Approve may change things, but giving anyone Approve, and every proposal, needs a second
 * person. Every change writes one row to the append-only audit log.
 */

export interface CommandDeps {
  db: () => Promise<Db | null>;
  /** Verifies the Privy token and sets req.auth (middleware/auth requireIdentity). */
  identify: RequestHandler;
  /** Has a Clear account, so gets the Members row. */
  isMember: (auth: NonNullable<Request['auth']>) => Promise<boolean>;
  mail: (m: { to: string; subject: string; text: string }) => Promise<void>;
  /** Emails that become Admin on first sign-in (COMMAND_ADMIN_EMAILS): how the first admin gets in. */
  adminEmails: () => string[];
  appUrl: () => string;
  /** Rate limits: sign-in attempts, and writes. */
  limits?: { signIn: RequestHandler; write: RequestHandler };
  now?: () => Date;
}

interface CommandContext {
  db: Db;
  person: store.Person;
  sessionId: string;
  member: boolean;
  levels: Levels;
  group: store.Group | null;
  access: store.Access | null;
  termsRequired: boolean;
}

declare global {
  namespace Express {
    interface Request {
      command?: CommandContext;
    }
  }
}

const fail = (res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  res.status(status).json({ error: message, code, ...extra });

const passThrough: RequestHandler = (_req, _res, next) => next();

const levelsSchema = z.record(z.string(), z.number().int().min(0).max(4)).transform((v, ctx) => {
  const l = parseLevels(v);
  if (!l) ctx.addIssue({ code: 'custom', message: `levels need all of ${SECTIONS.join(', ')}, each 0 to 4` });
  return l as Levels;
});
const email = z.string().trim().toLowerCase().email().max(254);
const name = z.string().trim().min(1).max(80);

export function commandRouter(deps: CommandDeps) {
  const router = forwardAsyncErrors(express.Router());
  const now = () => deps.now?.() ?? new Date();
  const limits = deps.limits ?? { signIn: passThrough, write: passThrough };

  router.use(deps.identify);

  const database = async (res: Response): Promise<Db | null> => {
    const db = await deps.db();
    if (!db) fail(res, 503, 'NO_DATABASE', 'The Command Center’s database isn’t configured');
    return db;
  };

  /** Effective levels and the group behind them. */
  const resolve = async (db: Queryable, person: store.Person, member: boolean) => {
    const access = await store.accessOf(db, person.id);
    const all = await store.groups(db);
    const members = all.find((g) => g.auto)?.levels ?? zero();
    const group = access?.groupId ? (all.find((g) => g.id === access.groupId) ?? null) : null;
    const levels = effectiveLevels({
      group: group?.levels ?? null,
      custom: access?.custom ?? null,
      off: access?.off ?? false,
      expiresAt: access?.expiresAt ?? null,
      member,
      members,
      now: now(),
    });
    const termsRequired = group?.key === 'investors' && !(await store.acceptedTerms(db, person.id));
    return { access, group, levels, termsRequired };
  };

  // ── sign-in ───────────────────────────────────────────────────────────────

  const signInBody = z.object({
    deviceKey: z.string().min(16).max(128),
    keep: z.boolean(),
    method: z.enum(['passkey', 'email', 'other']),
    city: z.string().max(80).optional(),
    invite: z.string().max(128).optional(),
  });

  /**
   * Starts a Command Center session for the signed-in Privy user. Who they are: the person tied to
   * their login, else the person an invite (by its link, or by a verified email) was for, else an
   * address on COMMAND_ADMIN_EMAILS, else a Clear member with only the Members view. Nobody else.
   */
  router.post('/sessions', limits.signIn, async (req, res) => {
    const db = await database(res);
    if (!db) return;
    const body = signInBody.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'BAD_REQUEST', 'A device and how you signed in are needed');
    const auth = req.auth!;
    const privyId = auth.profileUuid!;
    const emails = (auth.emails ?? []).map((e) => e.toLowerCase());
    const t = now();
    const member = await deps.isMember(auth);

    const result = await db.transaction(async (tx) => {
      let person = await store.personByPrivy(tx, privyId);
      if (!person && body.data.invite) {
        const invited = await store.takeInvite(tx, body.data.invite, t);
        if (invited) {
          await store.bindPrivy(tx, invited, privyId);
          person = await store.personById(tx, invited);
        }
      }
      if (!person) {
        const byEmail = await store.unboundPersonByEmail(tx, emails);
        if (byEmail) {
          await store.bindPrivy(tx, byEmail.id, privyId);
          await store.markInviteAccepted(tx, byEmail.id, t);
          person = { ...byEmail, privyId };
        }
      }
      if (!person) {
        const admins = deps.adminEmails().map((e) => e.toLowerCase());
        const adminEmail = emails.find((e) => admins.includes(e));
        if (adminEmail) {
          person = await store.createPerson(tx, { privyId, email: adminEmail });
          const admin = await store.groupByKey(tx, 'admin');
          await store.setAccess(tx, person.id, { groupId: admin!.id, custom: null, off: false, expiresAt: null, expiresAfterDays: null });
          await store.audit(tx, { personId: person.id, who: adminEmail, area: 'access', action: 'Became an admin on first sign-in', detail: 'COMMAND_ADMIN_EMAILS', result: 'done' });
        } else if (member) {
          person = await store.createPerson(tx, { privyId, email: emails[0] ?? null });
        } else return { code: 'NO_ACCOUNT' as const };
      }

      // An investor invited "for 30 days after first sign-in": the clock starts now.
      const access = await store.accessOf(tx, person.id);
      if (access && !access.expiresAt && access.expiresAfterDays) {
        await store.setAccess(tx, person.id, { ...access, expiresAt: new Date(t.getTime() + access.expiresAfterDays * 86400_000) });
      }
      const r = await resolve(tx, person, member);
      if (!hasAny(r.levels)) return { code: 'NO_ACCESS' as const };

      const label = deviceLabel(req.get('user-agent'));
      const device = await store.upsertDevice(tx, person.id, body.data.deviceKey, label);
      const city = cleanCity(body.data.city);
      await store.logSignIn(tx, { personId: person.id, deviceId: device.id, method: body.data.method, device: label, city, newDevice: device.isNew });
      const session = await store.startSession(tx, { personId: person.id, deviceId: device.id, privySessionId: auth.sessionId ?? null, keep: body.data.keep, member, now: t });
      return { person, session, member, ...r };
    });

    if ('code' in result) {
      return result.code === 'NO_ACCOUNT'
        ? fail(res, 403, 'NO_ACCOUNT', 'There’s no Clear account for this login. Make one in the Clear app, or ask for an invite.')
        : fail(res, 403, 'NO_ACCESS', 'Your access to the Command Center is off or has ended.');
    }
    res.status(201).json({ session: { id: result.session.id, expiresAt: result.session.expiresAt.toISOString() }, me: me(result.person, result) });
  });

  // ── everything else needs a live session ────────────────────────────────

  const TERMS_FREE = new Set(['GET /me', 'POST /terms', 'DELETE /sessions/current']);

  router.use(async (req: Request, res: Response, next: NextFunction) => {
    const db = await database(res);
    if (!db) return;
    const person = await store.personByPrivy(db, req.auth!.profileUuid!);
    const sessionId = String(req.get('x-command-session') ?? '');
    const session = person ? await store.liveSession(db, sessionId, person.id, now()) : null;
    if (!person || !session) return fail(res, 401, 'SESSION_ENDED', 'Your session has ended. Sign in again.');
    const r = await resolve(db, person, session.member);
    if (!hasAny(r.levels)) {
      await store.endSessions(db, person.id, 'access ended');
      return fail(res, 401, 'SESSION_ENDED', 'Your access to the Command Center is off or has ended.');
    }
    if (r.termsRequired && !TERMS_FREE.has(`${req.method} ${req.path}`)) return fail(res, 403, 'TERMS_REQUIRED', 'Accept the data room’s terms first.');
    req.command = { db, person, sessionId: session.id, member: session.member, ...r };
    next();
  });

  const need =
    (section: Section, level: number): RequestHandler =>
    (req, res, next) => {
      const have = req.command!.levels[section];
      if (have >= level) return next();
      return fail(res, 403, 'FORBIDDEN', have > 0 ? 'Your access here can look, not change.' : 'You don’t have access to this.', { section, need: level, have });
    };

  const auditFrom = async (req: Request, e: Omit<store.AuditEntry, 'personId' | 'who' | 'fromWhere'>, db: Queryable = req.command!.db) => {
    const c = req.command!;
    await store.audit(db, { ...e, personId: c.person.id, who: c.person.name || c.person.email || 'Someone', fromWhere: await store.whereFrom(db, c.sessionId) });
  };

  // ── you ──────────────────────────────────────────────────────────────────

  router.get('/me', (req, res) => {
    const c = req.command!;
    res.json({ me: me(c.person, c) });
  });

  router.post('/terms', limits.write, async (req, res) => {
    const c = req.command!;
    const version = String(req.body?.version ?? '');
    if (version !== store.TERMS_VERSION) return fail(res, 400, 'BAD_VERSION', 'Those aren’t the current terms', { version: store.TERMS_VERSION });
    await store.acceptTerms(c.db, c.person.id);
    await auditFrom(req, { area: 'records', action: 'Accepted the data room’s terms', detail: store.TERMS_VERSION, result: 'done' });
    res.json({ me: me(c.person, { ...c, termsRequired: false }) });
  });

  router.delete('/sessions/current', async (req, res) => {
    const c = req.command!;
    await store.endSessions(c.db, c.person.id, 'signed out', c.sessionId);
    res.status(204).end();
  });

  const viewBody = z.object({ route: z.string().min(1).max(40), pane: z.string().max(60).nullish(), panel: z.string().max(120).nullish() });
  /** The data room logs every page and panel an investor opens; for anyone else this does nothing. */
  router.post('/views', async (req, res) => {
    const c = req.command!;
    const body = viewBody.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'BAD_REQUEST', 'A page is needed');
    if (c.group?.key === 'investors') {
      await store.logView(c.db, { personId: c.person.id, sessionId: c.sessionId, route: body.data.route, pane: body.data.pane ?? null, panel: body.data.panel ?? null });
    }
    res.status(204).end();
  });

  // ── Permissions: reading ────────────────────────────────────────────────

  router.get('/groups', need('access', TOTALS), async (req, res) => {
    const c = req.command!;
    const team = await store.team(c.db);
    const all = await store.groups(c.db);
    const count = (key: string) => team.filter((p) => p.group === key).length;
    if (c.levels.access < SEE) return res.json({ totals: Object.fromEntries(all.map((g) => [g.name, count(g.key)])) });
    res.json({ groups: all.map((g) => ({ key: g.key, name: g.name, description: g.description, levels: g.levels, auto: g.auto, people: count(g.key) })) });
  });

  router.get('/people', need('access', TOTALS), async (req, res) => {
    const c = req.command!;
    const team = await store.team(c.db);
    // Totals: how many, by group, and no one's name.
    if (c.levels.access < SEE) {
      const by: Record<string, number> = {};
      for (const p of team) by[p.group ?? 'custom'] = (by[p.group ?? 'custom'] ?? 0) + 1;
      return res.json({ totals: { people: team.length, byGroup: by } });
    }
    res.json({ people: team });
  });

  router.get('/proposals', need('access', SEE), async (req, res) => {
    res.json({ proposals: await store.proposals(req.command!.db, String(req.query.area ?? 'access')) });
  });

  router.get('/audit', need('records', SEE), async (req, res) => {
    res.json({ entries: await store.auditLog(req.command!.db) });
  });

  // ── the sections' data ───────────────────────────────────────────────────

  /**
   * A section's rows and figures. Level 0 is refused by `need`; Totals gets what the server built for
   * Totals (no names, nothing that points to one person). Names in full (?reveal=1) need See, and
   * every time they're asked for is logged.
   */
  router.get('/sections/members', need('members', TOTALS), async (req, res) => {
    const c = req.command!;
    const level = c.levels.members;
    const reveal = req.query.reveal === '1' && level >= SEE;
    try {
      const data = await membersSection(c.db, { level, reveal, now: now() });
      if (reveal) await auditFrom(req, { area: 'members', action: 'Showed member names', detail: `${data.MEMBERS.length} members`, result: 'done' });
      res.json(data);
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/sections/growth', need('growth', TOTALS), async (req, res) => {
    const c = req.command!;
    const level = c.levels.growth;
    const reveal = req.query.reveal === '1' && level >= SEE;
    try {
      const data = await growthSection(c.db, { level, reveal, now: now() });
      if (reveal) await auditFrom(req, { area: 'growth', action: 'Showed names on the forms', detail: `${data.INBOX?.length ?? 0} forms`, result: 'done' });
      res.json(data);
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/sections/field', need('field', TOTALS), async (req, res) => {
    const c = req.command!;
    try {
      res.json(await fieldSection(c.db, { level: c.levels.field, reveal: false, now: now() }));
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/sections/merchants', need('merchants', TOTALS), async (req, res) => {
    const c = req.command!;
    try {
      res.json(await merchantsSection(c.db, { level: c.levels.merchants, reveal: false, now: now() }));
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/sections/money', need('money', TOTALS), async (req, res) => {
    const c = req.command!;
    try {
      res.json(await moneySection(c.db, { level: c.levels.money, reveal: false, now: now() }));
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/sections/shop', need('shop', TOTALS), async (req, res) => {
    const c = req.command!;
    try {
      res.json(await shopSection(c.db, { level: c.levels.shop, reveal: false, now: now() }));
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/page-views', need('access', SEE), async (req, res) => {
    const { rows } = await req.command!.db.query(
      `SELECT v.at, p.name, p.email, v.route, v.pane, v.panel FROM command.page_views v JOIN command.people p ON p.id = v.person_id ORDER BY v.at DESC LIMIT 500`,
    );
    res.json({ views: rows });
  });

  // ── Permissions: changing ───────────────────────────────────────────────

  /**
   * A change to someone's access, a group, or an invite. Applied straight away by someone with
   * Approve on Permissions, unless it gives anyone Approve they didn't have: that, and anything
   * from someone who can only propose, waits for a second admin.
   */
  type Change =
    | { kind: 'invite'; email: string; name: string; title: string; group: string; expiresAfterDays: number | null }
    | { kind: 'access'; personId: string; group?: string | null; custom?: Levels | null; off?: boolean; expiresAt?: string | null }
    | { kind: 'group-new'; key: string; name: string; description: string; levels: Levels }
    | { kind: 'group-edit'; key: string; name?: string; description?: string; levels?: Levels };

  /** Who would gain Approve from a change, and a line saying what it is. */
  const assess = async (db: Queryable, ch: Change): Promise<{ gains: Section[]; summary: string; before: unknown; after: unknown } | { error: string; status: number }> => {
    const all = await store.groups(db);
    const byKey = (k: string | null | undefined) => (k ? all.find((g) => g.key === k) : undefined);
    const teamOf = (a: { groupId: string | null; custom: Levels | null } | null) =>
      a?.custom ?? (a?.groupId ? all.find((g) => g.id === a.groupId)?.levels : null) ?? zero();
    if (ch.kind === 'invite') {
      const g = byKey(ch.group);
      if (!g || g.auto) return { error: 'Pick a team group', status: 400 };
      return { gains: newApprove(zero(), g.levels), summary: `Invite ${ch.name} to ${g.name}`, before: null, after: { email: ch.email, group: g.key } };
    }
    if (ch.kind === 'access') {
      const p = await store.personById(db, ch.personId);
      if (!p) return { error: 'No such person', status: 404 };
      const a = await store.accessOf(db, p.id);
      const next = await nextAccess(db, a, ch);
      if ('error' in next) return next;
      const gains = next.off ? [] : newApprove(teamOf(a), teamOf(next));
      const what = ch.off === true ? 'Turn off' : ch.off === false ? 'Turn on' : ch.custom !== undefined ? 'Customize access for' : ch.group !== undefined ? 'Change the group of' : 'Change access for';
      return { gains, summary: `${what} ${p.name || p.email}`, before: a, after: next };
    }
    if (ch.kind === 'group-new') {
      if (byKey(ch.key)) return { error: 'A group with that name exists', status: 409 };
      return { gains: [], summary: `Make the group ${ch.name}`, before: null, after: ch };
    }
    const g = byKey(ch.key);
    if (!g) return { error: 'No such group', status: 404 };
    const team = await store.team(db);
    const inIt = team.filter((p) => p.group === g.key && !p.custom && !p.off).length;
    const gains = ch.levels && (inIt > 0 || g.auto) ? newApprove(g.levels, ch.levels) : [];
    return { gains, summary: `Edit the group ${g.name}`, before: g, after: { ...g, ...ch } };
  };

  const nextAccess = async (db: Queryable, a: store.Access | null, ch: Extract<Change, { kind: 'access' }>): Promise<store.Access | { error: string; status: number }> => {
    let groupId = a?.groupId ?? null;
    if (ch.group !== undefined) {
      if (ch.group === null) groupId = null;
      else {
        const g = await store.groupByKey(db, ch.group);
        if (!g || g.auto) return { error: 'Pick a team group', status: 400 };
        groupId = g.id;
      }
    }
    return {
      groupId,
      custom: ch.custom !== undefined ? ch.custom : (a?.custom ?? null),
      off: ch.off ?? a?.off ?? false,
      expiresAt: ch.expiresAt !== undefined ? (ch.expiresAt ? new Date(ch.expiresAt) : null) : (a?.expiresAt ?? null),
      expiresAfterDays: ch.expiresAt !== undefined ? null : (a?.expiresAfterDays ?? null),
    };
  };

  /** Makes the change. Runs inside the caller's transaction. */
  const apply = async (tx: Queryable, ch: Change, by: store.Person): Promise<Record<string, unknown>> => {
    if (ch.kind === 'invite') {
      const g = (await store.groupByKey(tx, ch.group))!;
      const existing = await tx.query<{ id: string }>('SELECT id FROM command.people WHERE email = $1', [ch.email]);
      const person = existing.rows[0] ? (await store.personById(tx, existing.rows[0].id))! : await store.createPerson(tx, { name: ch.name, email: ch.email, title: ch.title });
      const expiresAfterDays = g.key === 'investors' ? (ch.expiresAfterDays ?? 30) : ch.expiresAfterDays;
      await store.setAccess(tx, person.id, { groupId: g.id, custom: null, off: false, expiresAt: null, expiresAfterDays });
      const invite = await store.createInvite(tx, person.id, by.id, now());
      const link = `${deps.appUrl().replace(/\/+$/, '')}/#invite=${invite.token}`;
      await deps.mail({
        to: ch.email,
        subject: `${by.name || 'Clear'} invited you to the Clear Command Center`,
        text: [
          `${by.name || 'Someone at Clear'} invited you to the Clear Command Center, in the ${g.name} group.`,
          '',
          `Open this link to sign in: ${link}`,
          '',
          'Sign in with your Clear app login, or make one. The link works for 7 days.',
          g.key === 'investors' ? `Your access lasts ${expiresAfterDays} days from your first sign-in.` : '',
        ]
          .filter((l, i, all) => l || all[i - 1])
          .join('\n'),
      });
      return { personId: person.id, inviteExpiresAt: invite.expiresAt.toISOString() };
    }
    if (ch.kind === 'access') {
      const a = await store.accessOf(tx, ch.personId);
      const next = (await nextAccess(tx, a, ch)) as store.Access;
      await store.setAccess(tx, ch.personId, next);
      if (next.off && !a?.off) await store.endSessions(tx, ch.personId, 'access turned off');
      return { personId: ch.personId };
    }
    if (ch.kind === 'group-new') {
      await tx.query('INSERT INTO command.groups (key, name, description, levels) VALUES ($1, $2, $3, $4)', [ch.key, ch.name, ch.description, JSON.stringify(ch.levels)]);
      return { key: ch.key };
    }
    const sets: string[] = [];
    const vals: unknown[] = [ch.key];
    if (ch.name !== undefined) sets.push(`name = $${vals.push(ch.name)}`);
    if (ch.description !== undefined) sets.push(`description = $${vals.push(ch.description)}`);
    if (ch.levels !== undefined) sets.push(`levels = $${vals.push(JSON.stringify(ch.levels))}`);
    if (sets.length) await tx.query(`UPDATE command.groups SET ${sets.join(', ')}, updated_at = now() WHERE key = $1`, vals);
    return { key: ch.key };
  };

  /** Applies a change, or proposes it, and logs either. */
  const change = async (req: Request, res: Response, ch: Change) => {
    const c = req.command!;
    const verdict = await assess(c.db, ch);
    if ('error' in verdict) return fail(res, verdict.status, 'BAD_CHANGE', verdict.error);
    const direct = c.levels.access >= APPROVE && verdict.gains.length === 0;
    if (!direct) {
      const p = await c.db.transaction(async (tx) => {
        const proposal = await store.propose(tx, { kind: ch.kind, area: 'access', summary: verdict.summary, payload: ch, by: c.person.id });
        await auditFrom(req, { area: 'access', action: verdict.summary, detail: verdict.gains.length ? `Gives Approve on ${verdict.gains.join(', ')}` : 'Proposed', before: verdict.before, after: verdict.after, result: 'waiting' }, tx);
        return proposal;
      });
      return res.status(202).json({ proposal: p, needs: 'a second admin' });
    }
    const out = await c.db.transaction(async (tx) => {
      const r = await apply(tx, ch, c.person);
      await auditFrom(req, { area: 'access', action: verdict.summary, before: verdict.before, after: verdict.after, result: 'done' }, tx);
      return r;
    });
    res.json({ done: true, ...out });
  };

  const inviteBody = z.object({
    email,
    name,
    title: z.string().trim().max(80).default(''),
    group: z.string().min(2).max(32),
    expiresAfterDays: z.number().int().min(1).max(365).nullish(),
  });
  router.post('/invites', limits.write, need('access', PROPOSE), async (req, res) => {
    const b = inviteBody.safeParse(req.body);
    if (!b.success) return fail(res, 400, 'BAD_REQUEST', 'An email, a name and a group are needed');
    const taken = await req.command!.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM command.people p JOIN command.person_access a ON a.person_id = p.id WHERE p.email = $1 AND (a.group_id IS NOT NULL OR a.custom_levels IS NOT NULL)`,
      [b.data.email],
    );
    if (taken.rows[0].n) return fail(res, 409, 'ALREADY_ON_TEAM', 'That person already has team access');
    return change(req, res, { kind: 'invite', ...b.data, expiresAfterDays: b.data.expiresAfterDays ?? null });
  });

  /** Sends an unaccepted invite again, with a fresh 7 days. */
  router.post('/invites/:personId/resend', limits.write, need('access', APPROVE), async (req, res) => {
    const c = req.command!;
    const p = await store.personById(c.db, req.params.personId);
    if (!p?.email || p.privyId) return fail(res, 404, 'NO_INVITE', 'No invite waiting for that person');
    const a = await store.accessOf(c.db, p.id);
    const g = a?.groupId ? (await store.groups(c.db)).find((x) => x.id === a.groupId) : null;
    if (!g) return fail(res, 404, 'NO_INVITE', 'No invite waiting for that person');
    const out = await c.db.transaction(async (tx) => {
      const invite = await store.createInvite(tx, p.id, c.person.id, now());
      await deps.mail({
        to: p.email!,
        subject: `Your invite to the Clear Command Center`,
        text: `Your invite to the Clear Command Center, in the ${g.name} group, is here again.\n\nOpen this link to sign in: ${deps.appUrl().replace(/\/+$/, '')}/#invite=${invite.token}\n\nIt works for 7 days.`,
      });
      await auditFrom(req, { area: 'access', action: `Sent ${p.name || p.email}’s invite again`, result: 'done' }, tx);
      return invite;
    });
    res.json({ inviteExpiresAt: out.expiresAt.toISOString() });
  });

  const accessBody = z
    .object({
      group: z.string().min(2).max(32).nullable().optional(),
      custom: levelsSchema.nullable().optional(),
      off: z.boolean().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
  router.patch('/people/:id/access', limits.write, need('access', PROPOSE), async (req, res) => {
    const b = accessBody.safeParse(req.body);
    if (!b.success) return fail(res, 400, 'BAD_REQUEST', b.error.issues[0]?.message ?? 'Nothing to change');
    return change(req, res, { kind: 'access', personId: req.params.id, ...b.data });
  });

  /** Ends every session someone has, on every device. Not a grant, so no second person. */
  router.post('/people/:id/sign-out', limits.write, need('access', APPROVE), async (req, res) => {
    const c = req.command!;
    const p = await store.personById(c.db, req.params.id);
    if (!p) return fail(res, 404, 'NO_PERSON', 'No such person');
    const ended = await c.db.transaction(async (tx) => {
      const n = await store.endSessions(tx, p.id, 'signed out everywhere');
      await auditFrom(req, { area: 'access', action: `Signed ${p.name || p.email} out everywhere`, detail: `${n} session${n === 1 ? '' : 's'}`, result: 'done' }, tx);
      return n;
    });
    res.json({ ended });
  });

  const groupBody = z.object({ name, description: z.string().trim().max(200).default(''), levels: levelsSchema });
  router.post('/groups', limits.write, need('access', PROPOSE), async (req, res) => {
    const b = groupBody.safeParse(req.body);
    if (!b.success) return fail(res, 400, 'BAD_REQUEST', b.error.issues[0]?.message ?? 'A name and levels are needed');
    const key = b.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(key)) return fail(res, 400, 'BAD_REQUEST', 'Give the group a name that starts with a letter');
    return change(req, res, { kind: 'group-new', key, ...b.data });
  });

  router.patch('/groups/:key', limits.write, need('access', PROPOSE), async (req, res) => {
    const b = groupBody.partial().safeParse(req.body);
    if (!b.success) return fail(res, 400, 'BAD_REQUEST', b.error.issues[0]?.message ?? 'Nothing to change');
    if (req.params.key === 'admin' && b.data.levels) return fail(res, 400, 'BAD_CHANGE', 'Admin always has Approve everywhere');
    return change(req, res, { kind: 'group-edit', key: req.params.key, ...b.data });
  });

  /** The second person. Never the proposer: refused here, and by a CHECK in the database. */
  router.post('/proposals/:id/approve', limits.write, async (req, res) => {
    const c = req.command!;
    const out = await c.db.transaction(async (tx) => {
      const p = await store.proposalForUpdate(tx, req.params.id);
      if (!p || p.status !== 'waiting') return { status: 404, code: 'NO_PROPOSAL', message: 'Nothing waiting with that id' };
      if (c.levels[p.area as Section] < APPROVE) return { status: 403, code: 'FORBIDDEN', message: 'You can’t approve here' };
      if (p.proposedBy === c.person.id) return { status: 403, code: 'OWN_PROPOSAL', message: 'Someone else has to approve what you proposed' };
      const result = await apply(tx, p.payload as Change, (await store.personById(tx, p.proposedBy))!);
      await store.settleProposal(tx, p.id, 'approved', c.person.id, now());
      await auditFrom(req, { area: p.area, action: p.summary, detail: 'Approved by a second person', after: p.payload, result: 'approved', approver: c.person.id }, tx);
      return { status: 200, result };
    });
    if (out.status !== 200) return fail(res, out.status, out.code!, out.message!);
    res.json({ done: true, ...out.result });
  });

  router.post('/proposals/:id/decline', limits.write, async (req, res) => {
    const c = req.command!;
    const out = await c.db.transaction(async (tx) => {
      const p = await store.proposalForUpdate(tx, req.params.id);
      if (!p || p.status !== 'waiting') return 404;
      const own = p.proposedBy === c.person.id;
      if (!own && c.levels[p.area as Section] < APPROVE) return 403;
      await store.settleProposal(tx, p.id, own ? 'withdrawn' : 'declined', c.person.id, now());
      await auditFrom(req, { area: p.area, action: p.summary, detail: own ? 'Withdrawn' : 'Declined', result: 'declined' }, tx);
      return 200;
    });
    if (out === 404) return fail(res, 404, 'NO_PROPOSAL', 'Nothing waiting with that id');
    if (out === 403) return fail(res, 403, 'FORBIDDEN', 'You can’t decline here');
    res.json({ done: true });
  });

  return router;
}

/** What the app needs to draw someone's view. */
function me(person: store.Person, c: { levels: Levels; group: store.Group | null; access: store.Access | null; termsRequired: boolean; member?: boolean }) {
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    title: person.title,
    group: c.group ? { key: c.group.key, name: c.group.name, description: c.group.description } : null,
    custom: !!c.access?.custom,
    levels: c.levels,
    member: !!c.member,
    expiresAt: c.access?.expiresAt?.toISOString() ?? null,
    terms: { required: c.termsRequired, version: store.TERMS_VERSION },
  };
}
