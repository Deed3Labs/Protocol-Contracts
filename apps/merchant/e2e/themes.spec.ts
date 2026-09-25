import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Dusk and Dark (reference section 21): chosen on the tablet, kept across a reload, and every main
 * page passing axe's WCAG 2.1 AA checks in each, colour contrast included.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

const PAGES = ['/', '/new', '/charges', '/inventory', '/payouts', '/staff', '/overview', '/settings/shop', '/settings/tips'];

async function visit(page: Page, path: string, theme: string) {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`${path}?preview=1&theme=${theme}`);
  await settle(page);
}

for (const theme of ['dusk', 'dark'] as const) {
  test(`${theme}: every main page passes axe`, async ({ page }) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const found: string[] = [];
    for (const path of PAGES) {
      await visit(page, path, theme);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      found.push(...r.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`));
    }
    expect(found).toEqual([]);
  });
}

test('chosen on the tablet, and still there after a reload', async ({ page }) => {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/?preview=1');
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.dataset.theme ?? 'light')).toBe('light');
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  const paper = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(paper).toBe('rgb(22, 33, 29)');
  await page.reload();
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  // Codes stay dark on light, for the phones that scan them.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--qr-ink').trim())).toBe('#16211d');
});
