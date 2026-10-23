import { beforeAll, describe, expect, test } from 'bun:test';
import { MEMBERS_FIGURES, mask } from '@clear/command-types';
import fixture from '@clear/command-types/src/fixtures/members.json';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import { seedCommand } from '../services/command/seed.js';
import { commandRouter } from './command.js';

/*
 * Phase 3: a seeded database serves each section exactly as the prototype draws it, and decides on
 * the server what each level gets to see. The prototype's own rows (the fixture) are the answer key.
 */

let base = '';
let db: Db;

beforeAll(async () => {
  ({ db } = await testDb());
  const identify = (req: Request, res: Response, next: NextFunction) => {
    const [id, email] = String(req.header('x-test-user') ?? '').split('|');
    if (!id) return res.status(401).end();
    req.auth = { walletAddress: '', profileUuid: id, email, emails: email ? [email] : [], token: 't' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/command',
    commandRouter({
      db: async () => db,
      identify,
      isMember: async (a) => a.profileUuid === 'did:member',
      mail: async () => undefined,
      adminEmails: () => ['kai@useclear.org', 'second@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => new Date('2026-10-23T17:00:00Z'),
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
});

const call = async (who: { user: string; session?: string }, method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const signIn = async (user: string) => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;

describe('the seed', () => {
  test('loads the prototype’s 300 members, 13 batches and the Members figures, once', async () => {
    const first = await seedCommand(db);
    expect(first).toContain('300 members');
    expect(first).toContain('13 batches');
    expect(await seedCommand(db)).toEqual([]);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM command.figures WHERE key LIKE 'members.%'`);
    expect(rows[0].n).toBe(Object.keys(MEMBERS_FIGURES).length);
  });

  test('never overwrites a figure a live job wrote', async () => {
    await db.query(`UPDATE command.figures SET value = '1501', source = 'live:members' WHERE key = 'members.waitlist.total'`);
    await seedCommand(db);
    expect((await db.query<{ value: number }>(`SELECT value FROM command.figures WHERE key = 'members.waitlist.total'`)).rows[0].value).toBe(1501);
    await db.query(`UPDATE command.figures SET value = '1500', source = 'seed' WHERE key = 'members.waitlist.total'`);
  });
});

describe('Members, as each level gets it', () => {
  let kai: { user: string; session: string };
  beforeAll(async () => {
    kai = await signIn('did:kai|kai@useclear.org');
  });

  test('names in full, when asked for, are the prototype’s rows exactly, and the asking is logged', async () => {
    const r = await call(kai, 'GET', '/sections/members?reveal=1');
    expect(r.status).toBe(200);
    expect(r.body.names).toBe('shown');
    expect(r.body.MEMBERS).toEqual(fixture.members);
    expect(r.body.BATCH_DATE).toEqual(fixture.batches.map((b) => b.sentAt));
    expect(r.body.B_ACT).toEqual(fixture.check.B_ACT);
    expect(r.body.B_OPEN).toEqual(fixture.check.B_OPEN);
    expect(r.body.NEXT_BATCH).toEqual(fixture.proposed);
    expect(r.body.figures).toEqual(JSON.parse(JSON.stringify(MEMBERS_FIGURES)));
    const log = (await call(kai, 'GET', '/audit')).body.entries;
    expect(log[0]).toMatchObject({ action: 'Showed member names', area: 'members', detail: '300 members' });
  });

  test('otherwise names leave the server masked, the way the page masks them', async () => {
    const r = await call(kai, 'GET', '/sections/members');
    expect(r.body.names).toBe('masked');
    expect(r.body.MEMBERS[0].first).toBe(mask(fixture.members[0].first));
    expect(r.body.MEMBERS.every((m: any) => m.first.includes('•') && m.last.includes('•'))).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(fixture.members[0].first + '"');
  });

  test('Totals gets no names, numbers, posters or dates; asking for names changes nothing', async () => {
    const totals = all(2);
    totals.members = 1;
    const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'kai@useclear.org');
    expect(id).toBeTruthy();
    // a second person with Totals on Members
    await call(kai, 'POST', '/invites', { email: 'totals@useclear.org', name: 'Totals', group: 'outside' });
    const t = await signIn('did:totals|totals@useclear.org');
    const tid = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'totals@useclear.org').id;
    expect((await call(kai, 'PATCH', `/people/${tid}/access`, { custom: totals })).status).toBe(200);
    for (const q of ['', '?reveal=1']) {
      const r = await call(t, 'GET', `/sections/members${q}`);
      expect(r.status).toBe(200);
      expect(r.body.names).toBe('none');
      for (const m of r.body.MEMBERS) {
        expect(m.first).toBeNull();
        expect(m.last).toBeNull();
        expect(m.no).toBe('');
        expect(m.poster).toBeNull();
        expect(m.joined).toBe(0);
        expect(m.opened).toBeUndefined();
      }
      // the charts still count right
      expect(r.body.B_ACT).toEqual(fixture.check.B_ACT);
      expect(r.body.MEMBERS.filter((m: any) => m.status === 'active').length).toBe(124);
    }
    const names = fixture.members.map((m) => m.first);
    const body = JSON.stringify((await call(t, 'GET', '/sections/members')).body);
    expect(names.some((n) => body.includes(`"${n}"`))).toBe(false);
  });

  test('None is refused', async () => {
    const member = await signIn('did:member|member@example.com');
    expect((await call(member, 'GET', '/sections/members')).status).toBe(403);
  });
});
