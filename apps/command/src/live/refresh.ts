import { LIVE } from './env';
import { ageOf, refreshSection } from './sections';

/*
 * The page shown keeps up with the API: its section loads again every minute while the tab is in view,
 * when the tab comes back after being away, and when a page last loaded over 30 seconds ago is opened.
 * The page is only drawn again when the answer changed and nobody is in the middle of something (typing,
 * a panel or a dialog open, a press, a recent touch), and it keeps its tab, filters, period and scroll
 * (pageHost's keep).
 */

const EVERY = 60_000;
/** A page this old is loaded again when opened, or when the tab comes back. */
const STALE = 30_000;
/** Nothing is drawn again this soon after a press or a key. */
const QUIET = 8_000;

let draw: () => void = () => undefined;
let route = () => '';
let lastTouch = 0;
let pressed = false;
let busy = false;

/** The element with focus, through the pages' shadow roots. */
function focused(): Element | null {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

/** Whether drawing the page again now would get in someone's way. */
export function inTheMiddle(): boolean {
  if (pressed || Date.now() - lastTouch < QUIET) return true;
  const f = focused();
  if (f && (f.matches('input, textarea, select') || (f as HTMLElement).isContentEditable)) return true;
  // a dialog, Home's panel, or a page's side panel, sheet or drag
  if (document.body.classList.contains('h-pn') || document.querySelector('#modalRoot .modal, [aria-modal="true"]')) return true;
  for (const h of document.querySelectorAll('#main .g-host')) if (h.shadowRoot?.querySelector('.gw.pn, .gw.sh, .gw.kb-drag, [aria-modal="true"]')) return true;
  return !!String(window.getSelection() ?? '');
}

/** Loads the page's section again and draws it if it changed. */
export async function freshen(force = false) {
  const r = route();
  if (busy || !r || document.hidden || (!force && ageOf(r) < STALE)) return;
  busy = true;
  try {
    if ((await refreshSection(r, () => route() === r && !inTheMiddle())) && route() === r) {
      // the shell draws #main afresh, which drops the scroll: put it back once the page is drawn
      const y = window.scrollY;
      draw();
      window.scrollTo({ top: y, behavior: 'instant' });
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' }));
    }
  } catch {
    // the next minute tries again; the page keeps what it has
  } finally {
    busy = false;
  }
}

/** Starts keeping the shown page fresh: `render` draws the shell, `current` is the route shown. */
export function startRefresh(render: () => void, current: () => string) {
  if (!LIVE) return;
  draw = render;
  route = current;
  const touch = () => (lastTouch = Date.now());
  addEventListener('pointerdown', () => ((pressed = true), touch()), true);
  addEventListener('pointerup', () => ((pressed = false), touch()), true);
  addEventListener('pointercancel', () => (pressed = false), true);
  addEventListener('keydown', touch, true);
  setInterval(() => void freshen(true), EVERY);
  document.addEventListener('visibilitychange', () => void freshen());
  addEventListener('focus', () => void freshen());
}
