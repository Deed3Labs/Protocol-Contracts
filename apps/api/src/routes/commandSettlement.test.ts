import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import { seedCommand } from '../services/command/seed.js';
import { settlementFundingLive } from '../services/command/settlementFunding.js';
import { commandRouter } from './command.js';

/*
 * Card settlement's manual funding (decision 54, the redesign): every money move is two people, through Money's
 * actions and the proposals flow, and happens on approve; running the desk and stopping it are one person's, at Money
 * Approve. Everything is logged.
 */

let root = '';
let db: Db;
let runs = 0;
const POOL = '0x5840000000000000000000000000000000000023';
const A = { chainId: 84532, pool: POOL, forwarder: '0x' + '1'.repeat(40), safe: '0x' + '2'.repeat(40), module: '0x' + '3'.repeat(40), usdc: '0x' + '4'.repeat(40), wallet: '0x' + '5'.repeat(40), offRamp: '0x' + '6'.repeat(40) };
const U = (v: number) => String(Math.round(v * 1e6));

beforeAll(async () => {
  ({ db } = await testDb());
  await seedCommand(db);
  // the desk's last check: the short state of the reference (what the card and the actions read)
  const now = Date.now();
  const snapshot = {
    enabled: true,
    dryRun: false,
    addresses: A,
    ref: '0x' + 'ab'.repeat(32),
    coverage: { next: Math.floor(now / 1000) + 20 * 3600, through: Math.floor(now / 1000) + 20 * 3600, rollover: false },
    figures: { due: U(5850), dueSettled: U(5120.4), duePending: U(729.6), buffer: U(1000), target: U(6850), csa: U(1120.15), inFlight: U(2196.25), need: U(3533.6), surplus: '0', latencyMinutes: 240, forcedAt: Math.floor(now / 1000) + 15 * 3600, capLeft: U(1020), forwardLeft: U(3000), poolRoom: U(3412.98) },
    collection: U(412.6),
    marginHeld: U(1840),
    marginOutstanding: '0',
    lane: { upgraded: true, funder: A.wallet, stopped: false, capPerPeriod: U(5000), periodSeconds: 604800, periodUsed: U(3980), principal: U(9400), deployedBalance: U(8870), headroom: U(1000) },
    forwarder: { moduleEnabled: true, allowance: { amount: U(5000), spent: '0', resetTimeMin: 10080 }, offRamp: A.offRamp, desk: A.wallet, safe: A.safe, module: A.module, token: A.usdc },
    decision: { kind: 'fund' },
    outcome: 'funded',
  };
  await db.query(`INSERT INTO ops.settlement_funding_checks (chain_id, pool, checked_at, outcome, snapshot) VALUES (84532, $1, now(), 'funded', $2)`, [POOL, JSON.stringify(snapshot)]);

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
      adminEmails: () => ['kai@useclear.org', 'second@useclear.org'],
      appUrl: () => 'https://command.test',
      runSettlementDesk: async () => ((runs += 1), 'funded'),
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

type Who = { user: string; session?: string };
const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const r = await fetch(root + '/api/command' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
};
const signIn = async (user: string): Promise<Who> => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;
const q = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, p)).rows as T[];

let kai: Who, second: Who, proposer: Who;
beforeAll(async () => {
  kai = await signIn('did:kai|kai@useclear.org');
  second = await signIn('did:second|second@useclear.org');
  // someone who can propose on Money but not approve there
  await call(kai, 'POST', '/invites', { email: 'pat@useclear.org', name: 'Pat', group: 'outside' });
  const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'pat@useclear.org').id;
  expect((await call(kai, 'PATCH', `/people/${id}/access`, { custom: { ...all(1), money: 3 } })).status).toBe(200);
  proposer = await signIn('did:pat|pat@useclear.org');
});

/** Proposes, checks it waits and that its proposer can't approve it, then a second person approves it. */
async function twoPeople(kind: string, body: unknown) {
  const r = await call(kai, 'POST', `/actions/money/${kind}`, body);
  expect(r.status).toBe(202);
  const id = r.body.proposal.id;
  expect((await call(kai, 'POST', `/proposals/${id}/approve`)).status).toBe(403);
  const ok = await call(second, 'POST', `/proposals/${id}/approve`);
  expect(ok.status).toBe(200);
  return ok.body.result;
}

