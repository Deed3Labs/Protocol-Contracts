// Declarations for a published SDK under packages/, built with tsc rather than tsup's dts bundler.
//
// The SDKs import private workspace packages (@clear/public-api-contracts, and @useclear/node from
// the MCP server) whose package.json points straight at TypeScript source. tsup's bundler can't
// parse that, and those packages aren't on npm. So: emit declarations for the SDK and everything
// it imports from the workspace into dist/types, then rewrite each private import to a relative
// path into that tree. The package's "types" points at dist/types/<pkg>/src/index.d.ts.
//
//   node ../../scripts/sdk/build-types.mjs        (run from the package directory)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const pkgDir = process.cwd();
const packages = resolve(pkgDir, '..');
const out = join(pkgDir, 'dist/types');
const name = pkgDir.split('/').pop();

// Workspace packages an SDK may import, and the source each resolves to.
const WORKSPACE = {
  '@clear/public-api-contracts': join(packages, 'public-api-contracts/src/index.ts'),
  '@useclear/node': join(packages, 'clear-node/src/index.ts'),
};

rmSync(out, { recursive: true, force: true });
const tsconfig = join(pkgDir, 'tsconfig.types.json');
writeFileSync(
  tsconfig,
  JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      rootDir: '..',
      outDir: './dist/types',
      paths: Object.fromEntries(Object.entries(WORKSPACE).map(([k, v]) => [k, ['./' + relative(pkgDir, v)]])),
    },
    include: ['src'],
    exclude: ['src/**/*.test.ts'],
  }),
);
try {
  execFileSync(join(packages, '..', 'node_modules/.bin/tsc'), ['-p', tsconfig], { stdio: 'inherit' });
} finally {
  rmSync(tsconfig, { force: true });
}

// Point each private import at the copy emitted alongside.
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
for (const file of walk(out).filter((f) => f.endsWith('.d.ts'))) {
  let text = readFileSync(file, 'utf8');
  for (const [spec, src] of Object.entries(WORKSPACE)) {
    const target = join(out, relative(packages, src)).replace(/\.ts$/, '.js');
    let rel = relative(dirname(file), target);
    if (!rel.startsWith('.')) rel = './' + rel;
    text = text.replaceAll(`'${spec}'`, `'${rel}'`).replaceAll(`"${spec}"`, `"${rel}"`);
  }
  // ESM consumers on node16/nodenext resolution need the extension the source leaves off.
  text = text.replace(/(from\s+|import\()(['"])(\.{1,2}\/[^'"]+?)(?<!\.js)\2/g, (_, pre, q, spec) => `${pre}${q}${spec}.js${q}`);
  writeFileSync(file, text);
}
console.log(`${name}: declarations in dist/types/${name}/src/index.d.ts`);
