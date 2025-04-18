import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.js",
      formats: ["es"],
      fileName: (format) => `deed-nft-webflow.${format}.js`,
    },
    target: "modules",
    minify: true,
    rollupOptions: {
      external: ["@reown/appkit", "@reown/appkit-adapter-wagmi", "@wagmi/core"],
      output: {
        format: "es",
        intro: `if (typeof BigInt === 'undefined') { window.BigInt = Number; }`,
        globals: {
          "@reown/appkit": "ReownAppKit",
          "@reown/appkit-adapter-wagmi": "ReownWagmiAdapter",
          "@wagmi/core": "wagmiCore",
        },
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
  server: {
    cors: {
      origin: [
        "https://app.clearpath.one",
        "https://webflow.com",
        "https://*.webflow.io",
      ],
      methods: ["GET"],
      credentials: true,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    },
  },
});
