import { describe, expect, test } from 'bun:test';
import { testDb } from '../../db/testDb';
import { topUpStore } from '../payoutFunding/topUpStore';
import { payoutTopUpsLive, payoutTopUpsSeed } from './payoutTopUps';

const POOL = '0x1000000000000000000000000000000000000001';
const U = 1_000_000n;

describe('Money\'s automatic top-ups card', () => {
  test('live: nothing until the job has checked; then its check, its top-ups with links, and what needs a person', async () => {
    const { db } = await testDb();
    expect(await payoutTopUpsLive(db)).toBe(null);
    const store = topUpStore(db, 84532, POOL);
    const row = await store.create({
      trigger: 'low-water', lowShort: 300n * U, targetShort: 7_000n * U, need: 7_100n * U, amount: 5_000n * U, remainder: 2_100n * U,
      safeBatch: { version: '1.0', transactions: [{ to: '0x4', value: '0', data: '0xa9059cbb' }] }, nonceBefore: 1, status: 'planned',
    });
    await store.update(row.id, { pullTx: '0x' + 'a'.repeat(64), approveTx: '0x' + 'b'.repeat(64), fundTx: '0x' + 'c'.repeat(64), status: 'funded' });
    await store.saveCheck(new Date(1_795_000_000_000), {
      addresses: { wallet: '0xW', safe: '0xS' },
      low: { days: 14, amount: (2_000n * U).toString(), short: '0' },
      target: { days: 30, amount: (8_000n * U).toString(), short: (2_000n * U).toString() },
      margin: (100n * U).toString(),
      operatingBalance: (10_000n * U).toString(),
      allowance: { cap: (5_000n * U).toString(), spent: (5_000n * U).toString(), remaining: '0', resetMinutes: 10_080, resetsAt: 1_795_300_000 },
      needsHuman: null,
      outcome: 'idle',
    });
    const card = (await payoutTopUpsLive(db))!;
    expect(card.lastCheck).toBe(1_795_000_000_000);
    expect(card.low).toEqual({ days: 14, due: 2_000, short: 0, truncated: false });
    expect(card.target.short).toBe(2_000);
    expect(card.allowance).toEqual({ cap: 5_000, spent: 5_000, remaining: 0, resetMinutes: 10_080, resetsAt: 1_795_300_000_000 });
    expect(card.recent).toHaveLength(1);
    expect(card.recent[0]).toMatchObject({ amount: 5_000, trigger: 'low-water', status: 'funded' });
    expect(card.recent[0].txs.map(([k]) => k)).toEqual(['pull', 'approve', 'fund']);
    expect(card.explorer).toBe('https://sepolia.basescan.org/tx/');
    // The remainder stays on the card until it arrives (a wallet-balance top-up after it).
    expect(card.needsHuman).toMatchObject({ why: 'remainder', remainder: 2_100 });
    const paid = await store.create({ trigger: 'wallet-balance', lowShort: 0n, targetShort: 0n, need: 2_100n * U, amount: 2_100n * U, remainder: 0n, safeBatch: null, nonceBefore: null, status: 'pulled' });
    await store.update(paid.id, { status: 'funded' });
    expect((await payoutTopUpsLive(db))!.needsHuman).toBe(null);
    expect(card.halted).toBe(null);
  });

  test('seeded: a sample, like the other cards', () => {
    const c = payoutTopUpsSeed(1_795_000_000_000);
    expect(c.allowance.cap).toBe(5_000);
    expect(c.recent[0].status).toBe('funded');
  });
});
