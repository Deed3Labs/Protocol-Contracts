#!/usr/bin/env node
/*
 * The Face ID credentials our own server holds for a member (services/stepUp/stepUpStore).
 *
 *   node scripts/step-up-credentials.mjs --did did:privy:...
 *   node scripts/step-up-credentials.mjs --did did:privy:... --delete
 *
 * For starting clean. The app removes these itself when Face ID is turned off; this is for the case
 * where the account is in a state the app cannot act on, and somebody needs to see what is actually
 * in the table rather than infer it.
 *
 * Deleting them only means the server stops asking for Face ID until one is registered again. It
 * takes nothing else with it -- not the wallet, not the session, not the Privy passkey.
 *
 *   railway run --service Protocol-Contracts node scripts/step-up-credentials.mjs --did ...
 */
import 'dotenv/config';
import pg from 'pg';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const did = arg('did', '').trim();
const remove = process.argv.includes('--delete');
const connectionString = (process.env.PAY_DATABASE_URL || process.env.DATABASE_URL || '').trim();

if (!did) {
  console.error('Which member? --did did:privy:...');
  process.exit(1);
}
if (!connectionString) {
  console.error('Needs PAY_DATABASE_URL (or DATABASE_URL) from the API service\'s own environment.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
const table = 'member_step_up_credentials';

const { rows } = await pool.query(
  `SELECT credential_id, rp_id, counter, created_at, last_used_at FROM ${table} WHERE user_id = $1 ORDER BY created_at`,
  [did],
);

if (!rows.length) {
  console.log('No Face ID credentials on our side for that member. Nothing is being asked for.');
  await pool.end();
  process.exit(0);
}

console.log(`${rows.length} credential(s):`);
for (const r of rows) {
  console.log(
    `  ${r.credential_id}  site=${r.rp_id}  added=${r.created_at.toISOString().slice(0, 16)}  ` +
      `lastUsed=${r.last_used_at ? r.last_used_at.toISOString().slice(0, 16) : 'never'}`,
  );
}

if (!remove) {
  console.log('\nNothing changed. Add --delete to remove them.');
} else {
  const { rowCount } = await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [did]);
  console.log(`\nDeleted ${rowCount}. The server will not ask for Face ID again until one is registered.`);
}

await pool.end();
