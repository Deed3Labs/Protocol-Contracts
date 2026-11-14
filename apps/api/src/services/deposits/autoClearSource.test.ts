import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/*
 * What a deposit does to what is owed (Phase 2b, section 12.2 as replaced).
 *
 *   - Auto-clear ON, a Spendable deposit: earmarked for the auto-clear sweep (the settler's cash,
 *     since the dollars arrived at Clear's partner bank). Term plans' dues are paid first.
 *   - Auto-clear OFF, a Spendable deposit: acceptance 19, "With autoClear OFF, a Spendable deposit
 *     changes no credit position". Nothing is settled, earmarked, netted or collected.
 *   - A Bridge (USDC-rail) deposit, either way: the member's own USDC, never swept.
 *
 * Against a stand-in Pay DB that owes $50 on Boost and $30 due on a term plan. Run on its own
 * (module mocks leak between files in one bun process).
 */

let queries: { sql: string; params: unknown[] }[] = [];
let autoClear = true;
let termReads = 0;
let cardRepaymentSyncs = 0;

const client = {
  query: async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (/INSERT INTO deposit_receipts/.test(sql) && /RETURNING rail/.test(sql)) return { rows: [{ rail: params[0] }], rowCount: 1 };
    if (/SELECT enabled FROM member_auto_repay/.test(sql)) return { rows: [{ enabled: autoClear }], rowCount: 1 };
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
  readTermDue: async () => {
    termReads += 1;
    return [{ planId: 4, cents: 3_000 }];
  },
  allocateTermDue: (amount: number, due: { cents: number }[]) => {
    const paid = due.map((d) => ({ ...d, cents: Math.min(d.cents, amount) }));
    return { paid, remainingCents: amount - paid.reduce((a, d) => a + d.cents, 0) };
  },
  bookTermPayments: async (c: typeof client, input: { paid: { cents: number }[] }) => {
    const cents = input.paid.reduce((a, d) => a + d.cents, 0);
    if (cents > 0) await c.query(`INSERT INTO lithic_ledger_entries ... 'term_settlement'`, [cents]);
    return cents;
  },
}));

const { depositApplication, recordDeposit, AUTO_CLEAR_RAILS } = await import('./depositReceiptService');

const WALLET = '0x00000000000000000000000000000000000000a1';
const earmarks = () => queries.filter((q) => /INSERT INTO auto_repay_due/.test(q.sql));
const settlements = () => queries.filter((q) => /'credit_settlement'/.test(q.sql));
const termPayments = () => queries.filter((q) => /'term_settlement'/.test(q.sql));
/** Anything a deposit could write that changes a credit position. */
const creditWrites = () => [...earmarks(), ...settlements(), ...termPayments()];

beforeEach(() => {
  queries = [];
  autoClear = true;
  termReads = 0;
  cardRepaymentSyncs = 0;
});

describe('which deposits auto-clear may clear from', () => {
  test('only the Spendable (Lithic ACH) rail', () => {
    expect([...AUTO_CLEAR_RAILS]).toEqual(['lithic_ach']);
  });

  test('the rule, on its own', () => {
    expect(depositApplication({ rail: 'bridge_va', autoClearOn: true, availableCents: 10_000, owedCents: 5_000 })).toEqual({ paysTermDue: false, earmarkCents: 0 });
    expect(depositApplication({ rail: 'lithic_ach', autoClearOn: true, availableCents: 10_000, owedCents: 5_000 })).toEqual({ paysTermDue: true, earmarkCents: 5_000 });
    expect(depositApplication({ rail: 'lithic_ach', autoClearOn: true, availableCents: 2_000, owedCents: 5_000 })).toEqual({ paysTermDue: true, earmarkCents: 2_000 });
    expect(depositApplication({ rail: 'lithic_ach', autoClearOn: false, availableCents: 10_000, owedCents: 5_000 })).toEqual({ paysTermDue: false, earmarkCents: 0 });
  });
});

describe('a deposit, end to end against the Pay DB', () => {
  test('acceptance 19: with auto-clear OFF, a Spendable deposit changes no credit position', async () => {
    autoClear = false;
    const outcome = await recordDeposit({ rail: 'lithic_ach', externalId: 'ach-off', wallet: WALLET, amountCents: 10_000 });
    expect(outcome.recorded).toBe(true);
    expect(creditWrites()).toEqual([]);
    expect(termReads).toBe(0);
    expect(cardRepaymentSyncs).toBe(0);
    expect(outcome.plan?.settledCents ?? 0).toBe(0);
    // The whole deposit stays the member's, in Spendable.
    expect(outcome.toCashCents + outcome.toSavingsCents).toBe(10_000);
  });

  test('Bridge with auto-clear ON: no credit position changes and nothing for the settler to pay', async () => {
    const outcome = await recordDeposit({ rail: 'bridge_va', externalId: 'bridge-1', wallet: WALLET, amountCents: 10_000 });
    expect(outcome.recorded).toBe(true);
    expect(creditWrites()).toEqual([]);
    expect(cardRepaymentSyncs).toBe(0);
    // The switch is not even read for a USDC deposit.
    expect(queries.some((q) => /SELECT enabled FROM member_auto_repay/.test(q.sql))).toBe(false);
  });

  test('Spendable with auto-clear ON: term dues first, then the line earmarked for the sweep, never settled in the books', async () => {
    await recordDeposit({ rail: 'lithic_ach', externalId: 'ach-on', wallet: WALLET, amountCents: 10_000 });
    expect(termPayments()).toHaveLength(1);
    expect(earmarks()).toHaveLength(1);
    expect(earmarks()[0].sql).toContain("'spendable'");
    // $100 deposit, $30 to the plan, $50 owed on the line: the earmark is the $50.
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
