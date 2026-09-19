/*
 * One-off correction, 2026-09-19: a savings-funded repayment was posted against the member's USDC
 * cash account, but the money came out of savings (CLRUSD). That under-stated their cash in the
 * books by the amount. This moves the debit to `member_savings` with a labelled reversing pair --
 * the original entry is left untouched, so the history stays readable.
 *
 * Idempotent (unique by event_type + external_id + account): running it twice changes nothing.
 *
 *   railway run -s Protocol-Contracts -e dev bun scripts/correct-savings-repay-ledger.ts <txHash> <wallet> <cents>
 *   (or with PAY_DATABASE_URL set to the pay ledger's public URL)
 */
import { getPayPool } from '../src/config/postgres.js';

const [txHash, walletArg, centsArg] = process.argv.slice(2);
const cents = Number(centsArg);
if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? '') || !walletArg || !Number.isInteger(cents) || cents <= 0) {
  console.error('usage: bun scripts/correct-savings-repay-ledger.ts <txHash> <wallet> <cents>');
  process.exit(1);
}
const wallet = walletArg.toLowerCase();
const pool = getPayPool();
if (!pool) throw new Error('No pay ledger database configured.');

const meta = JSON.stringify({
  reason: 'Savings-funded repayment was posted against USDC cash; it came from savings (CLRUSD). Moves the debit to member_savings.',
  txHash,
});
const id = `correction:${txHash.toLowerCase()}:savings-funded`;
const r = await pool.query(
  `INSERT INTO lithic_ledger_entries (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
   VALUES ($1, $2, 'member_cash_usdc', 'credit', $3, 'internal', 'ledger_correction', $4, $5::jsonb),
          ($1, $2, 'member_savings', 'debit', $3, 'internal', 'ledger_correction', $4, $5::jsonb)
   ON CONFLICT DO NOTHING`,
  [`correction:${txHash.toLowerCase()}`, wallet, cents, id, meta],
);
console.log(`correction rows inserted: ${r.rowCount} (0 means it was already applied)`);
process.exit(0);
