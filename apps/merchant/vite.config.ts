import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Both ship TypeScript source rather than a build, so they are aliased to be treated as
      // first-party source instead of pre-bundled as dependencies with no dist/.
      '@clear/domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
      '@clear/tokens': resolve(__dirname, '../../packages/tokens/src/index.ts'),
    },
  },
  /*
   * The same Privy workaround the member app carries, and for the same reason.
   *
   * @privy-io/react-auth reaches @farcaster/mini-app-solana, which imports
   * @solana/wallet-adapter-react — a peer that is not installed and never will be here. The chunk
   * never loads at runtime in an EVM, email-and-passkey app, so its bare import never executes;
   * but esbuild resolves eagerly in dev and rollup resolves eagerly in build, so both need telling.
   *
   * Externalising is right rather than installing the peer: adding a Solana wallet adapter to a
   * merchant tablet to satisfy a code path that never runs is a dependency nobody asked for.
   */
  optimizeDeps: {
    exclude: ['@farcaster/mini-app-solana', '@abstract-foundation/agw-client'],
  },
  build: {
    rollupOptions: {
      external: [/^@farcaster\/mini-app-solana/, /^@abstract-foundation\/agw-client/],
    },
  },
  server: { port: 5174 },
});
