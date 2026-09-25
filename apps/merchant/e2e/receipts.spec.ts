import { expect, test } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Receipts on a live shop (the mock): after a sale, Text asks where to send it and sends it, and
 * Print sends the order's own receipt to the device's print dialog.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

test('a cash sale: text the receipt, then print it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Record the print instead of opening the dialog, with what was on the paper at that moment.
  await page.addInitScript(() => {
    (window as unknown as { printed: string[] }).printed = [];
    window.print = () => (window as unknown as { printed: string[] }).printed.push(document.getElementById('c-print-root')?.innerText ?? '');
  });
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/new?preview=1&live=1&as=jen');
  await settle(page);

  for (const d of '50') await page.getByRole('button', { name: d, exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await page.getByRole('button', { name: /^Cash/ }).first().click();
  // Checkout asks for a tip on the customer's side first.
  await page.getByRole('button', { name: 'No tip' }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await page.getByRole('button', { name: 'Exact' }).click();
  await page.getByRole('button', { name: /Take \$50\.00 cash/ }).click();
  await expect(page.getByText('Paid in cash')).toBeVisible();

  // Text: asks where, sends, and says where it went.
  await page.getByRole('radio', { name: 'Text' }).click();
  const send = page.getByRole('dialog').filter({ hasText: /Text|number/i }).first();
  await expect(send).toBeVisible();
  await send.getByRole('textbox').fill('(909) 555-0177');
  await send.getByRole('button', { name: /^Send/ }).click();
  await expect(send).toHaveCount(0);
  await expect(page.getByText('To (909) 555-0177')).toBeVisible();

  // Print: the device's printer, and the order's receipt on the paper.
  await page.getByRole('button', { name: /Print receipt/ }).click();
  const print = page.getByRole('dialog', { name: 'Print receipt' });
  await expect(print).toContainText('This tablet’s printer');
  await print.getByRole('button', { name: /^Print 2 copies/ }).click();
  const printed = await page.evaluate(() => (window as unknown as { printed: string[] }).printed);
  expect(printed).toHaveLength(1);
  expect(printed[0]).toContain('Mike’s Tire');
  expect(printed[0]).toContain('$50.00');
  expect(printed[0]).toContain('Cash');
  expect(printed[0]!.match(/Thank you/g)).toHaveLength(2);
  expect(errors).toEqual([]);
});
