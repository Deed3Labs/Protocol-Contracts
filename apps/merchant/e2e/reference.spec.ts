import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { STATES, type File, type Ref } from './states';
import { refKey, REFERENCE_DIR, REPORT_DIR } from './capture';

/**
 * The reference frames the states pair with, drawn at the size they stand for: a landscape tablet
 * at 1180×820, a portrait one at 820×1180, a phone at 390 wide. The reference draws them at 1000,
 * 640 and 340 to fit its page; widening the frame is all that changes. A detail crop (a `snip`)
 * keeps its own size. Written to .report/ref with each frame's size, for e2e/report.ts.
 *
 * Runs once, in the landscape project: the reference is the same file at any viewport.
 */

const byFile = new Map<File, Ref[]>();
for (const s of STATES) for (const r of s.refs) byFile.set(r.file, [...(byFile.get(r.file) ?? []).filter((x) => refKey(x) !== refKey(r)), r]);

const HAS = (c: string) => `contains(concat(' ',normalize-space(@class),' '),' ${c} ')`;

const WIDEN = `
  .mc-tablet:not([data-detail]){max-width:none!important;width:1180px!important}
  .mc-tablet.mc-portrait{width:820px!important}
  .phone:not([data-detail]){width:390px!important;max-width:none!important}
  .phone.page{height:844px!important}
`;

for (const [file, refs] of byFile) {
  test(`reference ${file}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'landscape', 'the reference is captured once');
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(`file://${REFERENCE_DIR}/clear-merchant-${file}.html`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const frameOf = (ref: Ref) =>
      page
        .locator('h2', { hasText: new RegExp(`^${ref.h2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
        .locator(`xpath=following::*[(${HAS('mc-tablet')} or ${HAS('phone')}) and not(ancestor::*[${HAS('mc-tablet')} or ${HAS('phone')}])]`)
        .nth(ref.i);
    // What each frame is, from its classes and the width the reference drew it at: a frame drawn
    // narrower than a tablet is a detail of one (a cell, a row), and keeps its own size.
    const kinds = new Map<string, string>();
    for (const ref of refs) {
      const frame = frameOf(ref);
      const cls = (await frame.getAttribute('class')) ?? '';
      const w = (await frame.boundingBox())!.width;
      const kind = cls.includes('phone') ? (cls.includes('ps-phone') ? 'detail' : 'phone') : cls.includes('mc-portrait') ? 'portrait' : cls.includes('snip') || w < 900 ? 'detail' : 'landscape';
      kinds.set(refKey(ref), kind);
      if (kind === 'detail') await frame.evaluate((e) => e.setAttribute('data-detail', ''));
    }
    await page.addStyleTag({ content: WIDEN });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const index: Record<string, { size: string; w: number; h: number }> = {};
    for (const ref of refs) {
      const frame = frameOf(ref);
      const key = refKey(ref);
      const box = (await frame.boundingBox())!;
      const out = path.join(REPORT_DIR, 'ref', `${key}.png`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await frame.screenshot({ path: out, animations: 'disabled' });
      index[key] = { size: kinds.get(key)!, w: Math.round(box.width), h: Math.round(box.height) };
    }
    fs.writeFileSync(path.join(REPORT_DIR, 'ref', `${file}.json`), JSON.stringify(index, null, 2));
  });
}
