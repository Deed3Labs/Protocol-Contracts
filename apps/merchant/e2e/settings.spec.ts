import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Settings on a live shop (the mock), as the owner: Tax, Tips, Discounts and Closing show the shop's
 * own settings, and a change saves and shows what the server now holds.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page, section: string) {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`/settings/${section}?preview=1&live=1`);
  await settle(page);
}
const amount = async (page: Page, title: string, value: string) => {
  const sheet = page.getByRole('dialog', { name: title });
  await sheet.getByRole('textbox').fill(value);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
};

test('Closing: starting cash and two counts', async ({ page }) => {
  await open(page, 'closing');
  await expect(page.getByText('$150.00')).toBeVisible();
  await page.getByText('Starting cash').click();
  await amount(page, 'Starting cash', '200');
  await expect(page.getByText('$200.00')).toBeVisible();
  const two = page.getByRole('switch', { name: 'Two counts at close' });
  await expect(two).toHaveAttribute('aria-checked', 'true');
  await two.click();
  await expect(two).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Luis M., Mike R.')).toBeVisible();
});

test('Discounts: a limit, and a new code', async ({ page }) => {
  await open(page, 'discounts');
  await expect(page.getByText('FALL10', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Counter Up to/ }).click();
  await amount(page, 'Counter discount limit', '15');
  await expect(page.getByText('Up to 15%')).toBeVisible();

  await page.getByRole('button', { name: 'New code' }).click();
  const sheet = page.getByRole('dialog', { name: 'New discount code' });
  await sheet.getByRole('textbox', { name: 'Code' }).fill('spring20');
  await sheet.getByRole('textbox', { name: 'Percent off' }).fill('20');
  await sheet.getByRole('button', { name: 'Tires' }).click();
  await sheet.getByRole('button', { name: 'Create SPRING20' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('20% off tires')).toBeVisible();
});

test('Tips: percentages, and a preset added', async ({ page }) => {
  await open(page, 'tips');
  await expect(page.getByRole('button', { name: 'Change $5' })).toBeVisible();
  await page.getByRole('button', { name: 'Percentages' }).click();
  await expect(page.getByRole('button', { name: 'Change 18%' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add' }).click();
  await amount(page, 'Add a tip', '22');
  await expect(page.getByRole('button', { name: 'Change 22%' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Split by hours on shift' })).toBeDisabled();
});

test('Tax: the shop’s own address, and prices with tax included', async ({ page }) => {
  await open(page, 'tax');
  await expect(page.getByText('412 Colton Ave, Redlands, CA')).toBeVisible();
  const included = page.getByRole('button', { name: 'Tax included' });
  await included.click();
  await expect(included).toHaveAttribute('aria-pressed', 'true');
});

test('the live panes pass axe', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  for (const section of ['tax', 'tips', 'discounts', 'closing']) {
    await open(page, section);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${section}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  }
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-kyngkai909-Documents-GitHub/64e7b089-8516-4d6b-ae1f-ffe51ad727cc/scratchpad/closing.png' });
  await open(page, 'tips');
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-kyngkai909-Documents-GitHub/64e7b089-8516-4d6b-ae1f-ffe51ad727cc/scratchpad/tips.png' });
});
