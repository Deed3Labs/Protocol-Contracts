import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Overview on a live shop (the mock), as the owner: Export saves the month's sales as a spreadsheet,
 * and a month's statement opens from Statements, prints (Save as PDF is the print dialog's) and emails.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page) {
  // Count print calls instead of opening the dialog, and keep what was printed.
  await page.addInitScript(() => {
    (window as unknown as { printed: string[] }).printed = [];
    window.print = () => (window as unknown as { printed: string[] }).printed.push(document.getElementById('c-print-root')?.innerText ?? '');
  });
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/overview?preview=1&live=1');
  await settle(page);
}

test('Export: the month’s sales as a spreadsheet', async ({ page }) => {
  await open(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  expect(download.suggestedFilename()).toBe('mikes-tire-sales-2026-09.csv');
  const csv = fs.readFileSync((await download.path())!, 'utf8');
  const lines = csv.trimEnd().split('\r\n');
  expect(lines[0]).toBe('Date,Time,Sale,Customer,Raised by,Status,Items,Subtotal,Discount,Tax,Tip,Total,Paid by,Refunded');
  expect(lines.length).toBeGreaterThan(1);
  expect(csv).toContain('2026-09-');
});

test('Statements: a month opens, and prints', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Statements' }).click();
  const list = page.getByRole('dialog', { name: 'Statements' });
  await expect(list.getByText('Open a month to save it as a PDF.')).toBeVisible();
  await list.getByRole('button', { name: /September 2026 statement/ }).click();

  const sheet = page.getByRole('dialog', { name: 'September 2026 statement' });
  await expect(sheet.getByText('Sales', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/Taken · \d+ sales?/)).toBeVisible();
  await expect(sheet.getByText(/, in progress/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Save as PDF' }).click();
  const printed = await page.evaluate(() => (window as unknown as { printed: string[] }).printed);
  expect(printed).toHaveLength(1);
  expect(printed[0]).toContain('September 2026');
  expect(printed[0]).toContain('Taken');

  // Email it to the accountant; the address is remembered for next month.
  await sheet.getByRole('button', { name: 'Send to my accountant' }).click();
  const send = sheet.getByRole('button', { name: 'Send the statement' });
  await sheet.getByRole('textbox', { name: 'Your accountant’s email' }).fill('books');
  await expect(send).toBeDisabled();
  await sheet.getByRole('textbox', { name: 'Your accountant’s email' }).fill('books@acme-accounting.com');
  await send.click();
  await expect(sheet.getByRole('status')).toHaveText('Sent to books@acme-accounting.com');
  expect(await page.evaluate(() => localStorage.getItem('clear.merchant.accountant'))).toBe('books@acme-accounting.com');

  // Back to the months.
  await sheet.locator('.c-mc-back').click();
  await expect(page.getByRole('dialog', { name: 'Statements' })).toBeVisible();
});

test('the statement passes axe', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await open(page);
  await page.getByRole('button', { name: 'Statements' }).click();
  await page.getByRole('dialog', { name: 'Statements' }).getByRole('button', { name: /September 2026 statement/ }).click();
  await expect(page.getByRole('dialog', { name: 'September 2026 statement' }).getByText('Sales', { exact: true })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
});
