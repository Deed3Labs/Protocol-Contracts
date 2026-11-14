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
/** Lithic holds asked for after a deposit: the first step of moving the money. */
let holdsAsked: string[] = [];

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

const realRuns = await import('./autoClearRuns');
mock.module('./autoClearRuns.js', () => ({
  ...realRuns,
  holdAutoClear: async (ref: string) => {
    holdsAsked.push(ref);
    return null;
  },
}));

const { depositApplication, recordDeposit, AUTO_CLEAR_RAILS } = await import('./depositReceiptService');

const WALLET = '0x00000000000000000000000000000000000000a1';
const earmarks = () => queries.filter((q) => /INSERT INTO auto_clear_runs/.test(q.sql));
const settlements = () => queries.filter((q) => /'credit_settlement'/.test(q.sql));
const termPayments = () => queries.filter((q) => /'term_settlement'/.test(q.sql));
/** Anything a deposit could write that changes a credit position. */
const creditWrites = () => [...earmarks(), ...settlements(), ...termPayments()];

beforeEach(() => {
  queries = [];
  autoClear = true;
  termReads = 0;
  cardRepaymentSyncs = 0;
  holdsAsked = [];
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
    // And no money moves: nothing is held at Lithic, so nothing can be transferred.
    expect(holdsAsked).toEqual([]);
    expect(outcome.plan?.settledCents ?? 0).toBe(0);
    // The whole deposit stays the member's, in Spendable.
    expect(outcome.toCashCents + outcome.toSavingsCents).toBe(10_000);
  });

  test('Bridge with auto-clear ON: no credit position changes and nothing for the settler to pay', async () => {
    const outcome = await recordDeposit({ rail: 'bridge_va', externalId: 'bridge-1', wallet: WALLET, amountCents: 10_000 });
    expect(outcome.recorded).toBe(true);
    expect(creditWrites()).toEqual([]);
    expect(cardRepaymentSyncs).toBe(0);
    expect(holdsAsked).toEqual([]);
    // The switch is not even read for a USDC deposit.
    expect(queries.some((q) => /SELECT enabled FROM member_auto_repay/.test(q.sql))).toBe(false);
  });

  test('Spendable with auto-clear ON: term dues first, then one clearing for the line, held at Lithic, never settled in the books', async () => {
    await recordDeposit({ rail: 'lithic_ach', externalId: 'ach-on', wallet: WALLET, amountCents: 10_000 });
    expect(termPayments()).toHaveLength(1);
    expect(earmarks()).toHaveLength(1);
    // $100 deposit, $30 to the plan, $50 owed on the line: the clearing is the $50, keyed by a ref
    // derived from this receipt (the same ref goes on chain and roots the Lithic tokens).
    const ref = realRuns.refFor('lithic_ach', 'ach-on');
    expect(earmarks()[0].params).toEqual([ref, WALLET, 'lithic_ach', 'ach-on', 5_000]);
    expect(holdsAsked).toEqual([ref]);
    expect(settlements()).toEqual([]);
    expect(cardRepaymentSyncs).toBe(0);
  });
});

describe('the sweep', () => {
  const sweep = readFileSync(new URL('../chain/autoRepayService.ts', import.meta.url), 'utf8');

  test('clears only per-deposit clearings (Spendable deposits), and releases anything earmarked before them', () => {
    expect(sweep).toContain('UPDATE auto_repay_due SET due_cents = 0, updated_at = now() WHERE due_cents > 0');
    expect(sweep).toContain('pgRunStore.listOpen(limit)');
    expect(sweep).toContain('advanceRun(run, deps)');
    // The chain is reached only through the clearing's state machine, which holds the money first.
    expect(sweep.match(/issuer\.repayForMember\(/g)).toHaveLength(1);
    expect(sweep.indexOf('submit: async')).toBeLessThan(sweep.indexOf('issuer.repayForMember('));
  });
});
