// The page shell from the design (Main.dc.html), as static HTML: rail, page header, body, footer,
// and on small screens the top bar and tab bar. client/docs.js adds the interactive parts.
import { GITHUB, SIGN_IN } from '../nav.mjs';
import { esc } from './markdown.mjs';

export const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,600;12..96,75..100,700;12..96,75..100,800&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600&display=swap';

const svg = (vb, cls, inner, label) => `<svg class="${cls}" viewBox="${vb}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${inner}</svg>`;
export const ICON = {
  search: svg('0 0 18 18', 'cd-ico', '<circle cx="8" cy="8" r="5.5"></circle><path d="M12 12l4.5 4.5"></path>'),
  home: svg('0 0 18 18', 'cd-ico', '<path d="M3 3h5v5H3zM10 3h5v5h-5zM3 10h5v5H3zM10 10h5v5h-5z"></path>'),
  menu: svg('0 0 18 18', 'cd-ico', '<path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13"></path>'),
  lock: svg('0 0 18 18', 'cd-ico', '<rect x="3.5" y="8" width="11" height="7.5"></rect><path d="M6 8V5.5a3 3 0 0 1 6 0V8"></path>'),
  lockLabel: svg('0 0 18 18', 'cd-ico cd-lock', '<rect x="3.5" y="8" width="11" height="7.5"></rect><path d="M6 8V5.5a3 3 0 0 1 6 0V8"></path>', 'Sign-in only'),
  lockSmall: svg('0 0 18 18', 'cd-ico', '<rect x="3.5" y="8" width="11" height="7.5"></rect><path d="M6 8V5.5a3 3 0 0 1 6 0V8"></path>', 'Sign-in only'),
  sun: svg('0 0 18 18', 'cd-ico cd-l-dark', '<circle cx="9" cy="9" r="3.2"></circle><path d="M9 1.8v2M9 14.2v2M1.8 9h2M14.2 9h2M3.9 3.9l1.4 1.4M12.7 12.7l1.4 1.4M3.9 14.1l1.4-1.4M12.7 5.3l1.4-1.4"></path>'),
  moon: svg('0 0 18 18', 'cd-ico cd-l-light', '<path d="M15 10.6A6.3 6.3 0 0 1 7.4 3 6.3 6.3 0 1 0 15 10.6z"></path>'),
  arrow: svg('0 0 16 10', 'cd-arw', '<path d="M0 5h15M10.5.7 15 5l-4.5 4.3"></path>'),
  caret: svg('0 0 10 10', 'cd-car', '<path d="M3 1l4 4-4 4"></path>'),
  prev: svg('0 0 10 10', 'cd-car', '<path d="M7 1L3 5l4 4"></path>'),
  rail: svg('0 0 18 18', 'cd-ico', '<rect x="2.5" y="3.5" width="13" height="11"></rect><path d="M7 3.5v11"></path>'),
  shield: svg('0 0 18 18', 'cd-ico', '<path d="M9 2.5l5.5 2v4.5c0 3.2-2.3 5.5-5.5 6.5-3.2-1-5.5-3.3-5.5-6.5V4.5z"></path>'),
};
export const secIcon = (d) => svg('0 0 18 18', 'cd-ico', `<path d="${d}"></path>`);

const themeLabel = '<span><span class="cd-l-light">Dark mode</span><span class="cd-l-dark">Light mode</span></span>';

// Runs before first paint, inside the element it sets, so the page never flashes the wrong theme or
// rail width. Storage can throw (private windows, blocked site data): the defaults stand.
const THEME_INIT = `<script>(function(e){var t=null;try{t=localStorage.getItem('clear-docs-theme')}catch(x){}if(t!=='dark'&&t!=='light')t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';e.setAttribute('data-theme',t);document.documentElement.setAttribute('data-theme',t)})(document.currentScript.parentNode)</script>`;
const RAIL_INIT = `<script>(function(e){try{if(localStorage.getItem('clear-docs-rail')==='min')e.setAttribute('data-rail','min')}catch(x){}})(document.currentScript.parentNode)</script>`;

