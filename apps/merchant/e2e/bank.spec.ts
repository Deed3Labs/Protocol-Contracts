import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Payouts › Where withdrawals go on a live shop (the mock): the shop's linked banks, one added with
 * Plaid (the mock stands in for Plaid Link) and one removed; refused before the business is verified.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function destinations(page: Page, query = '') {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`/payouts?preview=1&live=1${query}`);
  await settle(page);
  await page.getByText('Withdraws to').click();
  return page.getByRole('dialog', { name: 'Where withdrawals go' });
}

test('an owner adds a bank with Plaid, and removes one', async ({ page }) => {
  const sheet = await destinations(page);
  await expect(sheet).toContainText('Chase ••4417');
  await sheet.getByRole('button', { name: 'Add a bank account' }).click();
  await expect(sheet).toContainText('First Platypus Bank ••0000');
  await expect(sheet).toContainText('Business checking · verified with Plaid');
  await sheet.getByRole('button', { name: 'Remove Chase ••4417' }).click();
  await expect(sheet).not.toContainText('Chase ••4417');
});

test('before the business is verified, it says so', async ({ page }) => {
  const sheet = await destinations(page, '&kyb=new');
  await sheet.getByRole('button', { name: 'Add a bank account' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Verify the business first');
});

test('a manager sees the banks and can’t change them', async ({ page }) => {
  const sheet = await destinations(page, '&as=luis');
  await expect(sheet).toContainText('Chase ••4417');
  await expect(sheet.getByRole('button', { name: 'Add a bank account' })).toBeDisabled();
  await expect(sheet.getByRole('button', { name: /Remove/ })).toHaveCount(0);
});

test('withdrawing to the linked bank, same-day, with its 1%', async ({ page }) => {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/payouts?preview=1&live=1');
  await settle(page);
  await page.getByText('Withdraw', { exact: true }).first().click();
  for (const k of '100') await page.getByRole('button', { name: k, exact: true }).first().click();
  await page.locator('.c-leg').nth(1).click();
  const to = page.getByRole('dialog', { name: 'Where does it end up?' });
  await expect(to).toContainText('Standard ACH');
  await to.getByRole('button', { name: /Same-day ACH/ }).click();
  await expect(page.locator('.c-leg').nth(1)).toContainText('Today · 1%');
  await expect(page.getByText('1% · $1.00')).toBeVisible();
  await expect(page.getByText('$99.00')).toBeVisible();
  await page.getByRole('button', { name: /^Withdraw to/ }).click();
  await expect(page.getByText(/1–3 business days to the bank|to the bank/).first()).toBeVisible();
});
