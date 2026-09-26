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