const logos = (cls) =>
  `<img class="${cls} cd-l-light" src="/brand/clear-lockup-solid-ink.svg" alt="Clear" width="73" height="21"><img class="${cls} cd-l-dark" src="/brand/clear-lockup-solid-paper.svg" alt="Clear" width="73" height="21">`;
const marks = `<img class="cd-mark cd-l-light" src="/brand/clear-mark-solid-ink.svg" alt="Clear" width="22" height="22"><img class="cd-mark cd-l-dark" src="/brand/clear-mark-solid-paper.svg" alt="Clear" width="22" height="22">`;

/** The rail's section list. site: { nav, entryById }. Pages of the current section are open. */
export function railNav(site, current) {
  const cur = site.entryById.get(current);
  const out = [`<a class="cd-sec" href="/" title="Home" data-on="${current === 'home'}"${current === 'home' ? ' aria-current="page"' : ''}>${ICON.home}<span>Home</span></a>`];
  for (const sec of site.nav) {
    if (sec.locked) {
      out.push(`<div data-sec="${sec.id}"><a class="cd-sec" href="${SIGN_IN}" title="${sec.name}: sign in" data-locked>${secIcon(sec.icon)}<span>${sec.name}</span>${ICON.lockLabel}</a></div>`);
      continue;
    }
    const active = !!cur && cur.sec === sec.id;
    const first = site.firstOf(sec.id);
    const head = active
      ? `<button class="cd-sec" type="button" title="${sec.name}" data-on="true" aria-expanded="true" data-href="${first}">${secIcon(sec.icon)}<span>${sec.name}</span></button>`
      : `<a class="cd-sec" href="${first}" title="${sec.name}" data-on="false" aria-expanded="false">${secIcon(sec.icon)}<span>${sec.name}</span></a>`;
    const groups = sec.groups
      .map(([name, items]) => {
        const holds = items.some((it) => site.idOfItem(it) === current);
        const open = !sec.fold || holds;
        const links = items
          .map((it) => {
            const e = site.entryOfItem(it);
            if (e.kind === 'L') return `<a class="cd-nav" href="${SIGN_IN}" data-locked>${esc(e.navLabel)}${ICON.lockSmall}</a>`;
            const on = e.id === current;
            return `<a class="cd-nav" href="${e.url}" data-on="${on}"${on ? ' aria-current="page"' : ''}>${esc(e.navLabel)}</a>`;
          })
          .join('');
        return `<div><button class="cd-grp" type="button" data-open="${open}" aria-expanded="${open}">${esc(name)}${ICON.caret}</button><div${open ? '' : ' hidden'}>${links}</div></div>`;
      })
      .join('');
    out.push(`<div data-sec="${sec.id}" data-name="${esc(sec.name)}">${head}<div class="cd-pages"${active ? '' : ' hidden'}>${groups}</div></div>`);
  }
  return out.join('');
}

/**
 * A whole page.
 * p: { id, title, description, crumbs: [sec, label] | null, main, toc, wide, edit, prev, next }
 * assets: { css, js, search }
 */
