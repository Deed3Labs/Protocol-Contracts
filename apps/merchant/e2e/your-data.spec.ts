import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/** Settings › Advanced › Your data on a live shop (the mock): every charge and every payout, as CSV. */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page) {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/settings/advanced?preview=1&live=1');
  await settle(page);
  return page.locator('.c-cell', { hasText: 'Your data' });
}
const read = async (d: import('@playwright/test').Download) => fs.readFileSync((await d.path())!, 'utf8').trim().split('\r\n');

test('every charge since the shop joined, as a spreadsheet', async ({ page }) => {
  const cell = await open(page);
  const row = cell.locator('.c-r2', { hasText: 'Every charge' });
  const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^mikes-tire-every-charge-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = await read(download);
  expect(lines[0]).toBe('Date,Time,Sale,Customer,Raised by,Status,Items,Subtotal,Discount,Tax,Tip,Total,Paid by,Refunded');
  expect(lines.length).toBeGreaterThan(1);
});

test('every payout, Clear’s and the card deposits, with the charges in each', async ({ page }) => {
  const cell = await open(page);
  const row = cell.locator('.c-r2', { hasText: 'Every payout' });
  const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^mikes-tire-every-payout-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = await read(download);
  expect(lines[0]).toBe('Date,Kind,Reference,Charges,Gross,Processor fee,Clear fee,Net,Status');
  expect(lines.some((l) => l.includes(',Card deposit,'))).toBe(true);
});
