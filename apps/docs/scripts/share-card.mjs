// Renders the docs site's share card — the image link previews show — to public/share-card.png.
// It is the useclear.org card (clearpath-website app/_og/card.tsx) with "Docs" as its kicker: same
// paper, ink, mark, faces and footer. Run it by hand when the card changes; the PNG is committed,
// so builds never need a browser.
//
//   node apps/docs/scripts/share-card.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'share-card.png');
const PAPER = '#DFE3DE';
const INK = '#16211D';
const INK_50 = '#6E7672';
const HEADLINE = 'How the co-op works, how to use it, and how it is built.';

// The solid mark, geometry as in useclear.org's card. Never redrawn or altered.
const MARK = `<svg width="34" height="34" viewBox="-164 -164 328 328" aria-hidden="true">
  <path d="M 148.28 -64 A 161.5 161.5 0 1 0 148.28 64 L 74.22 64 A 98 98 0 1 1 74.22 -64 Z" fill="${INK}" stroke="${INK}" stroke-width="4"/>
  <path d="M 0 -8 H 114 V 8 H 0 Z" fill="${INK}"/>
  <circle cx="0" cy="0" r="34" fill="${INK}"/>
  <circle cx="131.5" cy="0" r="25.25" fill="none" stroke="${INK}" stroke-width="15.5"/>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=IBM+Plex+Mono:wght@400&display=block">
<style>
  html,body{margin:0}
  .card{box-sizing:border-box;width:1200px;height:630px;padding:72px;background:${PAPER};color:${INK};display:flex;flex-direction:column;justify-content:space-between}
  .top{display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:14px}
  .word{font:800 30px 'Bricolage Grotesque';letter-spacing:-0.035em}
  .kicker,.foot{font:400 21px 'IBM Plex Mono';color:${INK_50}}
  .kicker{letter-spacing:0.1em;text-transform:uppercase}
  .head{font:800 92px/1.02 'Bricolage Grotesque';letter-spacing:-0.04em;max-width:1000px}
  .foot{border-top:1px solid ${INK_50};padding-top:20px}
</style></head><body>
<div class="card">
  <div class="top"><div class="brand">${MARK}<div class="word">Clear</div></div><div class="kicker">Docs</div></div>
  <div class="head">${HEADLINE}</div>
  <div class="foot">A member-owned cooperative · Inland Empire, California</div>
</div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const ok = await page.evaluate(() => document.fonts.check("800 92px 'Bricolage Grotesque'") && document.fonts.check("400 21px 'IBM Plex Mono'"));
if (!ok) throw new Error('The card faces did not load; not writing a card in fallback fonts.');
await page.locator('.card').screenshot({ path: OUT });
await browser.close();
console.log('wrote', OUT);
