import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    exclude: ["@xmtp/wasm-bindings", "@xmtp/browser-sdk"],
    include: ["@xmtp/proto", "buffer"],
  },
  define: {
    global: 'globalThis',
  },
  build: {
    rollupOptions: {
      // @solana/* MUST be bundled — Privy imports @solana/kit EAGERLY, so externalizing it left a bare
      // "@solana/kit" specifier the browser can't resolve → blank screen. Only externalize the genuinely
      // lazy/unused Privy features that pull UNINSTALLED transitive deps (e.g. @farcaster/mini-app-solana
      // → @solana/wallet-adapter-react, which isn't installed). Those chunks never load in this EVM-only
      // email/social app, so their bare imports never execute.
      external: [
        // Genuinely lazy/unused Privy features whose chunks NEVER load in this EVM email/social app, and
        // which pull UNINSTALLED transitive deps (e.g. @farcaster/mini-app-solana → @solana/wallet-
        // adapter-react). @solana/* + @solana-program/* are bundled (Privy imports them eagerly).
        /^@farcaster\/mini-app-solana/,
        /^@abstract-foundation\/agw-client/,
        /^@stripe\/crypto/,
      ],
      output: {
        manualChunks: undefined,
      },
    },
  },
  // Service Worker configuration
  publicDir: 'public',
})
