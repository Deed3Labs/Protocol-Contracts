import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Inventory › Import a spreadsheet on a live shop (the mock), as the owner: a supplier's CSV, its
 * columns matched and one changed, a row that matches Michelin adding to its stock, and a row with
 * no price left out with why.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

const CSV = [
  'Item,Size,Retail,Cost,Qty,Notes',
  'Pirelli Scorpion AS Plus 3,235/65R17,"$176.00",$128.00,8,New line',
  'Michelin Defender2,225/65R17 · all-season,189.00,132.00,6,Restock',
  'Wiper blades,,,4.00,12,No price yet',
].join('\r\n');

async function open(page: Page, as = '') {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`/inventory?preview=1&live=1${as ? `&as=${as}` : ''}`);
  await settle(page);
}

test('a supplier’s spreadsheet: new items, a match adds stock, a row without a price is left out', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Import a spreadsheet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Import a spreadsheet' });
  await expect(sheet.getByRole('button', { name: /Import/ })).toBeDisabled();
  await sheet.locator('input[type=file]').setInputFiles({ name: 'stock-sept.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });

  await expect(sheet).toContainText('stock-sept.csv');
  await expect(sheet).toContainText('3 rows · 6 columns');
  // Guessed: Item → Name, Size → Size or detail, Retail → Price, Cost → You pay, Qty → On the shelf.
  await expect(sheet.getByRole('combobox', { name: 'Item is' })).toHaveValue('name');
  await expect(sheet.getByRole('combobox', { name: 'Retail is' })).toHaveValue('price');
  await expect(sheet.getByRole('combobox', { name: 'Qty is' })).toHaveValue('quantity');
  await expect(sheet.getByRole('combobox', { name: 'Notes is' })).toHaveValue('skip');
  // Changing one: Notes can't be the name while Item is.
  await sheet.getByRole('combobox', { name: 'Notes is' }).selectOption('name');
  await expect(sheet.getByRole('combobox', { name: 'Item is' })).toHaveValue('skip');
  await sheet.getByRole('combobox', { name: 'Item is' }).selectOption('name');
  await expect(sheet.getByRole('combobox', { name: 'Notes is' })).toHaveValue('skip');

  await expect(sheet).toContainText('1 row matches an item you have. Their stock is added to, not replaced.');
  await sheet.getByRole('button', { name: 'Import 3 items' }).click();

  await expect(sheet.getByRole('status')).toContainText('1 new item, and stock added to 1 you had.');
  await expect(sheet).toContainText('Row 3');
  await expect(sheet).toContainText('Wiper blades has no price');
  await sheet.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByText('Pirelli Scorpion AS Plus 3')).toBeVisible();
  // Michelin had 14 on the shelf; the import added 6.
  await expect(page.locator('div, button', { hasText: /^Michelin Defender2/ }).filter({ hasText: '20' }).first()).toBeVisible();
});

test('a counter shift can’t import', async ({ page }) => {
  await open(page, 'jen');
  await expect(page.getByRole('button', { name: 'Import a spreadsheet' })).toHaveCount(0);
});
