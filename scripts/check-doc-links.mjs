// Every relative link in the repository's markdown points at a file that exists:
// `node scripts/check-doc-links.mjs`. CI runs it on every pull request.
//
// Only relative links are checked — not URLs, and not anchors within a page. The archive is skipped:
// it is kept as it was written, and its links are not maintained (docs/archive/README.md says so).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const SKIP = [/^docs\/archive\//, /(^|\/)node_modules\//, /^contracts\//];

const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !SKIP.some((re) => re.test(f)) && existsSync(f));

const broken = [];
for (const file of files) {
  // Code blocks hold examples, not links.
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, url] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#|\/)/.test(url)) continue;
    const target = url.split('#')[0];
    if (!target) continue;
    if (!existsSync(normalize(join(dirname(file), target)))) broken.push(`${file}: ${url}`);
  }
}

if (broken.length) {
  console.error(`${broken.length} broken link${broken.length === 1 ? '' : 's'}:\n  ${broken.join('\n  ')}`);
  process.exit(1);
}
console.log(`${files.length} files, no broken links.`);
