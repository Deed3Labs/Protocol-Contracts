import { createHash, timingSafeEqual } from 'node:crypto';
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
import { NotLiveYet, fieldSection, growthSection, membersSection, merchantsSection, moneySection, shopSection, contractsSection, governanceSection, recordsSection, homeSection } from '../services/command/sections.js';
import * as store from '../services/command/store.js';
import { ActionError, actionFor, actionTime, levelFor, type Action } from '../services/command/actions.js';
import { settingsSection } from '../services/command/settings.js';
import { liveSafeReader, safeAppUrl, safeConfig, SafeServiceError, type SafeConfig, type SafeReader } from '../services/command/safe.js';
import { getAddress, isAddress, recoverTypedDataAddress, verifyMessage, type Hex } from 'viem';
import { BUILDERS, BuildError, onChain, safeTxFor, safeTxHash, typedDataFor, type SafeTxData } from '../services/command/safeTx.js';
import { indexStatus } from '../services/command/indexer.js';
import type { ChainReader } from '../services/command/onchain.js';
import { codeStatus } from '../services/command/github.js';
import { feedStatus, requestSync, type Feed } from '../services/command/feeds.js';
import { liveFeeds, plaidWebhook, plaidWebhookKey, shopAddress } from '../services/command/feedSources.js';
import { join } from '../services/command/waitlist.js';
import { cachedSiteNow, type SiteNow } from '../services/command/siteNow.js';
import { MAX_PHOTO_BYTES, PHOTO_TYPES, publicCatalog, revalidateSite, uploadPhoto } from '../services/command/catalog.js';
import type { MemberSource } from '../services/command/memberSource.js';
import { FILE_TYPES, MAX_FILE_BYTES, newShareToken, openShare, postgresFiles, type FileStore } from '../services/command/files.js';

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
  /** The name a member chose to be seen by in Clear (display name, else @username), if they're one. */
  memberName?: (auth: NonNullable<Request['auth']>) => Promise<string | null>;
  mail: (m: { to: string; subject: string; text: string }) => Promise<void>;
  /** Emails that become Admin on first sign-in (COMMAND_ADMIN_EMAILS): how the first admin gets in. */
  adminEmails: () => string[];
  appUrl: () => string;
  /** The indexer: a catch-up when someone opens a section that reads the chain. */
  indexer?: { catchUp(): void };
  /** The contracts' own reads, for Money and Contracts when they're live from the chain. */
  chain?: ChainReader;
  /** The GitHub poller: a catch-up when someone opens Contracts. */
  code?: { catchUp(): void };
  /** The sandbox feeds, for their status (Phase 6a): the live four unless given. */
  feeds?: Feed[];
  /** The member app's records, for Members when it's live (Phase 7b). */
  memberSource?: MemberSource;
  /** Who's on the site now, for Growth's Right now (Umami's real-time view, kept a few seconds, unless given). */
  siteNow?: { off(): string | null; read(): Promise<SiteNow> };
  /** A live order's address, read from the shop's Stripe (Phase 7a): Stripe's unless given. */
  shopAddress?: typeof shopAddress;
  /** The Ops Safe: which one (env unless given), and how it's read. */
  safe?: { config: () => SafeConfig | null; reader: SafeReader };
  /** Where files people add are kept (Postgres unless given). */
  files?: FileStore;
  /** Tells the site its catalog changed (Phase 11b): COMMAND_SITE_REVALIDATE_URL unless given. */
  revalidate?: () => Promise<unknown>;
  /** Stores a product photo (Phase 11d): through the site's /api/shop/photos into Vercel Blob unless given. */
  uploadPhoto?: typeof uploadPhoto;
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
  const feedList = (() => {
    let list: Feed[] | null = deps.feeds ?? null;
    return () => (list ??= liveFeeds());
  })();
  const limits = deps.limits ?? { signIn: passThrough, write: passThrough };
  const siteNowReader = (() => {
    let r: CommandDeps['siteNow'] | null = deps.siteNow ?? null;
    return () => (r ??= cachedSiteNow());
  })();

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
    // someone with no name yet is named as they are in Clear, else by their social login's name
    const knownName = member ? ((await deps.memberName?.(auth).catch(() => null)) ?? auth.name ?? null) : (auth.name ?? null);

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

      if (!person.name.trim() && knownName) person = await store.namePerson(tx, person.id, knownName);

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

  /**
   * A reveal of personal details (migration 0059): only at Approve on the section (Settings → Who can
   * reveal), with a reason (`reason`), or flagged when skipped in a rush (`rush=1`) if Settings allows.
   * Logged before anything is shown; false (and a 400 sent) when it isn't allowed.
   */
  const revealFrom = async (req: Request, res: Response, r: Omit<store.Reveal, 'person' | 'reason'> & { why?: string }) => {
    const c = req.command!;
    const reason = (r.why ?? String(req.query.reason ?? req.body?.reason ?? '')).slice(0, 500);
    const rush = req.query.rush === '1' || req.body?.rush === true;
    const out = await store.logReveal(c.db, { ...r, person: c.person, reason, rush, fromWhere: await store.whereFrom(c.db, c.sessionId) });
    if (!out.ok) fail(res, 400, 'REASON_NEEDED', 'Say why you need to see this');
    return out.ok;
  };

  /**
   * A whole list with names is an export (migration 0064): it needs an approved export of the asker's own
   * (`export=<grant>`), which a second person gave. Used once; logged as a reveal with the reason it was
   * approved for. False (and a 403 sent) without one.
   */
  const exportFrom = async (req: Request, res: Response, section: 'members' | 'growth') => {
    const c = req.command!;
    const why = await store.useExport(c.db, String(req.query.export ?? ''), c.person.id, section, now());
    if (why == null) fail(res, 403, 'EXPORT_NEEDS_SECOND', 'A whole list with names needs a second person: ask for an export');
    return why;
  };

  // ── you ──────────────────────────────────────────────────────────────────

  router.get('/me', async (req, res) => {
    const c = req.command!;
    // someone signed in before names were filled at sign-in gets theirs on their next load
    let person = c.person;
    if (!person.name.trim()) {
      const auth = req.auth!;
      const name = (c.member ? await deps.memberName?.(auth).catch(() => null) : null) ?? auth.name ?? null;
      if (name) person = await store.namePerson(c.db, person.id, name);
    }
    res.json({ me: me(person, c) });
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

  /** What's waiting for a second person: in one area, or (area=all) every area you can see. */
  router.get('/proposals', async (req, res) => {
    const c = req.command!;
    const area = String(req.query.area ?? 'access');
    const areas = area === 'all' ? (Object.keys(c.levels) as Section[]).filter((s) => c.levels[s] >= SEE) : [area as Section];
    if (!areas.length || areas.some((a) => !(a in c.levels) || c.levels[a] < SEE)) return fail(res, 403, 'FORBIDDEN', 'You can’t see what’s waiting there');
    // approved=30: what was approved in the last 30 days, for the two-person rule's counts and waits
    const days = Number(req.query.approved);
    if (days > 0) {
      const since = new Date(now().getTime() - Math.min(days, 365) * 86400_000);
      return res.json({ proposals: (await Promise.all(areas.map((a) => store.approvedSince(c.db, a, since)))).flat() });
    }
    res.json({ proposals: (await Promise.all(areas.map((a) => store.proposals(c.db, a)))).flat() });
  });

  /** The audit log, newest first, and whether its chain holds (migration 0058). */
  router.get('/audit', need('records', SEE), async (req, res) => {
    const db = req.command!.db;
    res.json({ entries: await store.auditLog(db), chain: await store.auditChain(db) });
  });

  /** A correction: a new entry pointing back at the one it corrects. Nothing in the log is ever edited. */
  router.post('/audit/:id/correct', limits.write, need('records', PROPOSE), async (req, res) => {
    const c = req.command!;
    const id = Number(req.params.id);
    const note = z.string().trim().min(1).max(500).safeParse(req.body?.note);
    if (!note.success) return fail(res, 400, 'BAD_REQUEST', 'Say what was wrong and what’s right');
    const { rows } = await c.db.query<{ area: string; action: string }>('SELECT area, action FROM command.audit_log WHERE id = $1', [Number.isSafeInteger(id) ? id : -1]);
    if (!rows[0]) return fail(res, 404, 'NOT_FOUND', 'No such entry');
    await auditFrom(req, { area: rows[0].area, action: `Corrected: ${rows[0].action}`, detail: note.data, result: 'done', corrects: id });
    res.json({ done: true });
  });

  /** Records → Reveals: who saw whose details, and why. */
  router.get('/reveals', need('records', SEE), async (req, res) => {
    res.json({ reveals: await store.reveals(req.command!.db) });
  });

  /** Records → exports: every approved export, who asked, who approved, and whether it was used. */
  router.get('/exports', need('records', SEE), async (req, res) => {
    res.json({ exports: await store.exports(req.command!.db) });
  });

  /** Your own approved exports: the ones you can still use, and the ones you have. */
  router.get('/exports/mine', async (req, res) => {
    res.json({ exports: await store.exports(req.command!.db, req.command!.person.id) });
  });

  /** Settings → Rules and limits: every rule's value, and any change waiting for a second person. */
  router.get('/sections/settings', need('settings', TOTALS), async (req, res) => {
    res.json(await settingsSection(req.command!.db, req.command!.levels.settings, now().getTime()));
  });

  // ── the sections' data ───────────────────────────────────────────────────

  /**
   * A section's rows and figures. Level 0 is refused by `need`; Totals gets what the server built for
   * Totals (no names, nothing that points to one person). Names in full (?reveal=1) are an export: Approve,
   * and an approved export of the asker's own (`export=<grant>`); each use is logged as a reveal.
   */
  router.get('/sections/members', need('members', TOTALS), async (req, res) => {
    const c = req.command!;
    const level = c.levels.members;
    const reveal = req.query.reveal === '1' && level >= APPROVE;
    try {
      const why = reveal ? await exportFrom(req, res, 'members') : null;
      if (reveal && why == null) return;
      const data = await membersSection(c.db, { level, reveal, now: now(), memberSource: deps.memberSource });
      if (reveal && !(await revealFrom(req, res, { section: 'members', subject: '*', field: 'names', rows: data.MEMBERS.length, why: why! }))) return;
      res.json(data);
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  /** One member's name (or someone waiting's), shown for a reason: Members at Approve, logged as a reveal before it's sent. */
  router.post('/members/:id/reveal', limits.write, need('members', APPROVE), async (req, res) => {
    const c = req.command!;
    try {
      const data = await membersSection(c.db, { level: c.levels.members, reveal: true, now: now(), memberSource: deps.memberSource });
      const m = [...data.MEMBERS, ...(data.WAITLIST ?? [])].find((x) => String(x.id) === req.params.id || x.no === req.params.id);
      if (!m) return fail(res, 404, 'NOT_FOUND', 'No such member');
      if (!(await revealFrom(req, res, { section: 'members', subject: m.no || String(m.id), field: 'name' }))) return;
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ id: m.id, no: m.no, first: m.first, last: m.last });
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/sections/growth', need('growth', TOTALS), async (req, res) => {
    const c = req.command!;
    const level = c.levels.growth;
    const reveal = req.query.reveal === '1' && level >= APPROVE;
    try {
      const why = reveal ? await exportFrom(req, res, 'growth') : null;
      if (reveal && why == null) return;
      const data = await growthSection(c.db, { level, reveal, now: now(), memberSource: deps.memberSource });
      if (reveal && !(await revealFrom(req, res, { section: 'growth', subject: '*', field: 'form names', rows: data.INBOX?.length ?? 0, why: why! }))) return;
      res.json(data);
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  /** Who's on the site right now (Growth's Right now): counts, pages and sources only, never who. */
  router.get('/growth/now', need('growth', TOTALS), async (_req, res) => {
    const r = siteNowReader();
    const off = r.off();
    res.setHeader('Cache-Control', 'private, no-store');
    if (off) return res.json({ off });
    try {
      res.json(await r.read());
    } catch (e) {
      fail(res, 502, 'SITE_FEED', `The site feed didn’t answer: ${(e as Error).message}`);
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
      res.json(await merchantsSection(c.db, { level: c.levels.merchants, reveal: false, now: now(), chain: deps.chain }));
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  /** A shop enquiry's contact (their name and email), shown for a reason: Merchants at Approve, logged as a reveal before it's sent. */
  router.post('/merchants/enquiries/:id/reveal', limits.write, need('merchants', APPROVE), async (req, res) => {
    const c = req.command!;
    const id = Number(req.params.id);
    const { rows } = Number.isInteger(id) && id > 0 ? await c.db.query<{ first_name: string; last_name: string; email: string }>(`SELECT first_name, last_name, email FROM command.form_submissions WHERE id = $1 AND form = 'Shop enquiry'`, [id]) : { rows: [] };
    if (!rows[0]) return fail(res, 404, 'NOT_FOUND', 'No such shop enquiry');
    if (!(await revealFrom(req, res, { section: 'merchants', subject: `enquiry ${id}`, field: 'name' }))) return;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ id, first: rows[0].first_name, last: rows[0].last_name, email: rows[0].email });
  });

  router.get('/sections/money', need('money', TOTALS), async (req, res) => {
    const c = req.command!;
    deps.indexer?.catchUp();
    try {
      res.json(await moneySection(c.db, { level: c.levels.money, reveal: false, now: now(), chain: deps.chain, memberSource: deps.memberSource }));
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

  router.get('/sections/contracts', need('contracts', TOTALS), async (req, res) => {
    const c = req.command!;
    deps.indexer?.catchUp();
    deps.code?.catchUp();
    try {
      res.json(await contractsSection(c.db, { level: c.levels.contracts, reveal: false, now: now(), chain: deps.chain }));
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/sections/governance', need('governance', TOTALS), async (req, res) => {
    const c = req.command!;
    try {
      res.json(await governanceSection(c.db, { level: c.levels.governance, reveal: false, now: now(), memberSource: deps.memberSource }));
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/sections/records', need('records', TOTALS), async (req, res) => {
    const c = req.command!;
    try {
      res.json(await recordsSection(c.db, { level: c.levels.records, reveal: false, now: now() }));
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  router.get('/sections/home', need('home', TOTALS), async (req, res) => {
    const c = req.command!;
    try {
      res.json(await homeSection(c.db, { level: c.levels.home, reveal: false, now: now(), memberSource: deps.memberSource }));
    } catch (e) {
      if (e instanceof NotLiveYet) return fail(res, 501, 'NOT_LIVE_YET', e.message);
      throw e;
    }
  });

  /** Where the indexer is: how far it's read, how far behind the head, its last error. */
  router.get('/chain/status', need('contracts', SEE), async (req, res) => {
    res.json(await indexStatus(req.command!.db));
  });

  /**
   * One live order's shipping address, for packing it (Phase 7a): Shop at Propose or above, read from
   * Stripe for this order only, never stored, and logged.
   */
  router.get('/shop/orders/:id/address', need('shop', PROPOSE), async (req, res) => {
    const db = req.command!.db;
    const a = await (deps.shopAddress ?? shopAddress)(db, req.params.id);
    if (!a) return fail(res, 404, 'NOT_FOUND', 'No live order with that number');
    // packing is the reason unless another is given
    if (!req.query.reason && !req.query.rush) req.query.reason = 'To pack it';
    if (!(await revealFrom(req, res, { section: 'shop', subject: `#${req.params.id}`, field: 'address' }))) return;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(a);
  });

  /** Each feed's health and freshness, and the menu's line: the same for everyone signed in. */
  router.get('/feeds', need('home', TOTALS), async (req, res) => {
    res.json(await feedStatus(req.command!.db, feedList(), now().getTime()));
  });

  /** Where the GitHub poller is: how many commits it holds, how many want their files, its last error. */
  router.get('/code/status', need('contracts', SEE), async (req, res) => {
    res.json(await codeStatus(req.command!.db));
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
    const settle = () => c.db.transaction(async (tx) => {
      const p = await store.proposalForUpdate(tx, req.params.id);
      if (!p || p.status !== 'waiting') return { status: 404, code: 'NO_PROPOSAL', message: 'Nothing waiting with that id' };
      if (c.levels[p.area as Section] < APPROVE) return { status: 403, code: 'FORBIDDEN', message: 'You can’t approve here' };
      if (p.proposedBy === c.person.id) return { status: 403, code: 'OWN_PROPOSAL', message: 'Someone else has to approve what you proposed' };
      const proposer = (await store.personById(tx, p.proposedBy))!;
      const result = p.kind === 'action' ? await runAction(tx, p.payload as unknown as ActionPayload, proposer, c.person, p.id) : await apply(tx, p.payload as Change, proposer);
      await store.settleProposal(tx, p.id, 'approved', c.person.id, now());
      await auditFrom(req, { area: p.area, action: p.summary, detail: 'Approved by a second person', after: p.payload, result: 'approved', approver: c.person.id }, tx);
      const ap = p.payload as unknown as ActionPayload;
      return { status: 200, result, kind: p.kind, section: ap.section, actionKind: ap.kind, body: ap.body };
    });
    let out: Awaited<ReturnType<typeof settle>>;
    try {
      out = await settle();
    } catch (e) {
      // an action that can't run any more (it changed while it waited) says why, and nothing is approved
      if (e instanceof ActionError) return fail(res, e.status, e.code, e.message);
      throw e;
    }
    if (out.status !== 200) return fail(res, out.status, out.code!, out.message!);
    if (out.kind === 'action') afterAction(actionFor(out.section!, out.actionKind!) as Action, out.body);
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

  // ── each section's own actions ───────────────────────────────────────────

  /**
   * One action of a section's (services/command/actions.ts). It runs now, recording anything for an
   * outside system in the outbox, or, when its rule asks for a second person, waits as a proposal
   * until someone else approves it.
   */
  router.post('/actions/:section/:kind', limits.write, async (req, res) => {
    const c = req.command!;
    const section = req.params.section as Section;
    const a = actionFor(section, req.params.kind);
    if (!a) return fail(res, 404, 'NO_ACTION', 'No such action');
    if ((c.levels[section] ?? 0) < levelFor(a)) return fail(res, 403, 'FORBIDDEN', 'You can see this but not change it');
    const b = a.body.safeParse(req.body ?? {});
    if (!b.success) return fail(res, 400, 'BAD_REQUEST', b.error.issues[0]?.message ?? 'Something’s missing');
    try {
      const summary = await a.summary(b.data, c.db);
      const payload: ActionPayload = { section, kind: req.params.kind, body: b.data };
      if (a.second && (await a.second(b.data, c.db))) {
        const proposal = await c.db.transaction(async (tx) => {
          const pr = await store.propose(tx, { kind: 'action', area: section, summary, payload, by: c.person.id });
          await auditFrom(req, { area: section, action: summary, detail: 'Needs a second person', after: b.data, result: 'waiting' }, tx);
          return pr;
        });
        return res.status(202).json({ proposal, needs: 'a second person' });
      }
      const out = await c.db.transaction(async (tx) => {
        const r = await runAction(tx, payload, c.person, null, null, c.levels);
        await auditFrom(req, { area: section, action: summary, detail: r.queued ? 'Recorded for the outside system; nothing sent yet' : '', after: b.data, result: 'done' }, tx);
        return r;
      });
      afterAction(a, b.data);
      res.json({ done: true, ...out });
    } catch (e) {
      if (e instanceof ActionError) return fail(res, e.status, e.code, e.message);
      throw e;
    }
  });

  /** What follows a committed action: a change to the store's catalog tells the site, never holding up the answer. */
  function afterAction(a: Action | undefined, body?: unknown) {
    if (a?.after) void a.after(body).catch(() => undefined);
    if (a?.revalidates) void (deps.revalidate ?? revalidateSite)().catch(() => undefined);
  }

  /** Runs an action as the person who asked for it (and the second person, when approved). */
  async function runAction(tx: Queryable, p: ActionPayload, by: store.Person, approver: store.Person | null, proposalId: string | null, levels?: Levels) {
    const a = actionFor(p.section, p.kind) as Action;
    const at = actionTime(p.section, now());
    const result = a.apply ? await a.apply({ tx, person: by, approver, at, proposal: proposalId, levels }, p.body) : undefined;
    const queued = typeof a.outbox === 'function' ? a.outbox(p.body) : !!a.outbox;
    if (queued) {
      await tx.query('INSERT INTO command.outbox (section, kind, summary, payload, requested_by, approved_by, proposal_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        p.section,
        p.kind,
        await a.summary(p.body, tx),
        JSON.stringify(p.body),
        by.id,
        approver?.id ?? null,
        proposalId,
      ]);
    }
    return { result: result ?? null, queued };
  }

  /** What's waiting for an outside system, newest first. */
  router.get('/outbox', need('records', SEE), async (req, res) => {
    const { rows } = await req.command!.db.query(
      'SELECT o.id, o.section, o.kind, o.summary, o.status, o.created_at, p.name AS requested_by, q.name AS approved_by FROM command.outbox o JOIN command.people p ON p.id = o.requested_by LEFT JOIN command.people q ON q.id = o.approved_by ORDER BY o.created_at DESC LIMIT 200',
    );
    res.json({ outbox: rows });
  });

  // ── files ────────────────────────────────────────────────────────────────

  const files: FileStore = deps.files ?? postgresFiles;
  const raw = express.raw({ type: () => true, limit: MAX_FILE_BYTES });

  /** Adds a file for a section that keeps them (records, field). The body is the file itself. */
  router.post('/files', limits.write, raw, async (req, res) => {
    const c = req.command!;
    const section = String(req.query.section ?? '') as Section;
    if (!['records', 'field'].includes(section)) return fail(res, 400, 'BAD_REQUEST', 'Files belong to Records or Field');
    if ((c.levels[section] ?? 0) < PROPOSE) return fail(res, 403, 'FORBIDDEN', 'You can see this but not add to it');
    const mime = String(req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!FILE_TYPES[mime]) return fail(res, 415, 'BAD_TYPE', 'Add a PDF, an image, a Word or Excel file, or plain text');
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!bytes.length) return fail(res, 400, 'EMPTY', 'That file is empty');
    const f = await c.db.transaction(async (tx) => {
      const stored = await files.put(tx, { name: String(req.query.name ?? 'file'), mime, bytes, by: c.person.id });
      await auditFrom(req, { area: section, action: `Added a file · ${stored.name}`, detail: `${Math.ceil(stored.size / 1024)} KB · sha256 ${stored.sha256.slice(0, 12)}`, result: 'done' }, tx);
      return stored;
    });
    res.status(201).json({ file: f });
  });

  /**
   * A product photo (Phase 11d): checked here, stored through the site in Vercel Blob, and its address
   * answered. Nothing's in the catalog until photo-add puts it there, so a photo that never gets added
   * shows nowhere.
   */
  router.post('/shop/photos/:id', limits.write, raw, need('shop', PROPOSE), async (req, res) => {
    const c = req.command!;
    const pid = req.params.id;
    const p = (await c.db.query<{ in_catalog: boolean }>('SELECT in_catalog FROM command.shop_products WHERE id = $1', [pid])).rows[0];
    if (!p) return fail(res, 404, 'NOT_FOUND', 'No such product');
    if (!p.in_catalog) return fail(res, 409, 'NOT_IN_CATALOG', 'It isn’t in Command’s catalog yet');
    const mime = String(req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!PHOTO_TYPES.has(mime)) return fail(res, 415, 'BAD_TYPE', 'A photo is a JPEG, PNG or WebP');
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!bytes.length) return fail(res, 400, 'EMPTY', 'That photo is empty');
    if (bytes.length > MAX_PHOTO_BYTES) return fail(res, 413, 'TOO_BIG', 'A photo can be up to 4 MB: make it smaller and try again');
    const name = String(req.query.name ?? 'photo').slice(0, 120);
    let src: string;
    try {
      src = await (deps.uploadPhoto ?? uploadPhoto)(pid, name, mime, bytes);
    } catch (e) {
      return fail(res, 502, 'STORE', `The shop’s photo store didn’t take it: ${(e as Error).message}`);
    }
    await auditFrom(req, { area: 'shop', action: `Uploaded a photo of ${pid} · ${name}`, detail: `${Math.ceil(bytes.length / 1024)} KB`, result: 'done' });
    res.status(201).json({ src });
  });

  const sendFile = (res: Response, f: { name: string; mime: string; bytes: Buffer }, disposition: 'attachment' | 'inline') => {
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.end(f.bytes);
  };

  /** A document's file, logged. */
  router.get('/documents/:id/file', need('records', SEE), async (req, res) => {
    const c = req.command!;
    const { rows } = await c.db.query<{ title: string; file_id: string | null }>('SELECT title, file_id FROM command.documents WHERE id = $1', [req.params.id]);
    if (!rows[0]) return fail(res, 404, 'NOT_FOUND', 'No such document');
    if (!rows[0].file_id) return fail(res, 404, 'NO_FILE', 'There’s no file on record for this document yet');
    const f = await files.get(c.db, rows[0].file_id);
    if (!f) return fail(res, 404, 'NO_FILE', 'The file is missing');
    await auditFrom(req, { area: 'records', action: `Downloaded ${rows[0].title}`, result: 'done' });
    sendFile(res, f, 'attachment');
  });

  /** A field photo or any file by id, for someone who can see the section it belongs to. */
  router.get('/files/:id', async (req, res) => {
    const c = req.command!;
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'No such file');
    const { rows } = await c.db.query<{ area: string }>(
      `SELECT 'records' AS area FROM command.documents WHERE file_id = $1 UNION SELECT 'records' FROM command.document_versions WHERE file_id = $1 UNION SELECT 'field' FROM command.route_tasks WHERE photo_file = $1`,
      [req.params.id],
    );
    if (!rows.some((r) => (c.levels[r.area as Section] ?? 0) >= SEE)) return fail(res, 404, 'NOT_FOUND', 'No such file');
    const f = await files.get(c.db, req.params.id);
    if (!f) return fail(res, 404, 'NOT_FOUND', 'No such file');
    sendFile(res, f, 'inline');
  });

  const shareBody = z.object({ days: z.union([z.literal(1), z.literal(7), z.literal(30)]), forWhom: z.string().trim().min(1).max(120) });
  /** A view-only link to a document, for someone outside: it expires, and every open is logged. */
  router.post('/documents/:id/share', limits.write, need('records', PROPOSE), async (req, res) => {
    const c = req.command!;
    const b = shareBody.safeParse(req.body);
    if (!b.success) return fail(res, 400, 'BAD_REQUEST', b.error.issues[0]?.message ?? 'Say who it’s for and how long');
    const { rows } = await c.db.query<{ title: string; file_id: string | null }>('SELECT title, file_id FROM command.documents WHERE id = $1', [req.params.id]);
    if (!rows[0]) return fail(res, 404, 'NOT_FOUND', 'No such document');
    if (!rows[0].file_id) return fail(res, 409, 'NO_FILE', 'Add the file before sharing it');
    const { token, hash } = newShareToken();
    const expiresAt = new Date(now().getTime() + b.data.days * 86400_000);
    await c.db.transaction(async (tx) => {
      await tx.query('INSERT INTO command.share_links (document_id, token_hash, for_whom, expires_at, created_by) VALUES ($1, $2, $3, $4, $5)', [req.params.id, hash, b.data.forWhom, expiresAt, c.person.id]);
      await auditFrom(req, { area: 'records', action: `Shared ${rows[0].title}`, detail: `View-only link for ${b.data.forWhom} · ${b.data.days} day${b.data.days === 1 ? '' : 's'}`, result: 'done' }, tx);
    });
    res.status(201).json({ path: `/api/command/shared/${token}`, expiresAt });
  });

  // ── your wallet, and the Ops Safe ────────────────────────────────────────

  /** A one-time message to sign with the wallet you want to link. */
  router.post('/me/wallet/challenge', limits.write, async (req, res) => {
    const c = req.command!;
    const at = now();
    const message = `Link this wallet to the Clear Command Center as ${c.person.email || c.person.name}.\n\nOne-time code: ${store.newToken()}\nIssued: ${at.toISOString()}`;
    const { rows } = await c.db.query<{ id: string }>('INSERT INTO command.wallet_challenges (person_id, message, expires_at) VALUES ($1, $2, $3) RETURNING id', [c.person.id, message, new Date(at.getTime() + 10 * 60_000)]);
    res.json({ id: rows[0].id, message });
  });

  const walletBody = z.object({ id: z.string().uuid(), address: z.string().refine((a) => isAddress(a), 'Not a wallet address'), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });
  /** Links a wallet: the signature over the challenge proves it's yours. A Safe owner's wallet makes you a signer. */
  router.post('/me/wallet', limits.write, async (req, res) => {
    const c = req.command!;
    const b = walletBody.safeParse(req.body);
    if (!b.success) return fail(res, 400, 'BAD_REQUEST', b.error.issues[0]?.message ?? 'A signed challenge is needed');
    const address = getAddress(b.data.address);
    const out = await c.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ message: string }>(
        'UPDATE command.wallet_challenges SET used_at = $3 WHERE id = $1 AND person_id = $2 AND used_at IS NULL AND expires_at > $3 RETURNING message',
        [b.data.id, c.person.id, now()],
      );
      if (!rows[0]) return { status: 400, code: 'BAD_CHALLENGE', message: 'That code has expired or been used. Start again.' };
      const ok = await verifyMessage({ address, message: rows[0].message, signature: b.data.signature as `0x${string}` }).catch(() => false);
      if (!ok) return { status: 400, code: 'BAD_SIGNATURE', message: 'That signature isn’t from this wallet' };
      const taken = await tx.query<{ id: string }>('SELECT id FROM command.people WHERE wallet_address = $1 AND id <> $2', [address.toLowerCase(), c.person.id]);
      if (taken.rows[0]) return { status: 409, code: 'WALLET_TAKEN', message: 'That wallet is linked to someone else' };
      await tx.query('UPDATE command.people SET wallet_address = $2, wallet_linked_at = $3, updated_at = $3 WHERE id = $1', [c.person.id, address.toLowerCase(), now()]);
      await auditFrom(req, { area: 'access', action: 'Linked a wallet', detail: `${address.slice(0, 6)}…${address.slice(-4)}`, result: 'done' }, tx);
      return { status: 200 };
    });
    if (out.status !== 200) return fail(res, out.status, out.code!, out.message!);
    res.json({ wallet: address.toLowerCase() });
  });

  router.delete('/me/wallet', limits.write, async (req, res) => {
    const c = req.command!;
    await c.db.transaction(async (tx) => {
      await tx.query('UPDATE command.people SET wallet_address = NULL, wallet_linked_at = NULL, updated_at = $2 WHERE id = $1', [c.person.id, now()]);
      await auditFrom(req, { area: 'access', action: 'Unlinked a wallet', result: 'done' }, tx);
    });
    res.json({ wallet: null });
  });

  const safeDeps = deps.safe ?? { config: () => safeConfig(), reader: liveSafeReader() };
  /**
   * The Ops Safe: owners (and which Command person each is), threshold, nonce, what's waiting and
   * who has signed it, and the latest executed. Without a configured Safe, says so.
   */
  router.get('/safe', need('contracts', SEE), async (req, res) => {
    const c = req.command!;
    const cfg = safeDeps.config();
    if (!cfg) return res.json({ configured: false });
    try {
      const [info, pending, done] = await Promise.all([safeDeps.reader.info(cfg), safeDeps.reader.transactions(cfg, { executed: false }), safeDeps.reader.transactions(cfg, { executed: true, limit: 20 })]);
      const { rows } = await c.db.query<{ id: string; name: string; email: string | null; wallet_address: string }>('SELECT id, name, email, wallet_address FROM command.people WHERE wallet_address = ANY($1)', [info.owners.map((o) => o.toLowerCase())]);
      const who = (a: string) => rows.find((r) => r.wallet_address === a.toLowerCase());
      res.json({
        configured: true,
        address: cfg.address,
        chainId: cfg.chainId,
        link: safeAppUrl(cfg),
        threshold: info.threshold,
        nonce: info.nonce,
        owners: info.owners.map((a) => ({ address: a, person: who(a) ? { id: who(a)!.id, name: who(a)!.name || who(a)!.email } : null, you: c.person.wallet === a.toLowerCase() })),
        // stale queue entries (a nonce already used) are left out
        pending: pending.filter((t) => t.nonce >= info.nonce).sort((a, b) => a.nonce - b.nonce),
        executed: done,
      });
    } catch (e) {
      if (e instanceof SafeServiceError) return fail(res, 502, 'SAFE_SERVICE', e.message);
      return fail(res, 502, 'SAFE_UNREACHABLE', 'Couldn’t read the Safe right now');
    }
  });

  // ── proposing to the Ops Safe ────────────────────────────────────────────

  /** The outbox's on-chain acts, each with the Safe transaction built for it, if any. */
  router.get('/safe/outbox', need('contracts', SEE), async (req, res) => {
    const { rows } = await req.command!.db.query<any>(
      `SELECT o.id, o.section, o.kind, o.summary, o.status, o.created_at, p.name AS requested_by, sp.safe_tx_hash, sp.nonce, sp.status AS safe_status
       FROM command.outbox o JOIN command.people p ON p.id = o.requested_by
       LEFT JOIN LATERAL (SELECT * FROM command.safe_proposals s WHERE s.outbox_id = o.id AND s.status <> 'superseded' ORDER BY created_at DESC LIMIT 1) sp ON true
       WHERE o.status IN ('queued', 'sent') ORDER BY o.created_at`,
    );
    res.json({ outbox: rows.filter((r) => onChain(r.section, r.kind)) });
  });

  /** You, as a Safe owner: your linked wallet and whether it's one of the Safe's owners. */
  const asOwner = async (c: NonNullable<Request['command']>, cfg: SafeConfig) => {
    if (!c.person.wallet) return { error: 'Link the wallet you sign with first' };
    const info = await safeDeps.reader.info(cfg);
    if (!info.owners.some((o) => o.toLowerCase() === c.person.wallet)) return { error: 'Your linked wallet isn’t one of the Safe’s owners' };
    return { info, wallet: getAddress(c.person.wallet) };
  };
  const signerOf = (cfg: SafeConfig, tx: SafeTxData, signature: string) => recoverTypedDataAddress({ ...(typedDataFor(cfg, tx) as any), signature: signature as Hex }).catch(() => null);
  const safeFail = (res: Response, e: unknown) => {
    if (e instanceof BuildError) return fail(res, 422, e.code, e.message);
    if (e instanceof SafeServiceError) return fail(res, 502, 'SAFE_SERVICE', e.message);
    throw e;
  };

  /**
   * Builds the Safe transaction for an outbox row at the Safe's next free nonce, and what the
   * signer's wallet signs. Building again supersedes what was built before and not yet proposed.
   */
  router.post('/safe/prepare', limits.write, need('contracts', PROPOSE), async (req, res) => {
    const c = req.command!;
    const cfg = safeDeps.config();
    if (!cfg) return fail(res, 409, 'NO_SAFE', 'No Safe is connected yet');
    const id = z.object({ outboxId: z.string().uuid() }).safeParse(req.body);
    if (!id.success) return fail(res, 400, 'BAD_REQUEST', 'Which outbox row?');
    const { rows } = await c.db.query<{ section: string; kind: string; summary: string; payload: any; status: string }>('SELECT section, kind, summary, payload, status FROM command.outbox WHERE id = $1', [id.data.outboxId]);
    const o = rows[0];
    if (!o) return fail(res, 404, 'NOT_FOUND', 'No such outbox row');
    if (!onChain(o.section, o.kind)) return fail(res, 400, 'NOT_ON_CHAIN', 'That isn’t something the Safe does');
    if (o.status !== 'queued') return fail(res, 409, 'ALREADY_SENT', 'That’s already in the Safe’s queue');
    try {
      const calls = await BUILDERS[`${o.section}.${o.kind}`](o.payload, { db: c.db, chain: { read: (a, abi, fn, args) => safeDeps.reader.read(cfg, a, abi, fn, args) } });
      const [info, pending] = await Promise.all([safeDeps.reader.info(cfg), safeDeps.reader.transactions(cfg, { executed: false })]);
      const nonce = Math.max(info.nonce, ...pending.filter((t) => t.nonce >= info.nonce).map((t) => t.nonce + 1));
      const tx = safeTxFor(calls, nonce);
      const hash = safeTxHash(cfg, tx);
      await c.db.transaction(async (q) => {
        await q.query(`UPDATE command.safe_proposals SET status = 'superseded' WHERE outbox_id = $1 AND status = 'prepared'`, [id.data.outboxId]);
        await q.query(
          'INSERT INTO command.safe_proposals (safe_tx_hash, outbox_id, safe_address, chain_id, nonce, tx, summary, prepared_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (safe_tx_hash) DO UPDATE SET status = \'prepared\'',
          [hash, id.data.outboxId, cfg.address, cfg.chainId, nonce, JSON.stringify(tx), o.summary, c.person.id],
        );
      });
      res.json({ safeTxHash: hash, nonce, calls: calls.map((x) => ({ to: x.to, label: x.label })), typedData: typedDataFor(cfg, tx) });
    } catch (e) {
      return safeFail(res, e);
    }
  });

  const signedBody = z.object({ safeTxHash: z.string().regex(/^0x[0-9a-f]{64}$/i), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) });

  /** The first signature: checks it's your owner wallet's over this exact transaction, then puts it in the Safe's queue. */
  router.post('/safe/propose', limits.write, need('contracts', PROPOSE), async (req, res) => {
    const c = req.command!;
    const cfg = safeDeps.config();
    if (!cfg) return fail(res, 409, 'NO_SAFE', 'No Safe is connected yet');
    const b = signedBody.safeParse(req.body);
    if (!b.success) return fail(res, 400, 'BAD_REQUEST', 'A transaction hash and a signature are needed');
    const hash = b.data.safeTxHash.toLowerCase();
    const { rows } = await c.db.query<{ tx: SafeTxData; outbox_id: string; summary: string; status: string; safe_address: string }>('SELECT tx, outbox_id, summary, status, safe_address FROM command.safe_proposals WHERE safe_tx_hash = $1', [hash]);
    const sp = rows[0];
    if (!sp || sp.status !== 'prepared' || sp.safe_address !== cfg.address) return fail(res, 404, 'NOT_PREPARED', 'Build it again: that transaction isn’t waiting to be proposed');
    try {
      const owner = await asOwner(c, cfg);
      if ('error' in owner) return fail(res, 403, 'NOT_A_SIGNER', owner.error!);
      if (safeTxHash(cfg, sp.tx) !== hash) return fail(res, 409, 'HASH_MISMATCH', 'What was built doesn’t match its hash');
      const signer = await signerOf(cfg, sp.tx, b.data.signature);
      if (!signer || signer !== owner.wallet) return fail(res, 403, 'BAD_SIGNATURE', 'That signature isn’t your wallet’s, over this transaction');
      await safeDeps.reader.propose(cfg, { ...sp.tx, contractTransactionHash: hash, sender: owner.wallet, signature: b.data.signature, origin: 'Clear Command Center' });
      await c.db.transaction(async (q) => {
        await q.query(`UPDATE command.safe_proposals SET status = 'proposed', proposed_by = $2, proposed_at = $3 WHERE safe_tx_hash = $1`, [hash, c.person.id, now()]);
        await q.query(`UPDATE command.outbox SET status = 'sent' WHERE id = $1`, [sp.outbox_id]);
        await auditFrom(req, { area: 'contracts', action: `Proposed to the Safe: ${sp.summary}`, detail: `Nonce ${sp.tx.nonce} · ${hash.slice(0, 10)}… · 1 of ${owner.info.threshold} signed`, result: 'waiting' }, q);
      });
      res.json({ proposed: true, safeTxHash: hash });
    } catch (e) {
      return safeFail(res, e);
    }
  });

  /** What to sign to add your signature to a transaction already in the Safe's queue. */
  router.get('/safe/tx/:hash', need('contracts', SEE), async (req, res) => {
    const cfg = safeDeps.config();
    if (!cfg) return fail(res, 409, 'NO_SAFE', 'No Safe is connected yet');
    try {
      const t = await safeDeps.reader.transaction(cfg, req.params.hash);
      if (!t) return fail(res, 404, 'NOT_FOUND', 'The Safe has no such transaction');
      const tx: SafeTxData = { to: t.to, value: t.value, data: (t.data ?? '0x') as Hex, operation: t.operation, safeTxGas: t.safeTxGas, baseGas: t.baseGas, gasPrice: t.gasPrice, gasToken: t.gasToken, refundReceiver: t.refundReceiver, nonce: t.nonce };
      res.json({ ...t, typedData: typedDataFor(cfg, tx), hashMatches: safeTxHash(cfg, tx) === req.params.hash.toLowerCase() });
    } catch (e) {
      return safeFail(res, e);
    }
  });

  /** Another signature on a queued transaction: checked against your owner wallet, then sent to the service. */
  router.post('/safe/confirm', limits.write, need('contracts', SEE), async (req, res) => {
    const c = req.command!;
    const cfg = safeDeps.config();
    if (!cfg) return fail(res, 409, 'NO_SAFE', 'No Safe is connected yet');
    const b = signedBody.safeParse(req.body);
    if (!b.success) return fail(res, 400, 'BAD_REQUEST', 'A transaction hash and a signature are needed');
    const hash = b.data.safeTxHash.toLowerCase();
    try {
      const owner = await asOwner(c, cfg);
      if ('error' in owner) return fail(res, 403, 'NOT_A_SIGNER', owner.error!);
      const t = await safeDeps.reader.transaction(cfg, hash);
      if (!t || t.executed) return fail(res, 404, 'NOT_FOUND', 'Nothing waiting with that hash');
      if (t.confirmations.some((x) => x.owner === owner.wallet)) return fail(res, 409, 'ALREADY_SIGNED', 'You’ve signed this one already');
      const tx: SafeTxData = { to: t.to, value: t.value, data: (t.data ?? '0x') as Hex, operation: t.operation, safeTxGas: t.safeTxGas, baseGas: t.baseGas, gasPrice: t.gasPrice, gasToken: t.gasToken, refundReceiver: t.refundReceiver, nonce: t.nonce };
      if (safeTxHash(cfg, tx) !== hash) return fail(res, 409, 'HASH_MISMATCH', 'The service’s transaction doesn’t match its hash');
      const signer = await signerOf(cfg, tx, b.data.signature);
      if (!signer || signer !== owner.wallet) return fail(res, 403, 'BAD_SIGNATURE', 'That signature isn’t your wallet’s, over this transaction');
      const n = t.confirmations.length + 1;
      await safeDeps.reader.confirm(cfg, hash, b.data.signature);
      await auditFrom(req, { area: 'contracts', action: `Signed in the Safe: ${t.method ?? 'transaction'} · nonce ${t.nonce}`, detail: `${n} of ${t.confirmationsRequired} signed${n >= t.confirmationsRequired ? ' · ready to execute' : ''}`, result: n >= t.confirmationsRequired ? 'approved' : 'done' });
      res.json({ confirmed: true, signatures: n, required: t.confirmationsRequired });
    } catch (e) {
      return safeFail(res, e);
    }
  });

  return router;
}

interface ActionPayload {
  section: Section;
  kind: string;
  body: unknown;
}

/**
 * Opening a shared link: no sign-in, so it's mounted ahead of the Command Center's own router. The
 * link is the only key; it works until it expires or is revoked, and each open is logged.
 */
/**
 * Webhooks from the sandbox providers, mounted ahead of the signed-in router. Plaid's says the co-op's
 * bank has news: checked against Plaid's signature, then the bank feed syncs at the next tick.
 */
export function commandWebhookRouter(deps: { db: () => Promise<Db | null>; plaidKey?: Parameters<typeof plaidWebhook>[3]; now?: () => Date }) {
  const router = forwardAsyncErrors(express.Router());
  router.post('/plaid', async (req, res) => {
    const db = await deps.db();
    if (!db) return res.status(503).end();
    const raw = (req as any).rawBody as Buffer | undefined;
    if (!raw) return res.status(400).json({ error: 'no body' });
    const r = await plaidWebhook(db, req.header('plaid-verification'), raw, deps.plaidKey ?? plaidWebhookKey(), (deps.now?.() ?? new Date()).getTime()).catch((e) => ({ ok: false as const, why: (e as Error).message }));
    if (!r.ok) return res.status(400).json({ error: r.why });
    if (r.wake) await requestSync(db, 'plaid', 'Plaid webhook');
    res.json({ ok: true });
  });
  return router;
}

/**
 * The site's join form (clearpath-website, NEXT_PUBLIC_JOIN_ENDPOINT), signed in by nobody: kept as a
 * form submission, and "I want to join" is a place on the waitlist (Phase 7b). Rate-limited by address,
 * and it says the same thing whether the email was new or already waiting.
 */
const JOIN = z.object({
  as: z.enum(['member', 'shop', 'land', 'work']).default('member'),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/).optional().or(z.literal('')),
  note: z.string().trim().max(2000).optional(),
  poster: z.string().trim().regex(/^P-\d{1,6}$/).optional(),
});
export function commandJoinRouter(deps: { db: () => Promise<Db | null>; limit?: RequestHandler; now?: () => Date }) {
  const router = forwardAsyncErrors(express.Router());
  router.post('/', deps.limit ?? passThrough, async (req, res) => {
    const db = await deps.db();
    if (!db) return res.status(503).json({ error: 'Not available right now' });
    const p = JOIN.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Check your name, email and ZIP' });
    // the other answers' fields (business, industry, property…): short strings only, kept as they came
    const known = new Set(['as', 'name', 'email', 'zip', 'note', 'poster']);
    const details = Object.fromEntries(
      Object.entries(req.body as Record<string, unknown>)
        .filter(([k, v]) => !known.has(k) && /^[a-zA-Z]{1,40}$/.test(k) && typeof v === 'string' && v.trim())
        .slice(0, 20)
        .map(([k, v]) => [k, String(v).trim().slice(0, 300)]),
    );
    await join(db, { ...p.data, zip: p.data.zip || undefined, details }, deps.now?.() ?? new Date());
    res.status(201).json({ ok: true });
  });
  return router;
}

/**
 * The shop's catalog for the store (Phase 11), read by nobody signed in: the site's server reads it,
 * cached, and falls back to its last good copy. Live products for anyone; the drafts too with the
 * shared token (COMMAND_CATALOG_TOKEN, the same value in the site's env), compared as hashes.
 */
export function commandCatalogRouter(deps: { db: () => Promise<Db | null>; token?: () => string | undefined }) {
  const router = forwardAsyncErrors(express.Router());
  router.get('/', async (req, res) => {
    const db = await deps.db();
    if (!db) return res.status(503).json({ error: 'Not available right now' });
    const want = (deps.token?.() ?? process.env.COMMAND_CATALOG_TOKEN)?.trim();
    const got = req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
    const drafts = !!want && !!got && timingSafeEqual(createHash('sha256').update(want).digest(), createHash('sha256').update(got).digest());
    res.setHeader('Cache-Control', drafts ? 'private, no-store' : 'public, max-age=60');
    res.json(await publicCatalog(db, drafts));
  });
  return router;
}

export function commandSharedRouter(deps: { db: () => Promise<Db | null>; files?: FileStore; now?: () => Date }) {
  const router = forwardAsyncErrors(express.Router());
  router.get('/:token', async (req, res) => {
    const db = await deps.db();
    if (!db) return res.status(503).end();
    const link = await openShare(db, req.params.token, deps.now?.() ?? new Date());
    const f = link?.file_id ? await (deps.files ?? postgresFiles).get(db, link.file_id) : null;
    if (!link || !f) return res.status(404).type('text/plain').send('This link has expired or doesn’t exist.');
    await store.audit(db, { personId: null, who: `Link · ${link.for_whom}`, area: 'records', action: `Opened ${link.title}`, detail: 'Shared view-only link', fromWhere: 'Link', result: 'done' });
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.end(f.bytes);
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
    wallet: person.wallet ?? null,
  };
}
