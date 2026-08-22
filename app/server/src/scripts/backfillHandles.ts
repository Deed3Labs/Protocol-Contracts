import { getPostgresPool } from '../config/postgres.js';
import { generateHandle, isValidHandle, normalizeHandle } from '../services/handles.js';
import { memberStore } from '../services/memberStore.js';

/*
 * Gives every member a handle.
 *
 * Named handles first, from HANDLE_ASSIGNMENTS -- members who already have a name people know them
 * by should keep it rather than be handed two words and a number. Everyone else gets a generated
 * one, which they can change twice before it needs approving.
 *
 * Writes history for each, marked `assigned`, so nobody spends one of their two changes on a
 * handle they never chose.
 *
 *   bun run server/src/scripts/backfillHandles.ts            # report only
 *   BACKFILL_APPLY=1 bun run server/src/scripts/backfillHandles.ts
 */
const APPLY = process.env.BACKFILL_APPLY === '1';

/** wallet (lowercase) -> the handle that member is already known by. */
const HANDLE_ASSIGNMENTS: Record<string, string> = {
  '0x7ec1d6b69398af413edc94692fb167a3864a86cf': 'kyngkai909',
};

async function main() {
  const pool = getPostgresPool();
  if (!pool) throw new Error('No database configured.');

  // The schema comes from the store rather than a second copy here. Two definitions of one table
  // drift, and the one in a backfill script is the copy nobody remembers to update.
  await memberStore.ensureReady();

  const { rows } = await pool.query<{ id: string; primary_wallet: string; username: string | null }>(
    `SELECT m.id, m.primary_wallet, p.username
       FROM members m LEFT JOIN member_profile_public p ON p.member_id = m.id
      WHERE m.primary_wallet IS NOT NULL
      ORDER BY m.id`
  );
  console.log(`${rows.length} member(s)`);
  if (!APPLY) console.log('Reporting only. Set BACKFILL_APPLY=1 to write.\n');

  const isFree = async (candidate: string) => {
    const r = await pool.query(
      `SELECT 1 FROM member_profile_public WHERE lower(username) = $1
        UNION ALL
       SELECT 1 FROM member_handle_history WHERE lower(handle) = $1 LIMIT 1`,
      [normalizeHandle(candidate)],
    );
    return (r.rowCount ?? 0) === 0;
  };

  let assigned = 0;
  let kept = 0;

  for (const row of rows) {
    if (row.username) {
      console.log(`  keeps @${row.username}: ${row.primary_wallet}`);
      kept++;
      continue;
    }

    const named = HANDLE_ASSIGNMENTS[row.primary_wallet.toLowerCase()];
    let handle: string;
    if (named && isValidHandle(named) && (await isFree(named))) {
      handle = normalizeHandle(named);
    } else {
      if (named) console.warn(`  ! ${named} is not available; generating instead`);
      handle = await generateHandle(isFree);
    }

    if (!APPLY) {
      console.log(`  would assign @${handle}: ${row.primary_wallet}`);
      assigned++;
      continue;
    }

    // The profile row may not exist yet for a member who never saved one.
    await pool.query(
      `INSERT INTO member_profile_public (member_id, username)
       VALUES ($1, $2)
       ON CONFLICT (member_id) DO UPDATE SET username = EXCLUDED.username, updated_at = NOW()
        WHERE member_profile_public.username IS NULL`,
      [row.id, handle],
    );
    await pool.query(
      `INSERT INTO member_handle_history (member_id, handle, assigned)
       VALUES ($1, $2, TRUE) ON CONFLICT (lower(handle)) DO NOTHING`,
      [row.id, handle],
    );
    console.log(`  assigned @${handle}: ${row.primary_wallet}`);
    assigned++;
  }

  console.log(`\n${kept} kept, ${assigned} ${APPLY ? 'assigned' : 'to assign'}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
