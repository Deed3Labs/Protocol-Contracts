import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { tipsPayable } from './accounts.js';
import { balance, balances, type EntryInput, LedgerError, post, reverse } from './ledgerService.js';
import * as postings from './postings.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const postIt = (e: EntryInput) => db.transaction((tx) => post(tx, e));
const bal = (merchant: string, account: Parameters<typeof balance>[2]) => balance(db, merchant, account);

/** Debit-normal balances minus credit-normal ones: 0 in books that balance. */
async function trial(merchant: string) {
  const all = await balances(db, merchant);
  let sum = 0;
  for (const [code, cents] of all) {
    const creditNormal = code === 'sales' || code === 'tax_payable' || code.startsWith('tips_payable:');
    sum += creditNormal ? -cents : cents;
  }
  return sum;
}

describe('example postings', () => {
  test('cash sale: drawer cash in; sales, tax and tips owed', async () => {
    const { merchant, staff } = await seedShop(db);
    // $36.00 of goods, $2.00 off, $2.79 tax: $36.79, plus a $3.00 tip for Jen.
    const { entry } = await postIt(
      postings.sale({
        merchant,
        orderId: 'ord_1',
        subtotalCents: 3600,
        discountCents: 200,
        taxCents: 279,
        tenders: [{ id: 'tnd_1', method: 'cash', amountCents: 3679, tipCents: 300, tipStaffId: staff.jen }],
      }),
    );
    expect(entry.kind).toBe('cash_sale');
    expect(entry.lines).toEqual([
      { account: 'drawer_cash', debitCents: 3979, creditCents: 0 },
      { account: 'discounts', debitCents: 200, creditCents: 0 },
      { account: 'sales', debitCents: 0, creditCents: 3600 },
      { account: 'tax_payable', debitCents: 0, creditCents: 279 },
      { account: tipsPayable(staff.jen), debitCents: 0, creditCents: 300 },
    ]);
    expect(await bal(merchant, 'drawer_cash')).toBe(3979);
    expect(await bal(merchant, 'sales')).toBe(3600);
    expect(await bal(merchant, tipsPayable(staff.jen))).toBe(300);
    expect(await trial(merchant)).toBe(0);
  });

  test('card authorised, then captured: a receivable, and the fees when the payout lands', async () => {
    const { merchant, staff } = await seedShop(db);
    // Authorised at the tap for $92.75 + a $10.00 tip; the order is paid, so the sale posts now.
    await postIt(
      postings.sale({
        merchant,
        orderId: 'ord_2',
        subtotalCents: 8610,
        discountCents: 0,
        taxCents: 665,
        tenders: [{ id: 'tnd_2', method: 'card', amountCents: 9275, tipCents: 1000, tipStaffId: staff.luis }],
      }),
    );
    expect(await bal(merchant, 'card_receivable')).toBe(10275);
    // Luis bumps the tip to $15.00 before Close the day captures it: only the difference posts.
    await postIt(postings.cardTipAdjusted({ merchant, tenderId: 'tnd_2', adjustmentId: 'adj_1', staffId: staff.luis, fromCents: 1000, toCents: 1500 })!);
    expect(await bal(merchant, 'card_receivable')).toBe(10775);
    // Capture changes the tender's status and posts nothing: the receivable is already right.
    // Two days later Stripe pays out, with its own figures for the fees.
    await postIt(postings.cardPayout({ merchant, payoutId: 'po_1', grossCents: 10775, stripeFeeCents: 292, clearFeeCents: 30 }));
    expect(await bal(merchant, 'card_receivable')).toBe(0);
    expect(await bal(merchant, 'bank')).toBe(10453);
    expect(await bal(merchant, 'card_processing_expense')).toBe(322);
    expect(await bal(merchant, tipsPayable(staff.luis))).toBe(1500);
    expect(await trial(merchant)).toBe(0);
  });

  test('tip paid from the drawer', async () => {
    const { merchant, staff } = await seedShop(db);
    await postIt(postings.sale({ merchant, orderId: 'ord_3', subtotalCents: 1000, discountCents: 0, taxCents: 0, tenders: [{ id: 'tnd_3', method: 'cash', amountCents: 1000, tipCents: 500, tipStaffId: staff.jen }] }));
    const { entry } = await postIt(postings.tipPaidOut({ merchant, payoutId: 'tp_1', staffId: staff.jen, sessionId: 'drw_1', cents: 500 }));
    expect(entry.lines).toEqual([
      { account: tipsPayable(staff.jen), debitCents: 500, creditCents: 0 },
      { account: 'drawer_cash', debitCents: 0, creditCents: 500 },
    ]);
    expect(await bal(merchant, tipsPayable(staff.jen))).toBe(0);
    expect(await bal(merchant, 'drawer_cash')).toBe(1000);
  });

  test('short at close, and over', async () => {
    const { merchant } = await seedShop(db);
    await postIt(postings.sale({ merchant, orderId: 'ord_4', subtotalCents: 21179, discountCents: 0, taxCents: 0, tenders: [{ id: 't', method: 'cash', amountCents: 21179, tipCents: 0, tipStaffId: null }] }));
    // Counted $208.00 against $211.79 expected: $3.79 short.
    const { entry } = await postIt(postings.drawerDifference({ merchant, sessionId: 'drw_short', differenceCents: -379 })!);
    expect(entry.kind).toBe('drawer_short');
    expect(entry.lines).toEqual([
      { account: 'cash_over_short', debitCents: 379, creditCents: 0 },
      { account: 'drawer_cash', debitCents: 0, creditCents: 379 },
    ]);
    expect(await bal(merchant, 'drawer_cash')).toBe(20800);
    const over = await postIt(postings.drawerDifference({ merchant, sessionId: 'drw_over', differenceCents: 25 })!);
    expect(over.entry.kind).toBe('drawer_over');
    expect(await bal(merchant, 'cash_over_short')).toBe(354);
    expect(postings.drawerDifference({ merchant, sessionId: 'drw_even', differenceCents: 0 })).toBeNull();
  });

  test('deposit marked: in transit, then the bank', async () => {
    const { merchant } = await seedShop(db);
    await postIt(postings.sale({ merchant, orderId: 'ord_5', subtotalCents: 30000, discountCents: 0, taxCents: 0, tenders: [{ id: 't', method: 'cash', amountCents: 30000, tipCents: 0, tipStaffId: null }] }));
    await postIt(postings.depositLeftDrawer({ merchant, depositId: 'dep_1', amountCents: 15000 }));
    expect(await bal(merchant, 'drawer_cash')).toBe(15000);
    expect(await bal(merchant, 'cash_in_transit_to_bank')).toBe(15000);
    await postIt(postings.depositMarked({ merchant, depositId: 'dep_1', amountCents: 15000 }));
    expect(await bal(merchant, 'cash_in_transit_to_bank')).toBe(0);
    expect(await bal(merchant, 'bank')).toBe(15000);
  });

  test('cash refund: refunds, and cash out of the drawer', async () => {
    const { merchant } = await seedShop(db);
    await postIt(postings.sale({ merchant, orderId: 'ord_6', subtotalCents: 3600, discountCents: 0, taxCents: 279, tenders: [{ id: 't', method: 'cash', amountCents: 3879, tipCents: 0, tipStaffId: null }] }));
    const { entry } = await postIt(postings.refund({ merchant, refundId: 'rf_1', method: 'cash', amountCents: 3879, taxCents: 279 }));
    expect(entry.lines).toEqual([
      { account: 'refunds', debitCents: 3600, creditCents: 0 },
      { account: 'tax_payable', debitCents: 279, creditCents: 0 },
      { account: 'drawer_cash', debitCents: 0, creditCents: 3879 },
    ]);
    expect(await bal(merchant, 'drawer_cash')).toBe(0);
    expect(await bal(merchant, 'tax_payable')).toBe(0);
    expect(await trial(merchant)).toBe(0);
  });

  test('a split sale debits each tender where its money went', async () => {
    const { merchant, staff } = await seedShop(db);
    const { entry } = await postIt(
      postings.sale({
        merchant,
        orderId: 'ord_7',
        subtotalCents: 21000,
        discountCents: 0,
        taxCents: 1779,
        tenders: [
          { id: 'a', method: 'cash', amountCents: 20000, tipCents: 0, tipStaffId: null },
          { id: 'b', method: 'card', amountCents: 2779, tipCents: 200, tipStaffId: staff.jen },
        ],
      }),
    );
    expect(entry.kind).toBe('split_sale');
    expect(await bal(merchant, 'drawer_cash')).toBe(20000);
    expect(await bal(merchant, 'card_receivable')).toBe(2979);
  });
});

