import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { buildLegal } from '../services/command/legal.js';
import { commandRouter } from './command.js';

/*
 * GET /sections/legal: Admin sees clear-agreements' titles and counsel's questions; everyone else with
 * Governance sees the totals only. Made-up rows: the real repo is private and this one public.
 */

const LEGAL = buildLegal({
  repo: 'Sample/agreements',
  sha: 'abc',
  readAt: Date.parse('2026-11-17T12:00:00Z'),
  readme: '## Status\n\n| ID | Agreement | File | Status |\n| --- | --- | --- | --- |\n| MB-01 | Sample agreement | `members/MB-01-sample.md` | Final draft v1.0, awaiting counsel |\n',
  parts: ['## MB-01 Sample agreement\n\n| Note | Gate | Severity | Specialty | Question | Status |\n| --- | --- | --- | --- | --- | --- |\n| 1 | G1 | S1 | Securities | Sample question? | Open |\n'],
  tree: ['members/MB-01-sample.md'],
  research: [],
  specs: [],
  commits: [{ message: 'Sample change (#4)', date: '2026-11-17T00:00:00Z' }],
});

const servers: Record<string, string> = {};
let db: Db;
const serve = (legal?: { off(): string | null; read(): Promise<typeof LEGAL> }) => {
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
      isMember: async () => true,
      mail: async () => undefined,
      adminEmails: () => ['kai@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => new Date('2026-11-17T17:00:00Z'),
      legal,
    }),
  );
  const server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
};
const call = async (base: string, who: { user: string; session?: string }, method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const signIn = async (base: string, user: string) => {
  const r = await call(base, { user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};

beforeAll(async () => {
  ({ db } = await testDb());
  servers.on = serve({ off: () => null, read: async () => LEGAL });
  servers.off = serve({ off: () => 'COMMAND_AGREEMENTS_TOKEN isn’t set', read: async () => LEGAL });
});

describe('Governance → Legal', () => {
  test('Admin gets the titles and questions; anyone else the counts only', async () => {
    const kai = await signIn(servers.on, 'did:kai|kai@useclear.org');
    const a = await call(servers.on, kai, 'GET', '/sections/legal');
    expect(a.status).toBe(200);
    expect(a.body.full).toBe(true);
    expect(a.body.REG[0][1]).toBe('Sample agreement');
    expect(a.body.S1[0][4]).toBe('Sample question?');
    expect(a.body.asOf).toBe('2026-11-17T12:00:00.000Z');

    // a teammate in another group, with Governance
    expect((await call(servers.on, kai, 'POST', '/invites', { email: 'board@useclear.org', name: 'Board', group: 'board' })).status).toBeLessThan(300);
    const board = await signIn(servers.on, 'did:board|board@useclear.org');
    const b = await call(servers.on, board, 'GET', '/sections/legal');
    expect(b.status).toBe(200);
    expect(b.body.full).toBe(false);
    expect(b.body.COUNSEL).toEqual(a.body.COUNSEL);
    const s = JSON.stringify(b.body);
    for (const w of ['Sample agreement', 'Sample question', 'Sample change', 'MB-01-sample']) expect(s).not.toContain(w);
  });

  test('off until its token is set, and says so', async () => {
    const kai = await signIn(servers.off, 'did:kai|kai@useclear.org');
    const r = await call(servers.off, kai, 'GET', '/sections/legal');
    expect(r.status).toBe(200);
    expect(r.body.off).toBe('COMMAND_AGREEMENTS_TOKEN isn’t set');
    expect(r.body.REG).toBeUndefined();
  });
});
