import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { CREDIT_UNITS, POINTS_ISSUER_ABI, SOURCE, refOf, runCreditsMint, sourceOf, summarize, type CreditsMintDeps } from './creditsMint';
import type { Simulation } from './keeperKit';
import type { MintableCredit } from '../payLedgerStore';

/*
 * The minting job against a stand-in Points Issuer: what it sends for each row, and how it treats each
 * of the contract's refusals.
 */

const ISSUER = '0x00000000000000000000000000000000000000aa';
const iface = new ethers.Interface(POINTS_ISSUER_ABI as unknown as string[]);
const M1 = '0x0000000000000000000000000000000000000001';
const M2 = '0x0000000000000000000000000000000000000002';

const refused = (name: string): Simulation => ({ kind: 'refused', error: { name, args: [] as unknown as ethers.Result }, sentence: name });

function harness(rows: MintableCredit[], decide: (fn: string, args: ethers.Result) => Simulation, mode: 'live' | 'dry_run' = 'live') {
  const sent: { fn: string; args: ethers.Result }[] = [];
  const state = { minted: new Map<string, string>(), refused: new Map<string, string>(), failed: new Map<string, string>() };
  const parse = (data: string) => iface.parseTransaction({ data })!;
  const deps: CreditsMintDeps = {
    mode,
    issuer: ISSUER,
    network: 'testnet',
    runner: {
      from: '0x8801',
      simulate: async (c) => {
        const t = parse(c.data);
        return decide(t.name, t.args);
      },
      send: async (c) => {
        const t = parse(c.data);
        sent.push({ fn: t.name, args: t.args });
        return { hash: `0xh${sent.length}`, logs: [], status: 1 };
      },
    },
    rows: {
      mintable: async () => rows,
      minted: async (id, tx) => void state.minted.set(id, tx),
      refused: async (id, r) => void state.refused.set(id, r),
      failed: async (id, r) => void state.failed.set(id, r),
    },
    joinedAt: async () => new Date('2026-06-01T00:00:00Z'),
    maxPerRun: 50,
  };
  return { deps, sent, state };
}

const row = (id: string, wallet: string, amount: number, reason: string): MintableCredit => ({ id, wallet, amount, reason, createdAt: new Date('2026-10-01T00:00:00Z') });
const ok: Simulation = { kind: 'ok', returnData: '0x' };

