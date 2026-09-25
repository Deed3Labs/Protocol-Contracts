import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Shop, Shop hours, Counter and Devices on a live shop (the mock), as the owner: each shows the
 * shop's own record, and a change saves and shows what the server now holds.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page, section: string) {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`/settings/${section}?preview=1&live=1`);
  await settle(page);
}
/** Fill a sheet's fields by label, save, and wait for it to close. */
async function save(page: Page, title: string, fields: Record<string, string>) {
  const sheet = page.getByRole('dialog', { name: title });
  for (const [label, value] of Object.entries(fields)) await sheet.getByRole('textbox', { name: label, exact: true }).fill(value);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
}

test('Shop: the listing and the contact', async ({ page }) => {
  await open(page, 'shop');
  await expect(page.getByText('Tires, brakes and alignment')).toBeVisible();
  await expect(page.getByText('412 Colton Ave, Redlands, CA 92374')).toBeVisible();

  await page.getByText('One line', { exact: true }).click();
  await save(page, 'One line', { 'A line about the shop': 'Tires, brakes, alignment and oil' });
  await expect(page.getByText('Tires, brakes, alignment and oil')).toBeVisible();

  await page.getByText('Email', { exact: true }).click();
  await save(page, 'Email', { Email: '' });
  await expect(page.getByText('hello@mikestire.com')).toHaveCount(0);

  await page.getByText('Address', { exact: true }).click();
  await save(page, 'Address', { Street: '500 Orange St', ZIP: '92373' });
  await expect(page.getByText('500 Orange St, Redlands, CA 92373')).toBeVisible();

  // The name can't be left empty.
  await page.getByText('Name', { exact: true }).click();
  const name = page.getByRole('dialog', { name: 'Name' });
  await name.getByRole('textbox').fill('  ');
  await expect(name.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('Shop hours: a day changed, a date added, saved', async ({ page }) => {
  await open(page, 'shop');
  await expect(page.getByText('2 coming up')).toBeVisible();
  await page.getByRole('button', { name: 'Change hours' }).click();
  await expect(page.locator('[aria-label="Mon opens"]')).toHaveValue('08:00');

  const save = page.getByRole('button', { name: 'Save hours' });
  await expect(save).toBeDisabled();
  await page.getByRole('switch', { name: 'Open on Sun' }).click();
  await page.locator('[aria-label="Sun closes"]').fill('15:00');
  await page.getByRole('button', { name: 'Remove Thanksgiving' }).click();

  await page.getByRole('button', { name: 'Add a date' }).click();
  const sheet = page.getByRole('dialog', { name: 'A date that differs' });
  await sheet.locator('[aria-label="Date"]').fill('2026-12-31');
  await sheet.getByRole('textbox', { name: 'What it is' }).fill('New Year’s Eve');
  await sheet.getByRole('button', { name: 'Open other hours' }).click();
  await sheet.locator('[aria-label="Closes"]').fill('13:00');
  await sheet.getByRole('button', { name: 'Add the date' }).click();
  await expect(page.getByText('Dec 31 · 8:00am – 1:00pm')).toBeVisible();

  await save.click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(save).toBeDisabled();

  // Back on Shop: what the server now holds.
  await page.getByRole('button', { name: 'Shop hours' }).click();
  await expect(page.getByText('2 coming up')).toBeVisible();
  await expect(page.getByText('9:00am – 3:00pm')).toBeVisible();
});

test('Counter: breaks and this tablet’s lock', async ({ page }) => {
  await open(page, 'counter');
  await expect(page.getByText('30 minutes, over 5 hours')).toBeVisible();
  await page.getByText('Break', { exact: true }).click();
  await save(page, 'Breaks', { 'Break, in minutes': '20', 'Due after, in hours': '4' });
  await expect(page.getByText('20 minutes, over 4 hours')).toBeVisible();

  const five = page.getByRole('button', { name: '5 minutes', exact: true });
  await expect(five).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '15 minutes' }).click();
  await expect(page.getByRole('button', { name: '15 minutes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(five).toHaveAttribute('aria-pressed', 'false');
});

test('Devices: this tablet, renamed', async ({ page }) => {
  await open(page, 'devices');
  await expect(page.getByText('Front counter')).toBeVisible();
  await expect(page.getByText('Aug 4, 2026')).toBeVisible();
  await page.getByText('Counter tablet').click();
  await save(page, 'This tablet’s name', { Name: 'Front desk' });
  await expect(page.getByText('Front desk')).toBeVisible();
});

test('the live panes pass axe', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  for (const section of ['shop', 'shop/hours', 'counter', 'devices']) {
    await open(page, section);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${section}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  }
});
