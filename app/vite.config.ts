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
    // @farcaster/mini-app-solana is excluded for the same reason build.rollupOptions.external lists it
    // below: it pulls UNINSTALLED transitive deps (@solana/wallet-adapter-react, @farcaster/miniapp-sdk),
    // which crashed esbuild's dep pre-bundling and took the whole dev server down on startup. The chunk
    // never loads in this EVM-only app, so excluding it from optimization is safe.
    exclude: ["@xmtp/wasm-bindings", "@xmtp/browser-sdk", "@farcaster/mini-app-solana"],
    include: ["@xmtp/proto", "buffer"],
  },
  define: {
    global: 'globalThis',
  },
  build: {
    rollupOptions: {
      // Two entries: the app, and the unlinked design-preview harness at /design-preview.html.
      // The harness ships so the redesign can be reviewed on the branch deploy without signing
      // in. Drop this input (and the file) before merging to main.
      input: {
        main: resolve(__dirname, 'index.html'),
        designPreview: resolve(__dirname, 'design-preview.html'),
      },
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
