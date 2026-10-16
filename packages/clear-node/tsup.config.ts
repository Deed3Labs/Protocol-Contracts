import { defineConfig } from 'tsup';

/**
 * The published build. `@clear/public-api-contracts` is a private workspace package, so its types and
 * its few runtime helpers are bundled in (`noExternal`), and the declarations are resolved into
 * `dist/index.d.ts` so nobody needs it from npm. Before publishing, point `main`/`types`/`exports` in
 * package.json at `dist/` and drop `private`.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'node18',
  platform: 'node',
  dts: { resolve: true },
  noExternal: [/^@clear\//],
  clean: true,
  sourcemap: true,
  treeshake: true,
});
