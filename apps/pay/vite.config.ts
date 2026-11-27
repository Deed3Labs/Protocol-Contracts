import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * pay.useclear.org: a payment link's page (`/l/:slug`) now, and the modal (`/m/:session`) in Phase 5.
 * Clear's own page: no Privy and no wallet here (pay DECISIONS, Phase 1).
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { port: 5195 },
});
