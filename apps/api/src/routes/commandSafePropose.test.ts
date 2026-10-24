import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { decodeFunctionData, getAddress, type Abi, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { safeConfig, type SafeReader, type SafeTx } from '../services/command/safe.js';
import { CONTRACTS, SAFE_TX_TYPES, argFor, safeTxFor, safeTxHash, type SafeTxData } from '../services/command/safeTx.js';
import { seedCommand } from '../services/command/seed.js';
import { commandRouter } from './command.js';

/*
 * Phase 4b: an on-chain act in the outbox becomes a Safe transaction. Command builds it from the
 * deployed ABIs, a signer's own wallet signs its hash, and Command checks that signature before
 * the Transaction Service sees it. The service here is a stand-in that keeps what it's sent.
 */

let base = '';
let db: Db;
const cfg = safeConfig({ COMMAND_SAFE_ADDRESS: '0x000000000000000000000000000000000000dEaD' })!;
const kai = privateKeyToAccount(generatePrivateKey());
const dana = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const shopWallet = '0x00000000000000000000000000000000000000aa' as Address;

// the stand-in Transaction Service: what was proposed, and its signatures
const queue = new Map<string, { tx: SafeTxData; confirmations: Array<{ owner: Address; at: string }>; proposer: Address }>();
const reader: SafeReader = {
  info: async () => ({ owners: [kai.address, dana.address], threshold: 2, nonce: 3 }),
  transactions: async (_c, { executed }) =>
    executed
      ? []
      : [...queue.entries()].map(([h, q]): SafeTx => ({ safeTxHash: h, nonce: q.tx.nonce, to: q.tx.to, value: q.tx.value, data: q.tx.data, method: null, confirmationsRequired: 2, confirmations: q.confirmations, executed: false, executedAt: null, submittedAt: '2026-10-23T17:00:00Z', proposer: q.proposer })),
  transaction: async (_c, h) => {
    const q = queue.get(h);
    return q ? { safeTxHash: h, ...q.tx, method: 'setActive', confirmationsRequired: 2, confirmations: q.confirmations, executed: false, executedAt: null, submittedAt: '2026-10-23T17:00:00Z', proposer: q.proposer } : null;
  },
  propose: async (_c, body: any) => {
    const { contractTransactionHash, sender, signature, origin, ...tx } = body;
    queue.set(contractTransactionHash, { tx, confirmations: [{ owner: getAddress(sender), at: '2026-10-23T17:00:00Z' }], proposer: getAddress(sender) });
  },
  confirm: async (_c, h) => {
    queue.get(h)!.confirmations.push({ owner: dana.address, at: '2026-10-23T18:00:00Z' });
  },
  // MerchantRegistry's current terms, and the pool's token
  read: async (_c, _a, _abi, fn) => (fn === 'payoutWindowOf' ? 1209600 : fn === 'discountBpsOf' ? 250n : fn === 'reserveToken' ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e' : 0n),
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
      adminEmails: () => ['kai@useclear.org', 'dana@useclear.org', 'sam@useclear.org'],
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
const link = async (who: Who, w: ReturnType<typeof privateKeyToAccount>) => {
  const ch = (await call(who, 'POST', '/me/wallet/challenge')).body;
  expect((await call(who, 'POST', '/me/wallet', { id: ch.id, address: w.address, signature: await w.signMessage({ message: ch.message }) })).status).toBe(200);
};
/** What a wallet's eth_signTypedData_v4 produces, from the typed data the API hands out. */
const sign = (w: ReturnType<typeof privateKeyToAccount>, td: any) => {
  const m = td.message;
  return w.signTypedData({
    domain: { chainId: td.domain.chainId, verifyingContract: td.domain.verifyingContract },
    types: SAFE_TX_TYPES,
    primaryType: 'SafeTx',
    message: { ...m, value: BigInt(m.value), safeTxGas: BigInt(m.safeTxGas), baseGas: BigInt(m.baseGas), gasPrice: BigInt(m.gasPrice), nonce: BigInt(m.nonce) },
  });
};

let K: Who, D: Who, S: Who;
beforeAll(async () => {
  K = await signIn('did:kai|kai@useclear.org');
  D = await signIn('did:dana|dana@useclear.org');
  S = await signIn('did:sam|sam@useclear.org');
  await link(K, kai);
  await link(D, dana);
  await link(S, stranger);
  await db.query(`UPDATE command.merchants SET wallet_address = $1 WHERE id = 'rosas'`, [shopWallet]);
});

describe('building Safe transactions from the deployed ABIs', () => {
  test('arguments typed as text become their ABI types, or are refused', () => {
    expect(argFor('uint256', '150000000')).toBe(150000000n);
    expect(argFor('bool', 'True')).toBe(true);
    expect(argFor('address[]', '["0x000000000000000000000000000000000000dead"]')).toEqual(['0x000000000000000000000000000000000000dEaD']);
    expect(() => argFor('address', 'rosas')).toThrow('isn’t an address');
    expect(() => argFor('uint256', '1.5')).toThrow('whole number');
  });

  test('several calls go through MultiSendCallOnly as one delegatecall', () => {
    const one = { to: kai.address, value: 0n, data: '0x1234' as const, label: '' };
    expect(safeTxFor([one], 4).operation).toBe(0);
    const two = safeTxFor([one, one], 4);
    expect([two.operation, two.to]).toEqual([1, '0x9641d764fc13c8B624c04430C7356C1C7C8102e2']);
  });
});

describe('proposing and signing', () => {
  let outboxId = '';
  let hash = '';
  let typed: any;

  test('an on-chain outbox row is built at the Safe’s next nonce, with what the wallet signs', async () => {
    expect((await call(K, 'POST', '/actions/merchants/off', { id: 'rosas', reason: 'Closed for the month' })).status).toBe(200);
    const list = (await call(K, 'GET', '/safe/outbox')).body.outbox;
    outboxId = list.find((o: any) => o.kind === 'off').id;
    const r = await call(K, 'POST', '/safe/prepare', { outboxId });
    expect(r.status).toBe(200);
    expect(r.body.nonce).toBe(3);
    ({ safeTxHash: hash, typedData: typed } = r.body);
    expect(typed.domain.verifyingContract).toBe(cfg.address);
    const reg = CONTRACTS.MerchantRegistry;
    expect(getAddress(typed.message.to)).toBe(getAddress(reg.address));
    expect(decodeFunctionData({ abi: reg.functions as Abi, data: typed.message.data })).toEqual({ functionName: 'setActive', args: [getAddress(shopWallet), false] });
    expect(safeTxHash(cfg, { ...typed.message, nonce: Number(typed.message.nonce) }) as string).toBe(hash);
  });

  test('a signature from a wallet that isn’t yours, or isn’t an owner, is refused', async () => {
    expect((await call(K, 'POST', '/safe/propose', { safeTxHash: hash, signature: await sign(dana, typed) })).body.code).toBe('BAD_SIGNATURE');
    expect((await call(S, 'POST', '/safe/propose', { safeTxHash: hash, signature: await sign(stranger, typed) })).body.code).toBe('NOT_A_SIGNER');
  });

  test('your own signature puts it in the Safe’s queue, and the outbox row is sent', async () => {
    const r = await call(K, 'POST', '/safe/propose', { safeTxHash: hash, signature: await sign(kai, typed) });
    expect(r.status).toBe(200);
    expect(queue.get(hash)!.proposer).toBe(kai.address);
    expect((await db.query(`SELECT status FROM command.outbox WHERE id = $1`, [outboxId])).rows[0].status).toBe('sent');
    expect((await call(K, 'POST', '/safe/propose', { safeTxHash: hash, signature: await sign(kai, typed) })).body.code).toBe('NOT_PREPARED');
  });

  test('the next one builds at the nonce after it', async () => {
    expect((await call(K, 'POST', '/actions/merchants/on', { id: 'rosas' })).status).toBe(200);
    const id = (await call(K, 'GET', '/safe/outbox')).body.outbox.find((o: any) => o.kind === 'on').id;
    expect((await call(K, 'POST', '/safe/prepare', { outboxId: id })).body.nonce).toBe(4);
  });

  test('a second owner confirms with their own signature, once', async () => {
    const t = (await call(D, 'GET', `/safe/tx/${hash}`)).body;
    expect(t.hashMatches).toBe(true);
    const r = await call(D, 'POST', '/safe/confirm', { safeTxHash: hash, signature: await sign(dana, t.typedData) });
    expect(r.body).toEqual({ confirmed: true, signatures: 2, required: 2 });
    expect((await call(D, 'POST', '/safe/confirm', { safeTxHash: hash, signature: await sign(dana, t.typedData) })).body.code).toBe('ALREADY_SIGNED');
  });

  test('a top-up is two calls in one transaction; a shop without a wallet can’t be built', async () => {
    expect((await call(K, 'POST', '/actions/money/top', { amount: 1116.89 })).status).toBe(202);
    const waiting = (await call(D, 'GET', '/proposals?area=money')).body.proposals[0];
    expect((await call(D, 'POST', `/proposals/${waiting.id}/approve`)).status).toBe(200);
    const id = (await call(K, 'GET', '/safe/outbox')).body.outbox.find((o: any) => o.kind === 'top').id;
    const r = await call(K, 'POST', '/safe/prepare', { outboxId: id });
    expect(r.body.calls.map((c: any) => c.label)).toEqual(['Let the PayoutPool take the top-up', 'Fund the PayoutPool with $1116.89']);
    expect(r.body.typedData.message.operation).toBe(1);
    expect((await call(K, 'POST', '/actions/merchants/off', { id: 'mesa' })).status).toBe(200);
    const mesa = (await call(K, 'GET', '/safe/outbox')).body.outbox.find((o: any) => o.kind === 'off' && o.status === 'queued').id;
    expect((await call(K, 'POST', '/safe/prepare', { outboxId: mesa })).body.code).toBe('NO_SHOP_WALLET');
  });
});