export function renderPage(site, p, assets) {
  const docTitle = p.id === 'home' ? 'Clear docs' : `${p.title} · Clear docs`;
  const pager = (o, dir) => (o ? `<a class="cd-icon-btn" href="${o.url}" aria-label="${dir === 'prev' ? 'Previous' : 'Next'} page: ${esc(o.label)}" rel="${dir}">${dir === 'prev' ? ICON.prev : ICON.caret}</a>` : `<span class="cd-icon-btn" aria-hidden="true" disabled>${dir === 'prev' ? ICON.prev : ICON.caret}</span>`);
  const crumbs = p.crumbs ? `<span>${esc(p.crumbs[0])}</span><i>/</i><b>${esc(p.crumbs[1])}</b>` : `<b>${p.id === 'home' ? 'Home' : esc(p.title)}</b>`;
  const right = p.crumbs
    ? `<div class="cd-ph-r">${p.edit ? `<a class="cd-btn" data-variant="ghost" data-size="s" href="${p.edit}">Edit</a>` : ''}${pager(p.prev, 'prev')}${pager(p.next, 'next')}</div>`
    : '';
  const hasToc = p.toc && p.toc.length > 1 && !p.wide;
  const toc = hasToc
    ? `<aside class="cd-toc" aria-label="On this page"><div class="cd-toc-in"><span class="cd-th">On this page</span><ul>${p.toc.map((h, i) => `<li><a href="#${h.id}" data-on="${i === 0}">${esc(h.label)}</a></li>`).join('')}</ul></div></aside>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)}</title>
<meta name="description" content="${esc(p.description || 'How the co-op works, how to use it, and how it is built.')}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/brand/clear-mark-solid-ink.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${assets.css}">
<script src="${assets.js}" defer></script>
</head>
<body>
<div class="cd" data-theme="light" data-page="${esc(p.id)}" data-search="${assets.search}" data-signin="${SIGN_IN}">
${THEME_INIT}
<a class="cd-skip" href="#main">Skip to content</a>
<header class="cd-mob">
  <a href="/" aria-label="Clear docs home">${logos('')}</a>
  <div class="cd-mob-r"><span class="cd-label">Docs</span><button class="cd-icon-btn cd-mob-t" type="button" data-theme-toggle aria-label="Dark mode">${ICON.sun}${ICON.moon}</button></div>
</header>
<div class="cd-shell" data-rail="full">
${RAIL_INIT}
  <aside class="cd-rail">
    <div class="cd-rail-in">
      <a class="cd-rail-top" href="/" aria-label="Clear docs home">${logos('cd-full')}${marks}<span class="cd-label">Docs</span></a>
      <button class="cd-find" type="button" title="Search docs" aria-label="Search docs" data-search-open>${ICON.search}<span>Search docs</span></button>
      <nav class="cd-rail-nav" aria-label="Docs">${railNav(site, p.id)}</nav>
      <div class="cd-rail-ft">
        <button class="cd-rail-sign cd-theme" type="button" data-theme-toggle aria-label="Dark mode">${themeLabel}${ICON.sun}${ICON.moon}</button>
        <div class="cd-net" title="Base Sepolia, testnet"><i class="cd-dot"></i><span class="cd-label">Base Sepolia · Testnet</span></div>
        <a class="cd-rail-sign" href="${SIGN_IN}" title="Sign in"><span>Sign in</span>${ICON.arrow}</a>
      </div>
    </div>
  </aside>
  <div class="cd-pg">
    <div class="cd-ph" data-home="${p.id === 'home'}">
      <button class="cd-icon-btn cd-rail-tog" type="button" aria-label="Collapse menu" aria-pressed="false" data-rail-toggle>${ICON.rail}</button>
      <div class="cd-crumbs">${crumbs}</div>
      ${right}
    </div>
    <div class="cd-pb" data-wide="${!!p.wide}">
      <main class="cd-art" id="main" tabindex="-1">
${p.main}
      </main>
      ${toc}
    </div>
    <footer class="cd-foot">
      <span>A member-owned cooperative, building in Inland Empire, California.</span>
      <nav aria-label="Footer"><a href="https://useclear.org">useclear.org</a><a href="https://useclear.org/style">Style guide</a><a href="${GITHUB}">GitHub</a></nav>
    </footer>
  </div>
</div>
<nav class="cd-tabbar" aria-label="Main">
  <a href="/" data-on="${p.id === 'home'}">${ICON.home}Home</a>
  <button type="button" data-menu-open>${ICON.menu}Browse</button>
  <button type="button" data-search-open>${ICON.search}Search</button>
  <a href="${SIGN_IN}">${ICON.lock}Sign in</a>
</nav>
</div>
</body>
</html>
`;
}

