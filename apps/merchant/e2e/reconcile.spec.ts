import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Payouts › Checked against Stripe on a live shop (the mock): the night's findings in plain words,
 * and one explained by a manager.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page, as = '') {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`/payouts?preview=1&live=1${as ? `&as=${as}` : ''}`);
  await settle(page);
}

test('what doesn’t match, and a manager explaining one', async ({ page }) => {
  await open(page, 'luis');
  const cell = page.locator('.c-cell', { hasText: 'Checked against Stripe' });
  await expect(cell).toContainText('2 to look at');
  await expect(cell).toContainText('Clear’s fee on a card sale differs');
  await expect(cell).toContainText('Expected $0.30 · found $0.29');
  await expect(cell).toContainText('A payout that isn’t in the books');

  await cell.locator('.c-line', { hasText: 'Clear’s fee on a card sale differs' }).getByRole('button', { name: 'Explain' }).click();
  const sheet = page.getByRole('dialog', { name: 'What happened?' });
  await expect(sheet).toContainText('should be 30 cents; the processor took 29');
  const save = sheet.getByRole('button', { name: 'Mark as explained' });
  await expect(save).toBeDisabled();
  await sheet.getByRole('textbox', { name: 'Your note' }).fill('Stripe rounded the fee on a split tender; checked with support');
  await save.click();
  await expect(sheet).toHaveCount(0);

  await expect(cell).toContainText('1 to look at');
  await expect(cell).not.toContainText('Clear’s fee on a card sale differs');
  await cell.getByRole('button', { name: 'Explained · 1' }).click();
  await expect(cell).toContainText('“Stripe rounded the fee on a split tender; checked with support” · Luis M.');
});

test('the live Payouts page passes axe with the findings', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await open(page);
  await expect(page.getByText('Checked against Stripe')).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
});
