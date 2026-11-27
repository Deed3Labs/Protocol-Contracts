import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { addBank, BankError, bankAccounts, bankLinkToken, type BankRail, type PlaidBank, removeBank } from './bankService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

/** Plaid as the tests play it: one checking account behind any public token. */
function fakePlaid(opts: { configured?: boolean; noAccount?: boolean } = {}): PlaidBank & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    configured: () => opts.configured ?? true,
    linkToken: async (user) => `link-sandbox-${user.slice(-4)}`,
    accountFor: async (publicToken, accountId) => {
      reads.push(`${publicToken}:${accountId}`);
      return opts.noAccount ? null : { accountNumber: '1111222233330000', routingNumber: '011401533', mask: '0000', subtype: 'checking', name: 'Plaid Checking' };
    },
  };
}
function fakeRail(opts: { refuse?: string; notReady?: boolean } = {}): BankRail & { registered: Array<Record<string, unknown>>; removed: string[] } {
  const registered: Array<Record<string, unknown>> = [];
  const removed: string[] = [];
  return {
    name: 'bridge',
    ready: async () => !opts.notReady,
    registered,
    removed,
    register: async (input) => {
      registered.push(input);
      return opts.refuse ? { error: opts.refuse } : { externalAccountId: `ea_${registered.length}` };
    },
    remove: async (_c, ext) => void removed.push(ext),
  };
}

async function verifiedShop() {
  const s = await seedShop(db);
  await db.query(
    `UPDATE merchant.profiles SET bridge_customer_id = 'cus_biz', name = 'Mike’s Tire LLC', address_line1 = '412 Colton Ave', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92374' WHERE merchant = $1`,
    [s.merchant],
  );
  return s;
}

describe('linking a bank', () => {
  test('Plaid’s account, registered with Bridge in the business’s name at its address; only the last four kept', async () => {
    const s = await verifiedShop();
    expect(await bankLinkToken(db, { plaid: fakePlaid(), rail: fakeRail() }, s.merchant)).toEqual({ linkToken: `link-sandbox-${s.merchant.slice(-4)}` });
    const plaid = fakePlaid();
    const rail = fakeRail();
    const b = await addBank(db, { plaid, rail }, { merchant: s.merchant, staffId: s.staff.owner, body: { publicToken: 'public-sandbox-1', accountId: 'acc_1', institution: 'First Platypus Bank' } });
    expect(b).toMatchObject({ bankName: 'First Platypus Bank', mask: '0000', subtype: 'checking' });
    expect(plaid.reads).toEqual(['public-sandbox-1:acc_1']);
    expect(rail.registered[0]).toEqual({
      customerId: 'cus_biz',
      ownerName: 'Mike’s Tire LLC',
      bankName: 'First Platypus Bank',
      accountNumber: '1111222233330000',
      routingNumber: '011401533',
      subtype: 'checking',
      address: { line1: '412 Colton Ave', line2: null, city: 'Redlands', region: 'CA', postalCode: '92374' },
    });
    // The full numbers are nowhere in the database.
    const { rows } = await db.query<{ row: string }>('SELECT row_to_json(b)::text AS row FROM merchant.bank_accounts b WHERE merchant = $1', [s.merchant]);
    expect(rows[0]!.row).not.toContain('1111222233330000');
    expect(rows[0]!.row).not.toContain('011401533');
    expect(await bankAccounts(db, s.merchant)).toHaveLength(1);

    await removeBank(db, rail, { merchant: s.merchant, staffId: s.staff.owner, id: b.id });
    expect(rail.removed).toEqual(['ea_1']);
    expect(await bankAccounts(db, s.merchant)).toEqual([]);
    const { rows: log } = await db.query<{ action: string }>(`SELECT action FROM payments.audit_log WHERE merchant = $1 AND action LIKE 'bank.%' ORDER BY at`, [s.merchant]);
    expect(log.map((r) => r.action)).toEqual(['bank.added', 'bank.removed']);
  });

  test('refused: the business isn’t verified, no address, Plaid not set up, an account without numbers, Bridge saying no', async () => {
    const body = { publicToken: 'p', accountId: 'a', institution: null };
    const bare = await seedShop(db);
    await expect(addBank(db, { plaid: fakePlaid(), rail: fakeRail() }, { merchant: bare.merchant, staffId: bare.staff.owner, body })).rejects.toMatchObject({ code: 'not_verified' });
    await db.query(`UPDATE merchant.profiles SET bridge_customer_id = 'cus_x' WHERE merchant = $1`, [bare.merchant]);
    await expect(addBank(db, { plaid: fakePlaid(), rail: fakeRail() }, { merchant: bare.merchant, staffId: bare.staff.owner, body })).rejects.toThrow('Add the shop’s address first');
    const s = await verifiedShop();
    await expect(bankLinkToken(db, { plaid: fakePlaid({ configured: false }), rail: fakeRail() }, s.merchant)).rejects.toMatchObject({ code: 'not_configured', status: 503 });
    // Started with Bridge but not finished: told before Plaid opens, and refused if it's tried anyway.
    await expect(bankLinkToken(db, { plaid: fakePlaid(), rail: fakeRail({ notReady: true }) }, s.merchant)).rejects.toThrow('Bridge hasn’t finished verifying the business');
    await expect(addBank(db, { plaid: fakePlaid(), rail: fakeRail({ notReady: true }) }, { merchant: s.merchant, staffId: s.staff.owner, body })).rejects.toMatchObject({ code: 'not_verified' });
    await expect(addBank(db, { plaid: fakePlaid({ noAccount: true }), rail: fakeRail() }, { merchant: s.merchant, staffId: s.staff.owner, body })).rejects.toThrow('Choose a checking or savings account');
    await expect(addBank(db, { plaid: fakePlaid(), rail: fakeRail({ refuse: 'account_owner_name does not match' }) }, { merchant: s.merchant, staffId: s.staff.owner, body })).rejects.toBeInstanceOf(BankError);
    expect(await bankAccounts(db, s.merchant)).toEqual([]);
  });
});