describe('idempotency', () => {
  test('the same fact posted twice is one entry', async () => {
    const { merchant } = await seedShop(db);
    const e = postings.depositMarked({ merchant, depositId: 'dep_x', amountCents: 500 });
    const first = await postIt(e);
    const again = await postIt({ ...e, occurredAt: new Date(Date.now() + 60_000) });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.entry.id).toBe(first.entry.id);
    expect(await bal(merchant, 'bank')).toBe(500);
  });

  test('the same key with different lines is refused', async () => {
    const { merchant } = await seedShop(db);
    await postIt(postings.depositMarked({ merchant, depositId: 'dep_y', amountCents: 500 }));
    await expect(postIt(postings.depositMarked({ merchant, depositId: 'dep_y', amountCents: 600 }))).rejects.toThrow('already used for a different entry');
  });

  test('keys are per shop', async () => {
    const a = await seedShop(db);
    const b = await seedShop(db);
    await postIt(postings.depositMarked({ merchant: a.merchant, depositId: 'dep_z', amountCents: 500 }));
    const { created } = await postIt(postings.depositMarked({ merchant: b.merchant, depositId: 'dep_z', amountCents: 700 }));
    expect(created).toBe(true);
    expect(await bal(b.merchant, 'bank')).toBe(700);
    expect(await bal(a.merchant, 'bank')).toBe(500);
  });
});

