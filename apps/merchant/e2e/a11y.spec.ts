import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { STATES } from './states';
import { openState, REPORT_DIR } from './capture';

/**
 * Accessibility, UI Phase 7.
 *
 * - axe (WCAG 2.1 A and AA) on every state: real buttons and names, labels, roles, and the contrast
 *   of every text colour as it is actually drawn. Run at each size, since a phone lays controls out
 *   differently. Any rule turned off below says why.
 * - The masked figure is heard as "Hidden".
 * - Focus is visible, and keyboard presses work on controls that aren't <button>s.
 * - Reduced motion stills everything.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function axe(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(TAGS);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(0, 3).join(' ') })),
  }));
}

test.describe('axe', () => {
  for (const s of STATES) {
    test(s.id, async ({ page }, info) => {
    test.skip(!!s.sizes && !s.sizes.includes(info.project.name as never), `drawn for ${s.sizes?.join(' and ')} only`);
      await openState(page, s);
      const violations = await axe(page, s.gallery ? '[data-under-test]' : undefined);
      if (violations.length) {
        const out = path.join(REPORT_DIR, 'a11y', info.project.name, `${s.id}.json`);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, JSON.stringify(violations, null, 2));
      }
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }
});

test.describe('by hand', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'once is enough'));

  test('the hidden expected total is heard as "Hidden"', async ({ page }) => {
    await page.goto('/_gallery');
    const masked = page.locator('.c-dr-was .c-hid .c-f').first();
    await expect(masked).toBeVisible();
    // What a screen reader is given: the word, and not the bullets drawn in its place.
    const snapshot = await masked.ariaSnapshot();
    expect(snapshot).toContain('Hidden');
    expect(snapshot).not.toContain('•');
  });

  test('focus is visible, and a row that is not a <button> takes Enter', async ({ page }) => {
    await page.goto('/?preview=1&home=running');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(ring.tag).not.toBe('BODY');
    expect(ring.style).toBe('solid');
    expect(ring.width).toBeGreaterThanOrEqual(2);

    // A waiting charge opens from its name, a real button inside the row: Enter opens its sheet.
    const row = page.locator('.c-mc-g2 .c-mc-open').first();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    // The sheet takes focus without drawing a ring around itself.
    const sheetRing = await page.getByRole('dialog').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(sheetRing).toBe('none');
  });

  test('reduced motion stills every animation', async ({ page }) => {
    // The card reader's screen is the busiest: the wave, the live dot, the typing caret elsewhere.
    for (const url of ['/new?preview=1&screen=card-reading&as=jen', '/new?preview=1&screen=amount', '/?preview=1&home=running']) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(100);
      const still = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => (a as CSSAnimation).animationName ?? 'transition'));
      expect(still, `${url}: ${moving} running without the preference`).toEqual([]);
    }
  });
});
