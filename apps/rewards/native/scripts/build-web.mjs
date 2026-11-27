/*
 * Builds the rewards app for the one shop in shop.json, at `/`, into www/ for Capacitor. The rest of
 * the build's settings (VITE_PRIVY_APP_ID, VITE_CLEAR_NETWORK, …) come from the environment, as for
 * the web deployment.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';

const shop = JSON.parse(readFileSync(new URL('../shop.json', import.meta.url), 'utf8'));
const rewards = new URL('..', new URL('..', import.meta.url)).pathname;
execFileSync('npx', ['vite', 'build', rewards, '--outDir', 'dist-native', '--emptyOutDir'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_NATIVE_SHOP: shop.slug, VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || shop.api },
  cwd: rewards,
});
const www = new URL('../www', import.meta.url).pathname;
rmSync(www, { recursive: true, force: true });
cpSync(`${rewards}/dist-native`, www, { recursive: true });
// The spec comparator (public/_ref, development only) never ships in a store app.
rmSync(`${www}/_ref`, { recursive: true, force: true });
console.log(`Built ${shop.name} into www/. Next: npm run sync.`);
