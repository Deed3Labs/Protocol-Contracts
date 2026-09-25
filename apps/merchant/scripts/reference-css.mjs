#!/usr/bin/env node
/**
 * Transcribes the reference files' stylesheet into src/styles/reference.css.
 *
 * The ten files in docs/merchant-reference/ each inline the whole stylesheet: the brand library
 * (identical in all ten) plus that page's own rules. This reads all ten and writes one stylesheet
 * the app can use, so the numbers come from the reference rather than from anyone's eye.
 *
 * What it changes, and nothing else:
 * - Every class gets a `c-` prefix. Bare names like `.ring`, `.line` and `.row` collide with
 *   Tailwind utilities, which the pages that have not been converted yet still use.
 * - Rules no reference markup uses are dropped. The library carries the member app's parts too
 *   (card faces, messages, the savings ladder), and the merchant app has none of them.
 * - The page's own chrome is dropped: the document the frames sit on, its notes and headings.
 * - Frames become widths. `.phone X` becomes X below 520px; `.mc-portrait X` (or
 *   `.mc-tablet.mc-portrait X`) becomes X between 520 and 900. The frames themselves (a 340px phone outline, a tablet aspect ratio) go,
 *   because in the app the screen is the frame.
 * - Where two files define the same rule differently, the version most files use wins, and the
 *   others are listed in a comment above it.
 *
 * Decisions that override the reference live in src/styles/app.css, not here, so this file stays
 * a faithful transcription and can be regenerated whenever the reference changes:
 *
 *   node apps/merchant/scripts/reference-css.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const refDir = join(here, '../../../docs/merchant-reference');
const out = join(here, '../src/styles/reference.css');

// Home first: the library is identical everywhere, so this only fixes the order of page rules.
const ORDER = ['home', 'new-charge', 'inventory', 'staff', 'charges', 'settings', 'payouts', 'overview', 'onboarding', 'sign-in'];
const files = readdirSync(refDir)
  .filter((f) => /^clear-merchant-.*\.html$/.test(f))
  .sort((a, b) => ORDER.indexOf(a.slice(15, -5)) - ORDER.indexOf(b.slice(15, -5)));

const PHONE = '@media (max-width:519.98px)';
const PORTRAIT = '@media (min-width:520px) and (max-width:899.98px)';

/** The document the frames sit on. None of it is the app. */
const DOC_ONLY = new Set(['doc', 'note', 'lede', 'row', 'desktop', 'statelab', 'chg', 'tokens', 'tok', 'mc-frames', 'si-levels', 'si-map']);
const DOC_ELEMENTS = /^(h1|h2|h2 \+ \.note|body)$/;

function parse(css) {
  const rules = [];
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (text, media) => {
    let pos = 0;
    for (;;) {
      const open = text.indexOf('{', pos);
      if (open < 0) break;
      const sel = text.slice(pos, open).trim().replace(/\s+/g, ' ');
      let depth = 1;
      let j = open + 1;
      while (depth) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (/^@(media|supports|container)/.test(sel)) walk(body, sel.replace(/\s+/g, ' '));
      else rules.push({ media, sel, body: body.replace(/\s+/g, ' ').trim() });
      pos = j;
    }
  };
  walk(css, '');
  return rules;
}

const classesOf = (part) => [...part.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]);

// Every class the markup actually uses, across all ten files.
// Plus the one class the reference's own script adds (Staff's crew row, when it overflows).
const used = new Set(['over']);
/** Which files' markup use each class. */
const classFiles = new Map();
/**
 * A rule can appear more than once in one file, the second adding to the first. So a selector is
 * compared across files as the whole sequence of its bodies, and each occurrence keeps its own
 * place in the output, which keeps the cascade the reference actually has.
 */