describe('reversal', () => {
  test('voiding a sale before capture reverses it, once', async () => {
    const { merchant } = await seedShop(db);
    const { entry } = await postIt(postings.sale({ merchant, orderId: 'ord_v', subtotalCents: 93752, discountCents: 0, taxCents: 0, tenders: [{ id: 't', method: 'card', amountCents: 93752, tipCents: 0, tipStaffId: null }] }));
    const r1 = await db.transaction((tx) => reverse(tx, { merchant, entryId: entry.id }));
    expect(r1.entry.reverses).toBe(entry.id);
    expect(r1.entry.lines).toEqual(entry.lines.map((l) => ({ account: l.account, debitCents: l.creditCents, creditCents: l.debitCents })));
    const r2 = await db.transaction((tx) => reverse(tx, { merchant, entryId: entry.id }));
    expect(r2.created).toBe(false);
    expect(r2.entry.id).toBe(r1.entry.id);
    expect(await bal(merchant, 'card_receivable')).toBe(0);
    expect(await bal(merchant, 'sales')).toBe(0);
    // Both entries stay.
    const { rows } = await db.query('SELECT id FROM ledger.journal_entries WHERE merchant = $1', [merchant]);
    expect(rows).toHaveLength(2);
  });

  test("a reversal isn't reversed, and another shop's entry isn't found", async () => {
    const { merchant } = await seedShop(db);
    const other = await seedShop(db);
    const { entry } = await postIt(postings.depositMarked({ merchant, depositId: 'd', amountCents: 100 }));
    const r = await db.transaction((tx) => reverse(tx, { merchant, entryId: entry.id }));
    await expect(db.transaction((tx) => reverse(tx, { merchant, entryId: r.entry.id }))).rejects.toThrow('not reversed');
    await expect(db.transaction((tx) => reverse(tx, { merchant: other.merchant, entryId: entry.id }))).rejects.toBeInstanceOf(LedgerError);
  });

  test('balance as of a moment ignores what came after', async () => {
    const { merchant } = await seedShop(db);
    await postIt({ ...postings.depositMarked({ merchant, depositId: 'early', amountCents: 100 }), occurredAt: '2026-09-01T12:00:00Z' });
    await postIt({ ...postings.depositMarked({ merchant, depositId: 'late', amountCents: 900 }), occurredAt: '2026-09-20T12:00:00Z' });
    expect(await balance(db, merchant, 'bank', '2026-09-10T00:00:00Z')).toBe(100);
    expect(await balance(db, merchant, 'bank')).toBe(1000);
  });
});

describe('the service refuses', () => {
  test('an unbalanced entry, a zero line, fractions, one line, and unknown accounts', async () => {
    const { merchant } = await seedShop(db);
    const base = { merchant, kind: 'test', idempotencyKey: 'k' };
    await expect(postIt({ ...base, lines: [{ account: 'bank', debit: 100 }, { account: 'sales', credit: 99 }] })).rejects.toThrow('Unbalanced');
    await expect(postIt({ ...base, lines: [{ account: 'bank', debit: 0 }, { account: 'sales', credit: 0 }] })).rejects.toThrow('not zero');
    await expect(postIt({ ...base, lines: [{ account: 'bank', debit: 1.5 }, { account: 'sales', credit: 1.5 }] })).rejects.toThrow('whole');
    await expect(postIt({ ...base, lines: [{ account: 'bank', debit: 100 }] })).rejects.toThrow('two lines');
    await expect(postIt({ ...base, lines: [{ account: 'petty_cash' as never, debit: 1 }, { account: 'sales', credit: 1 }] })).rejects.toThrow('Unknown ledger account');
  });

  test('a sale whose tenders do not pay the total', () => {
    expect(() =>
      postings.sale({ merchant: 'm', orderId: 'o', subtotalCents: 1000, discountCents: 0, taxCents: 80, tenders: [{ id: 't', method: 'cash', amountCents: 1000, tipCents: 0, tipStaffId: null }] }),
    ).toThrow('the order is 1080');
  });
});

