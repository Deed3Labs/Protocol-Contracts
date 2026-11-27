// Builds @useclear/js:
//   dist/v1.js     one minified IIFE that puts `Clear` on the window: js.useclear.org/v1
//   dist/index.mjs the ES module for npm (`import Clear from "@useclear/js"`)
// and prints v1.js's size, failing over the budget.
//
//   node scripts/build.mjs                    build
//   node scripts/build.mjs --copy-to <dir>    build, then copy v1.js to <dir>/v1.js and <dir>/v1.<version>.js
//                                             (apps/pay's prebuild: js.useclear.org serves those)
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const GZIP_BUDGET = 10 * 1024;

const common = { bundle: true, target: ['es2020', 'safari15'], legalComments: 'none', logLevel: 'warning' };
const banner = { js: `/* @useclear/js ${pkg.version} · Pay with Clear · https://js.useclear.org */` };

await Promise.all([
  build({
    ...common,
    entryPoints: [join(root, 'src/browser.ts')],
    outfile: join(root, 'dist/v1.js'),
    format: 'iife',
    minify: true,
    banner,
  }),
  build({
    ...common,
    entryPoints: [join(root, 'src/index.ts')],
    outfile: join(root, 'dist/index.mjs'),
    format: 'esm',
    minify: false,
    banner,
  }),
]);

const v1 = join(root, 'dist/v1.js');
const raw = statSync(v1).size;
const gz = gzipSync(readFileSync(v1), { level: 9 }).length;
console.log(`@useclear/js ${pkg.version}: dist/v1.js ${(raw / 1024).toFixed(2)} KB, ${(gz / 1024).toFixed(2)} KB gzipped (budget ${GZIP_BUDGET / 1024} KB)`);
if (gz > GZIP_BUDGET) {
  console.error('dist/v1.js is over its gzipped budget.');
  process.exit(1);
}

const i = process.argv.indexOf('--copy-to');
if (i !== -1) {
  const dir = process.argv[i + 1];
  if (!dir) {
    console.error('--copy-to needs a directory');
    process.exit(1);
  }
  const out = resolve(process.cwd(), dir);
  mkdirSync(out, { recursive: true });
  copyFileSync(v1, join(out, 'v1.js'));
  copyFileSync(v1, join(out, `v1.${pkg.version}.js`));
  console.log(`copied to ${out}/v1.js and v1.${pkg.version}.js`);
}
