import { describe, expect, mock, test } from 'bun:test';
import express from 'express';
import type { AddressInfo } from 'node:net';

/*
 * The server-side lock against a stand-in for the table: a session idle past six minutes is refused
 * with 423 (never 401, which signs the app out), only Face ID or a new session opens it, and a locked
 * session cannot report itself active.
 */

const table = new Map<string, number>();
const fakePool = {
  query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    const id = String(params[0]);
    if (sql.includes('RETURNING last_active')) {
      if (!table.has(id)) table.set(id, Date.now());
      return { rows: [{ last_active: new Date(table.get(id)!) }] };
    }
    if (sql.includes('GREATEST')) {
      table.set(id, Math.max(table.get(id) ?? 0, Number(params[2])));
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  },
};
mock.module('../../config/postgres.js', () => ({ getPayPool: () => fakePool, getPostgresPool: () => fakePool }));

const { sessionLock, SESSION_LOCK_AFTER_MS } = await import('./sessionLock');
const { sessionOpen, openWhileLocked } = await import('../../middleware/sessionLock');
const { default: sessionRouter } = await import('../../routes/session');

let base = '';
const app = express();
app.use(express.json());
app.use(async (req, res, next) => {
  req.auth = { walletAddress: '0xabc', profileUuid: 'did:alice', sessionId: req.header('x-test-session') || undefined, token: 't' };
  if (await sessionOpen(req, res)) next();
});
app.use('/api/session', sessionRouter);
app.get('/api/credit/x', (_req, res) => res.json({ ok: true }));
app.post('/api/step-up/verify', async (req, res) => {
  // Stands in for a verified Face ID: what routes/stepUp does on success.
  await sessionLock.touch(req.auth!.sessionId!, 'did:alice', true);
  res.json({ ok: true });
});
const server = app.listen(0);
base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const call = async (path: string, session: string, method = 'GET') => {
  const r = await fetch(base + path, { method, headers: { 'x-test-session': session } });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
/** Wind a session's clock back, in the table and in the process's view, as if left idle. */
async function idle(session: string, ms: number) {
  table.set(session, Date.now() - ms);
  await sessionLock.touch(session, 'did:alice', true, Date.now() - ms);
}

describe('the lock, kept by the server', () => {
  test('a new session starts open', async () => {
    expect((await call('/api/credit/x', 's1')).status).toBe(200);
    expect((await call('/api/session', 's1')).body.locked).toBe(false);
  });

  test('idle past the lock, every signed-in request is refused with 423 APP_LOCKED', async () => {
    await idle('s1', SESSION_LOCK_AFTER_MS + 1000);
    const r = await call('/api/credit/x', 's1');
    expect(r.status).toBe(423);
    expect(r.body.code).toBe('APP_LOCKED');
  });

  test('a locked session cannot report itself active', async () => {
    expect((await call('/api/session/active', 's1', 'POST')).status).toBe(423);
    expect((await call('/api/credit/x', 's1')).status).toBe(423);
  });

  test('asking whether it is locked is answered while locked', async () => {
    const r = await call('/api/session', 's1');
    expect(r.status).toBe(200);
    expect(r.body.locked).toBe(true);
  });

  test('Face ID the server verified opens it', async () => {
    expect((await call('/api/step-up/verify', 's1', 'POST')).status).toBe(200);
    expect((await call('/api/credit/x', 's1')).status).toBe(200);
  });

  test('one device locking does not lock another: it is per session', async () => {
    await idle('s1', SESSION_LOCK_AFTER_MS + 1000);
    expect((await call('/api/credit/x', 's2')).status).toBe(200);
    expect((await call('/api/credit/x', 's1')).status).toBe(423);
  });

  test('using the app keeps it open; a report from another instance is found before refusing', async () => {
    await idle('s3', SESSION_LOCK_AFTER_MS - 30_000);
    expect((await call('/api/session/active', 's3', 'POST')).status).toBe(200);
    expect(await sessionLock.locked('s3', 'did:alice', Date.now() + 60_000)).toBe(false);
    // This process thinks it is stale, but the table (another instance) heard from the member.
    await sessionLock.touch('s4', 'did:alice', true, Date.now() - SESSION_LOCK_AFTER_MS - 1000);
    table.set('s4', Date.now());
    expect(await sessionLock.locked('s4', 'did:alice')).toBe(false);
  });

  test('only what it takes to open it again is let through', () => {
    const req = (method: string, originalUrl: string) => ({ method, originalUrl }) as express.Request;
    expect(openWhileLocked(req('POST', '/api/step-up/options'))).toBe(true);
    expect(openWhileLocked(req('POST', '/api/step-up/verify'))).toBe(true);
    expect(openWhileLocked(req('GET', '/api/step-up/status'))).toBe(true);
    expect(openWhileLocked(req('GET', '/api/session'))).toBe(true);
    expect(openWhileLocked(req('POST', '/api/session/active'))).toBe(false);
    expect(openWhileLocked(req('POST', '/api/step-up/register/options'))).toBe(false);
    expect(openWhileLocked(req('DELETE', '/api/step-up'))).toBe(false);
    expect(openWhileLocked(req('GET', '/api/lithic/cards/abc/embed'))).toBe(false);
  });
});

describe('wired through', () => {
  const read = (p: string) => require('node:fs').readFileSync(require('node:path').join(import.meta.dirname, p), 'utf8');
  test('requireAuth checks the lock after it knows the session, and Face ID verify opens it', () => {
    const auth = read('../../middleware/auth.ts');
    expect(auth).toContain('sessionId = claims.sessionId;');
    expect(auth).toMatch(/if \(!\(await sessionOpen\(req, res\)\)\) return;\s*return next\(\);/);
    expect(read('../../routes/stepUp.ts')).toMatch(/await openSession\(req\);\s*return res\.json\(issueStepUpToken\(userId\)\);/);
    expect(read('../../index.ts')).toContain("app.use('/api/session', requireAuth, sessionRouter);");
  });
});
