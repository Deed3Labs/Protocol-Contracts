// The static site generator: reads the nav and the markdown, writes dist/.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHIPS, DOOR_LABELS, DOORS, GH_BLOB, GOV_NOTES, NAV, SUGGESTED, WIDE } from '../nav.mjs';
import { lastChanged, niceDate } from './git.mjs';
import { articleMain, homeMain, pageFoot, renderPage } from './layout.mjs';
import { COUNSEL, esc, renderMarkdown } from './markdown.mjs';
import { checkNav, entriesOf, idOf, urlOf } from './site.mjs';
import { contractMap, placements, readDeployments } from './visuals.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO = join(APP, '..', '..');
const WORDS_PER_MINUTE = 220;
const CONTENT_PATHS = ['docs', 'apps/member/public/docs'];

export class NavError extends Error {}

/** Throws a NavError listing every problem if the nav and the published folders disagree. */
export function assertNavComplete(root, nav = NAV, folders) {
  const { missing, unlisted, duplicates } = checkNav(root, nav, folders);
  const lines = [];
  if (missing.length) lines.push(`The nav names files that don't exist:\n  ${missing.join('\n  ')}`);
  if (unlisted.length) lines.push(`Published markdown missing from the nav (apps/docs/src/nav.mjs):\n  ${unlisted.join('\n  ')}`);
  if (duplicates.length) lines.push(`The nav lists a page twice:\n  ${duplicates.join('\n  ')}`);
  if (lines.length) throw new NavError(lines.join('\n'));
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const plainOf = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

/** Insert a visual after a heading, past the paragraphs that open its section. */
function placeAfter(blocks, headingId, html, page) {
  const i = blocks.findIndex((b) => b.id === headingId);
  if (i < 0) throw new Error(`${page}: no heading #${headingId} to place a visual after. Was it renamed?`);
  let j = i + 1;
  while (blocks[j] && blocks[j].k === 'p') j++;
  blocks.splice(j, 0, { k: 'viz', html });
}

export function buildSite({ root = REPO, out = join(APP, 'dist'), log = console.log } = {}) {
  assertNavComplete(root);

  const entries = entriesOf(NAV);
  const byFile = Object.fromEntries(entries.filter((e) => e.file).map((e) => [e.file, e]));
  const dates = lastChanged(root, CONTENT_PATHS);
  const year = new Date().getUTCFullYear();
  const deployments = readDeployments(root);
  const warnings = { anchors: [], unresolved: [] };

  // ── Render every markdown page ──
  const pages = new Map();
  for (const e of entries) {
    e.url = urlOf(e.id);
    if (e.kind !== 'D') continue;
    const r = renderMarkdown(readFileSync(join(root, e.file), 'utf8'), { file: e.file, byFile, root });
    const d = dates.get(e.file);
    const title = r.title || e.label || basename(e.file, '.md');
    pages.set(e.id, {
      ...r,
      id: e.id,
      file: e.file,
      title,
      mins: Math.max(1, Math.round(r.words / WORDS_PER_MINUTE)),
      iso: d ? d.iso : '',
      ts: d ? d.ts : 0,
      date: d ? niceDate(d.iso, year) : '',
      source: GH_BLOB + e.file,
    });
    warnings.unresolved.push(...r.unresolved);
  }
  for (const e of entries) e.navLabel = e.label || (pages.get(e.id) || {}).title || e.id;
  const entryById = new Map(entries.map((e) => [e.id, e]));

  // ── The hand-drawn visuals, placed in the real pages ──
  for (const [id, list] of Object.entries(placements(deployments))) {
    const pg = pages.get(id);
    if (!pg) throw new Error(`Visuals are placed on ${id}, which is not in the nav.`);
    for (const [heading, render] of list) placeAfter(pg.blocks, heading, render(), id);
  }

  // ── Anchors: every #fragment that points at a page here must exist on it ──
  const idsOn = (pg) => new Set(pg.blocks.filter((b) => b.id).map((b) => b.id));
  const mapIds = new Set(['credit-and-money-contracts', 'deed-track-contracts', 'deployed-addresses']);
  for (const pg of pages.values()) {
    for (const { id, anchor } of pg.anchors) {
      const target = id === null ? pg : pages.get(id);
      const have = target ? idsOn(target) : id === 'protocol/contract-map' ? mapIds : null;
      if (have && !have.has(decodeURIComponent(anchor))) warnings.anchors.push(`${pg.file}: #${anchor}${id ? ` on /${id}` : ''}`);
    }
  }

  // ── Who links to the governance pages, and which governance pages each page leans on ──
  const back = {};
  for (const e of entries) {
    const pg = pages.get(e.id);
    if (!pg || e.id.startsWith('protocol/contracts/') || e.sec === 'governance') continue;
    for (const t of pg.links) if (t.startsWith('governance') && t !== e.id) (back[t] = back[t] || []).push(e.id);
  }

  // ── One reading order across the site. Sign-in links are not in it. ──
  const order = [{ id: 'home', label: 'Home', secName: 'Home', url: '/' }];
  for (const e of entries) if (e.kind !== 'L') order.push({ id: e.id, label: e.navLabel, secName: e.secName, url: e.url });
  const neighbours = (id) => {
    const at = order.findIndex((o) => o.id === id);
    const link = (o, word) => o && { url: o.url, label: o.label, tag: o.secName !== order[at].secName && o.id !== 'home' ? `${word} · ${o.secName}` : word };
    return { prev: at > 0 ? link(order[at - 1], 'Previous') : null, next: at >= 0 ? link(order[at + 1], 'Next') : null };
  };

  const firstUrl = {};
  for (const e of entries) if (!(e.sec in firstUrl) && e.kind !== 'L') firstUrl[e.sec] = e.url;
  const site = {
    nav: NAV,
    entryById,
    firstOf: (sec) => firstUrl[sec],
    entryOfItem: (item) => entryById.get(itemId(item)),
    idOfItem: (item) => itemId(item),
  };

  // ── Assets ──
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  const css = ['styles/clear-docs.css', 'styles/site.css'].map((f) => readFileSync(join(APP, 'src', f), 'utf8')).join('\n');
  const js = readFileSync(join(APP, 'src/client/docs.js'), 'utf8');
  const assets = { css: `/assets/docs.${hash(css)}.css`, js: `/assets/docs.${hash(js)}.js` };
  writeFileSync(join(out, assets.css), css);
  writeFileSync(join(out, assets.js), js);
  cpSync(join(APP, 'public'), out, { recursive: true });

  // Search: titles, headings and text of every public page. Built here, fetched on first search.
  const searchDocs = [];
  for (const e of entries) {
    if (e.kind === 'L') continue;
    const pg = pages.get(e.id);
    const title = e.label === 'Introduction' && pg ? pg.title : e.navLabel;
    if (pg) searchDocs.push({ t: title, s: e.secName, u: e.url, h: pg.blocks.filter((b) => b.id).map((b) => [b.id, plainOf(b.html)]), x: pg.text });
  }
  const map = contractMap(deployments, new Set(entries.map((e) => e.id)));
  const mapEntry = entries.find((e) => e.id === 'protocol/contract-map');
  if (mapEntry) searchDocs.push({ t: mapEntry.navLabel, s: mapEntry.secName, u: mapEntry.url, h: [...mapIds].map((id) => [id, id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())]), x: map.text });
  const suggested = SUGGESTED.map((id) => entryById.get(id)).filter(Boolean).map((e) => ({ t: e.navLabel, s: e.secName, u: e.url }));
  const searchJson = JSON.stringify({ docs: searchDocs, suggested });
  assets.search = `/assets/search.${hash(searchJson)}.json`;
  writeFileSync(join(out, assets.search), searchJson);

  const write = (id, html) => {
    if (html.includes(COUNSEL)) throw new Error(`/${id} would publish "${COUNSEL}".`);
    const file = id === 'home' ? join(out, 'index.html') : id === '404' ? join(out, '404.html') : join(out, id, 'index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  };

  // ── Pages ──
  let count = 0;
  for (const e of entries) {
    if (e.kind === 'L') continue;
    const { prev, next } = neighbours(e.id);
    const wide = WIDE.includes(e.id);
    if (e.kind === 'C') {
      const main = [`<h1 class="cd-title">${esc(map.title)}</h1>`, `<p class="cd-lede">${map.lede}</p>`, map.actions, `<div class="cd-body">${map.body}</div>`, pageFoot(prev, next)].join('\n');
      write(e.id, renderPage(site, { id: e.id, title: e.navLabel, description: plainOf(map.lede), crumbs: [e.secName, e.navLabel], main, wide: true, edit: `${GH_BLOB}apps/docs/src/lib/visuals.mjs`, prev, next }, assets));
      count++;
      continue;
    }
    const pg = pages.get(e.id);
    const backRows = (back[e.id] || []).map((id) => ({ url: urlOf(id), title: pages.get(id).title, note: entryById.get(id).secName }));
    const gov = e.sec === 'governance' ? [] : pg.links.filter((t) => t in GOV_NOTES && pages.has(t)).map((t) => ({ url: urlOf(t), title: pages.get(t).title, note: GOV_NOTES[t] }));
    const main = articleMain(pg, { chips: CHIPS.includes(e.id), back: backRows, gov, prev, next });
    const description = clip(plainOf(pg.lede || (pg.blocks.find((b) => b.k === 'p') || { html: '' }).html) || pg.title, 160);
    write(e.id, renderPage(site, { id: e.id, title: pg.title, description, crumbs: [e.secName, e.navLabel], main, toc: pg.toc, wide, edit: pg.source, prev, next }, assets));
    count++;
  }

  // Home: the doors, and what changed lately (generated contract pages left out: they all move at once).
  const doors = DOORS.map(([sec, note, ids]) => {
    const s = NAV.find((n) => n.id === sec);
    return { name: s.name, icon: s.icon, note, url: firstUrl[sec], links: ids.map((id) => ({ url: urlOf(id), label: DOOR_LABELS[id] || entryById.get(id).navLabel })) };
  });
  const changed = entries
    .filter((e) => e.kind === 'D' && pages.get(e.id).iso && e.group !== 'Contracts')
    .sort((a, b) => pages.get(b.id).ts - pages.get(a.id).ts || a.id.localeCompare(b.id))
    .slice(0, 6)
    .map((e) => ({ url: e.url, title: pages.get(e.id).title, sec: e.secName, iso: pages.get(e.id).iso, date: pages.get(e.id).date }));
  write('home', renderPage(site, { id: 'home', title: 'Clear docs', main: homeMain(site, doors, changed), wide: true }, assets));
  count++;

  write('404', renderPage(site, { id: '404', title: 'Not found', main: `<h1 class="cd-title">Not found</h1><p class="cd-lede">There is no page at this address. It may have moved: try <a class="cd-inl" href="/">the docs home</a> or search.</p>`, wide: true }, assets));

  log(`apps/docs: ${count} pages, ${searchDocs.length} in search, ${(searchJson.length / 1024).toFixed(0)} KB index.`);
  if (warnings.anchors.length) log(`Links to a #heading that doesn't exist (${warnings.anchors.length}):\n  ${warnings.anchors.join('\n  ')}`);
  if (warnings.unresolved.length) log(`Links to files that don't exist (${warnings.unresolved.length}):\n  ${warnings.unresolved.join('\n  ')}`);
  return { count, ids: order.map((o) => o.id), warnings, out };
}

function itemId(item) {
  const [p] = item.split('|');
  return p[1] === ':' ? p.slice(2) : idOf(p);
}

/** Every built page file, as site paths: '/', '/governance/structure', … */
export function builtPaths(out) {
  const paths = [];
  const walk = (dir, rel) => {
    for (const f of readdirSync(dir)) {
      const abs = join(dir, f);
      if (statSync(abs).isDirectory()) walk(abs, `${rel}/${f}`);
      else if (f === 'index.html') paths.push(rel || '/');
    }
  };
  if (existsSync(out)) walk(out, '');
  return paths.sort();
}