// ── Page bodies ──

const metaLine = (pg) =>
  `<p class="cd-meta"><span>${pg.mins} min read</span>${pg.date ? `<span>Updated <time datetime="${pg.iso}">${pg.date}</time></span>` : ''}<a href="${pg.source}">View source</a></p>`;

const tocMobile = (toc) =>
  `<details class="cd-toc-m"><summary>On this page</summary><ul>${toc.map((h) => `<li><a href="#${h.id}">${esc(h.label)}</a></li>`).join('')}</ul></details>`;

const decList = (label, rows) =>
  `<section class="cd-decided" aria-label="${label}"><div class="cd-decided-h"><span class="cd-label">${label}</span></div>${rows.map((r) => `<a class="cd-dec" href="${r.url}">${esc(r.title)}<span>${esc(r.note)}</span>${ICON.arrow}</a>`).join('')}</section>`;

export function pageFoot(prev, next) {
  if (!prev && !next) return '';
  const cell = (o, word, cls) => `<a class="cd-pn-c${cls}" href="${o.url}" rel="${word === 'Previous' ? 'prev' : 'next'}"><span class="cd-label">${o.tag}</span><b>${esc(o.label)}</b></a>`;
  return `<div class="cd-pf"><nav class="cd-pn" aria-label="Next and previous">${prev ? cell(prev, 'Previous', '') : ''}${next ? cell(next, 'Next', ' cd-pn-n') : ''}</nav></div>`;
}

/** An article from markdown. pg: rendered page; extra: { chips, back, gov, prev, next } */
export function articleMain(pg, extra) {
  const hasToc = pg.toc.length > 1;
  return [
    `<h1 class="cd-title">${esc(pg.title)}</h1>`,
    pg.lede ? `<p class="cd-lede">${pg.lede}</p>` : '',
    metaLine(pg),
    extra.chips && pg.toc.length ? `<nav class="cd-jump" aria-label="On this page">${pg.toc.map((h) => `<a href="#${h.id}">${esc(h.label)}</a>`).join('')}</nav>` : '',
    hasToc ? tocMobile(pg.toc) : '',
    `<div class="cd-body cd-md">${pg.blocks.map((b) => b.html).join('\n')}</div>`,
    extra.back.length ? decList('Pages that point here', extra.back) : '',
    extra.gov.length ? decList('Who decides this', extra.gov) : '',
    pageFoot(extra.prev, extra.next),
  ].join('\n');
}

export function homeMain(site, doors, changed) {
  const doorHtml = doors
    .map(
      (d) =>
        `<section class="cd-door"><a class="cd-door-h" href="${d.url}"><i>${secIcon(d.icon)}</i><b>${esc(d.name)}</b>${ICON.arrow}</a><p class="cd-door-n">${esc(d.note)}</p><ul class="cd-door-l">${d.links
          .map((l) => `<li><a href="${l.url}">${esc(l.label)}${ICON.arrow}</a></li>`)
          .join('')}</ul></section>`,
    )
    .join('');
  const staff = `<a class="cd-door-staff" href="${SIGN_IN}"><i>${ICON.shield}</i><b>Staff</b><span>Field guides, training and how we work</span><em>Sign in</em>${ICON.arrow}</a>`;
  const changedHtml = changed.length
    ? `<h2 class="cd-two-h" style="margin-top: 40px">Changed lately</h2><div class="cd-two">${changed.map((c) => `<a class="cd-row" href="${c.url}"><span>${esc(c.title)}</span><small>${esc(c.sec)} · <time datetime="${c.iso}">${c.date}</time></small></a>`).join('')}</div>`
    : '';
  return `<div class="cd-home"><h1 class="cd-title">Clear docs</h1><p class="cd-lede">How the co-op works, how to use it, and how it is built.</p><button class="cd-hfind" type="button" data-search-open>${ICON.search}Search the docs</button><div class="cd-doors">${doorHtml}${staff}</div>${changedHtml}</div>`;
}
