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
    expect(all.map((m) => m.version)).toEqual(['0001_merchant_shop', '0002_commerce', '0003_payments', '0004_ledger', '0005_connector_status_and_event_retry', '0006_card_payments', '0007_checkout', '0008_refunds_receipts_tax', '0009_payouts_reconciliation', '0010_card_connectors_fee_billing', '0011_pin_failures_audit_log', '0012_shop_listing_hours', '0013_shifts_staff_hours', '0014_setup_marks', '0015_flag_explanations', '0016_end_of_day_email', '0017_bridge_kyb', '0018_bank_accounts', '0019_bank_withdrawals', '0020_monthly_statements', '0021_terms_codes', '0022_who_can_close', '0023_terminal_hardware', '0024_terminal_floor', '0025_terminal_menu_receipts', '0026_point_firmware', '0027_waitlist_states', '0028_tables_v2', '0029_rewards', '0030_pay', '0031_pay_join', '0032_command', '0033_command_members', '0034_command_growth', '0035_command_merchants', '0036_command_money', '0037_command_shop', '0038_command_contracts', '0039_command_governance', '0040_command_records', '0041_command_actions', '0042_command_safe', '0043_command_safe_proposals', '0044_command_chain', '0045_command_code', '0046_command_feeds', '0047_command_shop_live', '0048_command_waitlist', '0049_command_site', '0050_command_bondvault_coop', '0051_command_code_pulls', '0052_command_shop_costing', '0053_command_shop_site_products', '0054_command_shop_catalog', '0055_command_shop_sell_past_stock', '0056_command_sections_community_settings', '0057_command_settings', '0058_command_audit_chain', '0059_command_reveals', '0060_command_shop_materials', '0061_command_shop_suppliers', '0062_command_shop_flat_batches', '0063_command_shop_orders_pickup', '0064_command_export_grants', '0065_command_code_projects', '0068_command_admin_records']);
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
