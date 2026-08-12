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
    // The same lazy/unused Privy features that `build.rollupOptions.external` drops (see below)
    // also have to be kept out of dev pre-bundling: esbuild resolves imports eagerly, so
    // @farcaster/mini-app-solana's uninstalled peers (@solana/wallet-adapter-react,
    // @farcaster/miniapp-sdk) aborted `vite dev` at startup. Their chunks never load at runtime.
    exclude: [
      "@xmtp/wasm-bindings",
      "@xmtp/browser-sdk",
      "@farcaster/mini-app-solana",
      "@abstract-foundation/agw-client",
      "@stripe/crypto",
    ],
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
