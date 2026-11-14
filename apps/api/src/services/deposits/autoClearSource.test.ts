import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/*
 * Auto-clear runs only on Spendable deposits (Phase 2b 12.2, the owner's "option 1").
 *
 * The settler pays each clearing from Clear's own USDC, so it may clear only from a fiat deposit
 * that landed at the partner bank. A Bridge (USDC-rail) deposit lands in the member's own wallet as
 * Ready to allocate and is never swept: with auto-clear ON it must change no credit position and
 * leave nothing for the settler to pay.
 *
 * Against a stand-in Pay DB that owes $50 on Boost, with auto-clear switched on. Run on its own
 * (module mocks leak between files in one bun process).
 */

let queries: { sql: string; params: unknown[] }[] = [];
let cardRepaymentSyncs = 0;

const client = {
  query: async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (/INSERT INTO deposit_receipts|INSERT INTO \S*receipts/i.test(sql) && /RETURNING rail/.test(sql)) return { rows: [{ rail: params[0] }], rowCount: 1 };
    if (/SELECT enabled FROM member_auto_repay/.test(sql)) return { rows: [{ enabled: true }], rowCount: 1 };
    if (/account LIKE 'member_credit_%'/.test(sql)) return { rows: [{ account: 'member_credit_boost', net: '5000' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
  release: () => {},
};

mock.module('../../config/postgres.js', () => ({
  getPayPool: () => ({ connect: async () => client, query: client.query }),
  getPostgresPool: () => null,
}));
mock.module('../lithic/snapshotService.js', () => ({ refreshSnapshotsFor: async () => 0 }));
mock.module('../chain/cardSettlementService.js', () => ({
  syncCardRepayment: async () => {
    cardRepaymentSyncs += 1;
  },
}));
mock.module('../chain/termCollection.js', () => ({
  readTermDue: async () => [],
  allocateTermDue: (amount: number) => ({ paid: [], remainingCents: amount }),
  bookTermPayments: async () => 0,
}));

const { depositApplication, recordDeposit, AUTO_CLEAR_RAILS } = await import('./depositReceiptService');

const WALLET = '0x00000000000000000000000000000000000000a1';
const earmarks = () => queries.filter((q) => /INSERT INTO auto_repay_due/.test(q.sql));
const settlements = () => queries.filter((q) => /'credit_settlement'/.test(q.sql));

beforeEach(() => {
  queries = [];
  cardRepaymentSyncs = 0;
});

describe('which deposits auto-clear may clear from', () => {
  test('only the Spendable (Lithic ACH) rail', () => {
    expect([...AUTO_CLEAR_RAILS]).toEqual(['lithic_ach']);
  });

  test('the rule, on its own', () => {
    expect(depositApplication({ rail: 'bridge_va', autoClearOn: true, availableCents: 10_000, owedCents: 5_000 })).toEqual({ settleInBooks: false, earmarkCents: 0 });
    expect(depositApplication({ rail: 'lithic_ach', autoClearOn: true, availableCents: 10_000, owedCents: 5_000 })).toEqual({ settleInBooks: false, earmarkCents: 5_000 });
    expect(depositApplication({ rail: 'lithic_ach', autoClearOn: true, availableCents: 2_000, owedCents: 5_000 })).toEqual({ settleInBooks: false, earmarkCents: 2_000 });
    expect(depositApplication({ rail: 'lithic_ach', autoClearOn: false, availableCents: 10_000, owedCents: 5_000 })).toEqual({ settleInBooks: true, earmarkCents: 0 });
  });
});

describe('a deposit, end to end against the Pay DB', () => {
  test('Bridge with auto-clear ON: no credit position changes and nothing for the settler to pay', async () => {
    const outcome = await recordDeposit({ rail: 'bridge_va', externalId: 'bridge-1', wallet: WALLET, amountCents: 10_000 });
    expect(outcome.recorded).toBe(true);
    expect(earmarks()).toEqual([]);
    expect(settlements()).toEqual([]);
    expect(cardRepaymentSyncs).toBe(0);
    // The switch is not even read for a USDC deposit.
    expect(queries.some((q) => /SELECT enabled FROM member_auto_repay/.test(q.sql))).toBe(false);
    expect(outcome.plan?.settledCents ?? 0).toBe(0);
  });

  test('Spendable with auto-clear ON: earmarked for the sweep, marked spendable, not settled twice', async () => {
    await recordDeposit({ rail: 'lithic_ach', externalId: 'ach-1', wallet: WALLET, amountCents: 10_000 });
    expect(earmarks()).toHaveLength(1);
    expect(earmarks()[0].sql).toContain("'spendable'");
    expect(earmarks()[0].params).toEqual([WALLET, 5_000]);
    expect(settlements()).toEqual([]);
    expect(cardRepaymentSyncs).toBe(0);
  });
});

describe('the sweep pays only Spendable earmarks', () => {
  const sweep = readFileSync(new URL('../chain/autoRepayService.ts', import.meta.url), 'utf8');

  test('it selects source = spendable, and releases anything else rather than paying it', () => {
    expect(sweep).toContain("WHERE due_cents > 0 AND source = '${AUTO_CLEAR_SOURCE}'");
    expect(sweep).toContain("WHERE due_cents > 0 AND source IS DISTINCT FROM '${AUTO_CLEAR_SOURCE}'");
    expect(sweep.indexOf('IS DISTINCT FROM')).toBeLessThan(sweep.indexOf('issuer.repayForMember('));
  });
});
