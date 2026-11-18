import { merchantDb } from '../config/merchantDb.js';
import { clearDeskHalt } from '../services/settlementFunding/store.js';

/*
 * Lets the settlement funding desk (jobs/fundingDesk.ts) move money again after a move failed.
 *
 * A failed move stops the desk on purpose: a revert, a refused guard, or a failed bank or off-ramp
 * payment means the money path is not what it expects. Look first (docs/operators/
 * settlement-funding.md, "When it stops"), then clear it:
 *
 *   cd apps/api && bun src/scripts/clearSettlementFundingHalt.ts <move id> "<your name>"
 *
 * It sends nothing. The next check reads the chain and the bank afresh and decides again.
 */
async function main() {
  const [idRaw, by] = process.argv.slice(2);
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0 || !by?.trim()) throw new Error('Usage: bun src/scripts/clearSettlementFundingHalt.ts <move id> "<your name>"');
  const db = await merchantDb();
  if (!db) throw new Error('No database configured.');
  const cleared = await clearDeskHalt(db, id, by.trim());
  console.log(cleared ? `Move #${id} cleared by ${by.trim()}: the desk resumes on its next check.` : `Move #${id} is not a failed move waiting to be cleared.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
