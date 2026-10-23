import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The same Privy workaround the member, merchant and rewards apps carry: Solana and wallet peers
  // that never load in an app that doesn't sign, resolved eagerly by esbuild and rollup.
  optimizeDeps: {
    exclude: ['@farcaster/mini-app-solana', '@abstract-foundation/agw-client'],
  },
  build: {
    rollupOptions: {
      external: [/^@farcaster\/mini-app-solana/, /^@abstract-foundation\/agw-client/],
    },
  },
  server: { port: 5230 },
});
