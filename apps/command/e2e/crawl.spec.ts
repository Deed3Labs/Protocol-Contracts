import { expect, test, type Page } from '@playwright/test';
import { APP, PROTO, REDESIGN } from '../playwright.config';
import { ROUTES, SHADOWED, SHADOW_TABS, canonical, open, ported } from './pages';

/**
 * The buttons on every page and pane, clicked once in the reference and once in the app, from the
 * same starting point: what opens (a panel, a modal, the profile menu, a toast, another page) must
 * be the same DOM. A page ported to the redesign is clicked against the redesign
 * (design/command-center-ui), tab by tab inside its shadow root, as the pixel check does; the rest
 * against the old prototype. A table's rows all do the same thing, so up to three of each kind of control are
 * clicked (a kind is its tag and data-* attribute names). Slow, so it runs on demand:
 * `npm run test:crawl`.
 */
test.skip(!process.env.CRAWL, 'set CRAWL=1 to run the click crawl');
test.beforeEach(({}, info) => test.skip(info.project.name !== 'wide', 'the crawl runs at one width'));
test.describe.configure({ timeout: 30 * 60_000 });

const CLICKABLE = '#main button, #main [data-member], #main tr[data-merchant], #main tr[data-poster], #main [data-cmcity]';
const LAYERS = ['#main', '#modalRoot', '#pfRoot', '#loginRoot', '#railNav'];

async function snapshot(page: Page, route: string) {
  // a redesigned page draws inside its host's shadow root, its side panel too: that's what's compared, and not
  // #main around it, where the app keeps the host in a slot of its own (sections/pageHost.tsx)
  const layers = SHADOWED.has(route) ? [...LAYERS.filter((l) => l !== '#main'), 'shadow:.gw'] : LAYERS;
  const parts = await Promise.all(layers.map((s) => canonical(page, s)));
  const toast = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return t && t.classList.contains('on') ? t.textContent : '';
  });
  return [...parts, `toast: ${toast}`, `route: ${new URL(page.url()).hash}`].join('\n');
}

async function at(page: Page, base: string, route: string, pane: number) {
  // a real reload: going to the same #hash again would keep whatever the last click opened
  await page.goto('about:blank');
  // the old prototype only knows Build by its old name
  await open(page, base, base === PROTO && route === 'build' ? 'contracts' : route);
  // the same clock and dice in both: the prototype reads Date.now() twice and makes up a time with Math.random()
  await page.evaluate(() => {
    Date.now = () => Date.UTC(2026, 9, 21, 21);
    Math.random = () => 0.5;
  });
  if (pane > 0) await page.locator(tabsOf(route)).nth(pane).click({ timeout: 5000 });
}

/** What a route is compared with, and where its tabs are. */
const baseOf = (route: string) => (ported(route) ? REDESIGN : PROTO);
const tabsOf = (route: string) => (SHADOWED.has(route) ? SHADOW_TABS : '#main .ptabs button');

/** Up to three of each kind of control, by index into CLICKABLE. */
async function sample(page: Page): Promise<number[]> {
  return page.$$eval(CLICKABLE, (els) => {
    const seen = new Map<string, number>();
    const out: number[] = [];
    els.forEach((el, i) => {
      const data = [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).sort().join(',');
      const kind = `${el.tagName}|${data || el.textContent?.trim().slice(0, 30)}`;
      const n = seen.get(kind) ?? 0;
      if (n < 3) out.push(i);
      seen.set(kind, n + 1);
    });
    return out;
  });
}

for (const route of ROUTES) {
  for (let pane = 0; pane < 8; pane++) {
    test(`clicks match the reference: ${route} · pane ${pane}`, async ({ browser }) => {
      const ref = await browser.newPage();
      const app = await browser.newPage();
      const base = baseOf(route);
      await at(ref, base, route, 0);
      const panes = Math.max(1, await ref.locator(tabsOf(route)).count());
      test.skip(pane >= panes, 'no such pane');
      await at(ref, base, route, pane);
      for (const i of await sample(ref)) {
        await at(ref, base, route, pane);
        await at(app, APP, route, pane);
        const target = ref.locator(CLICKABLE).nth(i);
        if (!(await target.isVisible())) continue;
        const label = `${route} · pane ${pane} · #${i} ${(await target.textContent())?.trim().slice(0, 40)}`;
        await target.click({ timeout: 2000 }).catch(() => undefined);
        await app.locator(CLICKABLE).nth(i).click({ timeout: 2000 }).catch(() => undefined);
        await ref.waitForTimeout(60);
        await app.waitForTimeout(60);
        expect.soft(await snapshot(app, route), label).toBe(await snapshot(ref, route));
      }
      await ref.close();
      await app.close();
    });
  }
}
