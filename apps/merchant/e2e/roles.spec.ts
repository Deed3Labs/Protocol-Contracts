import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * Every screen as counter, manager and owner, UI Phase 7.
 *
 * On the live path (`?preview=1&live=1`): the pages' real code against the mock API, with the
 * preview's session standing in Jen (counter), Luis (manager) or Mike (owner). What each role may
 * do comes from @clear/domain (seesMoney and friends); this checks the screens keep to it:
 *
 * - The money routes (Close the day, Payouts, Staff, Overview) send a counter shift Home.
 * - A counter shift never sees what the shop is paid, owed or charged: no payout, fee, cost or
 *   margin on any screen it can reach.
 * - The nav locks Payouts and Overview for a counter shift, and opens them for the other two.
 * - Settings is You alone for a counter shift and a manager, every section for the owner.
 * - Every screen renders without an uncaught error, and passes axe, as each role.
 */

type Role = 'counter' | 'manager' | 'owner';
const AS: Record<Role, string> = { counter: '&as=jen', manager: '&as=luis', owner: '' };
const NAME: Record<Role, string> = { counter: 'Jen', manager: 'Luis', owner: 'Mike' };
const ROLES: Role[] = ['counter', 'manager', 'owner'];

/** Where a counter shift is sent Home from. */
const MONEY_ROUTES = ['/close', '/payouts', '/staff', '/overview'];
/** What a counter shift may never read. */
const MONEY = /Next payout|You receive|Margin|You pay\b|at cost|Fee ·|Ready to withdraw|Owed to you|Fees this month/;

const SCREENS: { path: string; open?: (p: Page) => Promise<void> }[] = [
  { path: '/' },
  { path: '/new' },
  { path: '/charges' },
  // A charge and an item, opened from their lists (the mock's ids are its own).
  { path: '/charges', open: (p) => p.getByRole('button', { name: /Marcus T\./ }).first().click() },
  { path: '/inventory' },
  { path: '/inventory', open: (p) => p.locator('.c-iv-row').first().click() },
  { path: '/close' },
  { path: '/payouts' },
  { path: '/staff' },
  { path: '/overview' },
  { path: '/settings' },
];

async function visit(page: Page, role: Role, path: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto(`${path}?preview=1&live=1${AS[role]}`);
  await settle(page);
  return errors;
}

test.beforeEach(({}, info) => test.skip(info.project.name === 'portrait', 'landscape and phone cover the two layouts that differ by role'));

for (const role of ROLES) {
  test.describe(role, () => {
    for (const s of SCREENS) {
      const name = `${s.path}${s.open ? ' (opened)' : ''}`;
      test(name, async ({ page }) => {
        const errors = await visit(page, role, s.path);
        if (s.open) {
          await s.open(page);
          await settle(page);
        }
        const url = new URL(page.url());

        if (role === 'counter' && MONEY_ROUTES.includes(s.path)) {
          expect(url.pathname, `${s.path} sends a counter shift Home`).toBe('/');
        } else {
          expect(url.pathname.startsWith(s.path), `${role} stays on ${s.path}`).toBe(true);
        }

        const text = await page.locator('body').innerText();
        if (role === 'counter') expect(text, 'no money on a counter shift').not.toMatch(MONEY);
        // Whoever is on shift is who the header says.
        if (!s.path.startsWith('/new') && !s.open && s.path !== '/close') expect(text).toContain(NAME[role]);

        expect(errors, 'no uncaught errors').toEqual([]);
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
      });
    }

    test('the nav', async ({ page }, info) => {
      await visit(page, role, '/');
      const phone = info.project.name === 'phone';
      for (const label of ['Payouts', 'Overview']) {
        const locked = page.getByRole('button', { name: `${label}, needs the owner` });
        if (role === 'counter') {
          await expect(locked.first()).toBeVisible();
          // Pressing it asks for the owner rather than going there.
          await locked.first().click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await page.keyboard.press('Escape');
        } else {
          await expect(locked).toHaveCount(0);
          await expect(page.getByRole('link', { name: phone ? label : new RegExp(`^${label}$`) }).first()).toBeVisible();
        }
      }
    });

    test('settings', async ({ page }) => {
      await visit(page, role, '/settings');
      const text = await page.locator('body').innerText();
      if (role === 'owner') {
        for (const section of ['Shop', 'Payouts', 'Partnership', 'Security', 'Help']) expect(text).toContain(section);
      } else {
        // A counter shift's rail is You alone, and so is a manager's for now (DECISIONS › Settings).
        expect(text).toMatch(/Your own PIN|Your PIN and this tablet/);
        expect(text).not.toMatch(/Partnership|Where payouts go/);
      }
    });
  });
}

test.describe('a Clear refund, start to finish', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

  test('Jen asks, Luis clears it with his PIN, and the charge reads Refunded', async ({ page }) => {
    const errors = await visit(page, 'counter', '/charges');
    // A counter shift sees today and yesterday: Marcus, confirmed at 11:02am.
    await page.getByRole('button', { name: /Marcus T\./ }).first().click();
    await settle(page);
    // The preview's parameters travel with it, so a reload stays on the mock.
    expect(new URL(page.url()).search).toContain('live=1');
    await expect(page.getByText('Confirmed')).toBeVisible();

    await page.getByRole('button', { name: 'Start a refund', exact: true }).click();
    await page.getByRole('button', { name: /Send to (an owner|a manager)/ }).click();
    // Under the $500 limit, a manager's PIN clears it at the counter.
    // The sheet names who can clear it, from the roster every shift can read.
    await expect(page.getByRole('dialog', { name: 'Waiting on Mike' })).toBeVisible();
    await page.getByRole('textbox', { name: /PIN/ }).pressSequentially('2222');
    await page.getByRole('button', { name: 'Approve refund' }).click();
    await expect(page.getByRole('dialog', { name: 'Refunded' })).toBeVisible();

    // Back to the list inside the app (the mock lives as long as the page does).
    await page.getByRole('dialog', { name: 'Refunded' }).getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/charges\?preview=1&live=1&as=jen$/);
    const row = page.getByRole('button', { name: /Marcus T\./ }).first();
    await expect(row).toContainText('Refunded');
    expect(errors).toEqual([]);
  });
});