const perFile = new Map(); // media|sel -> Map<file, body[]>
const order = []; // media|sel|n, in first-seen order
const seen = new Set();
for (const f of files) {
  const html = readFileSync(join(refDir, f), 'utf8');
  const style = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  const markup = html.slice(html.indexOf('</style>'));
  const mine = new Set();
  for (const m of markup.matchAll(/class\s*=\s*"([^"]*)"|class\s*=\s*([\w-]+)/g)) {
    for (const c of (m[1] ?? m[2]).split(/\s+/)) if (c) mine.add(c);
  }
  for (const c of mine) {
    used.add(c);
    if (!classFiles.has(c)) classFiles.set(c, new Set());
    classFiles.get(c).add(f.slice(15, -5));
  }
  const counts = new Map();
  for (const r of parse(style)) {
    const key = `${r.media}|${r.sel}`;
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    if (!perFile.has(key)) perFile.set(key, new Map());
    const fm = perFile.get(key);
    if (!fm.has(f)) fm.set(f, []);
    fm.get(f).push(r.body);
    const okey = `${key}|${n}`;
    if (!seen.has(okey)) {
      seen.add(okey);
      order.push({ key, n, media: r.media, sel: r.sel });
    }
  }
}
// The winning sequence of bodies per selector: most files, ties to the later file in ORDER.
const winner = new Map();
for (const [key, fm] of perFile) {
  const groups = new Map();
  for (const [f, bodies] of fm) {
    const sig = JSON.stringify(bodies);
    if (!groups.has(sig)) groups.set(sig, { bodies, files: [] });
    groups.get(sig).files.push(f.slice(15, -5));
  }
  const ranked = [...groups.values()].sort((a, b) => b.files.length - a.files.length);
  winner.set(key, { bodies: ranked[0].bodies, files: ranked[0].files, others: ranked.slice(1) });
}

const prefix = (sel) => sel.replace(/\.([a-zA-Z_][\w-]*)/g, '.c-$1');

/** Where a selector part lands in the app: dropped, or [media, selector]. */
function place(part, media) {
  if (DOC_ELEMENTS.test(part)) return null;
  if (/--doc|data-theme/.test(part)) return null;
  const cls = classesOf(part);
  if (cls.some((c) => DOC_ONLY.has(c))) return null;
  if (cls.some((c) => !used.has(c))) return null;
  if (media.includes('prefers-color-scheme') || media.includes('max-width:900px')) return null;

  // Frames. A frame's own class counts toward specificity in the reference (`.phone .iv-th`
  // beats `.iv-th.lg`), so the frame is replaced by `:root`, which counts the same and always
  // matches: the rule keeps its weight without the frame.
  if (/^\.phone(\.[\w-]+)*$/.test(part)) return null; // the outline itself
  // A phone frame with a modifier: `.phone.ci .ci-th` is the item list on a phone, and keeps its
  // modifier as the ancestor it names. `.phone.fixed` and `.phone.page` are the outline's own
  // layout, which the screen replaces.
  let m = part.match(/^\.phone((?:\.[\w-]+)+)(\s*>?\s*.+)$/);
  if (m) {
    const mods = m[1].split('.').filter((x) => x && x !== 'fixed' && x !== 'page');
    if (!mods.length) return null;
    return [PHONE, `:root .${mods.join('.')}${m[2]}`];
  }
  m = part.match(/^\.phone\s+(.+)$/);
  if (m) return [PHONE, `:root ${m[1]}`];
  if (/^\.mc-tablet\.mc-portrait$/.test(part)) return null;
  m = part.match(/^\.mc-tablet\.mc-portrait\s+(.+)$/);
  if (m) return [PORTRAIT, `:root .mc-tablet ${m[1]}`];
  // Most portrait rules name the frame by its modifier alone: `.mc-portrait .mc-qr`.
  m = part.match(/^\.mc-portrait\s+(.+)$/);
  if (m) return [PORTRAIT, `:root ${m[1]}`];
  return [media, part];
}

const blocks = new Map(); // media -> lines
const add = (media, line) => {
  if (!blocks.has(media)) blocks.set(media, []);
  blocks.get(media).push(line);
};
let dropped = 0;
let drifted = 0;
/**
 * Emit one rule. `pages` scopes it: `forced` always, otherwise only when it could match on a page
 * that does not carry it (see below).
 */
