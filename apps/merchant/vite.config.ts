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
  server: { port: 5174 },
});
