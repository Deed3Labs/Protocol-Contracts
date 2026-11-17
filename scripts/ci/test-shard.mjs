#!/usr/bin/env node
// Prints the Hardhat test files for one CI shard, so the suite can run in parallel jobs.
//
//   node scripts/ci/test-shard.mjs <index> <total>     # index is 1-based
//   node scripts/ci/test-shard.mjs --check <total>     # every test file lands in exactly one shard
//
// Discovery matches `hardhat test` with no arguments: every .js, .cjs, .mjs and .ts file under the
// configured tests path (./test). Files are spread by size, largest first, onto the lightest shard,
// so the shards finish at about the same time. The split depends only on the file list and sizes,
// so every job computes the same one.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const TEST_DIR = join(ROOT, 'test');
const EXTENSIONS = /\.(c|m)?(j|t)s$/;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return EXTENSIONS.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

function shards(total) {
  const files = walk(TEST_DIR)
    .map((path) => ({ path: relative(ROOT, path), size: statSync(path).size }))
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
  const bins = Array.from({ length: total }, () => ({ size: 0, files: [] }));
  for (const file of files) {
    const lightest = bins.reduce((min, bin) => (bin.size < min.size ? bin : min));
    lightest.files.push(file.path);
    lightest.size += file.size;
  }
  return { files, bins };
}

const args = process.argv.slice(2);
if (args[0] === '--check') {
  const total = Number(args[1]);
  const { files, bins } = shards(total);
  const seen = bins.flatMap((bin) => bin.files);
  const unique = new Set(seen);
  if (seen.length !== files.length || unique.size !== files.length) {
    console.error(`shards cover ${unique.size} distinct of ${files.length} files (${seen.length} placements)`);
    process.exit(1);
  }
  bins.forEach((bin, i) => console.log(`shard ${i + 1}: ${bin.files.length} files, ${bin.size} bytes`));
  process.exit(0);
}

const [index, total] = args.map(Number);
if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) {
  console.error('usage: test-shard.mjs <index> <total> | --check <total>');
  process.exit(2);
}
console.log(shards(total).bins[index - 1].files.join('\n'));
