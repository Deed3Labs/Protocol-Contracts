import ax from '../styles/pages/ax.css?raw';
import bx from '../styles/pages/bx.css?raw';
import cx from '../styles/pages/cx.css?raw';
import fm from '../styles/pages/fm.css?raw';
import g from '../styles/pages/g.css?raw';
import m from '../styles/pages/m.css?raw';
import n from '../styles/pages/n.css?raw';
import sx from '../styles/pages/sx.css?raw';
import vx from '../styles/pages/vx.css?raw';
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
