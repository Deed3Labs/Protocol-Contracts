/*
 * Clear's terms codes (Onboarding › Your terms › Have a code?; migration 0021).
 *
 *   railway run -s Protocol-Contracts -e dev bun scripts/terms-code.ts add KAI-1104 founding 5 "Founding partners, Inland Empire"
 *   railway run -s Protocol-Contracts -e dev bun scripts/terms-code.ts list
 *   railway run -s Protocol-Contracts -e dev bun scripts/terms-code.ts retire KAI-1104
 *
 * A shop that signs up with a code goes on its tier while places last. Clear then registers the shop
 * on chain with that tier's terms (scripts/register_merchant.ts): the chain charges what it's told.
 */
import { merchantDb } from '../src/config/merchantDb.js';
import { addCode, normalizeCode } from '../src/services/merchant/termsCodes.js';

const [cmd, ...args] = process.argv.slice(2);
const db = await merchantDb();
if (!db) {
  console.error('No merchant database (DATABASE_URL or MERCHANT_DATABASE_URL).');
  process.exit(1);
}

if (cmd === 'add') {
  const [code, tier, places, ...note] = args;
  if (!code || !tier || !places) {
    console.error('usage: bun scripts/terms-code.ts add <CODE> <tier> <places> ["note"]');
    process.exit(1);
  }
  await addCode(db, { code, tier, places: Number(places), note: note.join(' ') || null });
  console.log(`added ${normalizeCode(code)}: ${tier}, ${places} places`);
} else if (cmd === 'list') {
  const { rows } = await db.query<{ code: string; tier: string; places: number; taken: number; retired: boolean; note: string | null }>(
    `SELECT c.code, c.tier, c.places, (SELECT count(*)::int FROM merchant.profiles p WHERE p.terms_code = c.code) AS taken, c.retired_at IS NOT NULL AS retired, c.note
       FROM merchant.terms_codes c ORDER BY c.created_at`,
  );
  for (const r of rows) console.log(`${r.code}  ${r.tier}  ${r.taken}/${r.places} taken${r.retired ? '  (retired)' : ''}${r.note ? `  ${r.note}` : ''}`);
  if (!rows.length) console.log('no codes');
} else if (cmd === 'retire') {
  const code = normalizeCode(args[0] ?? '');
  const { rows } = await db.query<{ code: string }>('UPDATE merchant.terms_codes SET retired_at = now() WHERE code = $1 AND retired_at IS NULL RETURNING code', [code]);
  console.log(rows[0] ? `retired ${code}; shops that used it keep their terms` : `no open code ${code}`);
} else {
  console.error('usage: bun scripts/terms-code.ts add|list|retire …');
  process.exit(1);
}
process.exit(0);
