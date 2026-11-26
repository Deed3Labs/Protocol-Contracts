import { describe, expect, test } from 'bun:test';
import { creditsLive } from './creditsLive';
import type { ChainReader } from './onchain';

/* Money → Credit's Clear Credits and Housing Allowance cards: each part read on its own. */

const reader = (outstanding: bigint, cap: bigint): ChainReader => ({
  read: async (calls) => calls.map((c) => (c.fn === 'outstanding' ? outstanding : cap)),
});
const totals = {
  minted: { saving: 1500, rent: 40, bill: 60 },
  pending: 300,
  vested: 20,
  voided: 5,
  byDay: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(12 + i).padStart(2, '0')}`, minted: i >= 10 ? 100 : 0 })),
};

describe('creditsLive', () => {
  test('the line in whole credits, the ledger with its total and last 7 days, and the housing totals', async () => {
    const housing = { records: 1 } as any;
    const k = await creditsLive({ reader: reader(1_350n * 1_000_000n, 10_000_000n * 1_000_000n), ledger: async () => totals, housing: async () => housing });
    expect(k.line).toEqual({ outstanding: 1350, cap: 10_000_000 });
    expect(k.ledger).toMatchObject({ mintedTotal: 1600, mintedWeek: 400, pending: 300 });
    expect(k.housing).toBe(housing);
  });

  test('a part that can’t be read is null and the rest stand', async () => {
    const k = await creditsLive({
      reader: { read: async () => Promise.reject(new Error('rpc down')) },
      ledger: async () => Promise.reject(new Error('no db')),
      housing: null,
    });
    expect(k).toEqual({ line: null, ledger: null, housing: null });
  });
});
