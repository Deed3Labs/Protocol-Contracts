import { getContractAddress } from '../config/contracts.js';
import { merchantDb } from '../config/merchantDb.js';
import { parseUsdc, formatUsdc } from '../services/payoutFunding/topUp.js';
import { recordMarginAdvance } from '../services/settlementFunding/store.js';

/*
 * Records that the Savings-Backed Margin covered part of a card settlement at the bank (decision 54,
 * the third source). It sends nothing. The record is what makes the Margin come back first when the
 * CSA has a surplus, and what the Pool Tier principal helper adds as Margin Advances.
 *
 *   cd apps/api && bun src/scripts/recordSettlementMarginAdvance.ts <dollars> "<your name>" "<note>"
 */
async function main() {
  const [amountRaw, by, note] = process.argv.slice(2);
  const amount = parseUsdc(amountRaw);
  if (!amount || amount <= 0n || !by?.trim()) {
    throw new Error('Usage: bun src/scripts/recordSettlementMarginAdvance.ts <dollars> "<your name>" "<note>"');
  }
  const id = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '84532').trim()) || 84532;
  const pool = getContractAddress(id, 'LendingPool');
  if (!pool) throw new Error(`No Yield Pool address for chain ${id}.`);
  const db = await merchantDb();
  if (!db) throw new Error('No database configured.');
  const row = await recordMarginAdvance(db, id, pool, amount, by.trim(), (note ?? '').trim());
  console.log(`Recorded Margin advance #${row.id}: ${formatUsdc(amount)} by ${by.trim()}.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
