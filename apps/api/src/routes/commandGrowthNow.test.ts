import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import type { SiteNow } from '../services/command/siteNow.js';
import { commandRouter } from './command.js';

/*
 * GET /growth/now: Growth's Right now, for anyone who sees Growth at all, from the reader it's given;
 * the reason when the site feed isn't set up, and a 502 when Umami doesn't answer.
 */

let base = '';
let db: Db;
let off: string | null = null;
let down = false;
const NOW: SiteNow = { people: [{ page: '/join', ch: 'Posters' }], mins: Array.from({ length: 30 }, (_, i) => (i === 29 ? 1 : 0)), wk: 2, feed: [], at: 1 };

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
      isMember: async () => false,
      mail: async () => undefined,
      adminEmails: () => ['kai@useclear.org'],
      appUrl: () => 'https://command.test',
      siteNow: {
        off: () => off,
        read: async () => {
          if (down) throw new Error('Umami 503');
          return NOW;
        },
      },
      now: () => new Date('2026-10-29T16:00:00Z'),
    }),
  );
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
});

const call = async (user: string, path: string, session?: string) => {
  const r = await fetch(base + path, { headers: { 'x-test-user': user, ...(session ? { 'x-command-session': session } : {}) } });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};

describe('GET /growth/now', () => {
  let session = '';
  test('needs a session', async () => {
    expect((await call('did:kai|kai@useclear.org', '/growth/now')).status).toBe(401);
    const r = await fetch(base + '/sessions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': 'did:kai|kai@useclear.org' }, body: JSON.stringify({ deviceKey: 'device-kai-00000000', keep: true, method: 'email' }) });
    session = ((await r.json()) as any).session.id;
    expect(session).toBeTruthy();
  });

  test('who is on the site now', async () => {
    const r = await call('did:kai|kai@useclear.org', '/growth/now', session);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(NOW);
  });

  test('the site feed not set up says why; Umami down is a 502', async () => {
    off = 'UMAMI_API_URL and UMAMI_WEBSITE_ID aren’t set';
    expect((await call('did:kai|kai@useclear.org', '/growth/now', session)).body).toEqual({ off });
    off = null;
    down = true;
    const r = await call('did:kai|kai@useclear.org', '/growth/now', session);
    expect([r.status, r.body.code]).toEqual([502, 'SITE_FEED']);
    down = false;
  });
});
