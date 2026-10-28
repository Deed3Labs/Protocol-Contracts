import ax from '../styles/pages/ax.css?raw';
import bx from '../styles/pages/bx.css?raw';
import cx from '../styles/pages/cx.css?raw';
import fm from '../styles/pages/fm.css?raw';
import g from '../styles/pages/g.css?raw';
import m from '../styles/pages/m.css?raw';
import n from '../styles/pages/n.css?raw';
import sx from '../styles/pages/sx.css?raw';
import vx from '../styles/pages/vx.css?raw';
import { REAL } from '../live/env';
import { dataStamp } from '../live/sections';
import { html } from '../runtime/dom';
import type { ReactNode } from 'react';

/*
 * The redesign's pages (docs/ui-redesign-plan.md): every page but Home draws inside its own open
 * shadow root, as design/command-center-ui does. The root adopts the page's chain of sheets, copied
 * verbatim from the reference's templates (scripts/port/sheets.cjs): Growth's is the base, and each
 * page stacks its own. Theme tokens inherit through the host; nothing else crosses either way, which
 * matters because the page sheets reuse names the app's global CSS has (.cell, .bento, .lbl…).
 *
 * The shell draws the host (pageHostEl) in #main, then the page into it (drawPage). Events from inside
 * reach the document listeners retargeted to the host; startup.tsx's evTarget reads the real target.
 */

const CSS: Record<string, string> = { g, m, fm, n, bx, vx, cx, sx, ax };

/** Each page's chain of sheets, in the order the reference's shadow roots hold them. */
export const CHAIN: Record<string, string[]> = {
  growth: ['g'],
  members: ['g', 'm'],
  field: ['g', 'fm'],
  merchants: ['g', 'fm'],
  money: ['g', 'fm', 'n'],
  build: ['g', 'fm', 'n', 'bx'],
  governance: ['g', 'fm', 'n', 'bx', 'vx'],
  community: ['g', 'fm', 'n', 'bx', 'vx', 'cx'],
  shop: ['g', 'fm', 'n', 'bx', 'vx', 'sx'],
  records: ['g', 'fm', 'n', 'bx', 'vx', 'ax'],
  team: ['g', 'fm', 'n', 'bx', 'vx', 'ax'],
  settings: ['g', 'fm', 'n', 'bx', 'vx', 'ax'],
};

/** One constructed sheet per template, shared by every root that adopts it. */
const sheets = new Map<string, CSSStyleSheet>();
function sheet(id: string): CSSStyleSheet {
  let s = sheets.get(id);
  if (!s) {
    s = new CSSStyleSheet();
    s.replaceSync(CSS[id]);
    sheets.set(id, s);
  }
  return s;
}

/** The page's host, for #main. A key per page, so moving between pages gives each its own root. */
export const pageHostEl = (page: string) => <div key={page} className="g-host" data-page={page} />;

/** The page's shadow root under #main, made the first time with its sheets adopted; null if the host isn't drawn. */
export function pageRoot(page: string): ShadowRoot | null {
  const host = document.querySelector(`#main .g-host[data-page="${page}"]`);
  if (!host) return null;
  if (!host.shadowRoot) {
    const root = host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = (CHAIN[page] ?? ['g']).map(sheet);
    // React draws into an element: this one takes no part in layout, so the sheets see the page as the reference has it
    const mount = document.createElement('div');
    mount.className = 'g-mount';
    mount.style.display = 'contents';
    root.appendChild(mount);
  }
  return host.shadowRoot;
}

/** Draws a page into its shadow root. */
export function drawPage(page: string, node: ReactNode) {
  const root = pageRoot(page);
  if (root) html(root.querySelector('.g-mount'), node);
}

/** The page's own querySelector: inside its shadow root, not the document. */
export const pageQuery = <T extends Element = HTMLElement>(page: string, sel: string): T | null => pageRoot(page)?.querySelector<T>(sel) ?? null;

