import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { loadMigrations, migrate } from './migrate.js';
import { LAZY_MERCHANT_TABLES, pgliteDb, testDb } from './testDb.js';

describe('the migration runner', () => {
  test('applies every migration once, in order', async () => {
    const pg = new PGlite();
    await pg.exec(LAZY_MERCHANT_TABLES);
    const db = pgliteDb(pg);
    const all = await loadMigrations();
    expect(all.map((m) => m.version)).toEqual(['0001_merchant_shop', '0002_commerce', '0003_payments', '0004_ledger', '0005_connector_status_and_event_retry', '0006_card_payments', '0007_checkout', '0008_refunds_receipts_tax', '0009_payouts_reconciliation', '0010_card_connectors_fee_billing', '0011_pin_failures_audit_log', '0012_shop_listing_hours', '0013_shifts_staff_hours', '0014_setup_marks', '0015_flag_explanations', '0016_end_of_day_email', '0017_bridge_kyb', '0018_bank_accounts']);
    expect(await migrate(db)).toEqual(all.map((m) => m.version));
    expect(await migrate(db)).toEqual([]);
    const { rows } = await db.query<{ version: string }>('SELECT version FROM merchant.schema_migrations ORDER BY version');
    expect(rows.map((r) => r.version)).toEqual(all.map((m) => m.version));
  });

  test('refuses a migration that changed after it ran', async () => {
    const { db } = await testDb();
    const all = await loadMigrations();
    const edited = all.map((m, i) => (i === 0 ? { ...m, checksum: 'edited' } : m));
    await expect(migrate(db, edited)).rejects.toThrow('has changed since it ran');
  });

  test('a failing migration leaves nothing behind', async () => {
    const { db } = await testDb();
    const bad = { version: '9999_bad', sql: 'CREATE TABLE ledger.half (id INT); SELECT 1/0;', checksum: 'x' };
    await expect(migrate(db, [bad])).rejects.toThrow();
    const { rows } = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'ledger' AND table_name = 'half'`);
    expect(rows).toHaveLength(0);
    const ran = await db.query(`SELECT 1 FROM merchant.schema_migrations WHERE version = '9999_bad'`);
    expect(ran.rows).toHaveLength(0);
  });

  test('keeps existing profiles, and marks founding shops', async () => {
    const pg = new PGlite();
    await pg.exec(LAZY_MERCHANT_TABLES);
    await pg.exec(`INSERT INTO merchant.profiles (merchant, name, founding) VALUES ('0xa', 'Old', true), ('0xb', 'New', false)`);
    await migrate(pgliteDb(pg));
    const { rows } = await pg.query<{ merchant: string; clear_tier: string; card_plan: string; timezone: string }>(
      'SELECT merchant, clear_tier, card_plan, timezone FROM merchant.profiles ORDER BY merchant',
    );
    expect(rows).toEqual([
      { merchant: '0xa', clear_tier: 'founding', card_plan: 'payg', timezone: 'America/Los_Angeles' },
      { merchant: '0xb', clear_tier: 'standard', card_plan: 'payg', timezone: 'America/Los_Angeles' },
    ]);
  });
});
