/*
 * The factory's list of Clear Points (merchant.point_keys, migration 0023): a Point can be claimed
 * by a shop only once its code is here.
 *
 *   railway run -s Protocol-Contracts -e dev bun scripts/point-codes.ts add point --file batch-07.txt --dry-run
 *   railway run -s Protocol-Contracts -e dev bun scripts/point-codes.ts add point_large A7K2 D00R
 *
 * A file has a code per line (spaces or commas also separate; `#` starts a comment). Every code must
 * be a Point's code, four Crockford base32 characters, or nothing is added. A code that's already
 * here is reported and left as it is; running the same list again adds nothing.
 */
import { readFileSync } from 'node:fs';
import { merchantDb } from '../src/config/merchantDb.js';
import { addPointCodes, POINT_MODELS, type PointModel, readCodes } from '../src/services/merchant/terminal/pointCodes.js';

const usage = 'usage: bun scripts/point-codes.ts add <point|point_large> [--dry-run] (--file <path> | <CODE> …)';
const [cmd, model, ...rest] = process.argv.slice(2);
if (cmd !== 'add' || !POINT_MODELS.includes(model as PointModel)) {
  console.error(usage);
  process.exit(1);
}

const dryRun = rest.includes('--dry-run');
const codes: string[] = [];
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--dry-run') continue;
  if (rest[i] === '--file') {
    const path = rest[++i];
    if (!path) {
      console.error(usage);
      process.exit(1);
    }
    codes.push(...readCodes(readFileSync(path, 'utf8')));
  } else codes.push(rest[i]!);
}
if (!codes.length) {
  console.error(`No codes given.\n${usage}`);
  process.exit(1);
}

const db = await merchantDb();
if (!db) {
  console.error('No merchant database (DATABASE_URL or MERCHANT_DATABASE_URL).');
  process.exit(1);
}

const r = await addPointCodes(db, { codes, model: model as PointModel, dryRun });
if (r.invalid.length) {
  console.error(`Not a Point's code (four of 0-9 A-Z without I, L, O, U): ${r.invalid.join(' ')}`);
  console.error('Nothing added. Fix the list and run it again.');
  process.exit(1);
}
const verb = dryRun ? 'would add' : 'added';
console.log(`${verb} ${r.added.length} ${model}${r.added.length ? `: ${r.added.join(' ')}` : ''}`);
for (const s of r.skipped) console.log(`skipped ${s.code}: already made as ${s.model}${s.model === model ? '' : ' (left as it is)'}`);
if (r.repeated.length) console.log(`in the list more than once: ${r.repeated.join(' ')}`);
if (dryRun) console.log('dry run: nothing written');
process.exit(0);
