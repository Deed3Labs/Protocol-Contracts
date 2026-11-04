// The site's pages and how a link in the docs becomes a site URL. No I/O except where a root is passed.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { GH_BLOB, GH_TREE, PUBLISHED, SIGN_IN } from '../nav.mjs';

/** The site id for a markdown file: its path under docs/ (or pay/ for the Pay with Clear docs), without README or .md. */
export function idOf(file) {
  return file
    .replace(/^docs\//, '')
    .replace(/^apps\/member\/public\/docs\//, 'pay/')
    .replace(/(^|\/)README\.md$/, '')
    .replace(/\.md$/, '');
}

/** The URL path for a site id. */
export const urlOf = (id) => (id === 'home' || id === '' ? '/' : `/${id}`);

/**
 * Every item in the nav, in reading order.
 * kind: 'D' a markdown page, 'C' a hand-drawn page, 'L' a sign-in-only link.
 */
export function entriesOf(nav) {
  const out = [];
  for (const sec of nav) {
    for (const [group, items] of sec.groups) {
      for (const item of items) {
        const [p, label] = item.split('|');
        const kind = p[1] === ':' ? p[0] : 'D';
        const id = kind === 'D' ? idOf(p) : p.slice(2);
        out.push({ id, file: kind === 'D' ? p : null, label: label || null, kind, sec: sec.id, secName: sec.name, group });
      }
    }
  }
  return out;
}

/** Markdown files under the published folders, repo-relative, sorted. */
export function publishedFiles(root, folders = PUBLISHED) {
  const out = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs).sort()) {
      const r = posix.join(rel, f);
      if (statSync(join(root, r)).isDirectory()) walk(r);
      else if (f.endsWith('.md')) out.push(r);
    }
  };
  folders.forEach(walk);
  return out;
}

/**
 * The nav must name files that exist, and every published markdown file must be in the nav.
 * Returns { missing, unlisted, duplicates }; all empty means the nav is complete.
 */
export function checkNav(root, nav, folders = PUBLISHED) {
  const entries = entriesOf(nav);
  const named = entries.filter((e) => e.file).map((e) => e.file);
  const missing = named.filter((f) => !existsSync(join(root, f)));
  const set = new Set(named);
  const unlisted = publishedFiles(root, folders).filter((f) => !set.has(f));
  const seen = new Set();
  const duplicates = entries.map((e) => e.id).filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  return { missing, unlisted, duplicates };
}

/**
 * GitHub's heading slug (github-slugger): lowercase, drop everything but letters, marks, numbers,
 * connector punctuation, spaces and hyphens, then each space becomes a hyphen. Spaces are not
 * collapsed: "A — B" is "a--b", as on GitHub.
 */
export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/** A slugger that numbers repeats as GitHub does: x, x-1, x-2. */
export function slugger() {
  const seen = new Map();
  return (text) => {
    const base = slug(text);
    let id = base;
    while (seen.has(id)) {
      const n = seen.get(base) + 1;
      seen.set(base, n);
      id = `${base}-${n}`;
    }
    seen.set(id, 0);
    return id;
  };
}

/**
 * Resolve a link found in `file` (repo-relative). byFile maps a markdown path to its entry.
 * Returns { href, id?, anchor?, external?, missing? }:
 *   - a page on this site: href '/id#anchor', id set
 *   - a repo file outside the site: the GitHub blob (or tree, for a folder) URL
 *   - a URL: unchanged, external
 * `root` (optional) lets it tell a folder from a file and spot a target that does not exist.
 */
export function resolveLink(href, file, byFile, root) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { href, external: !/^mailto:/i.test(href) };
  const hash = href.indexOf('#');
  const p = hash >= 0 ? href.slice(0, hash) : href;
  const anchor = hash >= 0 ? href.slice(hash + 1) : '';
  if (!p) return { href: `#${anchor}`, anchor, self: true };
  let target = p.startsWith('/') ? p.slice(1) : posix.normalize(posix.join(posix.dirname(file), decodeURI(p)));
  target = target.replace(/\/$/, '');
  const isDir = root ? existsSync(join(root, target)) && statSync(join(root, target)).isDirectory() : p.endsWith('/') || !posix.extname(target);
  const key = isDir ? `${target}/README.md` : target;
  const entry = byFile[key] || byFile[target];
  if (entry) return { href: urlOf(entry.id) + (anchor ? `#${anchor}` : ''), id: entry.id, anchor };
  if (target === 'docs/README.md' || target === 'docs') return { href: '/', id: 'home', anchor };
  const missing = root ? !existsSync(join(root, target)) : false;
  return { href: (isDir ? GH_TREE : GH_BLOB) + target + (anchor ? `#${anchor}` : ''), external: true, missing, target };
}

/** A sign-in-only link always goes to the Command Center sign-in. */
export const lockedHref = () => SIGN_IN;
