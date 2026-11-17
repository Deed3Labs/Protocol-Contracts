import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { Db } from '../../db/db';
import { testDb } from '../../db/testDb';
import {
  AssuranceRefusal,
  accrueFees,
  claimSend,
  itemById,
  markFailed,
  markFunded,
  markFundingProposed,
  markPaid,
  monthReadings,
  recordDeposit,
  recordInterchange,
  recordRepayment,
  recordSnapshot,
  retryFailed,
  unpaid,
} from './store';
import { safeBatch, type FundingProposal } from './proposals';

const USDC = 1_000_000n;
const CHAIN = 84532;
const POOL = '0x00000000000000000000000000000000000a55a1';
const PAYER = '0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd';
const reading = (coverage: bigint, block = 1) => ({ availableCoverage: coverage, backstopBalance: coverage * 2n, backstopFloor: coverage / 2n, coverageCap: coverage, block });
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const funding = {} as FundingProposal;

let db: Db;
let pg: PGlite;
beforeAll(async () => {
  ({ db, pg } = await testDb());
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.exec('DELETE FROM command.assurance_items; DELETE FROM command.assurance_snapshots; DELETE FROM command.assurance_interchange;');
});

describe('the daily reading', () => {
  test('once a day: a second run the same day writes nothing', async () => {
    expect(await recordSnapshot(db, { chainId: CHAIN, pool: POOL, today: '2026-11-03', reading: reading(100n * USDC) })).toEqual(['2026-11-03']);
    expect(await recordSnapshot(db, { chainId: CHAIN, pool: POOL, today: '2026-11-03', reading: reading(999n * USDC) })).toEqual([]);
    const m = await monthReadings(db, CHAIN, '2026-11');
    expect(m.get('2026-11-03')).toEqual({ coverage: 100n * USDC, filled: false });
  });

  test('missed days are filled by the next run with what it reads then, and marked filled', async () => {
    await recordSnapshot(db, { chainId: CHAIN, pool: POOL, today: '2026-10-30', reading: reading(100n * USDC) });
    expect(await recordSnapshot(db, { chainId: CHAIN, pool: POOL, today: '2026-11-02', reading: reading(250n * USDC) })).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect((await monthReadings(db, CHAIN, '2026-10')).get('2026-10-31')).toEqual({ coverage: 250n * USDC, filled: true });
    const nov = await monthReadings(db, CHAIN, '2026-11');
    expect(nov.get('2026-11-01')).toEqual({ coverage: 250n * USDC, filled: true });
    expect(nov.get('2026-11-02')).toEqual({ coverage: 250n * USDC, filled: false });
  });

  test('before the first reading nothing is written back: those days count as zero', async () => {
    await recordSnapshot(db, { chainId: CHAIN, pool: POOL, today: '2026-11-20', reading: reading(100n * USDC) });
    expect((await monthReadings(db, CHAIN, '2026-11')).size).toBe(1);
  });
});

describe('the monthly fee', () => {
  test('one per month, due, with its basis; running again adds nothing', async () => {
    for (let d = 1; d <= 31; d++) await recordSnapshot(db, { chainId: CHAIN, pool: POOL, today: `2026-10-${String(d).padStart(2, '0')}`, reading: reading(36_500n * USDC) });
    // nothing for October until October has ended
    expect(await accrueFees(db, { chainId: CHAIN, today: '2026-10-31', bps: 800n })).toEqual([]);
    const first = await accrueFees(db, { chainId: CHAIN, today: '2026-11-01', bps: 800n });
    // 36,500 × 31 × 0.08 / 365 = 248
    expect(first).toEqual([{ month: '2026-10', fee: 248n * USDC }]);
    expect(await accrueFees(db, { chainId: CHAIN, today: '2026-11-02', bps: 800n })).toEqual([]);
    const items = await unpaid(db, CHAIN);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'fee', month: '2026-10', sourceTag: 0, amount: 248n * USDC, status: 'due' });
    expect(items[0].basis).toMatchObject({ days: 31, read: 31, zero: 0, average: (36_500n * USDC).toString() });
  });

  test('the database refuses a second fee for a month', async () => {
    await db.query(`INSERT INTO command.assurance_items (chain_id, kind, month, source_tag, amount) VALUES ($1, 'fee', '2026-09-01', 0, 5)`, [CHAIN]);
    await expect(db.query(`INSERT INTO command.assurance_items (chain_id, kind, month, source_tag, amount) VALUES ($1, 'fee', '2026-09-01', 0, 7)`, [CHAIN])).rejects.toThrow();
  });

  test('every ended month since the first reading, and a month that rounds to nothing is nothing_due', async () => {
    await recordSnapshot(db, { chainId: CHAIN, pool: POOL, today: '2026-08-31', reading: reading(0n) });
    await recordSnapshot(db, { chainId: CHAIN, pool: POOL, today: '2026-09-01', reading: reading(0n) });
    const out = await accrueFees(db, { chainId: CHAIN, today: '2026-11-05', bps: 800n });
    expect(out.map((o) => o.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(await unpaid(db, CHAIN)).toEqual([]);
    const { rows } = await db.query<{ status: string }>(`SELECT DISTINCT status FROM command.assurance_items`);
    expect(rows.map((r) => r.status)).toEqual(['nothing_due']);
  });
});

