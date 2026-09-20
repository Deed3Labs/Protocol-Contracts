import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { createHash, generateKeyPairSync, sign as signWith, type KeyObject } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';

/*
 * Server-verified Face ID, end to end: a software authenticator (a P-256 key standing in for the
 * phone's secure enclave) registers, proves, and the guard lets through only a request carrying the
 * token that proof handed out. The database is an in-memory stand-in; everything else is real.
 */

process.env.STEP_UP_SECRET = 'test-step-up-secret';

type Cred = { credentialId: string; userId: string; rpId: string; publicKey: Uint8Array<ArrayBuffer>; counter: number; transports: string[] };
const rows: Cred[] = [];
mock.module('../services/stepUp/stepUpStore.js', () => ({
  stepUpStore: {
    available: () => true,
    listFor: async (u: string) => rows.filter((r) => r.userId === u),
    enrolled: async (u: string) => rows.some((r) => r.userId === u),
    add: async (c: Cred) => void rows.push(c),
    markUsed: async (id: string, counter: number) => {
      const r = rows.find((x) => x.credentialId === id);
      if (r) r.counter = counter;
    },
    removeAll: async (u: string) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].userId === u) rows.splice(i, 1);
      return before - rows.length;
    },
  },
}));

const { default: stepUpRouter } = await import('./stepUp');
const { requireStepUp, requireStepUpWhen } = await import('../middleware/stepUp');

const ORIGIN = 'https://demo.useclear.org';
/** Ours live on the registrable domain, apart from Privy's sign-in passkeys on the page's host. */
const RP_ID = 'useclear.org';
const HOST_RP_ID = 'demo.useclear.org';
const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');

// --- a minimal CBOR encoder: enough for a 'none' attestation and an EC2 COSE key -------------------
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) =>
    n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (v instanceof Map) {
    const parts: Buffer[] = [head(5, v.size)];
    for (const [k, val] of v) parts.push(cbor(k), cbor(val));
    return Buffer.concat(parts);
  }
  throw new Error('unsupported');
}

class SoftAuthenticator {
  readonly id = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  private key: KeyObject;
  private pub: KeyObject;
  private count = 0;
  constructor(private rpId = RP_ID) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = pair.privateKey;
    this.pub = pair.publicKey;
  }
  private authData(flags: number, attested?: Buffer): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.count);
    return Buffer.concat([createHash('sha256').update(this.rpId).digest(), Buffer.from([flags]), counter, attested ?? Buffer.alloc(0)]);
  }
  /** The public key as the authenticator hands it over, for standing a credential up directly. */
  coseKey(): Uint8Array<ArrayBuffer> {
    const jwk = this.pub.export({ format: 'jwk' }) as { x: string; y: string };
    return Uint8Array.from(
      cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]])),
    );
  }
  register(challenge: string, origin = ORIGIN) {
    const cose = Buffer.from(this.coseKey());
    const idLen = Buffer.from([0, this.id.length]);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.id, cose]);
    // UP | UV | AT
    const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(0x45, attested)]]));
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }));
    return {
      id: b64u(this.id),
      rawId: b64u(this.id),
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] },
    };
  }
  prove(challenge: string, origin = ORIGIN) {
    const authenticatorData = this.authData(0x05);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
    const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
    const signature = signWith('sha256', signed, this.key);
    return {
      id: b64u(this.id),
      rawId: b64u(this.id),
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature) },
    };
  }
}

