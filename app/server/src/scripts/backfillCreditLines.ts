import { getPayPool } from '../config/postgres.js';
import { openCreditLine, hasCreditLine } from '../services/chain/creditLineService.js';

/*
 * Opens a credit line for members who already existed before anything opened one.
 *
 * Onboarding does this now, but a member who signed up before that will never pass through it
 * again -- and until they have a period they have no cycle, which is the one thing the product
 * says every member has.
 *
 * Safe to re-run. Each member is checked before writing, because `openLine` reverts for anyone
 * already in an active period, and a backfill that fails loudly on everyone it has already done
 * is a backfill nobody runs twice.
 *
 *   bun run server/src/scripts/backfillCreditLines.ts          # report only
 *   BACKFILL_APPLY=1 bun run server/src/scripts/backfillCreditLines.ts
 */
const APPLY = process.env.BACKFILL_APPLY === '1';

async function main() {
  const pool = getPayPool();
  if (!pool) throw new Error('No database configured.');

  const { rows } = await pool.query<{ primary_wallet: string }>(
    `SELECT DISTINCT primary_wallet FROM members
      WHERE primary_wallet IS NOT NULL AND primary_wallet <> ''
      ORDER BY primary_wallet`
  );
  console.log(`${rows.length} member wallet(s) on record`);
  if (!APPLY) console.log('Reporting only. Set BACKFILL_APPLY=1 to open lines.\n');

  let already = 0;
  let opened = 0;
  let failed = 0;

  for (const { primary_wallet: wallet } of rows) {
    if (await hasCreditLine(wallet)) {
      already++;
      continue;
    }
    if (!APPLY) {
      console.log(`  would open: ${wallet}`);
      opened++;
      continue;
    }
    const result = await openCreditLine(wallet);
    if (result.opened) {
      console.log(`  opened: ${wallet}  ${result.txHash}`);
      opened++;
    } else {
      // Reported, never swallowed: a member the backfill could not reach still has no cycle, and
      // knowing which ones is the whole point of running it.
      console.warn(`  FAILED: ${wallet} -- ${result.reason}`);
      failed++;
    }
  }

  console.log(`\n${already} already had a line, ${opened} ${APPLY ? 'opened' : 'to open'}, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
