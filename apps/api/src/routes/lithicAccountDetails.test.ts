import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/*
 * Spendable's account details: the masked read never carries the full number, the full number needs
 * re-authentication (a fresh Face ID, or without Face ID a sign-in made minutes ago), and neither may
 * be cached.
 *
 * The real router and the real step-up guard, behind a stand-in for requireAuth. Lithic, the account
 * table and the Face ID credential table are stood in for, and only while these tests run: outside
 * them each stand-in hands straight back to the real module, so nothing leaks into other files.
 */

process.env.STEP_UP_SECRET = 'test-step-up-secret';

const FULL = '000123454192';
const ROUTING = '084106768';
const WALLET = '0xabc0000000000000000000000000000000000001';
const UNBANKED = '0xabc0000000000000000000000000000000000002';

let active = false;
/** Members with a server-held Face ID credential. */
const enrolled = new Set<string>();
/** Sessions that began in the last ten minutes (a sign-in just made, with a code). */
const freshSessions = new Set<string>();
/** Whether the server can read sessions at all (its database is up). */
let sessionsReadable = true;
const lithicCalls: string[] = [];

const realClient = await import('../services/lithic/lithicClient.js');
const fakeLithic = {
  financialAccounts: {
    retrieve: async (token: string) => {
      lithicCalls.push(`financialAccounts.retrieve:${token}`);
      return { token, type: 'OPERATING', routing_number: ROUTING, account_number: FULL };
    },
    // What GET /account reads, through provisioningService.
    list: async function* () {
      yield { token: 'fa_cash', type: 'OPERATING', nickname: null, routing_number: ROUTING, account_number: FULL };
    },
  },
  accountHolders: {
    retrieve: async (token: string) => {
      lithicCalls.push(`accountHolders.retrieve:${token}`);
      return { token, individual: { first_name: 'Ada', last_name: 'Lovelace' } };
    },
  },
};
mock.module('../services/lithic/lithicClient.js', () => ({
  ...realClient,
  isConfigured: () => active || realClient.isConfigured(),
  requireLithic: () => (active ? fakeLithic : realClient.requireLithic()),
}));

const realStore = await import('../services/lithic/lithicStore.js');
mock.module('../services/lithic/lithicStore.js', () => ({
  ...realStore,
  lithicStore: {
    ...realStore.lithicStore,
    isConfigured: () => active || realStore.lithicStore.isConfigured(),
    get: async (wallet: string) => {
      if (!active) return realStore.lithicStore.get(wallet);
      if (wallet !== WALLET) return null;
      return {
        wallet,
        accountHolderToken: 'ah_1',
        accountToken: 'acct_1',
        issuingFinancialAccountToken: 'fa_issuing',
        cashFinancialAccountToken: 'fa_cash',
        status: 'ACCEPTED',
        statusReasons: [],
        createdAt: '',
        updatedAt: '',
      };
    },
  },
}));

const realStepUpStore = await import('../services/stepUp/stepUpStore.js');
mock.module('../services/stepUp/stepUpStore.js', () => ({
  ...realStepUpStore,
  stepUpStore: {
    ...realStepUpStore.stepUpStore,
    available: () => active || realStepUpStore.stepUpStore.available(),
    enrolled: async (userId: string) => (active ? enrolled.has(userId) : realStepUpStore.stepUpStore.enrolled(userId)),
  },
}));

const realSessionLock = await import('../services/session/sessionLock.js');
mock.module('../services/session/sessionLock.js', () => ({
  ...realSessionLock,
  sessionLock: {
    ...realSessionLock.sessionLock,
    available: () => (active ? sessionsReadable : realSessionLock.sessionLock.available()),
    freshSignIn: async (sessionId: string, now?: number) =>
      active ? freshSessions.has(sessionId) : realSessionLock.sessionLock.freshSignIn(sessionId, now),
  },
}));

const { default: lithicRouter } = await import('./lithic');
const { issueStepUpToken } = await import('../services/stepUp/stepUpToken.js');

let base = '';
let server: Server;
const logged: string[] = [];
const originalError = console.error;
const originalLog = console.log;
const originalWarn = console.warn;