describe('manual funding: two people, through the proposals flow', () => {
  test('someone at Propose can ask for a settlement move; nothing moves until a second person approves', async () => {
    const r = await call(proposer, 'POST', '/actions/money/settlement-margin', { amount: 100 });
    expect(r.status).toBe(202);
    expect(await q(`SELECT 1 FROM ops.settlement_funding_moves WHERE kind = 'margin-advance'`)).toHaveLength(0);
    await call(proposer, 'POST', `/proposals/${r.body.proposal.id}/decline`);
  });

  test('book: a planned book move the desk carries out, no more than the Collection Account held', async () => {
    const out = await twoPeople('settlement-book', { amount: 412.6 });
    const [m] = await q(`SELECT kind, status, amount::text, recorded_by FROM ops.settlement_funding_moves WHERE id = $1`, [out.move]);
    expect(m).toEqual({ kind: 'book', status: 'planned', amount: '412600000', recorded_by: expect.any(String) });
    // more than it held is refused at approve, and nothing is approved
    const r = await call(kai, 'POST', '/actions/money/settlement-book', { amount: 5000 });
    expect((await call(second, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(409);
    await db.query(`UPDATE ops.settlement_funding_moves SET status = 'done', finished_at = now() WHERE id = $1`, [out.move]);
  });

  test('deploy beyond the lane: the Safe batches for the two deployers and CL Operating', async () => {
    const out = await twoPeople('settlement-deploy', { amount: 1513.6 });
    expect(Object.keys(out.batches)).toEqual(['deployers', 'clOperating']);
    expect(out.batches.deployers.transactions[0].to).toBe(POOL);
  });

  test('margin: recorded as an advance against this cut-off', async () => {
    const out = await twoPeople('settlement-margin', { amount: 1513.6 });
    const [m] = await q(`SELECT kind, status, amount::text FROM ops.settlement_funding_moves WHERE id = $1`, [out.move]);
    expect(m).toEqual({ kind: 'margin-advance', status: 'done', amount: '1513600000' });
  });

  test('restart: clears a stop, with no chain call when the lane isn’t stopped on chain', async () => {
    const s = await call(kai, 'POST', '/settlement-funding/stop', { why: 'Checking a forward' });
    expect(s.status).toBe(200);
    const out = await twoPeople('settlement-restart', {});
    expect(out).toEqual({ cleared: true, batch: null });
    expect(await q(`SELECT 1 FROM ops.settlement_funding_moves WHERE kind = 'stop' AND cleared_at IS NULL`)).toHaveLength(0);
  });
});

describe('one person’s levers, at Money Approve', () => {
  test('run: one forced check, and its decision; not at Propose', async () => {
    expect((await call(proposer, 'POST', '/settlement-funding/run')).status).toBe(403);
    const r = await call(kai, 'POST', '/settlement-funding/run');
    expect(r.status).toBe(200);
    expect(r.body.tick).toBe('funded');
    expect(runs).toBe(1);
  });

  test('stop: needs a reason; halts the desk now and hands back stopSettlementFunder for the signer’s wallet', async () => {
    expect((await call(proposer, 'POST', '/settlement-funding/stop', { why: 'x' })).status).toBe(403);
    expect((await call(kai, 'POST', '/settlement-funding/stop', {})).status).toBe(400);
    const r = await call(kai, 'POST', '/settlement-funding/stop', { why: 'A forward reverted' });
    expect(r.status).toBe(200);
    // stopSettlementFunder(): its selector alone
    expect(r.body.call).toEqual({ to: POOL, value: '0', data: expect.stringMatching(/^0x[0-9a-f]{8}$/) });
    // the card says it's stopped, and the verdict: nothing moves on its own
    const card = (await settlementFundingLive(db))!;
    expect(card.stopped?.why).toContain('A forward reverted');
    expect(card.verdict?.label).toBe('Desk stopped');
    expect(card.verdict?.willMove).toEqual({ book: 0, lane: 0 });
  });

  test('each lever and approval is in the audit log', async () => {
    const rows = await q<{ action: string }>(`SELECT action FROM command.audit_log WHERE area = 'money' ORDER BY id`);
    const acts = rows.map((r) => r.action);
    expect(acts).toContain('Ran the settlement funding desk now');
    expect(acts).toContain('Stopped the settlement funding desk');
    expect(acts.some((a) => a.startsWith('Advance $1,513.60 of the Savings-Backed Margin'))).toBe(true);
  });
});
