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
  // An item, opened from its list (the mock's ids are its own). A charge can't be opened here yet:
  // the Clear charges list is read from the API client, which the mock doesn't stand in for.
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
