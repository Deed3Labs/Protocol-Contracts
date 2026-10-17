/** Writes the docs into apps/member/public, where useclear.org serves them. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderDocs } from '../src/index';

export const PUBLIC_DIR = join(import.meta.dir, '..', '..', '..', 'apps', 'member', 'public');
for (const [path, body] of Object.entries(renderDocs())) {
  const file = join(PUBLIC_DIR, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  console.log(`wrote ${path}`);
}
