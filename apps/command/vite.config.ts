import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Stamps the build's id into the service worker, so each deploy is a new worker with its own cache.
 * After the files are written (writeBundle), never on a build that failed: closeBundle runs then too,
 * and would hide the build's own error behind a missing index.html.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'clear-command-sw-stamp',
    apply: 'build',
    writeBundle() {
      const dist = resolve(__dirname, 'dist');
      const id = createHash('sha256').update(readFileSync(resolve(dist, 'index.html'))).digest('hex').slice(0, 12);
      const sw = resolve(dist, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', id));
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
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
