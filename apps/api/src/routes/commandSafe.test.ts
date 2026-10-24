import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SafeServiceError, safeConfig, type SafeConfig, type SafeReader, type SafeTx } from '../services/command/safe.js';
import { commandRouter } from './command.js';

/*
 * Phase 4a: a person links the wallet they sign with by signing a one-time message, and Command
 * reads the Ops Safe (owners, threshold, the queue and its signatures) without ever holding a key.
 * The Safe here is a stand-in: the chain and the Transaction Service are faked.
 */

let base = '';
let db: Db;
let cfg: SafeConfig | null = null;
const kaiWallet = privateKeyToAccount(generatePrivateKey());
const danaWallet = privateKeyToAccount(generatePrivateKey());
const boardWallet = privateKeyToAccount(generatePrivateKey());
let serviceDown = false;
const tx = (nonce: number, confirmations: string[], executed = false): SafeTx => ({
  safeTxHash: '0x' + String(nonce).padStart(64, '0'),
  nonce,
  to: '0x4172842Ab5B1675a9E7F65B4eAcb2CC3f6b2f1f5',
  value: '0',
  data: '0x',
  method: 'setCap',
  confirmationsRequired: 2,
  confirmations: confirmations.map((owner) => ({ owner: owner as `0x${string}`, at: '2026-10-22T10:00:00Z' })),
  executed,
  executedAt: executed ? '2026-10-21T10:00:00Z' : null,
  submittedAt: '2026-10-22T09:00:00Z',
  proposer: confirmations[0] as `0x${string}`,
});
const reader: SafeReader = {
  info: async () => ({ owners: [kaiWallet.address, danaWallet.address, boardWallet.address], threshold: 2, nonce: 7 }),
  transactions: async (_c, { executed }) => {
    if (serviceDown) throw new SafeServiceError(503, 'The Safe Transaction Service said 503');
    return executed ? [tx(6, [kaiWallet.address, danaWallet.address], true)] : [tx(8, [danaWallet.address]), tx(5, [kaiWallet.address]), tx(7, [])];
  },
};

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
      adminEmails: () => ['kai@useclear.org', 'dana@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => new Date('2026-10-23T17:00:00Z'),
      safe: { config: () => cfg, reader },
    }),
  );
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
});

type Who = { user: string; session?: string };
const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const signIn = async (user: string): Promise<Who> => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const link = async (who: Who, wallet: ReturnType<typeof privateKeyToAccount>) => {
  const ch = (await call(who, 'POST', '/me/wallet/challenge')).body;
  return { ch, r: await call(who, 'POST', '/me/wallet', { id: ch.id, address: wallet.address, signature: await wallet.signMessage({ message: ch.message }) }) };
};

let kai: Who, dana: Who;
beforeAll(async () => {
  kai = await signIn('did:kai|kai@useclear.org');
  dana = await signIn('did:dana|dana@useclear.org');
});

describe('linking the wallet you sign with', () => {
  test('a signature over the one-time message links it; the code can’t be used twice', async () => {
    const { ch, r } = await link(kai, kaiWallet);
    expect(r.status).toBe(200);
    expect(r.body.wallet).toBe(kaiWallet.address.toLowerCase());
    expect((await call(kai, 'GET', '/me')).body.me.wallet).toBe(kaiWallet.address.toLowerCase());
    const again = await call(kai, 'POST', '/me/wallet', { id: ch.id, address: kaiWallet.address, signature: await kaiWallet.signMessage({ message: ch.message }) });
    expect(again.body.code).toBe('BAD_CHALLENGE');
  });

  test('a signature from another wallet doesn’t link this one', async () => {
    const ch = (await call(dana, 'POST', '/me/wallet/challenge')).body;
    const r = await call(dana, 'POST', '/me/wallet', { id: ch.id, address: danaWallet.address, signature: await boardWallet.signMessage({ message: ch.message }) });
    expect(r.body.code).toBe('BAD_SIGNATURE');
  });

  test('one wallet, one person', async () => {
    const ch = (await call(dana, 'POST', '/me/wallet/challenge')).body;
    const r = await call(dana, 'POST', '/me/wallet', { id: ch.id, address: kaiWallet.address, signature: await kaiWallet.signMessage({ message: ch.message }) });
    expect(r.status).toBe(409);
    expect((await link(dana, danaWallet)).r.status).toBe(200);
  });
});

describe('reading the Ops Safe', () => {
  test('without one configured, it says so', async () => {
    cfg = null;
    expect((await call(kai, 'GET', '/safe')).body).toEqual({ configured: false });
  });

  test('owners are matched to people by their linked wallets; the queue starts at the next nonce', async () => {
    cfg = safeConfig({ COMMAND_SAFE_ADDRESS: '0x000000000000000000000000000000000000dEaD' });
    const r = await call(kai, 'GET', '/safe');
    expect(r.status).toBe(200);
    expect([r.body.threshold, r.body.nonce]).toEqual([2, 7]);
    expect(r.body.owners.map((o: any) => [o.person?.name ?? null, o.you])).toEqual([
      ['kai@useclear.org', true],
      ['dana@useclear.org', false],
      [null, false],
    ]);
    // nonce 5 was already used on chain: it's stale, not waiting
    expect(r.body.pending.map((t: any) => t.nonce)).toEqual([7, 8]);
    expect(r.body.executed[0].confirmations).toHaveLength(2);
    expect(r.body.link).toBe('https://app.safe.global/transactions/queue?safe=basesep:0x000000000000000000000000000000000000dEaD');
  });

  test('a service that’s down is reported, not hidden', async () => {
    serviceDown = true;
    const r = await call(kai, 'GET', '/safe');
    expect([r.status, r.body.code]).toEqual([502, 'SAFE_SERVICE']);
    serviceDown = false;
  });

  test('the config comes from env and nowhere else', () => {
    expect(safeConfig({})).toBeNull();
    expect(safeConfig({ COMMAND_SAFE_ADDRESS: 'not-an-address' })).toBeNull();
    const c = safeConfig({ COMMAND_SAFE_ADDRESS: '0x000000000000000000000000000000000000dead', SAFE_TX_SERVICE_URL: 'https://safe.example/', SAFE_API_KEY: ' k ' })!;
    expect([c.address, c.serviceUrl, c.apiKey, c.chainId]).toEqual(['0x000000000000000000000000000000000000dEaD', 'https://safe.example', 'k', 84532]);
  });
});
