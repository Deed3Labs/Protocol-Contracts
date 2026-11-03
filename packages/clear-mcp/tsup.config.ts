import { defineConfig } from 'tsup';

/**
 * The published build: `dist/cli.js` is the `useclear-mcp` bin (`npx @useclear/mcp`), with its shebang.
 * `@useclear/node` and `@clear/public-api-contracts` aren't on npm, so they're bundled in (`noExternal`);
 * once `@useclear/node` is published it can become an ordinary dependency instead. Declarations come
 * from `scripts/sdk/build-types.mjs`.
 */
export default defineConfig([
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node18',
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
    noExternal: [/^@clear\//, /^@useclear\/node$/],
    clean: true,
    sourcemap: true,
  },
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    target: 'node18',
    platform: 'node',
    dts: false,
    noExternal: [/^@clear\//, /^@useclear\/node$/],
    sourcemap: true,
    treeshake: true,
  },
]);