beforeAll(() => {
  active = true;
  delete process.env.LITHIC_PARTNER_BANK_NAME;
  const capture = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  console.error = capture;
  console.log = capture;
  console.warn = capture;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.header('x-test-user');
    const wallet = req.header('x-test-wallet') || WALLET;
    // Every member signs in with an email by default; 'none' is one with neither email nor phone.
    const login = req.header('x-test-login') || 'email';
    const contact = login === 'email' ? { email: 'ada@example.com' } : login === 'phone' ? { phone: '+15555550100' } : {};
    if (user) req.auth = { walletAddress: wallet, profileUuid: user, sessionId: `session:${user}`, token: 't', ...contact };
    next();
  });
  app.use('/api/lithic', lithicRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  active = false;
  console.error = originalError;
  console.log = originalLog;
  console.warn = originalWarn;
  server?.close();
});

beforeEach(() => {
  enrolled.clear();
  freshSessions.clear();
  sessionsReadable = true;
  lithicCalls.length = 0;
  delete process.env.LITHIC_PARTNER_BANK_NAME;
});

async function call(path: string, user: string, init: { token?: string; wallet?: string; login?: 'email' | 'phone' | 'none' } = {}) {
  const r = await fetch(base + path, {
    headers: {
      'x-test-user': user,
      ...(init.wallet ? { 'x-test-wallet': init.wallet } : {}),
      ...(init.login ? { 'x-test-login': init.login } : {}),
      ...(init.token ? { 'x-step-up': init.token } : {}),
    },
  });
  const text = await r.text();
  return { status: r.status, cache: r.headers.get('cache-control'), text, body: JSON.parse(text) as Record<string, any> };
}

describe('GET /api/lithic/account-details: masked', () => {
  test('holder, bank, routing number, last four and type, read from Lithic now', async () => {
    process.env.LITHIC_PARTNER_BANK_NAME = 'Example Partner Bank';
    const r = await call('/api/lithic/account-details', 'did:ada');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      configured: true,
      details: {
        holderName: 'Ada Lovelace',
        bankName: 'Example Partner Bank',
        routingNumber: ROUTING,
        accountNumberLast4: '4192',
        accountType: 'Checking',
      },
    });
    // Lithic's account details endpoint, for this member's own cash account.
    expect(lithicCalls).toContain('financialAccounts.retrieve:fa_cash');
  });

  test('never carries the full account number, anywhere in the body', async () => {
    const r = await call('/api/lithic/account-details', 'did:ada');
    expect(r.text).not.toContain(FULL);
    expect(r.text).not.toContain(FULL.slice(0, -4));
  });

  test('sends no-store', async () => {
    expect((await call('/api/lithic/account-details', 'did:ada')).cache).toBe('no-store');
  });

  test('unset, the bank reads "Lithic partner bank": Lithic uses several partner banks (owner decision)', async () => {
    const r = await call('/api/lithic/account-details', 'did:ada');
    expect(r.body.details.bankName).toBe('Lithic partner bank');
  });

  test('needs no Face ID, even for an enrolled member', async () => {
    enrolled.add('did:ada');
    expect((await call('/api/lithic/account-details', 'did:ada')).status).toBe(200);
  });

  test('a member with no cash account gets nothing to show, not somebody else\'s', async () => {
    const r = await call('/api/lithic/account-details', 'did:bob', { wallet: UNBANKED });
    expect(r.status).toBe(200);
    expect(r.body.details).toBeNull();
    expect(r.cache).toBe('no-store');
  });
});

