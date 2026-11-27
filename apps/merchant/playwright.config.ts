import { defineConfig } from '@playwright/test';

/**
 * UI Phase 7's checks: every state at the three review sizes, paired with its reference frame
 * (e2e/visual.spec.ts), accessibility (e2e/a11y.spec.ts), roles (e2e/roles.spec.ts) and the PWA
 * (e2e/pwa.spec.ts).
 *
 * Runs on the installed Chrome (`channel: 'chrome'`) rather than a downloaded browser, against its
 * own dev server on 5186 so it never collides with a preview left running on 5174/5175. The dev
 * server is what serves `?preview=1`, which is how every state is reached without a backend.
 */
const PORT = 5186;

export const SIZES = {
  landscape: { width: 1180, height: 820 },
  portrait: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
} as const;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  // The dev server optimises a dependency the first time a page needs it and reloads that page; a
  // retry absorbs the one reload, which is the dev server's, not the app's.
  retries: 1,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  globalTeardown: './e2e/report.ts',
  expect: {
    // The app against itself: anti-aliasing differs a little between runs, a layout change does not.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    reducedMotion: 'no-preference',
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
  },
  projects: (Object.keys(SIZES) as (keyof typeof SIZES)[]).map((name) => ({
    name,
    // Tablets and phones are touch screens; the layout itself is decided by width alone.
    use: { viewport: SIZES[name], hasTouch: true },
  })),
  webServer: {
    command: `node ../../node_modules/vite/bin/vite.js --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