test.describe('card and cash sales in Charges', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));
  const walkIn = (page: Page, cents: RegExp) => page.getByRole('button', { name: new RegExp(`Walk-in.*${cents.source}`) }).first();

  test('the owner adjusts the card walk-in’s tip, then voids it with a manager’s PIN', async ({ page }) => {
    const errors = await visit(page, 'owner', '/charges');
    // Card and cash sales are on the list with the Clear charges.
    await expect(walkIn(page, /\$937\.52/)).toContainText('Visa ••4242');
    await expect(page.getByRole('button', { name: /Walk-in.*Cash/ }).first()).toBeVisible();

    await walkIn(page, /\$937\.52/).click();
    await expect(page.getByText('What was sold')).toBeVisible();
    await page.getByRole('button', { name: 'Adjust the tip' }).click();
    const tip = page.getByRole('dialog', { name: 'Adjust the tip' });
    await tip.getByRole('button', { name: '$15.00' }).click();
    await tip.getByRole('button', { name: 'Save the tip' }).click();
    await expect(tip).toHaveCount(0);
    await expect(page.getByText('$942.52').first()).toBeVisible();

    await page.getByRole('button', { name: 'Void', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Void this charge?' });
    for (const d of '1111') await sheet.getByRole('button', { name: d, exact: true }).click();
    await sheet.getByRole('button', { name: /^Void \$/ }).click();
    await expect(sheet.getByRole('alert')).toContainText('manager');
    for (const d of '2222') await sheet.getByRole('button', { name: d, exact: true }).click();
    await sheet.getByRole('button', { name: /^Void \$/ }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: 'Back' }).first().click();
    await expect(walkIn(page, /\$942\.52/)).toContainText('Voided');
    expect(errors).toEqual([]);
  });

  test('after close, Jen refunds one of four tires back into stock; a manager’s PIN approves it', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(REFERENCE_NOW);
    await page.goto('/charges?preview=1&live=1&as=jen&drawer=closed');
    await settle(page);
    await walkIn(page, /\$937\.52/).click();
    await page.getByRole('button', { name: 'Start a refund' }).click();
    const sheet = page.getByRole('dialog', { name: 'Start a refund' });
    // Four tires sold: one comes back.
    for (let i = 0; i < 3; i++) await sheet.getByRole('button', { name: /One fewer of 4 × Michelin/ }).click();
    await expect(sheet).toContainText('of 4 coming back');
    // The valve stems stay sold.
    await sheet.getByRole('checkbox', { name: /Valve stems/ }).click();
    await sheet.getByRole('button', { name: 'Send to a manager' }).click();
    const approve = page.getByRole('dialog', { name: 'A manager approves this refund' });
    for (const d of '2222') await approve.getByRole('button', { name: d, exact: true }).click();
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(approve).toHaveCount(0);
    await expect(page.getByText(/refunded/).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('staff PINs', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

  test('Luis resets Jen’s PIN with his own, and removes Ana; he can’t touch the owner', async ({ page }) => {
    const errors = await visit(page, 'manager', '/staff');
    // The team's rows (people on shift also have a tile in the crew strip).
    const row = (name: RegExp) => page.locator('.c-tm-row').filter({ hasText: name });

    // The owner's sheet has nothing a manager can do.
    await row(/Mike R\./).click();
    await expect(page.getByRole('dialog', { name: 'Mike R.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset their PIN' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await row(/Jen R\./).click();
    await page.getByRole('button', { name: 'Reset their PIN' }).click();
    const sheet = page.getByRole('dialog', { name: 'Reset Jen’s PIN' });
    await expect(sheet).toContainText('Luis M. approves');
    for (const d of '0000') await sheet.getByRole('button', { name: d, exact: true }).click();
    await sheet.getByRole('button', { name: 'Reset PIN' }).click();
    await expect(sheet.getByRole('alert')).toContainText('did not match');
    for (const d of '2222') await sheet.getByRole('button', { name: d, exact: true }).click();
    await sheet.getByRole('button', { name: 'Reset PIN' }).click();
    await expect(sheet).toHaveCount(0);
    // The list reloads with her PIN cleared; the shift she's on carries on.
    await expect(async () => {
      // A sheet opened before the reload keeps the old row, so each try opens it afresh.
      if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
      await row(/Jen R\./).click();
      await expect(page.getByRole('dialog', { name: 'Jen R.' })).toContainText('On first shift', { timeout: 500 });
    }).toPass();
    await page.keyboard.press('Escape');

    await row(/Ana Ruiz/).click();
    await page.getByRole('dialog', { name: 'Ana Ruiz' }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('dialog', { name: 'Remove Ana' }).getByRole('button', { name: 'Remove' }).click();
    await expect(row(/Ana Ruiz/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
