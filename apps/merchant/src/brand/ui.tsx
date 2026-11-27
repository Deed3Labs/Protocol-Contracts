import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ClearMark, IconClose, IconCloseLg, IconDelete } from '@/brand/icons';

/**
 * The reference's parts, as components.
 *
 * Every class here is one from docs/merchant-reference/, prefixed `c-` (see
 * scripts/reference-css.mjs). The markup is transcribed from the reference, so a component should
 * read like the frame it came from; when the two disagree, the reference is right.
 */

/**
 * The keyboard for a control drawn as an element other than a <button> (a row, a leg, a chip):
 * Enter and Space press it, as they do a button, by clicking it, so its onClick is the one path.
 */
export function clickOnKey(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.currentTarget.click();
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** "Jen R." → "JR". Two letters tell four colleagues apart at a glance. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** The wordmark, alone. Sign-in's screens use it without a shop name. */
export function Wordmark({ small }: { small?: boolean }) {
  return (
    <span className={cx('c-lockup', small && 'c-sm')}>
      <ClearMark />
      <span className="c-wm">Clear</span>
    </span>
  );
}

/** "Clear | Mike's Tire": the wordmark, a thin rule, and the shop, trimmed with an ellipsis. */
export function Lockup({ shop, small }: { shop: string; small?: boolean }) {
  return (
    <span className="c-mc-who">
      <Wordmark small={small} />
      {/* No rule before a name the tablet does not know yet. */}
      {shop && <span className="c-mc-for">{shop}</span>}
    </span>
  );
}

// ---- Sheets -----------------------------------------------------------------------------------

export interface SheetProps {
  /** Extra classes on `.sheet`: a width (`c-si-sheet`, `c-mc-hsheet`) or `c-menu`. */
  className?: string;
  /** The title, which the reference draws as `.mtitle` in the head's line. */
  title?: ReactNode;
  /** A head that is not a title: the profile sheet's person and End shift. */
  head?: ReactNode;
  /** Sign-in's sheets draw a larger close than Home's. */
  closeSize?: 'sm' | 'lg';
  onClose?: () => void;
  children?: ReactNode;
  foot?: ReactNode;
  /** Laid out where it is written, for the component gallery. Otherwise it opens over the screen. */
  inline?: boolean;
  label?: string;
}

/**
 * A sheet: the reference's `.sheet > .modal` with its head, body and foot.
 *
 * Opened, it sits on the reference's scrim (`.mc-scrim`), centred at every width. Escape and the
 * scrim close it when it can be closed; focus moves into it and back to where it came from.
 */
export function Sheet({
  className,
  title,
  head,
  closeSize = 'sm',
  onClose,
  children,
  foot,
  inline,
  label,
}: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, read at the moment Escape is pressed. Callers pass a new function on every
  // render; were it a dependency below, each render (a digit typed into a PIN) would pull focus out
  // of the field and back to the sheet, and on a tablet close the keyboard after one digit.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (inline) return;
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [inline]);

  const sheet = (
    <div
      ref={ref}
      className={cx('c-sheet', className)}
      role={inline ? undefined : 'dialog'}
      aria-modal={inline ? undefined : true}
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="c-modal">
        {(title || head) && (
          <div className="c-chead">
            {head ?? (
              <div className="c-line" style={{ alignItems: 'center' }}>
                <span className="c-mtitle">{title}</span>
                {onClose && (
                  <button
                    type="button"
                    className="c-mclose"
                    aria-label="Close"
                    onClick={onClose}
                    style={closeSize === 'lg' ? { display: 'flex', color: 'var(--ink-50)' } : undefined}
                  >
                    {closeSize === 'lg' ? <IconCloseLg /> : <IconClose />}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {children !== undefined && <div className="c-cmain">{children}</div>}
        {foot !== undefined && <div className="c-cfoot">{foot}</div>}
      </div>
    </div>
  );

  if (inline) return sheet;
  return createPortal(
    <div className="c-app c-mc-scrim" onClick={onClose}>
      {sheet}
    </div>,
    document.body,
  );
}

// ---- PINs and codes ---------------------------------------------------------------------------

/** Four dots: filled as digits go in, all red when it was wrong. */
export function PinDots({ filled, bad, length = 4 }: { filled: number; bad?: boolean; length?: number }) {
  return (
    <div className={cx('c-si-dots', bad && 'c-bad')} role="img" aria-label={`${filled} of ${length} digits`}>
      {Array.from({ length }, (_, i) => (
        <i key={i} className={i < filled ? 'c-f' : ''} />
      ))}
    </div>
  );
}

export type KeypadKey = string;

/**
 * The ruled number pad from sign-in: three columns of 56px keys on hairlines.
 *
 * The bottom-left key is the one that changes: "Not me" on a PIN, "Someone else" on the idle
 * lock, blank where there is nothing to back out of.
 */
export function PinKeys({
  onDigit,
  onDelete,
  left,
  onLeft,
  disabled,
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  left?: string;
  onLeft?: () => void;
  disabled?: boolean;
}) {
  const digit = (d: string) => (
    <button key={d} type="button" disabled={disabled} onClick={() => onDigit(d)}>
      {d}
    </button>
  );
  return (
    <div className="c-si-keys">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit)}
      {left ? (
        <button type="button" className="c-t" disabled={disabled} onClick={onLeft}>
          {left}
        </button>
      ) : (
        <button type="button" className="c-blank" aria-hidden="true" tabIndex={-1} />
      )}
      {digit('0')}
      <button type="button" aria-label="Delete" disabled={disabled} onClick={onDelete}>
        <IconDelete />
      </button>
    </div>
  );
}

/**
 * Six boxes split three and three: an enrollment code, or the emailed code. The box being typed
 * into is `c` (current), boxes still to come are `e` (empty).
 */
export function CodeBoxes({
  value,
  bad,
  small,
  length = 6,
}: {
  value: string;
  bad?: boolean;
  small?: boolean;
  length?: number;
}) {
  const half = Math.ceil(length / 2);
  const box = (i: number) => {
    const ch = value[i];
    const current = i === value.length && !bad;
    return (
      <span key={i} className={cx(ch === undefined && 'c-e', current && 'c-c')}>
        {ch ?? ''}
      </span>
    );
  };
  return (
    <div className={cx('c-si-code', bad && 'c-bad', small && 'c-small')} aria-label={`${value.length} of ${length} digits`}>
      {Array.from({ length: half }, (_, i) => box(i))}
      <i />
      {Array.from({ length: length - half }, (_, i) => box(half + i))}
    </div>
  );
}

/**
 * Typing into a PIN or a code with a keyboard as well as the pad: a tablet with a Bluetooth
 * keyboard, or the back-office computer.
 */
export function useDigitKeys(enabled: boolean, onDigit: (d: string) => void, onDelete: () => void) {
  const cb = useRef({ onDigit, onDelete });
  cb.current = { onDigit, onDelete };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(e.key)) cb.current.onDigit(e.key);
      else if (e.key === 'Backspace') cb.current.onDelete();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/**
 * One column or two. Above 900px a slab lays its cells side by side; below, one above the other,
 * which the reference draws as `.slab.one`. A page sets it once for the views inside it.
 */
export const OneColumn = createContext(false);

export function Slab({ children, className }: { children: ReactNode; className?: string }) {
  const one = useContext(OneColumn);
  return <div className={cx('c-slab', one && 'c-one', className)}>{children}</div>;
}

/**
 * A menu that drops from its button: the reference's `.sheet.menu`, anchored under the control
 * that opened it rather than centred on a scrim. Drawn at the top of the page, positioned under
 * its button, so the header it opens from does not restyle it. Closes on a tap outside, Escape,
 * scrolling or resizing.
 */
export function MenuButton({
  button,
  children,
  className,
  width,
  align = 'right',
  defaultOpen = false,
  role = 'menu',
  label,
}: {
  /** A sort is a menu of menuitemradios; a filter mixes options and chips, so it's a dialog. */
  role?: 'menu' | 'dialog';
  label?: string;
  /** Open on first draw: the dev preview shows a menu as the reference draws it. */
  defaultOpen?: boolean;
  button: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  width?: number;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [at, setAt] = useState<{ top: number; left: number; right: number } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setAt({ top: r.bottom + 6, left: r.left, right: window.innerWidth - r.right });
    };
    place();
    const off = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const shut = () => setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
    };
  }, [open]);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      {button(open, () => setOpen((o) => !o))}
      {open &&
        at &&
        createPortal(
          <div className="c-app">
            <div
              ref={menu}
              className={cx('c-sheet c-menu', className)}
              role={role}
              aria-label={label}
              style={{
                position: 'fixed',
                top: at.top,
                ...(align === 'right' ? { right: at.right } : { left: at.left }),
                zIndex: 30,
                width,
                boxShadow: '0 0 0 1px var(--ink-28)',
              }}
            >
              <div className="c-modal">{children(() => setOpen(false))}</div>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
