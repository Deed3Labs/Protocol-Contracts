import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(resolve(SRC, 'App.tsx'), 'utf8');

/** The nested `<Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>` and everything under it. */
const SHELL_AT = APP.indexOf('<AppShell />');
/** Routes declared before it are outside the shell, and so outside the provider it owns. */
const OUTSIDE_SHELL = APP.slice(0, SHELL_AT);

/** `@/x` -> src/x, resolved to whichever extension is on disk. */
function resolveAlias(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const base = resolve(SRC, spec.slice(2));
  for (const ext of ['.tsx', '.ts']) if (existsSync(base + ext)) return base + ext;
  return null;
}

/** Local name -> file, for every aliased import in App.tsx. Both quote styles are in use. */
const FILES = (() => {
  const found = new Map<string, string>();
  for (const m of APP.matchAll(/import\s+([\w{},\s*]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const file = resolveAlias(m[2]);
    if (!file) continue;
    for (const name of m[1].replace(/[{}]/g, ' ').split(/[\s,]+/).filter(Boolean)) {
      if (name !== 'type') found.set(name, file);
    }
  }
  return found;
})();

/**
 * Imports that CALL the hook and need somebody else to have mounted it.
 *
 * The hook's own module defines it, which is not the same as calling it, and a file that mounts
 * the provider supplies its own — AppShell both mounts and reads.
 */
const CALLERS = new Set(
  [...FILES]
    .filter(([, file]) => {
      if (file.includes('/hooks/')) return false;
      const src = readFileSync(file, 'utf8');
      return /useMemberProfile\s*\(\s*\)/.test(src) && !src.includes('<MemberProfileProvider>');
    })
    .map(([name]) => name),
);

function routes(region: string) {
  return [...region.matchAll(/<Route\s+path=["']([^"']+)["'][\s\S]{0,400}?element=\{([\s\S]{0,600}?)\}\s*\/?>/g)]
    .map((m) => ({
      path: m[1],
      element: m[2],
      readers: (m[2].match(/<(\w+)/g) ?? []).map((t) => t.slice(1)).filter((n) => CALLERS.has(n)),
    }));
}

/**
 * A route outside AppShell cannot read a context AppShell owns.
 *
 * `useMemberProfile` falls back to frozen empty values rather than throwing, so getting this wrong
 * is not a crash — it is a screen that waits on `loaded` and never gets it. That shipped once, on
 * the charge approval route. Assertions about that one file could not have caught it, because the
 * defect was in the tree above the file rather than in it.
 */
describe('routes that read the member profile sit under its provider', () => {
  test('AppShell is where the provider otherwise lives', () => {
    expect(SHELL_AT).toBeGreaterThan(-1);
    const shell = readFileSync(resolve(SRC, 'components/shell/AppShell.tsx'), 'utf8');
    expect(shell).toContain('<MemberProfileProvider>');
  });

  // Without this the check can go quiet: a reformatted route stops matching, the list empties, and
  // an empty list satisfies everything below it.
  test('every component that calls the hook is reached through a route the scan can see', () => {
    const seen = new Set(routes(APP).flatMap((r) => r.readers));
    expect([...CALLERS].filter((name) => !seen.has(name))).toEqual([]);
    expect(CALLERS.size).toBeGreaterThan(0);
  });

  test('none of the ones outside the shell is left without a provider', () => {
    const orphans = routes(OUTSIDE_SHELL)
      .filter((r) => r.readers.length > 0 && !r.element.includes('MemberProfileProvider'))
      .map((r) => r.path);
    expect(orphans).toEqual([]);
  });
});