function emit(media, sel, body, pages, forced, note) {
  if (sel.startsWith('@keyframes')) {
    add('', `${sel}{${body}}`);
    return true;
  }
  const byMedia = new Map();
  for (const part of sel.split(/\s*,\s*(?![^()]*\))/)) {
    const p = place(part.trim(), media);
    if (!p) continue;
    if (!byMedia.has(p[0])) byMedia.set(p[0], []);
    // Scoped when the selector could match on a page that does not carry the rule: some other
    // file uses every one of its classes.
    const cls = classesOf(p[1]);
    const leaks =
      forced ||
      (!!pages &&
        cls.length > 0 &&
        files.some((file) => {
          const g = file.slice(15, -5);
          return !pages.includes(g) && cls.every((c) => classFiles.get(c)?.has(g));
        }));
    // `:where()` scopes without adding specificity, so the cascade stays the reference's own: a
    // later rule still beats an earlier one exactly as it does in the file it came from.
    // The page class is on <html>, which is `:root` itself, so a frame rule's `:root` takes it
    // directly.
    const scope = (f) => (p[1].startsWith(':root ') ? `:root:where(.page-${f}) ${p[1].slice(6)}` : `:where(.page-${f}) ${p[1]}`);
    const scoped = pages && leaks ? pages.map(scope) : [p[1]];
    byMedia.get(p[0]).push(...scoped.map(prefix));
  }
  if (!byMedia.size) return false;
  for (const [m, parts] of byMedia) {
    if (note) add(m, note.replace(/\.([a-zA-Z_][\w-]*)/g, '.c-$1'));
    add(m, `${parts.join(',')}{${body}}`);
  }
  return true;
}

/*
 * A page's own rule stays on that page. Inventory sets `.mc-tablet .slab:not(.one)` to equal
 * columns and `.iv-pick-sheet` to 420px for its frames; pooled with every other file they would
 * square up Home's slab and widen New Charge's options sheet. So a rule fewer than half the files
 * carry, and that could match on another page (some file uses all its classes), is scoped under
 * `.c-page-<file>` for each file that has it. The app puts that class on <html> for the page that
 * is open (lib/usePage.ts).
 *
 * Where files draw the same rule differently, the version most files use applies everywhere, and
 * each other version is kept too, scoped to its own files: New Charge's phone buttons sit in a
 * row where most pages stack them, and on New Charge they still do.
 */
for (const { key, n, media, sel } of order) {
  const w = winner.get(key);
  const body = w.bodies[n];
  const note =
    n === 0 && w.others.length
      ? `/* ${w.files.join(', ')}. Differs in ${w.others
          .map((o) => `${o.files.join(', ')}: ${o.bodies.join(' + ')}`)
          .join(' | ')} */`
      : '';
  let any = false;
  const pages = w.files.length < files.length / 2 ? w.files : null;
  if (body !== undefined) {
    any = emit(media, sel, body, pages, false, note);
    if (note) drifted++;
  }
  // Another version is kept for its own pages when it differs, or when the winner was scoped to
  // its pages and so does not reach them: Inventory draws `.iv-th.lg` once and New Charge twice,
  // and Inventory still needs its copy.
  for (const o of w.others) {
    if (o.bodies[n] !== undefined && (o.bodies[n] !== body || pages)) any = emit(media, sel, o.bodies[n], o.files, true, '') || any;
  }
  if (!any) dropped++;
}

// The tablet frame is the screen: a full-height column, not a 1180:820 picture of one.
const lines = [
  '/* Generated by apps/merchant/scripts/reference-css.mjs from docs/merchant-reference/. Do not edit;',
  '   overrides and decisions go in app.css. */',
  ...(blocks.get('') ?? []),
];
for (const [m, ls] of blocks) {
  if (m === '') continue;
  lines.push(`${m}{`, ...ls.map((l) => `  ${l}`), '}');
}
writeFileSync(out, lines.join('\n') + '\n');
console.log(`reference.css: ${lines.length} lines from ${files.length} files; ${dropped} rules dropped, ${drifted} resolved from differing files`);