describe('an item’s states', () => {
  async function aFee(amount = 10n * USDC, month = '2026-10') {
    const { rows } = await db.query<{ id: string }>(`INSERT INTO command.assurance_items (chain_id, kind, month, source_tag, amount) VALUES ($1, 'fee', $2, 0, $3) RETURNING id`, [CHAIN, `${month}-01`, amount.toString()]);
    return rows[0].id;
  }
  const at = new Date('2026-11-03T10:00:00Z');

  test('due → funding proposed → funded → sending → paid, each move only from where it is', async () => {
    const id = await aFee();
    // nothing sends from due
    expect(await claimSend(db, id, { payer: PAYER, block: 10, at })).toBeNull();
    expect(await markFunded(db, id, at)).toBeNull();
    expect((await markFundingProposed(db, id, funding, null, at))?.status).toBe('funding_proposed');
    expect((await markFunded(db, id, at))?.status).toBe('funded');
    const sending = await claimSend(db, id, { payer: PAYER, block: 10, at });
    expect(sending).toMatchObject({ status: 'sending', attempt: 1, sendBlock: 10, payer: PAYER.toLowerCase() });
    // a second claim finds nothing to claim
    expect(await claimSend(db, id, { payer: PAYER, block: 11, at })).toBeNull();
    expect((await recordDeposit(db, id, hash(1)))?.depositTx).toBe(hash(1));
    // the hash is never written over
    expect(await recordDeposit(db, id, hash(2))).toBeNull();
    expect((await markPaid(db, id, hash(1), at))?.status).toBe('paid');
    // paid is the end
    expect(await markFailed(db, id, 'x')).toBeNull();
    expect(await markFundingProposed(db, id, funding, null, at)).toBeNull();
    expect(await unpaid(db, CHAIN)).toEqual([]);
  });

  test('a deposit hash belongs to one item only', async () => {
    const a = await aFee(1n, '2026-09');
    const b = await aFee(2n, '2026-10');
    for (const id of [a, b]) {
      await markFundingProposed(db, id, funding, null, at);
      await claimSend(db, id, { payer: PAYER, block: 1, at });
    }
    await recordDeposit(db, a, hash(9));
    await expect(recordDeposit(db, b, hash(9))).rejects.toThrow();
  });

  test('failed stops it until retried; a retry clears the hashes but keeps the first attempt’s block', async () => {
    const id = await aFee();
    await markFundingProposed(db, id, funding, null, at);
    await claimSend(db, id, { payer: PAYER, block: 42, at });
    await recordDeposit(db, id, hash(3));
    expect((await markFailed(db, id, 'reverted'))?.status).toBe('failed');
    expect(await claimSend(db, id, { payer: PAYER, block: 50, at })).toBeNull();
    const back = await retryFailed(db, id);
    expect(back).toMatchObject({ status: 'funded', depositTx: null, error: null });
    const again = await claimSend(db, id, { payer: PAYER, block: 50, at });
    expect(again).toMatchObject({ attempt: 2, sendBlock: 42 });
  });

  test('oldest first: by month, then when it was entered', async () => {
    const nov = await aFee(1n, '2026-11');
    const sep = await aFee(1n, '2026-09');
    expect((await unpaid(db, CHAIN)).map((i) => i.id)).toEqual([sep, nov]);
  });
});

describe('Spread Repayments and recoveries', () => {
  const entry = (kind: 'spread_repayment' | 'recovery', amount: bigint, released: bigint) =>
    db.transaction((tx) => recordRepayment(tx, { chainId: CHAIN, kind, month: '2026-10', amount, note: 'October Spread', evidence: '', by: null, released }));

  test('due under RECOVERY, through the same flow as the fee', async () => {
    const i = await entry('spread_repayment', 40n * USDC, 100n * USDC);
    expect(i).toMatchObject({ kind: 'spread_repayment', sourceTag: 1, status: 'due', amount: 40n * USDC });
  });

  test('never more than the advances outstanding, counting what is already entered and not yet paid', async () => {
    await entry('recovery', 60n * USDC, 100n * USDC);
    await entry('spread_repayment', 40n * USDC, 100n * USDC);
    const over = entry('spread_repayment', 1n, 100n * USDC);
    await expect(over).rejects.toBeInstanceOf(AssuranceRefusal);
    await expect(entry('spread_repayment', 1n, 100n * USDC)).rejects.toThrow('advances outstanding');
    expect((await unpaid(db, CHAIN)).length).toBe(2);
  });

  test('nothing to repay when no draw was released', async () => {
    await expect(entry('spread_repayment', 1n * USDC, 0n)).rejects.toThrow('$0.00');
  });
});

describe('the interchange proposal', () => {
  test('25% of the month’s interchange, one per month', async () => {
    const input = { chainId: CHAIN, month: '2026-10', interchange: 1_234n * USDC, bps: 2500n, safe: '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50', note: '', by: null, batch: (x: bigint) => safeBatch(CHAIN, 'i', String(x), []) };
    const row = await recordInterchange(db, input);
    expect(row.amount).toBe(308_500_000n);
    expect(row.batch.meta.description).toBe('308500000');
    await expect(recordInterchange(db, input)).rejects.toThrow('already proposed');
  });
});

test('itemById reads an item back', async () => {
  const { rows } = await db.query<{ id: string }>(`INSERT INTO command.assurance_items (chain_id, kind, month, source_tag, amount, note) VALUES ($1, 'recovery', '2026-10-01', 1, 5, 'n') RETURNING id`, [CHAIN]);
  expect(await itemById(db, rows[0].id)).toMatchObject({ kind: 'recovery', month: '2026-10', amount: 5n, note: 'n' });
});
