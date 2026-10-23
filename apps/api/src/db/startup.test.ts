import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { runMerchantMigrations } from '../config/merchantDb.js';

/**
 * The startup path, end to end: the real lazy `merchant` tables from src/config/merchantDb.ts, then
 * the migrations on top, on a Postgres with nothing in it. testDb.ts stands in for the lazy tables
 * to keep the other tests fast; this is what checks the stand-in hasn't drifted from the real ones.
 */
const pg = new PGlite();
// Just enough of a pg Pool: parameterless text may hold several statements, as ensureMerchantSchema's do.
const fakePool = {
  query: async (text: string, params?: unknown[]): Promise<{ rows: unknown[] }> => {
    if (params?.length) return pg.query(text, params as any[]);
    const results = await pg.exec(text);
    return results[results.length - 1] ?? { rows: [] };
  },
  connect: async () => ({ query: fakePool.query, release: () => undefined }),
} as unknown as Pool;

test('a fresh database gets the lazy merchant tables, then every migration', async () => {
  const applied = await runMerchantMigrations(fakePool);
  expect(applied).toEqual(['0001_merchant_shop', '0002_commerce', '0003_payments', '0004_ledger', '0005_connector_status_and_event_retry', '0006_card_payments', '0007_checkout', '0008_refunds_receipts_tax', '0009_payouts_reconciliation', '0010_card_connectors_fee_billing', '0011_pin_failures_audit_log', '0012_shop_listing_hours', '0013_shifts_staff_hours', '0014_setup_marks', '0015_flag_explanations', '0016_end_of_day_email', '0017_bridge_kyb', '0018_bank_accounts', '0019_bank_withdrawals', '0020_monthly_statements', '0021_terms_codes', '0022_who_can_close', '0023_terminal_hardware', '0024_terminal_floor', '0025_terminal_menu_receipts', '0026_point_firmware', '0027_waitlist_states', '0028_tables_v2', '0029_rewards', '0030_pay', '0031_pay_join', '0032_command', '0033_command_members', '0034_command_growth', '0035_command_merchants']);
  const { rows } = await pg.query<{ table_schema: string; n: number }>(
    `SELECT table_schema, count(*)::int AS n FROM information_schema.tables
      WHERE table_schema IN ('merchant','commerce','payments','ledger') GROUP BY table_schema ORDER BY table_schema`,
  );
  expect(Object.fromEntries(rows.map((r) => [r.table_schema, r.n]))).toEqual({
    commerce: 11, // 10 tables (category_order, 0025) and the stock_levels view
    ledger: 3,
    merchant: 32, // with table_visits (0028), firmware_releases (0026), shop_hours and shop_closures (0012), shifts, shift_breaks and staff_hours (0013), setup_marks (0014), bank_accounts (0018), bank_withdrawals (0019), statement_sends (0020), terms_codes (0021), and Terminal's hardware, point_keys, point_states, drawer_keys (0023), tables, waitlist_parties, table_requests and alerts (0024)
    payments: 27, // with Terminal's no_sale_approvals and drawer_events (0023), and Pay with Clear's eleven (0030)
  });
  // A restart applies nothing.
  expect(await runMerchantMigrations(fakePool)).toEqual([]);
});
