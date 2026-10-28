import type { Page } from '@playwright/test';

/**
 * Every section, and the phone-only pages. Build is `build`, as the redesign knows it (the app also takes `contracts`).
 * Settings is new in the redesign: the old prototype has no such page (its hash lands on Home there).
 */
export const ROUTES = ['home', 'waiting', 'more', 'growth', 'field', 'members', 'merchants', 'shop', 'money', 'build', 'governance', 'records', 'team', 'settings'] as const;

/**
 * Both pages start the same way: the stored theme and menu width set, and map tiles and the CDN map
 * script blocked (both fall back to the drawn map, so nothing depends on the network).
 *
 * The prototype file has no doctype, so opened on its own it renders in quirks mode (tables, for
 * one, stop inheriting line-height). Claude's artifact viewer, where the design was drawn and
 * reviewed, adds one; so does the app. The prototype is served here with it too.
 */
export async function open(page: Page, base: string, route: string, theme: 'light' | 'dark' = 'light') {
  await page.route(/openfreemap|maplibre-gl/, (r) => r.abort());
  await page.route(/clear-command-center\.html/, async (r) => {
    const res = await r.fetch();
    const body = await res.text();
    await r.fulfill({ response: res, body: /^\s*<!doctype/i.test(body) ? body : `<!doctype html>\n${body}` });
  });
  await page.addInitScript((t) => {
    localStorage.setItem('cc-theme', t);
    localStorage.setItem('cc-rail', 'full');
  }, theme);
  await page.goto(`${base}#${route}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  if (route === 'login') await page.locator('#loginRoot .sgn').waitFor();
  else await page.locator('#main > *').first().waitFor();
}

/** Pages ported to the redesign that it draws in light DOM (docs/ui-redesign-plan.md). */
export const REDESIGNED = new Set(['home', 'waiting', 'more']);
/** Ported pages the redesign draws in a shadow root: compared inside it, tab by tab. */
export const SHADOWED = new Set(['growth', 'members', 'money', 'build', 'records', 'team', 'settings']);
/** Whether a page is compared with the redesign rather than the old reference. */
export const ported = (route: string) => REDESIGNED.has(route) || SHADOWED.has(route);

/** A redesigned page's tabs (Overview, Traffic, …), inside its shadow root. */
export const SHADOW_TABS = '.g-host >> .gtabs button:not(.tabr)';

/** The section's pane tabs (Overview, Funnel, …), by label. */
export async function paneTabs(page: Page): Promise<string[]> {
  return page.locator('#main .ptabs button').allTextContents();
}

/**
 * A canonical form of an element's DOM: tags, attributes in order, inline styles as the browser
 * parsed them, and text with whitespace collapsed. React and innerHTML differ in how they split
 * text and spell styles; this form doesn't see those differences, and sees everything else.
 */
export async function canonical(page: Page, selector: string): Promise<string> {
  // some drawing finishes on the next frame (the map lays its labels out then), so let it
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate((sel) => {
    // `shadow:<sel>` reads inside the redesigned page's shadow root (the page host, docs/ui-redesign-plan.md)
    const root = sel.startsWith('shadow:') ? document.querySelector('.g-host')?.shadowRoot?.querySelector(sel.slice(7)) : document.querySelector(sel);
    if (!root) return '(missing)';
    const out: string[] = [];
    const walk = (n: Node, depth: number) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t) out.push(`${'  '.repeat(depth)}"${t}"`);
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as HTMLElement;
      const attrs = [...el.attributes]
        .filter((a) => a.name !== 'style')
        .map((a) => `${a.name}="${a.value}"`)
        .sort();
      // an inline style the browser rejected entirely is no style at all
      const style = el.style.cssText ? `style="${el.style.cssText}"` : '';
      out.push(`${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${[...attrs, style].filter(Boolean).map((a) => ' ' + a).join('')}>`);
      // adjacent text nodes are one piece of text
      let text = '';
      const flush = () => {
        const t = text.replace(/\s+/g, ' ').trim();
        if (t) out.push(`${'  '.repeat(depth + 1)}"${t}"`);
        text = '';
      };
      for (const c of el.childNodes) {
        if (c.nodeType === Node.TEXT_NODE) text += c.textContent;
        else {
          flush();
          walk(c, depth + 1);
        }
      }
      flush();
    };
    walk(root, 0);
    return out.join('\n');
  }, selector);
}
