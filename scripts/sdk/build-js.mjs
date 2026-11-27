// The published JavaScript for an SDK under packages/, bundled with esbuild.
//
// Workspace packages the SDK imports (@clear/*, and @useclear/node from the MCP server) aren't on
// npm, so they're bundled in; its own dependencies stay external, for npm to install. esbuild
// rather than tsup: tsup loads `typescript` from wherever it is hoisted, and CI installs only the
// workspaces, which leaves TypeScript nested where tsup can't see it.
//
//   node ../../scripts/sdk/build-js.mjs        (run from the package directory)
import { createRequire } from 'node:module';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const { build } = createRequire(join(pkgDir, 'package.json'))('esbuild');

// What each SDK builds: an entry, and the files it becomes.
const BUILDS = {
  '@useclear/node': [{ entry: 'src/index.ts', esm: 'dist/index.js', cjs: 'dist/index.cjs' }],
  '@useclear/mcp': [
    { entry: 'src/cli.ts', esm: 'dist/cli.js', banner: '#!/usr/bin/env node' },
    { entry: 'src/index.ts', esm: 'dist/index.js', cjs: 'dist/index.cjs' },
  ],
};
const builds = BUILDS[pkg.name];
if (!builds) throw new Error(`No build for ${pkg.name}.`);

const external = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
const common = { bundle: true, platform: 'node', target: 'node18', sourcemap: true, external, logLevel: 'warning' };

rmSync(join(pkgDir, 'dist'), { recursive: true, force: true });
await Promise.all(
  builds.flatMap(({ entry, esm, cjs, banner }) => [
    build({ ...common, entryPoints: [join(pkgDir, entry)], outfile: join(pkgDir, esm), format: 'esm', ...(banner ? { banner: { js: banner } } : {}) }),
    ...(cjs ? [build({ ...common, entryPoints: [join(pkgDir, entry)], outfile: join(pkgDir, cjs), format: 'cjs' })] : []),
  ]),
);
console.log(`${pkg.name}: ${builds.map((b) => [b.esm, b.cjs].filter(Boolean).join(', ')).join('; ')}`);
