import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Shifts on a live shop (the mock), at 4:41pm on the reference Tuesday: Jen, Luis and Mike started
 * theirs this morning. A counter shift's time clock and break on Home; the crew, the week, ending
 * someone's shift and setting hours on Staff.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function open(page: Page, path: string, as = '') {
  await page.clock.install({ time: REFERENCE_NOW });
  await page.goto(`${path}?preview=1&live=1${as ? `&as=${as}` : ''}`);
  await settle(page);
}

test('Home: a counter shift’s clock, and a break', async ({ page }) => {
  await open(page, '/', 'jen');
  const cell = page.locator('.c-mc-shiftcell');
  await expect(cell.getByText('On shift')).toBeVisible();
  // 8:04am to 4:41pm, no break: 8h 37m, past the booked 4:00pm end, and a break is due.
  await expect(cell.locator('.c-mc-clock')).toHaveText('8h 37m');
  await expect(cell.getByText('Since 8:04am')).toBeVisible();
  await expect(cell.getByText('Until 4:00pm, break due')).toBeVisible();
  await expect(cell.locator('.c-mc-remain')).toHaveCount(0);

  await cell.getByRole('button', { name: 'Start break' }).click();
  await expect(cell.getByText('On break · 0m')).toBeVisible();
  await expect(cell.getByText('Break from 4:41pm')).toBeVisible();
  // Twelve minutes, with someone at the counter so the tablet's 5-minute lock stays off.
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(4 * 60_000);
    await page.keyboard.press('Shift');
  }
  await cell.getByRole('button', { name: 'End break' }).click();
  await expect(cell.getByText('On shift')).toBeVisible();
  await expect(cell.getByText('Until 4:00pm, 12m break taken')).toBeVisible();
  // Breaks don't count: still 8h 37m worked.
  await expect(cell.locator('.c-mc-clock')).toHaveText('8h 37m');
});

test('Staff: the crew, the week, and ending someone’s shift', async ({ page }) => {
  await open(page, '/staff');
  const crew = page.locator('.c-mc-crewpanel');
  await expect(crew.getByText('3 on shift')).toBeVisible();
  await expect(crew.locator('.c-mc-mate:not(.c-mc-empty)')).toHaveCount(3);
  await expect(page.locator('.c-wk-panel').getByText('Sep 21 – 27')).toBeVisible();

  await crew.locator('.c-mc-mate', { hasText: 'Jen R.' }).click();
  const sheet = page.getByRole('dialog', { name: 'Jen R.' });
  await expect(sheet.getByText('On shift since 8:04am')).toBeVisible();
  await sheet.getByRole('button', { name: 'End Jen’s shift' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(crew.getByText('2 on shift')).toBeVisible();
  await expect(crew.locator('.c-mc-mate', { hasText: 'Jen R.' })).toHaveCount(0);
});

test('Staff: hours, every week and this week only', async ({ page }) => {
  await open(page, '/staff');
  await page.locator('.c-tm-row', { hasText: 'Ana Ruiz' }).click();
  await page.getByRole('dialog', { name: 'Ana Ruiz' }).getByText('Hours', { exact: true }).click();

  // Ana has none yet, so every week starts now.
  let sheet = page.getByRole('dialog', { name: 'Ana’s hours' });
  await expect(sheet.getByText('Starts this week.')).toBeVisible();
  for (const d of ['Mo', 'Tu', 'We']) await sheet.getByRole('button', { name: d, exact: true }).click();
  await sheet.getByLabel('Starts').fill('09:00');
  await sheet.getByLabel('Ends').fill('13:30');
  await expect(sheet.getByText('13.5 hours')).toBeVisible();
  await sheet.getByRole('button', { name: 'Save Ana’s hours' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.c-tm-row', { hasText: 'Ana Ruiz' })).toBeVisible();

  // Jen has usual hours and a different week: the sheet opens on this week.
  await page.locator('.c-tm-row', { hasText: 'Jen R.' }).click();
  await page.getByRole('dialog', { name: 'Jen R.' }).getByText('Hours', { exact: true }).click();
  sheet = page.getByRole('dialog', { name: 'Jen’s hours' });
  await expect(sheet.getByRole('button', { name: 'This week only' })).toHaveClass(/c-on/);
  await expect(sheet.getByText('Their usual hours come back on Monday the 28th.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Every week' }).click();
  await expect(sheet.getByText('Starts next week. This week stays as it is.')).toBeVisible();
});

test('a manager can’t end the owner’s shift', async ({ page }) => {
  await open(page, '/staff', 'luis');
  const crew = page.locator('.c-mc-crewpanel');
  await crew.locator('.c-mc-mate', { hasText: 'Mike R.' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mike R.' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: /End .* shift/ })).toHaveCount(0);
});

test('the live Staff page passes axe', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await open(page, '/staff');
  await page.locator('.c-tm-row', { hasText: 'Jen R.' }).click();
  await page.getByRole('dialog', { name: 'Jen R.' }).getByText('Hours', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Jen’s hours' })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
});