/* ── Page modules: the redesign's pages that keep their own state ─────────
 * The reference's pages (GROWTH, MEMBERS2, FM2 …) are modules with a persistent shadow host: drawn into
 * a slot the shell leaves in #main, mounted when their route is the one shown, unmounted when not, so a
 * tab or a filter picked there is still picked on the way back. The shell draws the slot (pageSlot) and
 * calls mountPages after every draw. The slot is React's; the host goes inside it, never in its place.
 */

export interface PageMod {
  mount(route: string): void;
  unmount(): void;
  /** Opens a tab (and anything after a comma: a panel, a filter) from a link elsewhere. */
  setTab(route: string, sub: string): void;
  /** The tab shown, kept when the page is built again. */
  tab(): string;
  /** The page's shadow host, taken out when the page is built again. */
  host: HTMLElement;
}
interface Entry {
  routes: string[];
  slot: string;
  make: () => PageMod;
  live: boolean;
  mod?: PageMod;
  stamp?: number;
}
const MODS: Entry[] = [];
/**
 * Registers a page module for its routes, with the id of the slot it mounts into. The module is built the
 * first time it's shown, from the data there is then: live, that's after its section has loaded (the shell
 * shows the loading state until it has), and again whenever a section loads afresh, keeping the tab.
 *
 * `live` says the page draws the API's data (and does its actions) for real. Until it does, the live app
 * and the empty preview keep the page from before the redesign, so dev never shows the reference's
 * figures and loses nothing it could do; the prototype preview always shows the redesign.
 */
export function registerPage(routes: string[], slot: string, make: () => PageMod, { live = false } = {}) {
  MODS.push({ routes, slot, make, live });
}
const entryFor = (route: string) => MODS.find((m) => m.routes.includes(route) && (m.live || !REAL));
/** The route's page module, built (or built again, on newer data) as it's asked for. */
export function pageModFor(route: string): PageMod | undefined {
  const e = entryFor(route);
  if (!e) return undefined;
  const stamp = dataStamp();
  if (!e.mod || e.stamp !== stamp) {
    const old = e.mod;
    e.mod = e.make();
    e.stamp = stamp;
    if (old) {
      old.unmount();
      old.host.remove();
      e.mod.setTab(route, old.tab());
    }
  }
  return e.mod;
}
/** The slot a redesigned page mounts into, for #main; null when the route isn't one. */
export function pageSlot(route: string) {
  const e = entryFor(route);
  return e ? <div key={route} id={e.slot} /> : null;
}
/** After the shell draws: the route's module mounts, every other one lets go. */
export function mountPages(route: string) {
  for (const e of MODS) if (e !== entryFor(route)) e.mod?.unmount();
  pageModFor(route)?.mount(route);
}

/**
 * A page module's persistent shadow host: made once, with the page's sheets adopted and its skeleton (the
 * reference template's markup) drawn in. `W` is the skeleton's wrapper (.gw), as the reference names it.
 */
export function shadowHost(page: string, skeleton: ReactNode) {
  const host = document.createElement('div');
  host.className = 'g-host';
  host.dataset.page = page;
  const R = host.attachShadow({ mode: 'open' });
  R.adoptedStyleSheets = (CHAIN[page] ?? ['g']).map(sheet);
  const mount = document.createElement('div');
  mount.className = 'g-mount';
  mount.style.display = 'contents';
  R.appendChild(mount);
  html(mount, skeleton);
  const W = R.querySelector('.gw') as HTMLElement;
  /** Mounts the host into its slot in #main; false when the slot isn't drawn. */
  const into = (slotId: string) => {
    const slot = document.getElementById(slotId);
    if (!slot) return false;
    if (host.parentElement !== slot) slot.appendChild(host);
    return true;
  };
  return { host, R, W, into, $g: (id: string) => R.getElementById(id) as HTMLElement | null };
}
