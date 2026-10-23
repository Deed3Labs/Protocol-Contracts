import { defineConfig } from '@playwright/test';

/**
 * The prototype is the spec, so the checks compare the app with it directly: the same page in both,
 * DOM against DOM (e2e/parity.spec.ts) and pixels against pixels (e2e/visual.spec.ts), at the three
 * widths in Paper and Ink. The prototype is served as a static file from docs/command-reference.
 *
 * Runs on the installed Chrome, like the merchant app's checks, against its own dev server on 5231.
 */
// the preview: the prototype's simulated sign-in and demo team, which is what the checks compare
export const APP = 'http://localhost:5231/?preview=1';
export const PROTO = 'http://localhost:5233/clear-command-center.html';
export const WIDTHS = { wide: 1500, laptop: 1100, phone: 390 } as const;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  timeout: 120_000,
  retries: 1,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
  },
  projects: (Object.keys(WIDTHS) as (keyof typeof WIDTHS)[]).map((name) => ({
    name,
    use: { viewport: { width: WIDTHS[name], height: 900 } },
  })),
  webServer: [
    {
      command: 'node ../../node_modules/vite/bin/vite.js --port 5231 --strictPort',
      url: APP,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js ../../docs/command-reference --port 5233 --strictPort',
      url: PROTO,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
