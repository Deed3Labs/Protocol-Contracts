import { merchantDb } from '../config/merchantDb.js';
import { clearTopUpHalt } from '../services/payoutFunding/topUpStore.js';

/*
 * Lets the automatic payout top-ups (jobs/payoutTopUp.ts) move money again after one failed.
 *
 * A failed top-up stops the job on purpose: a revert means something about the money path is not
 * what it expects. Look first (docs/operators/payout-topups.md, "When it stops"), then clear it:
 *
 *   cd apps/api && bun src/scripts/clearPayoutTopUpHalt.ts <top-up id> "<your name>"
 *
 * It sends nothing. The next check reads the chain afresh and decides again.
 */
async function main() {
  const [idRaw, by] = process.argv.slice(2);
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0 || !by?.trim()) throw new Error('Usage: bun src/scripts/clearPayoutTopUpHalt.ts <top-up id> "<your name>"');
  const db = await merchantDb();
  if (!db) throw new Error('No database configured.');
  const cleared = await clearTopUpHalt(db, id, by.trim());
  console.log(cleared ? `Top-up #${id} cleared by ${by.trim()}: the job resumes on its next check.` : `Top-up #${id} is not a failed top-up waiting to be cleared.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
