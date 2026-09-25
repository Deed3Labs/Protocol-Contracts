#!/usr/bin/env node
/**
 * Draws the app's icons into public/: the SVG, and the PNGs installing needs (Chrome and Android
 * want 192 and 512, a maskable 512 for adaptive icons; iOS takes the 180 apple-touch-icon).
 *
 * The icon is the Clear mark, exactly as the brand draws it (ClearMark in src/brand/icons.tsx),
 * in ink on paper, the lockup's own colours. Square: the platform rounds it. The maskable one
 * keeps the mark inside the middle 80%, the circle Android may crop to.
 *
 * Rasterised with the installed Chrome through Playwright, so nothing new is installed.
 *   node scripts/icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const PAPER = '#DFE3DE';
const INK = '#16211D';
const pub = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public');

/** The mark, centred at 0,0 in its own 336 units (ClearMark, unaltered). */
const MARK = `<g fill="none" stroke="${INK}">
  <path d="M 148.28 -64 A 161.5 161.5 0 1 0 148.28 64 L 74.22 64 A 98 98 0 1 1 74.22 -64 Z" stroke-width="4" fill="${INK}"/>
  <path d="M 0 -8 H 114 V 8 H 0 Z" fill="${INK}" stroke="none"/>
  <circle cx="0" cy="0" r="34" fill="${INK}" stroke="none"/>
  <circle cx="131.5" cy="0" r="25.25" stroke-width="15.5"/>
</g>`;

/** The mark reaches 164.5 units from its centre; `scale` sizes it on a 512 square. */
const icon = (scale, label = true) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${label ? ' role="img" aria-label="Clear for Merchants"' : ''}>
<rect width="512" height="512" fill="${PAPER}"/>
<g transform="translate(256 256) scale(${scale})">${MARK}</g>
</svg>
`;

// Any: the mark at about two thirds of the square. Maskable: inside the 205-unit safe circle.
const ANY = icon(1.05);
const MASKABLE = icon(0.9, false);
fs.writeFileSync(path.join(pub, 'icon.svg'), ANY);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
for (const [name, svg, size] of [
  ['icon-180.png', ANY, 180],
  ['icon-192.png', ANY, 192],
  ['icon-512.png', ANY, 512],
  ['icon-maskable-512.png', MASKABLE, 512],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(pub, name), omitBackground: false });
  console.log('wrote', name);
}
await browser.close();
