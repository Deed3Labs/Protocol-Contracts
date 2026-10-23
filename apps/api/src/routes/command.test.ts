import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import { commandRouter } from './command.js';

/*
 * The Command Center's API over HTTP, on a real Postgres (PGlite) with the real migrations. Privy is
 * stood in for by an x-test-user header ("privy id|email"); everything after it is the real router.
 */

let base = '';
let db: Db;
let clock = new Date('2026-10-21T17:00:00Z');
const members = new Set(['did:member', 'did:kai', 'did:dana', 'did:marcus']);
const mail: Array<{ to: string; subject: string; text: string }> = [];

beforeAll(async () => {
  ({ db } = await testDb());
  const identify = (req: Request, res: Response, next: NextFunction) => {
    const u = req.header('x-test-user');
    if (!u) return res.status(401).json({ code: 'AUTH_TOKEN_MISSING' });
    const [id, email] = u.split('|');
    req.auth = { walletAddress: '', profileUuid: id, email, emails: email ? [email] : [], token: 't', sessionId: `ps_${id}` };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/command',
    commandRouter({
      db: async () => db,
      identify,
      isMember: async (a) => members.has(a.profileUuid!),
      mail: async (m) => void mail.push(m),
      adminEmails: () => ['kai@useclear.org', 'second@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => clock,
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
});

type Who = { user: string; session?: string };
const deviceKey = (u: string) => `device-${u.replace(/\W/g, '')}-0123456789`;

async function call(who: Who | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers['x-test-user'] = who.user;
  if (who?.session) headers['x-command-session'] = who.session;
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as any };
}

async function signIn(user: string, extra: Record<string, unknown> = {}): Promise<Who & { me: any; status: number; code?: string }> {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: deviceKey(user), keep: true, method: 'email', city: 'Redlands', ...extra });
  return { user, session: r.body.session?.id, me: r.body.me, status: r.status, code: r.body.code };
}

const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;
const inviteToken = (to: string) => /#invite=([\w-]+)/.exec(mail.filter((m) => m.to === to).at(-1)!.text)![1];

let kai: Awaited<ReturnType<typeof signIn>>, second: Awaited<ReturnType<typeof signIn>>;

describe('signing in', () => {
  test('an address on COMMAND_ADMIN_EMAILS becomes Admin on first sign-in', async () => {
    const r = await signIn('did:kai|kai@useclear.org');
    expect(r.status).toBe(201);
    expect(r.me.group.key).toBe('admin');
    expect(Object.values(r.me.levels).every((v) => v === 4)).toBe(true);
    kai = r;
    second = await signIn('did:second|second@useclear.org');
    expect(second.me.group.key).toBe('admin');
  });

  test('a Clear member with no team access gets the Members row', async () => {
    const r = await signIn('did:member|member@example.com');
    expect(r.status).toBe(201);
    expect(r.me.group).toBeNull();
    expect(r.me.levels).toMatchObject({ home: 0, growth: 1, contracts: 2, access: 0 });
  });

  test('a login with no Clear account and no invite is refused', async () => {
    const r = await signIn('did:stranger|stranger@example.com');
    expect(r.status).toBe(403);
    expect(r.code).toBe('NO_ACCOUNT');
  });

  test('every request needs a live session of its own', async () => {
    expect((await call(null, 'GET', '/me')).status).toBe(401);
    expect((await call({ user: kai.user }, 'GET', '/me')).body.code).toBe('SESSION_ENDED');
    expect((await call({ user: kai.user, session: second.session }, 'GET', '/me')).status).toBe(401);
    expect((await call(kai, 'GET', '/me')).status).toBe(200);
  });

  test('sign-ins are logged with the device and city; a new device says so', async () => {
    await signIn('did:kai|kai@useclear.org');
    const ppl = (await call(kai, 'GET', '/people')).body.people;
    const me = ppl.find((p: any) => p.email === 'kai@useclear.org');
    expect(me.signIns[0]).toMatchObject({ device: 'Device', city: 'Redlands', newDevice: false });
    expect(me.signIns.at(-1).newDevice).toBe(true);
  });
});

describe('invites', () => {
  test('an invite emails a link; signing in with it binds the login, whatever its email', async () => {
    // Field has Approve on the Field section, so inviting into it needs the second admin
    const r = await call(kai, 'POST', '/invites', { email: 'marcus@useclear.org', name: 'Marcus Lee', title: 'Field', group: 'field' });
    expect(r.status).toBe(202);
    expect((await call(second, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    expect(mail.at(-1)!.to).toBe('marcus@useclear.org');
    const m = await signIn('did:marcus|marcus.personal@example.com', { invite: inviteToken('marcus@useclear.org') });
    expect(m.status).toBe(201);
    expect(m.me.group.key).toBe('field');
    expect(m.me.name).toBe('Marcus Lee');
  });

  test('or by signing in with the invited, verified email', async () => {
    await call(kai, 'POST', '/invites', { email: 'books@ledgerline.co', name: 'Outside accountant', group: 'outside' });
    const r = await signIn('did:books|books@ledgerline.co');
    expect(r.me.group.key).toBe('outside');
  });

  test('an investor gets 30 days from first sign-in, and must accept the terms first', async () => {
    await call(kai, 'POST', '/invites', { email: 'lena@harborcap.com', name: 'Lena Park', group: 'investors' });
    const lena = await signIn('did:lena|lena@harborcap.com');
    expect(lena.me.terms.required).toBe(true);
    expect(new Date(lena.me.expiresAt).getTime() - clock.getTime()).toBe(30 * 86400_000);
    expect((await call(lena, 'GET', '/audit')).body.code).toBe('TERMS_REQUIRED');
    expect((await call(lena, 'POST', '/terms', { version: 'data-room-v1' })).status).toBe(200);
    expect((await call(lena, 'GET', '/audit')).status).toBe(200);
  });

  test('an investor’s page views are logged; anyone else’s are not', async () => {
    const lena = await signIn('did:lena|lena@harborcap.com');
    await call(lena, 'POST', '/views', { route: 'money', pane: 'Bonds' });
    await call(kai, 'POST', '/views', { route: 'money' });
    const v = (await call(kai, 'GET', '/page-views')).body.views;
    expect(v.map((x: any) => x.email)).toEqual(['lena@harborcap.com']);
  });

  test('access ends at the investor’s expiry, and so does the session', async () => {
    const lena = await signIn('did:lena|lena@harborcap.com');
    const at = clock;
    clock = new Date(at.getTime() + 31 * 86400_000);
    expect((await call(lena, 'GET', '/me')).status).toBe(401);
    expect((await signIn('did:lena|lena@harborcap.com')).code).toBe('NO_ACCESS');
    clock = at;
  });
});

/**
 * The matrix: every endpoint, at every level 0–4, through custom access on one person. Reads at the
 * level they need; writes propose at 3 and apply at 4; below that, 403.
 */
describe('permission matrix, levels 0 to 4', () => {
  const ENDPOINTS: Array<{ name: string; section: string; need: number; run: (w: Who, ids: { target: string; invitee: string }) => Promise<{ status: number; body: any }> }> = [
    { name: 'GET /groups', section: 'access', need: 1, run: (w) => call(w, 'GET', '/groups') },
    { name: 'GET /people', section: 'access', need: 1, run: (w) => call(w, 'GET', '/people') },
    { name: 'GET /proposals', section: 'access', need: 2, run: (w) => call(w, 'GET', '/proposals') },
    { name: 'GET /page-views', section: 'access', need: 2, run: (w) => call(w, 'GET', '/page-views') },
    { name: 'GET /audit', section: 'records', need: 2, run: (w) => call(w, 'GET', '/audit') },
    { name: 'POST /invites', section: 'access', need: 3, run: (w) => call(w, 'POST', '/invites', { email: `x${Math.random().toString(36).slice(2)}@example.com`, name: 'X', group: 'board' }) },
    { name: 'PATCH /people/:id/access', section: 'access', need: 3, run: (w, ids) => call(w, 'PATCH', `/people/${ids.target}/access`, { group: 'outside' }) },
    { name: 'POST /groups', section: 'access', need: 3, run: (w) => call(w, 'POST', '/groups', { name: `Group ${Math.random().toString(36).slice(2, 8)}`, levels: all(1) }) },
    { name: 'PATCH /groups/:key', section: 'access', need: 3, run: (w) => call(w, 'PATCH', '/groups/outside', { description: 'Read-only' }) },
    { name: 'POST /invites/:id/resend', section: 'access', need: 4, run: (w, ids) => call(w, 'POST', `/invites/${ids.invitee}/resend`) },
    { name: 'POST /people/:id/sign-out', section: 'access', need: 4, run: (w, ids) => call(w, 'POST', `/people/${ids.target}/sign-out`) },
  ];

  let ids = { target: '', invitee: '' };
  let tester: Who;
  beforeAll(async () => {
    await call(kai, 'POST', '/invites', { email: 'tester@useclear.org', name: 'Tester', group: 'outside' });
    await call(kai, 'POST', '/invites', { email: 'target@useclear.org', name: 'Target', group: 'outside' });
    await call(kai, 'POST', '/invites', { email: 'invitee@useclear.org', name: 'Invitee', group: 'outside' });
    tester = await signIn('did:tester|tester@useclear.org');
    await signIn('did:target|target@useclear.org');
    const ppl = (await call(kai, 'GET', '/people')).body.people;
    ids = { target: ppl.find((p: any) => p.email === 'target@useclear.org').id, invitee: ppl.find((p: any) => p.email === 'invitee@useclear.org').id };
  });

  const setLevels = async (l: Levels) => {
    const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'tester@useclear.org').id;
    const r = await call(kai, 'PATCH', `/people/${id}/access`, { custom: l });
    // Approve on anything needs a second admin: approve it as the other one.
    if (r.status === 202) expect((await call(second, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    else expect(r.status).toBe(200);
    tester = await signIn('did:tester|tester@useclear.org');
  };

  for (const level of [0, 1, 2, 3, 4]) {
    test(`level ${level}`, async () => {
      // level 0 everywhere would leave no access at all: keep Home at 2 so the session stands
      const l = all(level);
      if (level === 0) l.home = 2;
      await setLevels(l);
      for (const e of ENDPOINTS) {
        const have = (l as Record<string, number>)[e.section];
        const r = await e.run(tester, ids);
        const label = `${e.name} at ${have}`;
        if (have < e.need) expect(r.status, label).toBe(403);
        else if (e.need >= 3 && e.name !== 'POST /invites/:id/resend' && e.name !== 'POST /people/:id/sign-out' && have === 3) expect(r.status, label).toBe(202);
        else expect([200, 202], label).toContain(r.status);
        // Totals is co-op numbers only: no names, no emails
        if (e.name === 'GET /people' && have === 1) {
          expect(r.body.people, label).toBeUndefined();
          expect(JSON.stringify(r.body), label).not.toContain('@');
        }
        // the sign-out endpoint ends the target's sessions; sign them back in for the next row
        if (e.name === 'POST /people/:id/sign-out') await signIn('did:target|target@useclear.org');
      }
    });
  }
});

describe('the groups as people get them', () => {
  test('Members, Investors and Field can’t touch Permissions; Admin can', async () => {
    const member = await signIn('did:member|member@example.com');
    const field = await signIn('did:marcus|marcus.personal@example.com');
    await call(kai, 'PATCH', `/people/${(await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'lena@harborcap.com').id}/access`, {
      expiresAt: new Date(clock.getTime() + 60 * 86400_000).toISOString(),
    });
    const investor = await signIn('did:lena|lena@harborcap.com');
    for (const who of [member, field, investor]) {
      expect((await call(who, 'GET', '/people')).status).toBe(403);
      expect((await call(who, 'POST', '/invites', { email: 'y@example.com', name: 'Y', group: 'board' })).status).toBe(403);
      expect((await call(who, 'GET', '/audit')).status).toBe(200); // Records is 2 for all three
    }
    expect((await call(kai, 'GET', '/people')).status).toBe(200);
  });
});

describe('the two-person rule', () => {
  test('giving Approve becomes a proposal, and the proposer can never approve it', async () => {
    const r = await call(kai, 'POST', '/invites', { email: 'dana@useclear.org', name: 'Dana Ruiz', group: 'protocol' });
    expect(r.status).toBe(202);
    expect(r.body.needs).toBe('a second admin');
    const id = r.body.proposal.id;
    const own = await call(kai, 'POST', `/proposals/${id}/approve`);
    expect(own.status).toBe(403);
    expect(own.body.code).toBe('OWN_PROPOSAL');
    expect(mail.some((m) => m.to === 'dana@useclear.org')).toBe(false);
    expect((await call(second, 'POST', `/proposals/${id}/approve`)).status).toBe(200);
    expect(mail.at(-1)!.to).toBe('dana@useclear.org');
    expect((await call(second, 'POST', `/proposals/${id}/approve`)).status).toBe(404);
  });

  test('editing a group with people in it to add Approve waits too', async () => {
    const r = await call(kai, 'PATCH', '/groups/field', { levels: { ...all(2), field: 4, money: 4 } });
    expect(r.status).toBe(202);
    expect((await call(second, 'POST', `/proposals/${r.body.proposal.id}/decline`)).status).toBe(200);
  });
});

describe('turning access off and signing out', () => {
  test('turning someone off ends their sessions at once', async () => {
    const books = await signIn('did:books|books@ledgerline.co');
    const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'books@ledgerline.co').id;
    expect((await call(kai, 'PATCH', `/people/${id}/access`, { off: true })).status).toBe(200);
    expect((await call(books, 'GET', '/me')).status).toBe(401);
    expect((await signIn('did:books|books@ledgerline.co')).code).toBe('NO_ACCESS');
    expect((await call(kai, 'PATCH', `/people/${id}/access`, { off: false })).status).toBe(200);
    expect((await signIn('did:books|books@ledgerline.co')).status).toBe(201);
  });

  test('signing out ends only this session', async () => {
    const a = await signIn('did:kai|kai@useclear.org');
    expect((await call(a, 'DELETE', '/sessions/current')).status).toBe(204);
    expect((await call(a, 'GET', '/me')).status).toBe(401);
    expect((await call(kai, 'GET', '/me')).status).toBe(200);
  });
});

describe('the audit log', () => {
  test('every change wrote a row, with who and where; proposals and approvals say so', async () => {
    const entries = (await call(kai, 'GET', '/audit')).body.entries as any[];
    expect(entries.find((e) => e.action === 'Invite Outside accountant to Outside')).toMatchObject({ who: 'kai@useclear.org', result: 'done', from_where: 'Device · Redlands' });
    expect(entries.filter((e) => e.action === 'Invite Marcus Lee to Field').map((e) => e.result).sort()).toEqual(['approved', 'waiting']);
    expect(entries.filter((e) => e.action === 'Invite Dana Ruiz to Protocol').map((e) => e.result).sort()).toEqual(['approved', 'waiting']);
    expect(entries.find((e) => e.action === 'Invite Dana Ruiz to Protocol' && e.result === 'approved').approver).toBe('second@useclear.org');
  });
});
