import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Settings › Advanced on a live shop (the mock): the business's verification with Bridge, started
 * by the owner (Bridge's hosted pages come next), and once it's done.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page, query = '') {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`/settings/advanced?preview=1&live=1${query}`);
  await settle(page);
}
const cell = (page: Page) => page.locator('.c-cell', { hasText: 'Business verification' });

test('not verified yet: the owner starts it, and goes to Bridge', async ({ page }) => {
  await open(page, '&kyb=new');
  await expect(cell(page)).toContainText('Not verified');
  await expect(cell(page)).toContainText('After verification');
  await cell(page).getByRole('button', { name: 'Verify the business' }).click();
  const sheet = page.getByRole('dialog', { name: 'Verify the business' });
  await expect(sheet.getByRole('textbox', { name: 'Legal business name' })).toHaveValue('Mike’s Tire');
  await sheet.getByRole('textbox', { name: 'Legal business name' }).fill('Mike’s Tire LLC');
  await sheet.getByRole('textbox', { name: 'Business email' }).fill('mike@mikestire.com');
  await sheet.getByRole('button', { name: 'Save' }).click();
  // The mock's "Bridge" sends it straight back, as Bridge's redirect will.
  await page.waitForURL(/kyb=back/);
});

test('verified: ready to withdraw to a bank, nothing more to do', async ({ page }) => {
  await open(page);
  await expect(cell(page)).toContainText('Verified');
  await expect(cell(page)).toContainText('Ready');
  await expect(cell(page)).toContainText('Under mike@mikestire.com');
  await expect(cell(page).getByRole('button')).toHaveCount(0);
});

test('the live Advanced pane passes axe', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await open(page, '&kyb=new');
  await expect(cell(page)).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
});
