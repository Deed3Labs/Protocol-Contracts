import { expect, test } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/** Home's Build cart opens New charge on its items, on a live shop (the mock), not on the amount. */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

test('Build cart opens New charge on Items', async ({ page }) => {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/?preview=1&live=1');
  await settle(page);
  await page.getByRole('button', { name: 'Build cart' }).click();
  await expect(page).toHaveURL(/\/new\?items=1/);
  await expect(page.getByRole('radio', { name: 'Items' })).toBeChecked();
  await expect(page.getByText('Quick sale')).toBeVisible();
});