describe('the database refuses, whatever wrote it', () => {
  async function rawEntry(merchant: string, lines: Array<[string, number, number]>, opts: { id?: string } = {}) {
    const id = opts.id ?? `je_raw_${Math.random().toString(36).slice(2)}`;
    return db.transaction(async (tx) => {
      const { ensureAccounts } = await import('./ledgerService.js');
      const accts = await ensureAccounts(tx, merchant);
      await tx.query(
        `INSERT INTO ledger.journal_entries (id, merchant, occurred_at, kind, idempotency_key, content_hash) VALUES ($1, $2, now(), 'raw', $1, 'h')`,
        [id, merchant],
      );
      for (const [code, dr, cr] of lines) {
        await tx.query('INSERT INTO ledger.journal_lines (entry_id, account_id, debit_cents, credit_cents) VALUES ($1, $2, $3, $4)', [id, accts.get(code as never), dr, cr]);
      }
      return id;
    });
  }

  test('an unbalanced entry does not commit', async () => {
    const { merchant } = await seedShop(db);
    await expect(rawEntry(merchant, [['bank', 100, 0], ['sales', 0, 90]])).rejects.toThrow('unbalanced');
    const { rows } = await db.query('SELECT 1 FROM ledger.journal_entries WHERE merchant = $1', [merchant]);
    expect(rows).toHaveLength(0);
  });

  test('an entry with no lines, or one', async () => {
    const { merchant } = await seedShop(db);
    await expect(rawEntry(merchant, [])).rejects.toThrow('at least two');
    await expect(rawEntry(merchant, [['bank', 0, 0]])).rejects.toThrow();
  });

  test("a line on another shop's account", async () => {
    const a = await seedShop(db);
    const b = await seedShop(db);
    await expect(
      db.transaction(async (tx) => {
        const { ensureAccounts } = await import('./ledgerService.js');
        const mine = await ensureAccounts(tx, a.merchant);
        const theirs = await ensureAccounts(tx, b.merchant);
        await tx.query(`INSERT INTO ledger.journal_entries (id, merchant, occurred_at, kind, idempotency_key, content_hash) VALUES ('je_x', $1, now(), 'raw', 'x', 'h')`, [a.merchant]);
        await tx.query('INSERT INTO ledger.journal_lines (entry_id, account_id, debit_cents) VALUES ($1, $2, 100)', ['je_x', mine.get('bank')]);
        await tx.query('INSERT INTO ledger.journal_lines (entry_id, account_id, credit_cents) VALUES ($1, $2, 100)', ['je_x', theirs.get('sales')]);
      }),
    ).rejects.toThrow("another shop's account");
  });

  test('editing or deleting an entry, a line or an account', async () => {
    const { merchant } = await seedShop(db);
    const { entry } = await postIt(postings.depositMarked({ merchant, depositId: 'd', amountCents: 100 }));
    await expect(db.query(`UPDATE ledger.journal_entries SET memo = 'edited' WHERE id = $1`, [entry.id])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM ledger.journal_entries WHERE id = $1', [entry.id])).rejects.toThrow('append-only');
    await expect(db.query('UPDATE ledger.journal_lines SET debit_cents = 1 WHERE entry_id = $1', [entry.id])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM ledger.journal_lines WHERE entry_id = $1', [entry.id])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM ledger.accounts WHERE merchant = $1', [merchant])).rejects.toThrow('append-only');
    await expect(db.query('TRUNCATE ledger.journal_lines')).rejects.toThrow('append-only');
    expect(await bal(merchant, 'bank')).toBe(100);
  });

  test('a reversal that does not mirror what it reverses', async () => {
    const { merchant } = await seedShop(db);
    const { entry } = await postIt(postings.depositMarked({ merchant, depositId: 'd', amountCents: 100 }));
    await expect(
      db.transaction(async (tx) => {
        const { ensureAccounts } = await import('./ledgerService.js');
        const accts = await ensureAccounts(tx, merchant);
        await tx.query(
          `INSERT INTO ledger.journal_entries (id, merchant, occurred_at, kind, idempotency_key, content_hash, reverses) VALUES ('je_bad_rev', $1, now(), 'reversal', 'r', 'h', $2)`,
          [merchant, entry.id],
        );
        await tx.query('INSERT INTO ledger.journal_lines (entry_id, account_id, debit_cents) VALUES ($1, $2, 90)', ['je_bad_rev', accts.get('cash_in_transit_to_bank')]);
        await tx.query('INSERT INTO ledger.journal_lines (entry_id, account_id, credit_cents) VALUES ($1, $2, 90)', ['je_bad_rev', accts.get('bank')]);
      }),
    ).rejects.toThrow('does not exactly reverse');
  });

  test('an account whose code and type disagree', async () => {
    const { merchant } = await seedShop(db);
    await expect(
      db.query(`INSERT INTO ledger.accounts (id, merchant, code, type, normal) VALUES ('a_bad', $1, 'bank', 'income', 'credit')`, [merchant]),
    ).rejects.toThrow();
  });
});
