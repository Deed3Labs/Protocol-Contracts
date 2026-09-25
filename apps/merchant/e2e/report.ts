import fs from 'node:fs';
import path from 'node:path';
import { STATES } from './states';
import { refKey, REPORT_DIR } from './capture';

/**
 * The side-by-side report: each state's capture beside the reference frame it is drawn from, at
 * that frame's size, with the reason for any difference. Written to e2e/.report/index.html after a
 * run (the config's globalTeardown), from whatever the run captured.
 */
export default function writeReport() {
  if (!fs.existsSync(REPORT_DIR)) return;
  const refs: Record<string, { size: string; w: number; h: number }> = {};
  const refDir = path.join(REPORT_DIR, 'ref');
  if (fs.existsSync(refDir)) for (const f of fs.readdirSync(refDir).filter((f) => f.endsWith('.json'))) Object.assign(refs, JSON.parse(fs.readFileSync(path.join(refDir, f), 'utf8')));
  const has = (p: string) => fs.existsSync(path.join(REPORT_DIR, p));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  let paired = 0;
  let noted = 0;
  const pages = [...new Set(STATES.map((s) => s.page))];
  const body = pages
    .map((pg) => {
      const rows = STATES.filter((s) => s.page === pg)
        .map((s) => {
          const pairs = s.refs.map((r) => {
            const key = refKey(r);
            const meta = refs[key];
            // A detail crop pairs with the size its parent frame was drawn at.
            const size = !meta || meta.size === 'detail' ? (r.at ?? 'landscape') : meta.size;
            paired++;
            if (r.note) noted++;
            return `<div class="pair">
              <figure><figcaption>Reference · ${esc(r.file)} · ${esc(r.h2)} [${r.i}]${meta?.size === 'detail' ? ' · detail' : ''}</figcaption>${has(`ref/${key}.png`) ? `<img loading="lazy" src="ref/${key}.png">` : '<p class="miss">not captured</p>'}</figure>
              <figure><figcaption>App · ${size}</figcaption>${has(`app/${size}/${s.id}.png`) ? `<img loading="lazy" src="app/${size}/${s.id}.png">` : '<p class="miss">not captured</p>'}</figure>
              <p class="note">${r.note ? esc(r.note) : '<span class="miss">No difference noted.</span>'}</p>
            </div>`;
          });
          const sizes = ['landscape', 'portrait', 'phone']
            .filter((z) => has(`app/${z}/${s.id}.png`))
            .map((z) => `<figure><figcaption>${z}</figcaption><img loading="lazy" src="app/${z}/${s.id}.png"></figure>`)
            .join('');
          return `<section id="${s.id}"><h3>${esc(s.id)} <code>${esc(s.url ?? `gallery: ${s.gallery}`)}</code></h3>${pairs.join('')}<details${s.refs.length ? '' : ' open'}><summary>All three sizes</summary><div class="sizes">${sizes}</div></details></section>`;
        })
        .join('');
      return `<h2>${esc(pg)}</h2>${rows}`;
    })
    .join('');

  const html = `<!doctype html><meta charset="utf-8"><title>Merchant visual check</title>
<style>
body{font:14px/1.4 system-ui;margin:24px;background:#fafaf7;color:#111}
h2{margin:40px 0 8px;border-bottom:1px solid #ccc;text-transform:capitalize}
h3{font-size:15px;margin:24px 0 8px}code{font-size:12px;color:#555;margin-left:8px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0 16px}
.pair .note{grid-column:1/-1;margin:0;padding:8px 12px;background:#fff;border-left:3px solid #2b50ff}
figure{margin:0}figcaption{font-size:12px;color:#555;margin-bottom:4px}
img{max-width:100%;border:1px solid #ddd;background:#fff}
.sizes{display:flex;gap:12px;align-items:flex-start}.sizes figure{flex:0 1 auto;max-width:40%}
.miss{color:#a33}
</style>
<h1>Merchant app against the reference</h1>
<p>${STATES.length} states at three sizes; ${paired} reference pairs, ${noted} with a difference explained. Generated ${new Date().toISOString()}.</p>
${body}`;
  fs.writeFileSync(path.join(REPORT_DIR, 'index.html'), html);
}
