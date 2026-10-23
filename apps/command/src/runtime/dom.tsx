import { cloneElement, Fragment, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

/*
 * The bridge between the prototype's way of drawing and React's.
 *
 * The prototype draws by assigning HTML strings to a few containers (`#main`, `#modalRoot`, …) and
 * reacts to clicks with listeners on `document`. The sections here keep that shape: their markup is
 * JSX, generated from the prototype's templates so the DOM stays the same, and each container gets
 * its own React root. `html(el, node)` is the prototype's `el.innerHTML = …`, rendered
 * synchronously so the code after it can query and focus what was just drawn.
 *
 * Only containers React doesn't render children into get a root: the static ones in index.html,
 * the empty `#railNav`, `#main` and `#tabs` that App renders once, and the empty slots some
 * sections leave for themselves (a modal's title and body, the board's side panel).
 */

const roots = new WeakMap<Element, Root>();
const filled = new WeakSet<Element>();

export function html(el: Element | null, node: ReactNode): void {
  if (!el) return;
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  const r = root;
  if (node == null || node === '' || node === false) filled.delete(el);
  else filled.add(el);
  // A new key each time, so every draw builds fresh DOM as innerHTML did: entry animations replay,
  // inputs start from what the markup says, and nothing the prototype's code changed by hand
  // (a class, a label) survives into the next draw.
  const n = (draws.get(el) ?? 0) + 1;
  draws.set(el, n);
  flushSync(() => r.render(node === '' || node === false ? null : <Fragment key={n}>{node}</Fragment>));
}
const draws = new WeakMap<Element, number>();

/** The prototype's `el.innerHTML` read as a truthy check: is anything drawn there? */
export function hasHtml(el: Element | null): boolean {
  return !!el && filled.has(el);
}

const NAMES: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  maxlength: 'maxLength',
  inputmode: 'inputMode',
  autocomplete: 'autoComplete',
  readonly: 'readOnly',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
};
const BOOL = new Set(['hidden', 'disabled', 'checked', 'selected', 'readonly', 'required', 'multiple', 'autofocus', 'open']);

/** Attributes the prototype wrote into a tag as a string (`${on ? 'aria-current="page"' : ''}`), as props. */
export function attrs(s: string | false | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!s) return out;
  const re = /([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const raw = m[1];
    const lower = raw.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4];
    const name = lower.startsWith('data-') || lower.startsWith('aria-') ? raw : NAMES[lower] ?? (raw.includes('-') ? camel(raw) : raw);
    if (lower === 'style') out.style = css(value ?? '');
    // a starting state, as in HTML, not a value React holds the field to
    else if (lower === 'checked') out.defaultChecked = true;
    else if (value === undefined) out[name] = BOOL.has(lower) ? true : '';
    else out[name] = value;
  }
  return out;
}

/** An inline `style="a:b;c:d"` string as a React style object. Custom properties keep their names. */
export function css(s: string | false | null | undefined): CSSProperties {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const decl of s.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    out[prop.startsWith('--') ? prop : camel(prop.startsWith('-') ? prop.slice(1).replace(/^(webkit|moz|ms)/, (v) => v[0].toUpperCase() + v.slice(1)) : prop)] = value;
  }
  return out as CSSProperties;
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** The prototype's `cellHtml.replace('cell s-5', 'cell s-4 wt')`: the same element with its class changed. */
export function swapClass(el: ReactElement<{ className?: string }>, from: string, to: string): ReactElement {
  return cloneElement(el, { className: (el.props.className ?? '').replace(from, to) });
}
