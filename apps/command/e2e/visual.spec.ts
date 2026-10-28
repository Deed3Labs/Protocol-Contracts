import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { APP, PROTO, REDESIGN } from '../playwright.config';
import { ROUTES, SHADOWED, SHADOW_TABS, open, ported } from './pages';

/**
 * Pixels against the prototype: every section and pane tab at 1500, 1100 and 390 px, in Paper and
 * Ink. The prototype's screenshot is written as the baseline and the app's is compared with it, so
 * the baseline can never drift from the design. (Don't run this with --update-snapshots: that would
 * compare the app with itself.)
 */
const shot = (page: Page) => page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css' });

for (const theme of ['light', 'dark'] as const) {
  for (const route of ROUTES) {
    test(`looks like the prototype: ${route} · ${theme === 'light' ? 'Paper' : 'Ink'}`, async ({ browser }, info) => {
      const viewport = info.project.use.viewport!;
      const proto = await browser.newPage({ viewport });
      const app = await browser.newPage({ viewport });
      // a ported page is compared with the redesign (docs/ui-redesign-plan.md), and its tabs are the redesign's
      await open(proto, ported(route) ? REDESIGN : PROTO, route, theme);
      await open(app, APP, route, theme);
      const tabs = SHADOWED.has(route) ? SHADOW_TABS : '#main .ptabs button';
      const panes = Math.max(1, await proto.locator(tabs).count());
      for (let pane = 0; pane < panes; pane++) {
        if (pane > 0) {
          await proto.locator(tabs).nth(pane).click();
          await app.locator(tabs).nth(pane).click();
        }
        // a pane can use a weight or face the last one didn't, and the browser loads it on first use
        await Promise.all([proto, app].map((p) => p.evaluate(() => document.fonts.ready)));
        const name = `${route}-${pane}-${theme}.png`;
        const baseline = info.snapshotPath(name);
        mkdirSync(dirname(baseline), { recursive: true });
        writeFileSync(baseline, await shot(proto));
        expect.soft(await shot(app), `${route} · pane ${pane}`).toMatchSnapshot(name, { maxDiffPixelRatio: 0.001 });
      }
      await proto.close();
      await app.close();
    });
  }
}
