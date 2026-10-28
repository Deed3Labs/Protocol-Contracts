import { expect, test } from '@playwright/test';
import { APP, PROTO, REDESIGN } from '../playwright.config';
import { REDESIGNED, ROUTES, SHADOWED, SHADOW_TABS, canonical, open, paneTabs } from './pages';

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
    await open(proto, REDESIGNED.has(route) ? REDESIGN : PROTO, route);
    await open(app, APP, route);
    // the shell is the redesign's; a page is compared with the old reference until it's ported (docs/ui-redesign-plan.md)
    await open(shell, REDESIGN, route === 'contracts' ? 'build' : route);
    // soft, so a shell difference is reported without hiding the page's own check below
    expect.soft(await canonical(app, '#railNav'), 'menu').toBe(await canonical(shell, '#railNav'));
    expect.soft(await canonical(app, '#tabs'), 'phone tabs').toBe(await canonical(shell, '#tabs'));
    await shell.close();
    // Home's timeline labels are sized by measuring text on a canvas; the reference measures before its
    // fonts load and keeps the fallback's widths, the app measures again once they have. Positions still compare.
    if (SHADOWED.has(route)) {
      const ref = await browser.newPage();
      await open(ref, REDESIGN, route);
      expect(await canonical(app, 'shadow:.gw'), route).toBe(await canonical(ref, 'shadow:.gw'));
      const labels = await ref.locator(SHADOW_TABS).allTextContents();
      for (let i = 0; i < labels.length; i++) {
        await ref.locator(SHADOW_TABS).nth(i).click();
        await app.locator(SHADOW_TABS).nth(i).click();
        expect(await canonical(app, 'shadow:.gw'), `${route} · ${labels[i]}`).toBe(await canonical(ref, 'shadow:.gw'));
      }
      await ref.close();
      await proto.close();
      await app.close();
      return;
    }
    const same = (dom: string) => (route === 'home' ? dom.replace(/(class="h-tg-lb[^"]*"[^>]*style="left: [\d.]+px; )width: [\d.]+px;/g, '$1') : dom);
    expect(same(await canonical(app, '#main')), `${route}`).toBe(same(await canonical(proto, '#main')));
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
