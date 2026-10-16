/*
 * Store app build records (rewards spec, Phase 7; docs/rewards-reference/store-builds.md). A record
 * only: this never builds or submits anything. Run it as a build moves through the shop's own App
 * Store Connect or Play Console.
 *
 *   railway run -s Protocol-Contracts -e dev bun scripts/store-build.ts list micasa
 *   railway run -s Protocol-Contracts -e dev bun scripts/store-build.ts record micasa ios org.useclear.shops.micasa 1.0.0 in_review "Submitted from Mi Casa's account"
 *
 * Review is one of not_submitted, in_review, approved, rejected, live.
 */
import { merchantDb } from '../src/config/merchantDb.js';
import { recordStoreBuild, storeBuilds } from '../src/services/merchant/rewards/storeBuilds.js';

const usage = 'usage: bun scripts/store-build.ts list <slug> | record <slug> <ios|android> <bundle id> <version> <review> [note]';
const [cmd, slug, platform, bundleId, version, review, ...note] = process.argv.slice(2);
if (!slug || (cmd !== 'list' && cmd !== 'record') || (cmd === 'record' && (!platform || !bundleId || !version || !review))) {
  console.error(usage);
  process.exit(1);
}
const db = await merchantDb();
if (!db) {
  console.error('No merchant database (DATABASE_URL or MERCHANT_DATABASE_URL).');
  process.exit(1);
}
try {
  if (cmd === 'record') {
    const b = await recordStoreBuild(db, { slug, platform: platform as 'ios' | 'android', bundleId: bundleId!, version: version!, review: review as 'in_review', note: note.join(' ') || null });
    console.log(`${b.platform} ${b.bundleId} ${b.version} · ${b.review} · config v${b.configVersion}`);
  } else {
    for (const b of await storeBuilds(db, slug)) console.log(`${b.platform}\t${b.bundleId}\t${b.version}\t${b.review}\tconfig v${b.configVersion}\t${b.updatedAt}${b.note ? `\t${b.note}` : ''}`);
  }
  process.exit(0);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
