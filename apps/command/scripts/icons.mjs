// The PWA's icons, drawn from the Clear mark (public/clear-mark-solid-ink.svg) on the paper ground,
// with a headless browser: `node scripts/icons.mjs`. Run again if the mark changes.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const mark = readFileSync(resolve(pub, 'clear-mark-solid-ink.svg'), 'utf8');
const PAPER = '#DFE3DE';
// [file, size, how much of the square the mark fills]: a maskable icon keeps it inside the safe circle
const ICONS = [
  ['icon-192.png', 192, 0.72],
  ['icon-512.png', 512, 0.72],
  ['icon-maskable-512.png', 512, 0.56],
  ['icon-180.png', 180, 0.68],
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
for (const [file, size, fill] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;width:${size}px;height:${size}px;background:${PAPER};display:grid;place-items:center">` +
      `<div style="width:${Math.round(size * fill)}px;height:${Math.round(size * fill)}px">${mark.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"')}</div></body></html>`,
  );
  await page.screenshot({ path: resolve(pub, file), omitBackground: false });
}
await browser.close();
console.log(`drew ${ICONS.map(([f]) => f).join(', ')}`);