describe('GET /api/lithic/account-details/account-number: behind step-up', () => {
  test('an enrolled member without a fresh Face ID is refused, with no-store', async () => {
    enrolled.add('did:ada');
    const r = await call('/api/lithic/account-details/account-number', 'did:ada');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('STEP_UP_REQUIRED');
    expect(r.text).not.toContain(FULL);
    expect(r.cache).toBe('no-store');
    // Refused before Lithic is asked.
    expect(lithicCalls).toEqual([]);
  });

  test('another member\'s token does not count', async () => {
    enrolled.add('did:ada');
    const r = await call('/api/lithic/account-details/account-number', 'did:ada', { token: issueStepUpToken('did:eve').token });
    expect(r.status).toBe(403);
    expect(r.text).not.toContain(FULL);
  });

  test('with a fresh Face ID, the full number, with no-store', async () => {
    enrolled.add('did:ada');
    const r = await call('/api/lithic/account-details/account-number', 'did:ada', { token: issueStepUpToken('did:ada').token });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ accountNumber: FULL });
    expect(r.cache).toBe('no-store');
  });

  test('signed out is refused by the guard', async () => {
    const r = await fetch(`${base}/api/lithic/account-details/account-number`);
    expect(r.status).toBe(401);
  });

  test('no cash account is a 404, not an empty number', async () => {
    freshSessions.add('session:did:bob');
    const r = await call('/api/lithic/account-details/account-number', 'did:bob', { wallet: UNBANKED });
    expect(r.status).toBe(404);
  });

  test('an enrolled member needs Face ID even just after signing in', async () => {
    enrolled.add('did:ada');
    freshSessions.add('session:did:ada');
    const r = await call('/api/lithic/account-details/account-number', 'did:ada');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('STEP_UP_REQUIRED');
    expect(r.text).not.toContain(FULL);
  });
});

describe('without Face ID: re-authentication by a fresh sign-in, never skipped', () => {
  const PATH = '/api/lithic/account-details/account-number';

  test('the session alone is refused (REAUTH_REQUIRED), with no-store and before Lithic is asked', async () => {
    const r = await call(PATH, 'did:ada');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('REAUTH_REQUIRED');
    expect(r.body.error).toContain('sign in again with the code');
    expect(r.text).not.toContain(FULL);
    expect(r.cache).toBe('no-store');
    expect(lithicCalls).toEqual([]);
  });

  test('a sign-in made in the last ten minutes (a code to their email) shows the full number', async () => {
    freshSessions.add('session:did:ada');
    const r = await call(PATH, 'did:ada');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ accountNumber: FULL });
    expect(r.cache).toBe('no-store');
  });

  test('the same for a member who signs in with a phone code', async () => {
    freshSessions.add('session:did:ada');
    expect((await call(PATH, 'did:ada', { login: 'phone' })).status).toBe(200);
    freshSessions.clear();
    expect((await call(PATH, 'did:ada', { login: 'phone' })).body.code).toBe('REAUTH_REQUIRED');
  });

  test('a step-up token is no way round it for a member without Face ID', async () => {
    const r = await call(PATH, 'did:ada', { token: issueStepUpToken('did:ada').token });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('REAUTH_REQUIRED');
  });

  test('no Face ID and nowhere to send a code: refused, and told how to set Face ID up', async () => {
    freshSessions.add('session:did:ada');
    const r = await call(PATH, 'did:ada', { login: 'none' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('STEP_UP_UNAVAILABLE');
    expect(r.body.error).toContain('turn on Face ID in Settings › Security');
    expect(r.text).not.toContain(FULL);
    expect(lithicCalls).toEqual([]);
  });

  test('when the server cannot check, it refuses rather than letting the session through', async () => {
    sessionsReadable = false;
    freshSessions.add('session:did:ada');
    const r = await call(PATH, 'did:ada');
    expect(r.status).toBe(503);
    expect(r.text).not.toContain(FULL);
    expect(lithicCalls).toEqual([]);
  });
});

describe('the full number stays out of other places', () => {
  test('GET /api/lithic/account sends only the last four now, with no-store', async () => {
    const r = await call('/api/lithic/account', 'did:ada');
    expect(r.status).toBe(200);
    expect(r.body.deposit).toEqual({ routingNumber: ROUTING, accountNumberLast4: '4192', accountType: 'OPERATING' });
    expect(r.text).not.toContain(FULL);
    expect(r.cache).toBe('no-store');
  });

  test('nothing above was logged with the number in it', () => {
    expect(logged.join('\n')).not.toContain(FULL);
  });

  test('the service stores nothing and logs nothing', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const service = readFileSync(join(import.meta.dirname, '../services/lithic/accountDetailsService.ts'), 'utf8');
    expect(service).not.toMatch(/console\./);
    expect(service).not.toMatch(/upsert|INSERT|UPDATE\s|redis|cache\.set/i);
  });
});
