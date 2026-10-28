import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { APP } from '../playwright.config';
import { ROUTES, open } from './pages';

/*
 * Real data only (Phase 9): every page, tab and pane renders with nothing in it, and none of the
 * prototype's demo data shows. The empty preview (`?preview=1&empty=1`) is the live app's pages with
 * every dataset emptied and no API, which is where a live page stands before anything is real.
 *
 * Each page, then each of its tabs, then the first controls on each (a pane or a flow opens, Escape
 * closes it): any error the page throws, and any demo name it draws, is reported. The report is
 * e2e/.results/empty-report.json.
 */

const EMPTY = APP + '&empty=1';
/** A section's tabs: the old pages' pane tabs, or a redesigned page's (inside its shadow root, which locators reach). */
const TABS = '#main .ptabs button, #main .gtabs button:not(.tabr)';
const CLICKABLE = '#main button, #main [data-member], #main tr[data-merchant], #main tr[data-poster]';
const PER_PANE = 40;
/** People, shops and places only the prototype has: if one is drawn, demo data leaked. The entities
 * (The Deed & Title Co. among them) are the co-op's real structure, so they aren't here. */
const DEMO = [
  'Dana Ruiz',
  'Marcus Lee',
  'Lena Park',
  'Priya Shah',
  'Ana R.',
  'Jordan P.',
  'Rosa’s',
  'Mesa Laundry',
  'Inland Cycle',
  'Uptown Barber',
  'Cajon Phone',
  'Citrus Bowl',
  'Redlands Tire',
  'Smiley Library',
  'UR Commons',
  'Bo Chen',
  'batch 13',
  // Money's reference (money2.tsx): its shops, signer and payee
  'Arrowhead Nails',
  'Highland Hardware',
  'Board signer',
  'CDTFA',
];

type Finding = { route: string; pane: string; after: string; kind: 'error' | 'demo' | 'garbage'; what: string };
/** What a page shows when it drew numbers it didn't have. */
const GARBAGE = /\bNaN\b|Infinity|\bundefined\b|\[object Object\]/;
// each page's findings in a file of its own: a worker restarted after a timeout loses nothing
const DIR = 'e2e/.results/empty';
const save = (route: string, f: Finding[]) => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/${route}.json`, JSON.stringify([...new Map(f.map((x) => [`${x.kind}|${x.what}`, x])).values()], null, 1));
};

async function demoText(page: Page): Promise<string[]> {
  const text = await page.evaluate(() =>
    [document.querySelector('#main'), document.querySelector('#modalRoot'), document.querySelector('.rail-ft')]
      .map((n) => (n as HTMLElement | null)?.innerText ?? '')
      // a redesigned page draws in its shadow root, which the page's own text doesn't include
      .concat([...document.querySelectorAll('#main .g-host')].map((h) => (h.shadowRoot?.querySelector('.gw') as HTMLElement | null)?.innerText ?? ''))
      .join('\n'),
  );
  const bad = GARBAGE.exec(text);
  return [...DEMO.filter((d) => text.includes(d)), ...(bad ? [`garbage: ${text.slice(Math.max(0, bad.index - 40), bad.index + 30).replace(/\s+/g, ' ')}`] : [])];
}

for (const route of ROUTES) {
  test(`renders empty: ${route}`, async ({ page }) => {
    // every tab and up to 40 controls on each: Growth and Contracts take longer than the default allows
    test.setTimeout(900_000);
    const findings: Finding[] = [];
    let where = { pane: 'overview', after: 'load' };
    page.on('pageerror', (e) => findings.push({ route, ...where, kind: 'error', what: e.message.slice(0, 200) }));
    try {
      await open(page, EMPTY, route);
      const tabs = Math.max(1, await page.locator(TABS).count());
      for (let t = 0; t < tabs; t++) {
        if (t > 0) {
          const label = (await page.locator(TABS).nth(t).textContent())?.trim() ?? `tab ${t}`;
          where = { pane: label, after: 'tab' };
          await page
            .locator(TABS)
            .nth(t)
            .click({ timeout: 3000 })
            .catch(() => undefined);
        }
        for (const d of await demoText(page)) findings.push({ route, ...where, kind: d.startsWith('garbage:') ? 'garbage' : 'demo', what: d });
        const n = Math.min(PER_PANE, await page.locator(CLICKABLE).count());
        for (let i = 0; i < n; i++) {
          const el = page.locator(CLICKABLE).nth(i);
          // a click before may have changed the pane, so this control may be gone: don't wait for it
          const label = ((await el.textContent({ timeout: 1500 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
          where = { pane: where.pane, after: `click "${label}"` };
          await el.click({ timeout: 1500 }).catch(() => undefined);
          for (const d of await demoText(page)) findings.push({ route, ...where, kind: d.startsWith('garbage:') ? 'garbage' : 'demo', what: d });
          await page.keyboard.press('Escape').catch(() => undefined);
          // a click that loads the page again without `empty=1` would draw the prototype's data from then on
          if (!page.url().includes('empty=1')) findings.push({ route, ...where, kind: 'error', what: `left the empty preview: ${page.url()}` });
          // back to the tab if a click navigated away
          // then loaded again: going to the same URL with only its hash changed doesn't load the page, so it would stay where the click took it
          if (!page.url().includes(`#${route}`) || !page.url().includes('empty=1')) {
            await open(page, EMPTY, route);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.locator('#main > *').first().waitFor();
            // and back to the tab being crawled
            if (t > 0)
              await page
                .locator(TABS)
                .nth(t)
                .click({ timeout: 3000 })
                .catch(() => undefined);
          }
        }
      }
    } finally {
      save(route, findings);
    }
    expect(findings).toEqual([]);
  });
}

/** Every page's findings in one report: `node -e` it, or read e2e/.results/empty/*.json. */
export function report(): Finding[] {
  return readdirSync(DIR).flatMap((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as Finding[]);
}
