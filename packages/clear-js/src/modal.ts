import type { View } from './controller';

/**
 * The overlay: a scrim and Clear's frame. A centred modal from 640px wide, a bottom sheet under it.
 * Square corners; the frame draws its own content. Styled through `element.style` only, so a shop's
 * Content-Security-Policy without 'unsafe-inline' styles doesn't break it.
 */

const PAPER = '#DFE3DE';
const INK = '#16211D';
const SCRIM = 'rgba(22,33,29,.42)';
const WIDE = '(min-width: 640px)';
const FIRST_HEIGHT = 360;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

type Styles = Record<string, string>;
const css = (el: HTMLElement, styles: Styles) => Object.assign(el.style, styles);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, styles: Styles, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  css(node, styles);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const matches = (query: string): boolean => typeof matchMedia === 'function' && matchMedia(query).matches;

export function domView(returnFocus: Element | null): View {
  const html = document.documentElement;
  const body = document.body;
  const reduced = matches('(prefers-reduced-motion: reduce)');
  let height = FIRST_HEIGHT;
  let frame: HTMLIFrameElement | null = null;
  let dismiss = () => {};
  const saved: Array<[HTMLElement, 'overflow' | 'paddingRight', string]> = [];
  const save = (node: HTMLElement, prop: 'overflow' | 'paddingRight', value: string) => {
    saved.push([node, prop, node.style[prop]]);
    node.style[prop] = value;
  };

  const root = el('div', {
    position: 'fixed', inset: '0', zIndex: '2147483647', display: 'flex', justifyContent: 'center', margin: '0', padding: '0',
  }, { 'data-clear-modal': '' });
  const scrim = el('div', { position: 'absolute', inset: '0', background: SCRIM, opacity: '0' });
  const box = el('div', {
    position: 'relative', boxSizing: 'border-box', maxWidth: '100%', background: PAPER, color: INK, borderRadius: '0',
    boxShadow: '0 18px 50px rgba(22,33,29,.18)', overflow: 'hidden', outline: 'none', opacity: '0',
  }, { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pay with Clear', tabindex: '-1' });
  const loading = el('div', {
    position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
    font: '500 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif', color: INK, letterSpacing: '0',
  }, { role: 'status' });
  loading.textContent = 'Loading Pay with Clear…';
  const sentinel = () => {
    const s = el('span', { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', opacity: '0' }, { tabindex: '0' });
    s.addEventListener('focus', focusInside);
    return s;
  };
  const before = sentinel();
  const after = sentinel();
  box.append(before, loading, after);
  root.append(scrim, box);

  function focusInside() {
    (frame && !loading.isConnected ? frame : box).focus({ preventScroll: true });
  }

  function layout() {
    const wide = matches(WIDE);
    const px = Math.min(height, Math.floor(innerHeight * 0.9));
    root.style.alignItems = wide ? 'center' : 'flex-end';
    css(box, wide
      ? { width: 'min(440px, calc(100% - 32px))', height: `${px}px`, paddingBottom: '0' }
      : { width: '100%', height: `calc(${px}px + env(safe-area-inset-bottom, 0px))`, paddingBottom: 'env(safe-area-inset-bottom, 0px)' });
    return wide;
  }

  /** The resting place (in) or the starting place (out) of the box. */
  function place(shown: boolean) {
    const wide = layout();
    scrim.style.opacity = shown ? '1' : '0';
    box.style.opacity = shown || !wide ? '1' : '0';
    box.style.transform = shown || reduced ? 'none' : wide ? 'translateY(8px)' : 'translateY(100%)';
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    }
  };
  const onFocus = (e: FocusEvent) => {
    if (!(e.target instanceof Node) || !root.contains(e.target)) focusInside();
  };

  return {
    show(onDismiss) {
      dismiss = onDismiss;
      const scrollbar = innerWidth - html.clientWidth;
      save(html, 'overflow', 'hidden');
      if (body) {
        save(body, 'overflow', 'hidden');
        if (scrollbar > 0) save(body, 'paddingRight', `${(parseFloat(getComputedStyle(body).paddingRight) || 0) + scrollbar}px`);
      }
      place(false);
      (body ?? html).appendChild(root);
      if (!reduced) {
        void root.offsetWidth; // start the transition from the place above
        scrim.style.transition = 'opacity 160ms ease';
        box.style.transition = `opacity 160ms ease, transform 220ms ${EASE}`;
      }
      place(true);
      scrim.addEventListener('click', () => dismiss());
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('focusin', onFocus, true);
      addEventListener('resize', layout);
      box.focus({ preventScroll: true });
    },

    load(url) {
      frame = el('iframe', {
        display: 'block', width: '100%', height: '100%', border: '0', margin: '0', padding: '0',
        background: 'transparent', colorScheme: 'light', opacity: '0',
      }, { title: 'Pay with Clear', allow: 'payment *; publickey-credentials-get *', src: url });
      box.insertBefore(frame, after);
    },

    frame: () => frame?.contentWindow ?? null,

    ready() {
      loading.remove();
      if (frame) {
        frame.style.opacity = '1';
        frame.focus({ preventScroll: true });
      }
    },

    height(px) {
      height = px;
      layout();
    },

    close() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      removeEventListener('resize', layout);
      for (const [node, prop, value] of saved.reverse()) node.style[prop] = value;
      root.style.pointerEvents = 'none';
      if (reduced) root.remove();
      else {
        place(false);
        setTimeout(() => root.remove(), 220);
      }
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    },
  };
}
