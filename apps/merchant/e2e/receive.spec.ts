import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Payouts › Receive on a live shop (the mock): the shop's account and routing numbers from Bridge,
 * opened by an owner, emailed to the business's address; not before the business is verified.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function receive(page: Page, query = '') {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`/payouts?preview=1&live=1${query}`);
  await settle(page);
  await page.getByText('Account and routing, for ACH or wire').click();
  return page.getByRole('dialog', { name: 'Cash account' });
}

test('an owner opens the account, and emails the details to the business', async ({ page }) => {
  const sheet = await receive(page, '&receive=new');
  await expect(sheet).toContainText('Get an account and routing number in the business’s name');
  await sheet.getByRole('button', { name: 'Get account and routing' }).click();
  await expect(sheet).toContainText('Routing101019644');
  await expect(sheet).toContainText('Account900123456789');
  await expect(sheet).toContainText('Account nameMike’s Tire LLC');
  await expect(sheet).toContainText('Email sends them to mike@mikestire.com');
  await sheet.getByRole('button', { name: 'Email them to me' }).click();
  await expect(sheet).toContainText('Sent to mike@mikestire.com.');
  await expect(sheet.getByRole('button', { name: 'Sent' })).toBeVisible();
});

test('a manager reads it and can’t open it', async ({ page }) => {
  const open = await receive(page, '&as=luis');
  await expect(open).toContainText('Routing101019644');
  await page.goto('/payouts?preview=1&live=1&as=luis&receive=new');
  await settle(page);
  await page.getByText('Account and routing, for ACH or wire').click();
  const sheet = page.getByRole('dialog', { name: 'Cash account' });
  await expect(sheet).toContainText('Only an owner can open it.');
  await expect(sheet.getByRole('button', { name: 'Get account and routing' })).toHaveCount(0);
});

test('before the business is verified, it sends the owner to verify it', async ({ page }) => {
  const sheet = await receive(page, '&kyb=new');
  await expect(sheet).toContainText('Bridge opens an account only for a verified business');
  await sheet.getByRole('button', { name: 'Verify the business' }).click();
  await expect(page).toHaveURL(/\/settings\/advanced/);
});
