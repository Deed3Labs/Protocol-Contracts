/*
 * Writes shop.json for one shop's store build, from its public config (GET /api/s/:slug).
 *
 *   SHOP=micasa API=https://api.useclear.org npm run config
 *
 * The bundle id is org.useclear.shops.<slug, letters and digits only>, unless BUNDLE_ID says
 * otherwise (a shop that already has an app keeps its id).
 */
import { writeFileSync } from 'node:fs';

const slug = (process.env.SHOP || '').trim();
const api = (process.env.API || '').trim().replace(/\/+$/, '');
if (!/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(slug) || !api) {
  console.error('usage: SHOP=<slug> API=<api origin> npm run config');
  process.exit(1);
}
const r = await fetch(`${api}/api/s/${slug}`);
if (!r.ok) {
  console.error(`No shop app at ${slug} (${r.status}). Is it on in Settings › Shop app?`);
  process.exit(1);
}
const app = await r.json();
const shop = {
  slug: app.slug,
  name: app.name,
  bundleId: (process.env.BUNDLE_ID || `org.useclear.shops.${app.slug.replace(/[^a-z0-9]/g, '')}`).trim(),
  colour: app.brand.colour,
  onColour: app.brand.onColour,
  paper: app.brand.paper,
  logoUrl: app.brand.logoUrl,
  monogram: app.brand.monogram,
  configVersion: app.configVersion,
  api,
};
writeFileSync(new URL('../shop.json', import.meta.url), `${JSON.stringify(shop, null, 2)}\n`);
console.log(`${shop.name}: ${shop.bundleId}, config v${shop.configVersion}. Record it with scripts/store-build.ts once it's built.`);
