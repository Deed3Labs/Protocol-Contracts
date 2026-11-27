import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { getAddress, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import type { SafeReader, SafeTx } from '../services/command/safe.js';
import { SAFE_TX_TYPES, type SafeTxData } from '../services/command/safeTx.js';
import { seedCommand } from '../services/command/seed.js';
import type { Signing } from '../services/command/signing.js';
import type { SigningLive } from '../services/command/signingStatus.js';
import { commandRouter } from './command.js';

/*
 * Build → Signing: a ready Safe step of the committed plan goes into its own Safe's queue from Command. An owner's
 * wallet signs exactly the step's call at the Safe's next nonce; Command checks the signer is one of that Safe's
 * owners before the Transaction Service sees it, and a further owner signs the queued copy only when it is still
 * exactly the step's call. The service here is a stand-in that keeps what it's sent.
 */

let base = '';
let db: Db;
const owner1 = privateKeyToAccount(generatePrivateKey());
const owner2 = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const SAFE = getAddress('0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50');
const TL = getAddress('0x0000000000000000000000000000000000000071');

const step = (id: string, o: Record<string, unknown> = {}) => ({ id, stage: 'Day 7', title: `Run ${id}`, kind: 'safe', signer: SAFE, to: TL, value: '0', data: `0x1234${id.length.toString(16).padStart(2, '0')}`, status: 'ready', ...o });
const steps = [step('SAx'), step('WAIT'), step('W1', { kind: 'wallet', signer: owner1.address }), step('NULL', { data: null })];
const live: SigningLive = {
  stepsSha256: 'x',
  checkedAt: 0,
  nextCheckAt: 0,
  block: 1,
  blockTime: 1,
  safes: {},
  steps: { SAx: { status: 'ready', by: 'dry-run' }, WAIT: { status: 'waiting', why: 'The timelock’s 7 days end later.', by: 'timelock' }, W1: { status: 'ready', by: 'dry-run' }, NULL: { status: 'waiting', by: 'plan' } },
};
let forgotten = 0;
const signing = {
  read: async (): Promise<Signing> => ({ source: 'plan', plan: { format: 'clear-signing-plan/1', generatedAt: '', network: 'base-sepolia', chainId: 84532, block: 1, blockTime: '', stepsSha256: 'x', notes: [], steps }, readAt: 0, live }),
  checkNow: async (): Promise<Signing> => ({ source: 'plan', plan: null, readAt: 0, live }),
  forget: () => void forgotten++,
};

// the stand-in Transaction Service
const queue = new Map<string, { tx: SafeTxData; confirmations: Array<{ owner: Address; at: string }> }>();
const asTx = (h: string, q: { tx: SafeTxData; confirmations: Array<{ owner: Address; at: string }> }): SafeTx & SafeTxData =>
  ({ safeTxHash: h, ...q.tx, method: null, confirmationsRequired: 2, confirmations: [...q.confirmations], executed: false, executedAt: null, submittedAt: "", proposer: null }) as never;
const reader: SafeReader = {
  info: async () => ({ owners: [owner1.address, owner2.address], threshold: 2, nonce: 21 }),
  transactions: async (_c, { executed }) => (executed ? [] : [...queue.entries()].map(([h, q]) => asTx(h, q))),
  transaction: async (_c, h) => (queue.has(h) ? (asTx(h, queue.get(h)!) as never) : null),
  propose: async (c, body: any) => {
    expect(c.address).toBe(SAFE);
    const { contractTransactionHash, sender, signature: _s, origin: _o, ...tx } = body;
    queue.set(contractTransactionHash, { tx, confirmations: [{ owner: getAddress(sender), at: '' }] });
  },
  confirm: async (_c, h) => void queue.get(h)!.confirmations.push({ owner: owner2.address, at: '' }),
  read: async () => 0n,
};

beforeAll(async () => {
  ({ db } = await testDb());
  await seedCommand(db);
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
      now: () => new Date('2026-11-26T17:00:00Z'),
      safe: { config: () => null, reader },
      signing,
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
const sign = (w: ReturnType<typeof privateKeyToAccount>, td: any) => {
  const m = td.message;
  return w.signTypedData({
    domain: { chainId: td.domain.chainId, verifyingContract: td.domain.verifyingContract },
    types: SAFE_TX_TYPES,
    primaryType: 'SafeTx',
    message: { ...m, value: BigInt(m.value), safeTxGas: BigInt(m.safeTxGas), baseGas: BigInt(m.baseGas), gasPrice: BigInt(m.gasPrice), nonce: BigInt(m.nonce) },
  });
};

let K: Who;
beforeAll(async () => {
  const r = await call({ user: 'did:kai|kai@useclear.org' }, 'POST', '/sessions', { deviceKey: 'device-kai-00000000', keep: true, method: 'email' });
  K = { user: 'did:kai|kai@useclear.org', session: r.body.session?.id };
});

describe('a Safe step from the plan', () => {
  test('Check now hands back the statuses', async () => {
    const r = await call(K, 'POST', '/signing/check');
    expect(r.status).toBe(200);
    expect(r.body.live.steps.SAx.status).toBe('ready');
  });

  test('only a ready Safe step with its call known can be prepared', async () => {
    expect((await call(K, 'POST', '/signing/safe/prepare', { stepId: 'WAIT' })).body).toMatchObject({ code: 'NOT_READY', error: 'The timelock’s 7 days end later.' });
    expect((await call(K, 'POST', '/signing/safe/prepare', { stepId: 'W1' })).body.code).toBe('NOT_A_SAFE_STEP');
    expect((await call(K, 'POST', '/signing/safe/prepare', { stepId: 'NULL' })).body.code).toBe('NOT_A_SAFE_STEP');
    expect((await call(K, 'POST', '/signing/safe/prepare', { stepId: 'NOPE' })).body.code).toBe('NO_STEP');
  });

  test('prepared at the Safe’s nonce, exactly the step’s call; a stranger’s signature is refused; an owner’s goes to the queue', async () => {
    const p = await call(K, 'POST', '/signing/safe/prepare', { stepId: 'SAx' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ safe: SAFE, nonce: 21, threshold: 2 });
    expect(p.body.typedData.domain).toEqual({ chainId: 84532, verifyingContract: SAFE });
    expect(p.body.typedData.message).toMatchObject({ to: TL, value: '0', data: steps[0].data, operation: 0, nonce: '21' });

    const bad = await call(K, 'POST', '/signing/safe/propose', { stepId: 'SAx', nonce: 21, signature: await sign(stranger, p.body.typedData) });
    expect(bad.body.code).toBe('NOT_AN_OWNER');
    // signed for another nonce than the one sent: not this transaction, so not an owner's signature over it
    const other = await call(K, 'POST', '/signing/safe/propose', { stepId: 'SAx', nonce: 22, signature: await sign(owner1, p.body.typedData) });
    expect(other.body.code).toBe('NOT_AN_OWNER');
    expect((await call(K, 'POST', '/signing/safe/propose', { stepId: 'SAx', nonce: 20, signature: await sign(owner1, p.body.typedData) })).body.code).toBe('STALE_NONCE');

    const before = forgotten;
    const ok = await call(K, 'POST', '/signing/safe/propose', { stepId: 'SAx', nonce: 21, signature: await sign(owner1, p.body.typedData) });
    expect(ok.body).toMatchObject({ proposed: true, safeTxHash: p.body.safeTxHash, signed: 1, required: 2 });
    expect(queue.get(p.body.safeTxHash)!.confirmations.map((c) => c.owner)).toEqual([owner1.address]);
    expect(forgotten).toBe(before + 1);

    // the second owner signs the queued copy
    const t = await call(K, 'POST', '/signing/safe/tx', { stepId: 'SAx', safeTxHash: p.body.safeTxHash });
    expect(t.body).toMatchObject({ signed: [owner1.address], required: 2 });
    expect((await call(K, 'POST', '/signing/safe/confirm', { stepId: 'SAx', safeTxHash: p.body.safeTxHash, signature: await sign(owner1, t.body.typedData) })).body.code).toBe('ALREADY_SIGNED');
    const c = await call(K, 'POST', '/signing/safe/confirm', { stepId: 'SAx', safeTxHash: p.body.safeTxHash, signature: await sign(owner2, t.body.typedData) });
    expect(c.body).toMatchObject({ confirmed: true, signed: 2, required: 2 });
  });

  test('a queued transaction that isn’t the step’s call is never signed from here', async () => {
    const h = `0x${'cd'.repeat(32)}`;
    queue.set(h, { tx: { to: TL, value: '0', data: '0xdeadbeef', operation: 0, safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: '0x0000000000000000000000000000000000000000', refundReceiver: '0x0000000000000000000000000000000000000000', nonce: 22 }, confirmations: [] });
    expect((await call(K, 'POST', '/signing/safe/tx', { stepId: 'SAx', safeTxHash: h })).body.code).toBe('NOT_THIS_STEP');
  });
});