describe('credits minting job', () => {
  test('maps each row to its source and a ref unique to the row', () => {
    expect(sourceOf('deposit_match')).toBe(SOURCE.SAVING);
    expect(sourceOf('rent_on_time')).toBe(SOURCE.RENT);
    expect(sourceOf('bill_on_time')).toBe(SOURCE.BILL);
    expect(sourceOf('other')).toBeNull();
    expect(refOf('a')).not.toBe(refOf('b'));
    expect(refOf('a')).toBe(ethers.keccak256(ethers.toUtf8Bytes('a')));
  });

  test('mints a vested row in whole credits at 6 decimals and records the transaction', async () => {
    const h = harness([row('r1', M1, 20, 'bill_on_time')], () => ok);
    const run = await runCreditsMint(h.deps);
    expect(run).toMatchObject({ checked: 1, minted: 1, credits: 20 });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].fn).toBe('mint');
    expect(h.sent[0].args[0]).toBe(M1);
    expect(h.sent[0].args[1]).toBe(20n * CREDIT_UNITS);
    expect(h.sent[0].args[2]).toBe(SOURCE.BILL);
    expect(h.sent[0].args[3]).toBe(refOf('r1'));
    expect(h.state.minted.get('r1')).toBe('0xh1');
  });

  test("opens a member's Match Period from their join date before their first saving mint, once", async () => {
    let open = false;
    const h = harness([row('s1', M1, 100, 'deposit_match'), row('s2', M1, 50, 'deposit_match')], (fn) => {
      if (fn === 'openMatchPeriod') return ok;
      return open ? ok : refused('PointsIssuerNoMatchPeriod');
    });
    const realSend = h.deps.runner.send;
    h.deps.runner.send = async (c) => {
      const r = await realSend(c);
      if (h.sent.at(-1)!.fn === 'openMatchPeriod') open = true;
      return r;
    };
    const run = await runCreditsMint(h.deps);
    expect(run).toMatchObject({ minted: 2, periodsOpened: 1 });
    expect(h.sent.map((s) => s.fn)).toEqual(['openMatchPeriod', 'mint', 'mint']);
    expect(h.sent[0].args[1]).toBe(BigInt(Date.parse('2026-06-01T00:00:00Z') / 1000));
  });

  test('a ref already minted marks the row minted without sending', async () => {
    const h = harness([row('r1', M1, 20, 'rent_on_time')], () => refused('PointsIssuerRefUsed'));
    const run = await runCreditsMint(h.deps);
    expect(run.minted).toBe(1);
    expect(h.sent).toHaveLength(0);
    expect(h.state.minted.get('r1')).toBe('onchain');
  });

  test("the contract's limits void a row; the month's cap makes it wait", async () => {
    const h = harness(
      [row('out', M1, 10, 'deposit_match'), row('life', M2, 10, 'deposit_match'), row('month', M2, 10, 'deposit_match')],
      (_fn, args) => {
        if (args[3] === refOf('out')) return refused('PointsIssuerOutsideMatchPeriod');
        if (args[3] === refOf('life')) return refused('PointsIssuerLifetimeCap');
        return refused('PointsIssuerMonthlyCap');
      },
    );
    const run = await runCreditsMint(h.deps);
    expect(run).toMatchObject({ voided: 2, waiting: 1, minted: 0 });
    expect(h.state.refused.get('out')).toBe('PointsIssuerOutsideMatchPeriod');
    expect(h.state.refused.get('life')).toBe('PointsIssuerLifetimeCap');
    expect(h.state.refused.has('month')).toBe(false);
    expect(h.sent).toHaveLength(0);
  });

  test('any other failure is counted for a retry and the run goes on', async () => {
    const h = harness([row('bad', M1, 10, 'bill_on_time'), row('good', M2, 10, 'bill_on_time')], (_fn, args) =>
      args[3] === refOf('bad') ? { kind: 'failed', reason: 'reverts: paused' } : ok,
    );
    const run = await runCreditsMint(h.deps);
    expect(run).toMatchObject({ failed: 1, minted: 1 });
    expect(h.state.failed.get('bad')).toContain('paused');
  });

  test('a dry run sends nothing and counts each member’s Match Period once', async () => {
    const h = harness(
      [row('r1', M1, 20, 'bill_on_time'), row('s1', M2, 10, 'deposit_match'), row('s2', M2, 15, 'deposit_match'), row('s3', M2, 5, 'deposit_match')],
      (fn, args) => (fn === 'mint' && args[2] === SOURCE.SAVING ? refused('PointsIssuerNoMatchPeriod') : ok),
      'dry_run',
    );
    const run = await runCreditsMint(h.deps);
    expect(run).toMatchObject({ checked: 4, wouldMint: 4, periodsOpened: 1, minted: 0 });
    expect(h.sent).toHaveLength(0);
    expect(summarize(run, 'dry_run')).toBe(
      '[credits-mint] dry run, nothing sent: 4 checked, would mint 4, would open 1 match period, 0 already minted, 0 would be void, 0 waiting for next month, 0 failed',
    );
  });

  test('a dry run writes nothing to the ledger, whatever the contract says', async () => {
    const h = harness(
      [row('used', M1, 20, 'rent_on_time'), row('out', M2, 10, 'deposit_match'), row('bad', M1, 5, 'bill_on_time'), row('odd', M1, 1.5, 'bill_on_time')],
      (_fn, args) =>
        args[3] === refOf('used') ? refused('PointsIssuerRefUsed') : args[3] === refOf('out') ? refused('PointsIssuerOutsideMatchPeriod') : { kind: 'failed', reason: 'reverts: paused' },
      'dry_run',
    );
    const run = await runCreditsMint(h.deps);
    expect(run).toMatchObject({ minted: 1, voided: 2, failed: 1 });
    expect([h.state.minted.size, h.state.refused.size, h.state.failed.size]).toEqual([0, 0, 0]);
    expect(h.sent).toHaveLength(0);
  });

  test('a row that cannot be a mint is void', async () => {
    const h = harness([row('x', M1, 12.5, 'bill_on_time'), row('y', M1, 5, 'mystery')], () => ok);
    const run = await runCreditsMint(h.deps);
    expect(run.voided).toBe(2);
    expect(h.sent).toHaveLength(0);
  });
});
