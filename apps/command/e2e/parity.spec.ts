import { expect, test } from '@playwright/test';
import { APP, PROTO, REDESIGN } from '../playwright.config';
import { ROUTES, canonical, open, paneTabs } from './pages';

/**
 * The app's DOM is the prototype's DOM: every section and every pane tab, compared as canonical
 * markup. Runs once (at the widest size); the layout differences between widths are CSS, which the
 * visual check covers.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== 'wide', 'DOM parity runs at one width'));

for (const route of ROUTES) {
  test(`DOM matches the prototype: ${route}`, async ({ browser }) => {
    const proto = await browser.newPage();
    const app = await browser.newPage();
    const shell = await browser.newPage();
    await open(proto, PROTO, route);
    await open(app, APP, route);
    // the shell is the redesign's; a page is compared with the old reference until it's ported (docs/ui-redesign-plan.md)
    await open(shell, REDESIGN, route === 'contracts' ? 'build' : route);
    // soft, so a shell difference is reported without hiding the page's own check below
    expect.soft(await canonical(app, '#railNav'), 'menu').toBe(await canonical(shell, '#railNav'));
    expect.soft(await canonical(app, '#tabs'), 'phone tabs').toBe(await canonical(shell, '#tabs'));
    await shell.close();
    expect(await canonical(app, '#main'), `${route}`).toBe(await canonical(proto, '#main'));
    const tabs = await paneTabs(proto);
    for (let i = 0; i < tabs.length; i++) {
      await proto.locator('#main .ptabs button').nth(i).click();
      await app.locator('#main .ptabs button').nth(i).click();
      expect(await canonical(app, '#main'), `${route} · ${tabs[i]}`).toBe(await canonical(proto, '#main'));
    }
    await proto.close();
    await app.close();
  });
}
