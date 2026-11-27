import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/** A shop with no payout day set (the mock's `&payday=none`): every place that names the day says net-30. */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`${path}?preview=1&live=1&payday=none`);
  await settle(page);
  const text = await page.locator('body').innerText();
  // Never a dash where the day would be.
  expect(text).not.toMatch(/the —|The —|Releases —|on —|Lands —/);
  return text;
}

test('Payouts: releases, paid and the rest, net-30', async ({ page }) => {
  const text = await open(page, '/payouts');
  expect(text).toContain('Releases net-30');
  expect(text).toMatch(/Paid\s+Net-30/);
  expect(text).toContain('The rest releases net-30.');
});

test('Home: the next payout is net-30', async ({ page }) => {
  const text = await open(page, '/');
  const cell = page.locator('.c-cell', { hasText: 'Next payout' });
  await expect(cell).toContainText('Net-30');
  await expect(cell).toContainText('Paid net-30');
  expect(text).not.toContain('Lands ');
});

test('Overview and Settings: next payout, net-30', async ({ page }) => {
  await open(page, '/overview');
  await expect(page.locator('.c-cell', { hasText: 'Owed to you' }).locator('.c-line', { hasText: 'Next payout' })).toContainText('Net-30');
  await open(page, '/settings/payouts');
  await expect(page.getByText(/Net-30 · \$/)).toBeVisible();
});
