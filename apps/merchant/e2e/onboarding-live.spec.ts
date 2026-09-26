import { expect, test, type Page } from '@playwright/test';
import { settle } from './capture';

/**
 * A live signup's Your team and Your terms: people added before the shop exists, and a terms code
 * checked with Clear (the API is stubbed here: GET /api/merchant/terms-code/:code).
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

async function toStep(page: Page, n: number) {
  await page.addInitScript(() => {
    localStorage.setItem('clear.merchant.onboarding', JSON.stringify({ shopName: 'Mike’s Tire', ownerName: 'Mike R.', email: 'mike@mikestire.com', people: '2 to 5' }));
  });
  await page.route('**/api/merchant/terms-code/**', async (route) => {
    const code = decodeURIComponent(route.request().url().split('/').pop() ?? '');
    const body =
      code === 'KAI-1104'
        ? { state: 'ok', code, tier: 'founding', paidNowBps: 125, overTimeBps: 200, placesLeft: 2, places: 5 }
        : code === 'KAI-0932'
          ? { state: 'full', code, tier: 'founding', places: 5 }
          : { state: 'unknown' };
    await route.fulfill({ json: body });
  });
  await page.goto('/onboarding');
  await settle(page);
  const here = page.getByText(`Step ${n} of 7`, { exact: true });
  for (let i = 0; i < 6 && !(await here.isVisible()); i++) await page.getByRole('button', { name: /^(Start|Continue)$/ }).last().click();
  await expect(here).toBeVisible();
}

test('Your team: people added, a manager chosen, one removed', async ({ page }) => {
  await toStep(page, 3);
  const add = page.getByRole('textbox', { name: 'Add someone' });
  await add.fill('Jen R.');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await add.fill('Luis M.');
  await add.press('Enter');
  await add.fill('Sam K.');
  await add.press('Enter');
  const luis = page.locator('.c-ob-person', { hasText: 'Luis M.' });
  await luis.getByRole('button', { name: 'Manager' }).click();
  await expect(luis.getByRole('button', { name: 'Manager' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Remove Sam K.' }).click();
  await expect(page.locator('.c-ob-person', { hasText: 'Sam K.' })).toHaveCount(0);
  await expect(page.locator('.c-ob-person', { hasText: 'Picks a PIN on their first shift' })).toHaveCount(2);
  // Kept with the form, so it goes with the sign-in that makes the shop.
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('clear.merchant.onboarding') ?? '{}').team);
  expect(kept).toEqual([
    { name: 'Jen R.', role: 'counter' },
    { name: 'Luis M.', role: 'manager' },
  ]);
});

test('Your terms: a code checked with Clear, its rates shown; a full one and an unknown one', async ({ page }) => {
  await toStep(page, 4);
  const code = page.getByRole('textbox', { name: 'Code' });
  await code.fill('kai-1104');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Founding partner · 2 of 5 left')).toBeVisible();
  const row = (k: string) => page.locator('.c-ob-tr', { hasText: k });
  await expect(row('Paid now').locator('.c-you')).toHaveText('1.25%');
  await expect(row('Paid over time').locator('.c-you')).toHaveText('2.0%');

  await code.fill('KAI-0932');
  await expect(page.getByText('Founding partner · 2 of 5 left')).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('All 5 founding places are taken')).toBeVisible();
  await expect(row('Paid now').locator('.c-you')).toHaveText('1.5%');

  await code.fill('NOPE');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Not a code we know')).toBeVisible();
});

/** Where payouts go, signed in as the owner (the mock's live shop): Bridge verifies, then Plaid links. */
async function payouts(page: Page, query = '') {
  await page.addInitScript(() => {
    localStorage.setItem('clear.merchant.onboarding', JSON.stringify({ shopName: 'Mike’s Tire', ownerName: 'Mike R.', email: 'mike@mikestire.com', people: '2 to 5' }));
    // Bridge's pages open in a new tab: note where, rather than open one.
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((url: string) => void (window as unknown as { opened: string[] }).opened.push(url)) as typeof window.open;
  });
  await page.goto(`/onboarding?preview=1&live=1&step=6${query}`);
  await settle(page);
  await expect(page.getByText('Step 6 of 7', { exact: true })).toBeVisible();
}
const cell = (page: Page, label: string) => page.locator('.c-ob-cell', { hasText: label });

test('Where payouts go: the owner starts Bridge’s verification, in a new tab, and checks again', async ({ page }) => {
  await payouts(page, '&kyb=new');
  const v = cell(page, 'Business verification');
  await expect(v).toContainText('Not verified');
  await expect(v.getByRole('textbox', { name: 'Legal business name' })).toHaveValue('Mike’s Tire');
  await v.getByRole('textbox', { name: 'Legal business name' }).fill('Mike’s Tire LLC');
  await v.getByRole('textbox', { name: 'Business email' }).fill('accounts@mikestire.com');
  await v.getByRole('button', { name: 'Verify the business' }).click();
  await expect(v).toContainText('Started');
  await expect(v).toContainText('Under accounts@mikestire.com');
  expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toHaveLength(1);
  await expect(v.getByRole('button', { name: 'Check again' })).toBeVisible();
  await expect(cell(page, 'Business bank account')).toContainText('After verification');
});

test('Where payouts go: once verified, the bank is linked with Plaid', async ({ page }) => {
  await payouts(page);
  await expect(cell(page, 'Business verification')).toContainText('Verified');
  const bank = cell(page, 'Business bank account');
  await expect(bank).toContainText('Chase');
  await bank.getByRole('button', { name: 'Add another' }).click();
  await expect(bank).toContainText('First Platypus Bank');
  await expect(bank).toContainText('Linked');
});
