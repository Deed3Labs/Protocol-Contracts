#!/usr/bin/env node
/*
 * Fail the build if a provider key made it into the shipped bundle.
 *
 * This exists because a source-level rule ("don't read VITE_ALCHEMY_*") only forbids the one path
 * we already know about. The thing that actually hurt us is not a variable name -- it is a key
 * being readable in dist/, and there are many ways to get one there: a different var name, a
 * hardcoded URL, a config object, a dependency's default. So this checks the output.
 *
 * The Alchemy key that leaked was found exactly this way, by curling the deployed site and
 * grepping the chunks. Doing it before deploying rather than after is the whole point.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');

/*
 * Patterns for a SECRET in a URL, not for a provider's name.
 *
 * `g.alchemy.com/v2/<key>` is a leak; `alchemy.com` in a comment or a docs link is not, and a rule
 * that cannot tell them apart gets muted the first time it cries wolf. Each pattern therefore
 * requires the key-shaped path segment, and `demo` is Alchemy's own public placeholder key.
 */
const PATTERNS = [
  { name: 'Alchemy API key', re: /\b[a-z0-9-]+\.g\.alchemy\.com\/v2\/(?!demo\b)[A-Za-z0-9_-]{16,}/g },
  { name: 'Infura project secret', re: /\binfura\.io\/v3\/[A-Za-z0-9]{16,}:[A-Za-z0-9]+/g },
  { name: 'QuickNode endpoint', re: /\b[a-z0-9-]+\.quiknode\.pro\/[A-Za-z0-9]{16,}/g },
  { name: 'Ankr premium key', re: /\brpc\.ankr\.com\/[a-z_]+\/[A-Za-z0-9]{24,}/g },
  // Mapbox scopes its tokens by prefix: `pk.` belongs in a web page, `sk.` never does. The map
  // code used to reach for the secret one specifically when building for production.
  { name: 'Mapbox secret token', re: /\bsk\.ey[A-Za-z0-9._-]{20,}/g },
  // Generic shapes worth catching before they are ours to explain.
  { name: 'Stripe secret key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'AWS access key id', re: /\bAKIA[A-Z0-9]{16}\b/g },
  { name: 'Private key material', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(js|mjs|cjs|css|html|json|map)$/.test(entry)) yield full;
  }
}

if (!existsSync(DIST)) {
  // Not "no secrets found" -- nothing was examined. Saying so is the difference between a guard
  // and a guard that passes because it never ran.
  console.error('[scan] dist/ does not exist — run the build first. Nothing was scanned.');
  process.exit(1);
}

const hits = [];
let scanned = 0;
for (const file of files(DIST)) {
  scanned += 1;
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      // Redact the key itself: this output goes to CI logs, which are not always private.
      hits.push(`${name} in ${file.slice(DIST.length + 1)} — ${match[0].replace(/[A-Za-z0-9_-]{12,}$/, (k) => `${k.slice(0, 4)}…REDACTED`)}`);
    }
  }
}

if (hits.length > 0) {
  console.error(`\n[scan] ${hits.length} provider key(s) in the shipped bundle:\n`);
  for (const hit of hits) console.error(`  ${hit}`);
  console.error(
    '\nVITE_* is inlined at build time and is readable by anyone who loads the site.\n' +
      'Move the key to the server env and call it through our API. See src/config/networks.ts.\n',
  );
  process.exit(1);
}

console.log(`[scan] ${scanned} files, no provider keys.`);