// --- the app: the real router and guard behind a stand-in for requireAuth -----------------------------
let base = '';
beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.header('x-test-user');
    if (user) req.auth = { walletAddress: '0xabc', profileUuid: user, token: 't' };
    next();
  });
  app.use('/api/step-up', stepUpRouter);
  app.get('/guarded', requireStepUp, (_req, res) => res.json({ ok: true }));
  app.post('/freeze', requireStepUpWhen((req) => req.body?.frozen === false), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

async function call(path: string, user: string, init: { method?: string; body?: unknown; token?: string; origin?: string } = {}) {
  const r = await fetch(base + path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      'x-test-user': user,
      origin: init.origin ?? ORIGIN,
      ...(init.token ? { 'x-step-up': init.token } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

async function register(user: string, device: SoftAuthenticator, token?: string) {
  const opts = await call('/api/step-up/register/options', user, { method: 'POST', token });
  if (opts.status !== 200) return opts;
  return call('/api/step-up/register/verify', user, { body: { response: device.register(opts.body.options.challenge) } });
}

async function prove(user: string, device: SoftAuthenticator) {
  const opts = await call('/api/step-up/options', user, { method: 'POST' });
  return call('/api/step-up/verify', user, { body: { response: device.prove(opts.body.options.challenge) } });
}

describe('server-verified Face ID', () => {
  const phone = new SoftAuthenticator();

  test('a member with no credential is not blocked -- as in the app', async () => {
    expect((await call('/guarded', 'did:alice')).status).toBe(200);
    expect((await call('/api/step-up/status', 'did:alice')).body.enrolled).toBe(false);
  });

  test('the first device registers on the session alone, and that counts as a check', async () => {
    const r = await register('did:alice', phone);
    expect(r.status).toBe(200);
    expect(r.body.enrolled).toBe(true);
    expect(typeof r.body.token).toBe('string');
    expect((await call('/api/step-up/status', 'did:alice')).body.enrolled).toBe(true);
  });

  test('once registered, a guarded request without a token is refused', async () => {
    const r = await call('/guarded', 'did:alice');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('STEP_UP_REQUIRED');
  });

  test('Face ID the server verified hands out a token the guard accepts', async () => {
    const r = await prove('did:alice', phone);
    expect(r.status).toBe(200);
    expect((await call('/guarded', 'did:alice', { token: r.body.token })).status).toBe(200);
  });

  test('a made-up token, or another member\'s, is refused', async () => {
    const mine = (await prove('did:alice', phone)).body.token as string;
    expect((await call('/guarded', 'did:alice', { token: mine.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) })).status).toBe(403);
    rows.push({ ...rows[0], userId: 'did:bob', credentialId: 'bob-cred' });
    expect((await call('/guarded', 'did:bob', { token: mine })).status).toBe(403);
    rows.pop();
  });

  test('a signature from a key the server does not hold is refused', async () => {
    const opts = await call('/api/step-up/options', 'did:alice', { method: 'POST' });
    const stranger = new SoftAuthenticator();
    for (let i = 0; i < 20; i++) stranger.prove('x'); // past the stored counter, so only the signature can fail
    const forged = stranger.prove(opts.body.options.challenge);
    forged.id = forged.rawId = rows[0].credentialId; // claims to be the registered credential
    expect((await call('/api/step-up/verify', 'did:alice', { body: { response: forged } })).status).toBe(400);
  });

  test('a challenge answers once; a replay is refused', async () => {
    const opts = await call('/api/step-up/options', 'did:alice', { method: 'POST' });
    const response = phone.prove(opts.body.options.challenge);
    expect((await call('/api/step-up/verify', 'did:alice', { body: { response } })).status).toBe(200);
    expect((await call('/api/step-up/verify', 'did:alice', { body: { response } })).status).toBe(400);
  });

  test('a challenge issued to one member cannot be answered for another', async () => {
    const opts = await call('/api/step-up/options', 'did:alice', { method: 'POST' });
    const r = await call('/api/step-up/register/verify', 'did:mallory', { body: { response: new SoftAuthenticator().register(opts.body.options.challenge) } });
    expect(r.status).toBe(400);
  });

  test('another site cannot use it, and a signature made for another origin is refused', async () => {
    expect((await call('/api/step-up/options', 'did:alice', { method: 'POST', origin: 'https://evil.example' })).status).toBe(400);
    const opts = await call('/api/step-up/options', 'did:alice', { method: 'POST' });
    const r = await call('/api/step-up/verify', 'did:alice', { body: { response: phone.prove(opts.body.options.challenge, 'https://evil.example') } });
    expect(r.status).toBe(400);
  });

  test('adding a second device takes Face ID from the first', async () => {
    const laptop = new SoftAuthenticator();
    expect((await register('did:alice', laptop)).status).toBe(403);
    const token = (await prove('did:alice', phone)).body.token;
    expect((await register('did:alice', laptop, token)).status).toBe(200);
  });

  test('a credential registered here belongs to the registrable domain, not the page\'s host', () => {
    expect(rows.every((r) => r.rpId === RP_ID)).toBe(true);
  });

  test('a credential from before that move, on the page\'s host, still opens it', async () => {
    const older = new SoftAuthenticator(HOST_RP_ID);
    rows.push({
      credentialId: b64u(older.id),
      userId: 'did:carol',
      rpId: HOST_RP_ID,
      publicKey: older.coseKey(),
      counter: 0,
      transports: ['internal'],
    });
    const opts = await call('/api/step-up/options', 'did:carol', { method: 'POST' });
    expect(opts.body.options.rpId).toBe(HOST_RP_ID);
    const proved = await call('/api/step-up/verify', 'did:carol', { body: { response: older.prove(opts.body.options.challenge) } });
    expect(proved.status).toBe(200);
    expect((await call('/guarded', 'did:carol', { token: proved.body.token })).status).toBe(200);
  });

  test('freezing is one tap; unfreezing needs the token', async () => {
    expect((await call('/freeze', 'did:alice', { body: { frozen: true } })).status).toBe(200);
    expect((await call('/freeze', 'did:alice', { body: { frozen: false } })).status).toBe(403);
    const token = (await prove('did:alice', phone)).body.token;
    expect((await call('/freeze', 'did:alice', { body: { frozen: false }, token })).status).toBe(200);
  });

  test('turning it off takes Face ID too, and afterwards nothing is asked', async () => {
    expect((await call('/api/step-up', 'did:alice', { method: 'DELETE' })).status).toBe(403);
    const token = (await prove('did:alice', phone)).body.token;
    expect((await call('/api/step-up', 'did:alice', { method: 'DELETE', token })).body.removed).toBe(2);
    expect((await call('/guarded', 'did:alice')).status).toBe(200);
  });
});

describe('the requests that need it', () => {
  const read = (p: string) => require('node:fs').readFileSync(require('node:path').join(import.meta.dirname, p), 'utf8');
  test('card numbers, PIN, unfreeze, limits, disputes, bills, withdrawals and autopay are guarded', () => {
    const cards = read('lithicCards.ts');
    expect(cards).toContain("router.post('/:token/freeze', requireStepUpWhen((req) => req.body?.frozen === false), async");
    expect(cards).toContain("router.post('/:token/spend-limit', requireStepUp, async");
    expect(cards).toContain("router.get('/:token/embed', requireStepUp, async");
    expect(cards).toContain("router.get('/:token/embed-session', requireStepUp, async");
    expect(read('disputes.ts')).toContain("disputesRouter.post('/', requireStepUp, async");
    expect(read('pay.ts')).toContain("router.post('/:wallet/pay', requireStepUp, async");
    expect(read('pay.ts')).toContain("router.post('/:wallet/billers/:id/payout', requireStepUp, async");
    expect(read('withdraw.ts')).toContain("router.post('/:wallet', requireStepUp, async");
    expect(read('autopay.ts')).toContain("router.post('/:wallet', requireStepUp, async");
    expect(read('autopay.ts')).toContain("router.post('/:wallet/:id/run', requireStepUp, async");
  });
  test('the header is allowed through CORS, and the routes are behind the session', () => {
    const index = read('../index.ts');
    expect(index).toContain("'X-Step-Up',");
    expect(index).toContain("app.use('/api/step-up', requireAuth, stepUpRouter);");
  });
});
