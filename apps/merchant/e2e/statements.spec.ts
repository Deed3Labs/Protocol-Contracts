import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Settings › Payouts on a live shop (the mock): where payouts go (the linked bank), and the monthly
 * statements, as PDF, as a spreadsheet, and emailed on the 2nd.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { printed: string[] }).printed = [];
    window.print = () => (window as unknown as { printed: string[] }).printed.push(document.getElementById('c-print-root')?.innerText ?? '');
  });
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/settings/payouts?preview=1&live=1');
  await settle(page);
}
const statements = (page: Page) => page.locator('.c-cell', { hasText: 'Statements' });

test('statements: a month as PDF and as a spreadsheet', async ({ page }) => {
  await open(page);
  await expect(statements(page)).toContainText('September 2026');
  await expect(statements(page)).toContainText('Still being written');
  await expect(statements(page)).toContainText('August 2026');
  const august = statements(page).locator('.c-r2, .c-line', { hasText: 'August 2026' }).first();
  await august.getByRole('button', { name: 'PDF' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: string[] }).printed.length)).toBe(1);
  expect((await page.evaluate(() => (window as unknown as { printed: string[] }).printed))[0]).toContain('August 2026');
  const [download] = await Promise.all([page.waitForEvent('download'), august.getByRole('button', { name: 'CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('mikes-tire-sales-2026-08.csv');
  expect(fs.readFileSync((await download.path())!, 'utf8').split('\r\n')[0]).toContain('Date,Time,Sale');
});

test('each statement emailed on the 2nd', async ({ page }) => {
  await open(page);
  const sw = page.getByRole('switch', { name: 'Email each statement' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  const sheet = page.getByRole('dialog', { name: 'Email each statement to' });
  await sheet.getByRole('textbox', { name: 'Email' }).fill('books@acme-accounting.com');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(statements(page)).toContainText('On the 2nd, to books@acme-accounting.com');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('where payouts go: the linked bank; Change account opens Payouts’ banks', async ({ page }) => {
  await open(page);
  await expect(page.locator('.c-cell', { hasText: 'Where payouts go' })).toContainText('Chase ••4417');
  await page.getByRole('button', { name: 'Change account' }).click();
  await expect(page.getByRole('dialog', { name: 'Where withdrawals go' })).toBeVisible();
});
