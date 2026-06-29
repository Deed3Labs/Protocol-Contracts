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
      // Privy statically references optional-feature peers (Farcaster-Solana / Abstract / Stripe-crypto
      // and their Solana wallet-adapter transitives) that this EVM-only email/social app never uses.
      // Externalize them so Rollup doesn't descend into their uninstalled deps — they live in lazy Privy
      // chunks that never load here.
      external: [
        /^@solana\//,
        /^@solana-program\//,
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
