import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

/**
 * Principle 2: only the ledger service writes to the ledger. The database can't tell one caller
 * from another (one role on Railway), so this is where it's held: any INSERT into `ledger.` outside
 * this folder fails the build's tests.
 */
const SRC = fileURLToPath(new URL('../../../', import.meta.url));
const HERE = fileURLToPath(new URL('./', import.meta.url));

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('the ledger has one writer', () => {
  test('nothing outside services/merchant/ledger writes to ledger tables', async () => {
    const offenders: string[] = [];
    for (const f of await files(SRC)) {
      if (f.startsWith(HERE)) continue;
      const src = await readFile(f, 'utf8');
      if (/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+ledger\./i.test(src)) offenders.push(relative(SRC, f));
    }
    expect(offenders).toEqual([]);
  });
});
