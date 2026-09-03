/**
 * Light, Dusk, Dark — reference section 21.
 *
 * A three-way segment rather than a toggle, because a counter under fluorescent light at 8am and
 * the same counter at 8pm are different problems and neither is "off".
 *
 * Stored per device rather than per shift: the tablet sits in one place under one set of lights,
 * and a writer starting a shift should not have to set it again. Which also means it survives an
 * end-of-shift, unlike anything else in this app's local storage.
 */
export type Appearance = 'light' | 'dusk' | 'dark';

const KEY = 'clear.merchant.appearance';

export function readAppearance(): Appearance {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'dusk' || v === 'dark' || v === 'light') return v;
  } catch {
    // Private windows throw rather than returning null.
  }
  return 'light';
}

export function applyAppearance(next: Appearance): void {
  // Light is the absence of an attribute, so the base :root palette is never overridden by a
  // selector that has to win — one less specificity question when a token is added later.
  const root = document.documentElement;
  if (next === 'light') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', next);
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // A tablet that cannot persist still looks right for this session.
  }
}
