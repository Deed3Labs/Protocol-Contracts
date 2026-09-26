import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { seedShop, testDb } from '../../db/testDb.js';
import { previousMonth, sendMonthlyStatements, sendStatement, StatementError, statementText } from './statements.js';
import { updateSettings } from './shop/shopService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const overview = {
  from: '2026-08-01',
  to: '2026-08-31',
  takenCents: 318204,
  orderCount: 22,
  byMethod: { clear: { count: 10, cents: 200000 }, card: { count: 9, cents: 100000 }, cash: { count: 3, cents: 18204 } },
  discounts: { count: 2, cents: 3000 },
  tips: { cents: 4500, byStaff: [{ staffId: 's', name: 'Jen R.', cents: 4500, cashCents: 0 }] },
  taxCents: 12000,
  refundsCents: 5000,
  topItems: [],
  dayReports: [],
};

describe('a statement by email', () => {
  test('the text: headings, labels and figures lined up', () => {
    const t = statementText({ shop: 'Mike’s Tire', month: 'August 2026', from: '2026-08-01', to: '2026-08-31', overview, deposits: [] });
    expect(t.split('\n').slice(0, 8)).toEqual([
      'Mike’s Tire: statement for August 2026',
      '2026-08-01 to 2026-08-31',
      '',
      'SALES',
      '  Taken (22 sales)  $3,182.04',
      '  Clear (10 sales)  $2,000.00',
      '  Card (9 sales)    $1,000.00',
      '  Cash (3 sales)    $182.04',
    ]);
    expect(t).toContain('  Refunds              -$50.00');
    expect(t).not.toContain('CARD DEPOSITS');
    expect(t).toContain('TIPS BY PERSON');
  });

  test('sent to the address, audited with its domain only', async () => {
    const { merchant, staff } = await seedShop(db);
    const sent: Array<{ to: string; subject: string; body: string }> = [];
    const r = await sendStatement(db, { configured: () => true, send: async (e) => void sent.push(e) }, { merchant, staffId: staff.owner, body: { from: '2026-08-01', to: '2026-08-31', email: 'books@acme-accounting.com' } });
    expect(r).toEqual({ sentTo: 'books@acme-accounting.com' });
    expect(sent[0]!.subject).toMatch(/^Shop \d+: statement for August 2026$/);
    expect(sent[0]!.body).toContain('Taken (0 sales)');
    const { rows } = await db.query<{ detail: Record<string, string> }>(`SELECT detail FROM payments.audit_log WHERE merchant = $1 AND action = 'statement.sent'`, [merchant]);
    expect(rows[0]!.detail).toEqual({ from: '2026-08-01', to: '2026-08-31', domain: 'acme-accounting.com' });
  });

  test('refused: no email set up, a bad address, a failed send', async () => {
    const { merchant, staff } = await seedShop(db);
    const body = { from: '2026-08-01', to: '2026-08-31', email: 'books@acme.com' };
    await expect(sendStatement(db, { configured: () => false, send: async () => undefined }, { merchant, staffId: staff.owner, body })).rejects.toMatchObject({ code: 'not_configured' });
    await expect(sendStatement(db, { configured: () => true, send: async () => undefined }, { merchant, staffId: staff.owner, body: { ...body, email: 'books' } })).rejects.toThrow('That isn’t an email address');
    await expect(
      sendStatement(db, { configured: () => true, send: async () => { throw new Error('Resend refused the email (403)'); } }, { merchant, staffId: staff.owner, body }),
    ).rejects.toBeInstanceOf(StatementError);
  });
});

describe('each month’s statement, on the 2nd', () => {
  test('the month before', () => {
    expect(previousMonth('2026-10-02')).toEqual({ period: '2026-09', from: '2026-09-01', to: '2026-09-30' });
    expect(previousMonth('2027-01-15')).toEqual({ period: '2026-12', from: '2026-12-01', to: '2026-12-31' });
    expect(previousMonth('2028-03-02')).toEqual({ period: '2028-02', from: '2028-02-01', to: '2028-02-29' });
  });

  test('sent from the 2nd in the shop’s time, once; only to shops that asked', async () => {
    const asked = await seedShop(db);
    const quiet = await seedShop(db);
    await updateSettings(db, { merchant: asked.merchant, staffId: asked.staff.owner, patch: { statementsEmail: 'books@acme-accounting.com' } });
    await updateSettings(db, { merchant: quiet.merchant, staffId: quiet.staff.owner, patch: { tips: { enabled: true, mode: 'amounts', presets: [500], goTo: 'raiser' } } });
    const sent: Array<{ to: string; subject: string }> = [];
    const mailer = { configured: () => true, send: async (e: { to: string; subject: string; body: string }) => void sent.push(e) };

    // Oct 1, 11pm in Los Angeles (Oct 2 in UTC): not yet the 2nd there.
    let r = await sendMonthlyStatements(db, mailer, new Date('2026-10-02T06:00:00Z'));
    expect(r.sent).not.toContain(asked.merchant);
    // Oct 2 in Los Angeles: September's goes.
    r = await sendMonthlyStatements(db, mailer, new Date('2026-10-02T17:00:00Z'));
    expect(r.sent).toContain(asked.merchant);
    expect(r.sent).not.toContain(quiet.merchant);
    const mine = sent.filter((e) => e.to === 'books@acme-accounting.com');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toMatch(/statement for September 2026$/);
    // The next day, nothing more.
    r = await sendMonthlyStatements(db, mailer, new Date('2026-10-03T17:00:00Z'));
    expect(r.sent).not.toContain(asked.merchant);
  });

  test('a send that fails is tried again the next day', async () => {
    const s = await seedShop(db);
    await updateSettings(db, { merchant: s.merchant, staffId: s.staff.owner, patch: { statementsEmail: 'books@acme.com' } });
    let fail = true;
    const mailer = { configured: () => true, send: async () => { if (fail) throw new Error('Resend refused the email (500)'); } };
    expect((await sendMonthlyStatements(db, mailer, new Date('2026-11-02T17:00:00Z'))).failed).toContain(s.merchant);
    fail = false;
    expect((await sendMonthlyStatements(db, mailer, new Date('2026-11-03T17:00:00Z'))).sent).toContain(s.merchant);
  });
});

