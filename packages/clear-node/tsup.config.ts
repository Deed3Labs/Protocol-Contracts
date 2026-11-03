import { defineConfig } from 'tsup';

/**
 * The published JavaScript. `@clear/public-api-contracts` is a private workspace package, so its few
 * runtime helpers are bundled in (`noExternal`); `zod` is a dependency and stays external.
 * Declarations come from `scripts/sdk/build-types.mjs`, which tsup's dts bundler can't replace: the
 * contracts package points at TypeScript source, which it can't parse.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'node18',
  platform: 'node',
  dts: false,
  noExternal: [/^@clear\//],
  clean: true,
  sourcemap: true,
  treeshake: true,
});
