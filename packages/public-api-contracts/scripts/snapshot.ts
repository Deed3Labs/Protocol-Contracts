/**
 * Writes `src/published/<latest version>.json`: what the latest version publishes (see
 * `src/published.ts`). Run with `bun run snapshot` when a version is first published, and after an
 * addition. It refuses to overwrite a snapshot with one that breaks it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { breakingChanges, describePublished, type PublishedShape } from '../src/published';
import { LATEST_VERSION } from '../src/versions';

const file = join(import.meta.dir, '..', 'src', 'published', `${LATEST_VERSION}.json`);
const now = describePublished();
if (existsSync(file)) {
  const was = JSON.parse(readFileSync(file, 'utf8')) as PublishedShape;
  const broken = breakingChanges(was, now);
  if (broken.length) {
    console.error(`Not written: this would break ${LATEST_VERSION}:\n  ${broken.join('\n  ')}`);
    process.exit(1);
  }
}
writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
console.log(`Wrote ${file}`);
