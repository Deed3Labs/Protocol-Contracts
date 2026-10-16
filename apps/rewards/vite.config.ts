import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // These ship TypeScript source rather than a build, so they're treated as first-party source.
      '@clear/domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
      '@clear/member-kit': resolve(__dirname, '../../packages/member-kit/src'),
    },
  },
  // The same Privy workaround the member and merchant apps carry: a Solana peer that never loads in
  // an EVM app, resolved eagerly by esbuild and rollup.
  optimizeDeps: {
    exclude: ['@farcaster/mini-app-solana', '@abstract-foundation/agw-client'],
  },
  build: {
    rollupOptions: {
      external: [/^@farcaster\/mini-app-solana/, /^@abstract-foundation\/agw-client/],
    },
  },
  server: { port: 5190 },
});
