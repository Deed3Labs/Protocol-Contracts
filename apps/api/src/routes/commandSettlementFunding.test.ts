import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { stringToHex } from 'viem';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { getContractAddress } from '../config/contracts.js';
import type { ChainCall, ChainReader } from '../services/command/onchain.js';
import { deskStore, recordMarginAdvance } from '../services/settlementFunding/store.js';
import { commandRouter } from './command.js';

/*
 * Settlement Funding's reads for the Command Center and the signing page (decision 54): the desk's
 * status from what it recorded, and the Pool Tier principal the two valuation signers should post,
 * read from the chain. Both need Money at See; neither sends anything.
 */

const U = 1_000_000n;
const M1 = '0x00000000000000000000000000000000000000a1';
const M2 = '0x00000000000000000000000000000000000000a2';
const kind = (k: string) => stringToHex(k, { size: 32 });

/** The book as the chain would answer it: savings 100 + 40, asset 900, income 25, one open plan of 300. */
const reader: ChainReader = {
  read: async (calls: ChainCall[]) =>
    calls.map((c) => {
      switch (c.fn) {
        case 'tierCount':
          return 3n;
        case 'planCount':
          return 2n;
        case 'tierAt':
          return [kind(['SAVINGS', 'BOND', 'INCOME'][Number(c.args![0])]), 0n, true];
        case 'principalOnlyOf': {
          const [m, t] = c.args as [string, bigint];
          const book: Record<string, number> = { [`${M1}:0`]: 100, [`${M2}:0`]: 40, [`${M1}:1`]: 900, [`${M2}:2`]: 25 };
          return BigInt(book[`${m}:${t}`] ?? 0) * U;
        }
        case 'planAt':
          return Number(c.args![0]) === 0 ? [M1, 500n * U, 300n * U, 200n * U, 0n, 4, 0n, 0n, false] : [M2, 50n * U, 0n, 50n * U, 0n, 4, 0n, 0n, true];
        case 'poolTierPrincipal':
          return [400n * U, 1_795_000_000n];
        case 'deployedBalance':
          return 380n * U;
        case 'settlementHeadroom':
          throw new Error('execution reverted'); // before the lane's upgrade
        default:
          throw new Error(`unexpected ${c.fn}`);
      }
    }),
};

let base = '';
let db: Db;

beforeAll(async () => {
  ({ db } = await testDb());
  for (const [i, m] of [M1, M2].entries()) {
    await db.query(
      `INSERT INTO command.chain_events (chain_id, block_number, block_hash, block_time, tx_hash, log_index, address, contract, event, args, topics, data)
       VALUES (84532, $1, '0x', now(), $2, 0, '0x', 'ClearCredit', 'CreditLineCreated', $3, '{}', '0x')`,
      [i + 1, `0x${i + 1}`, JSON.stringify({ member: m })],
    );
  }
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
      chain: reader,
      chainId: 84532,
      now: () => new Date('2026-11-17T17:00:00Z'),
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
});

const call = async (who: { user: string; session?: string }, path: string) => {
  const r = await fetch(base + path, { headers: { 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) } });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const signIn = async (user: string) => {
  const r = await fetch(base + '/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': user },
    body: JSON.stringify({ deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' }),
  });
  return { user, session: ((await r.json()) as any).session?.id as string };
};

describe('GET /pool-tier-principal', () => {
  test('the pool-funded tiers with savings-backed, the open term plans and the Margin Advances; asset-backed left out', async () => {
    const pool = getContractAddress(84532, 'LendingPool')!;
    await recordMarginAdvance(db, 84532, pool, 35n * U, 'ops', 'covered a settlement');
    const kai = await signIn('did:kai|kai@useclear.org');
    const r = await call(kai, '/pool-tier-principal');
    expect(r.status).toBe(200);
    // savings 140 + income 25 + plan 300 + Margin 35
    expect(r.body.total).toEqual({ units: (500n * U).toString(), usd: 500 });
    expect(r.body.tiers).toEqual([
      { kind: 'SAVINGS', principal: { units: (140n * U).toString(), usd: 140 }, members: 2 },
      { kind: 'INCOME', principal: { units: (25n * U).toString(), usd: 25 }, members: 1 },
      { kind: 'BOOST', principal: { units: '0', usd: 0 }, members: 0 },
    ]);
    expect(r.body.term).toEqual({ principal: { units: (300n * U).toString(), usd: 300 }, plans: 1 });
    expect(r.body.marginAdvances.usd).toBe(35);
    expect(r.body.posted).toEqual({ value: { units: (400n * U).toString(), usd: 400 }, postedAt: 1_795_000_000 });
    expect(r.body.difference.usd).toBe(100);
    expect(r.body.headroom).toBe(null);
    expect(r.body.note).toContain('Read-only');
  });

  test('without a session: refused', async () => {
    expect((await call({ user: 'did:kai|kai@useclear.org' }, '/pool-tier-principal')).status).toBe(401);
  });
});

describe('GET /settlement-funding', () => {
  test('null before the desk has ever checked; then its last check, moves and halt', async () => {
    const kai = await signIn('did:kai|kai@useclear.org');
    expect((await call(kai, '/settlement-funding')).body).toEqual({ desk: null });
    const pool = getContractAddress(84532, 'LendingPool')!;
    const s = deskStore(db, 84532, pool);
    await s.saveCheck({ checkedAt: new Date('2026-11-17T16:00:00Z'), cutoffAt: new Date('2026-11-17T19:00:00Z'), need: 0n, surplus: 0n, csa: 1n, outcome: 'idle', snapshot: { outcome: 'idle' } });
    const r = await call(kai, '/settlement-funding');
    expect(r.status).toBe(200);
    expect(r.body.desk.lastCheck.outcome).toBe('idle');
    expect(r.body.desk.marginOutstanding).toBe(35);
    expect(r.body.desk.recent[0]).toMatchObject({ kind: 'margin-advance', status: 'done', amount: 35, recordedBy: 'ops' });
    expect(r.body.desk.halted).toBe(null);
  });
});
