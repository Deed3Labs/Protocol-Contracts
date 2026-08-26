import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '_archive' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}


/*
 * Strip comments before scanning for a code pattern.
 *
 * The last two guards I wrote this way matched their own docblocks and passed on prose. A rule
 * about what the code does has to be checked against the code.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FILES = sourceFiles(SRC).map((path) => ({ path: path.slice(SRC.length + 1), text: readFileSync(path, 'utf8') }));

/*
 * What the browser is allowed to hold.
 *
 * `import.meta.env.VITE_*` is not configuration the server reads — Vite inlines it at build time,
 * so every one of these is a string literal in the bundle that anyone can curl and grep. An
 * Alchemy endpoint is a URL with the API key in its path, so reading one here published the key.
 * It was found in the deployed bundle and spent against Scroll and ZKsync, chains this codebase
 * has never supported.
 *
 * Two layers guard it, because they fail differently: this one names the mistake at the point
 * someone would repeat it, and scripts/scanBundleSecrets.mjs checks dist/ for the outcome
 * regardless of how it got there.
 */
describe('the browser bundle holds no provider keys', () => {
  test('nothing reads a keyed Alchemy endpoint from the client env', () => {
    const offenders = FILES.filter((f) => /import\.meta\.env\.VITE_ALCHEMY/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  test('no provider URL carries a key inline either', () => {
    // A var name is one route to the same place; a pasted URL is another.
    const keyed = /[a-z0-9-]+\.g\.alchemy\.com\/v2\/(?!\$\{|YOUR_|demo\b)[A-Za-z0-9_-]{16,}/;
    const offenders = FILES.filter((f) => keyed.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  test('the client RPC resolver returns Infura or a public node, and nothing keyed', () => {
    const networks = FILES.find((f) => f.path === 'config/networks.ts')!;
    const resolver = networks.text.slice(networks.text.indexOf('export const getRpcUrlForNetwork'));
    const body = resolver.slice(0, resolver.indexOf('\n};'));
    expect(body).toContain('network.infuraUrl');
    expect(body).toContain('network.rpcUrl');
    expect(body).not.toContain('alchemy');
  });

  test('NetworkConfig has no field to put one in', () => {
    // Deleting the reads but leaving the field invites the next person to fill it back in.
    const networks = FILES.find((f) => f.path === 'config/networks.ts')!;
    const iface = networks.text.slice(
      networks.text.indexOf('export interface NetworkConfig'),
      networks.text.indexOf('}', networks.text.indexOf('export interface NetworkConfig')),
    );
    expect(iface).toContain('infuraUrl');
    expect(iface).not.toContain('alchemyUrl');
  });

  test('the example env does not hand someone the same footgun', () => {
    const example = readFileSync(join(SRC, '..', '.env.example'), 'utf8');
    expect(example).not.toMatch(/^VITE_ALCHEMY/m);
  });

  test('and the build runs the dist scan, so this cannot be the only check', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toContain('scanBundleSecrets.mjs');
  });
});

/*
 * The deeper rule, and the one that actually mattered.
 *
 * Removing the VITE_ALCHEMY_* readers did not stop the key shipping. `import.meta.env` is not an
 * object Vite hands the browser — it substitutes the literal text `import.meta.env.VITE_FOO` at
 * build time. Index it dynamically and there is no literal to substitute, so Vite serialises the
 * entire env instead, and every VITE_ var in the build environment lands in the bundle whether
 * anything reads it or not.
 *
 * That is why the fix is an allowlist rather than a deletion: the leak was never about which
 * variables we read, it was about which ones we could reach.
 */
describe('client env is reachable only through the allowlist', () => {
  test('nothing indexes import.meta.env dynamically', () => {
    const dynamic = /import\.meta\.env\s*(\[|as\s+Record|\)\s*\[)/;
    const offenders = FILES.filter((f) => f.path !== 'config/clientEnv.ts' && dynamic.test(code(f.text)));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  test('the allowlist itself only ever reads static literals', () => {
    const env = FILES.find((f) => f.path === 'config/clientEnv.ts')!;
    const body = code(env.text);
    // Every read must be `import.meta.env.SOMETHING` — a bracket here would defeat the whole file.
    expect(body).not.toMatch(/import\.meta\.env\s*\[/);
    expect(body.match(/import\.meta\.env\.VITE_[A-Z0-9_]+/g)?.length ?? 0).toBeGreaterThan(30);
  });

  test('the helpers that used to index the env now go through it', () => {
    for (const path of ['config/networks.ts', 'config/tokens.ts', 'config/send.ts']) {
      const file = FILES.find((f) => f.path === path)!;
      expect(code(file.text)).toContain('readEnv(');
    }
  });
});
