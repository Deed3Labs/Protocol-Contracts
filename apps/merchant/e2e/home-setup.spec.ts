import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Home on a live shop (the mock), for owners and managers: Set up the till from what the shop has
 * done, and the stock running low.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page, query = '') {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`/?preview=1&live=1${query}`);
  await settle(page);
}
const till = (page: Page) => page.locator('.c-ob-cell', { hasText: 'Set up the till' });
const row = (page: Page, t: string) => till(page).locator('.c-ob-cl', { hasText: t });

test('a shop partway set up: the till, one step done from Settings', async ({ page }) => {
  await open(page, '&stripe=not_connected&setup=new');
  await expect(till(page)).toContainText('2 of 6');
  await expect(row(page, 'Add what you sell')).toHaveClass(/c-done/);
  await expect(row(page, 'Your team')).toContainText('Jen, Luis and Ana, added');
  await expect(row(page, 'Connect Stripe to take cards')).not.toHaveClass(/c-done/);

  // Each row opens the screen that does it.
  await row(page, 'Set starting cash').click();
  await expect(page).toHaveURL(/\/settings\/closing/);
  await page.getByText('Starting cash', { exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Starting cash' });
  await sheet.getByRole('textbox').fill('200');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
  await expect(till(page)).toContainText('3 of 6');
  await expect(row(page, 'Set starting cash')).toHaveClass(/c-done/);
});

test('a shop set up: no till; stock running low', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Set up the till')).toHaveCount(0);
  const low = page.locator('.c-panel, .c-cell', { hasText: 'Running low' }).first();
  await expect(low).toContainText('Brake rotor, front');
  await expect(low).not.toContainText('Michelin');
});

test('a counter shift sees neither', async ({ page }) => {
  await open(page, '&as=jen&stripe=not_connected&setup=new');
  await expect(page.locator('.c-mc-shiftcell')).toBeVisible();
  await expect(page.getByText('Set up the till')).toHaveCount(0);
  await expect(page.getByText('Running low')).toHaveCount(0);
});

test('the live Home passes axe with the till and running low', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await open(page, '&stripe=not_connected&setup=new');
  await expect(till(page)).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
});
