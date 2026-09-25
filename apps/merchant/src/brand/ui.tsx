import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ClearMark, IconClose, IconCloseLg, IconDelete } from '@/brand/icons';

/**
 * The reference's parts, as components.
 *
 * Every class here is one from docs/merchant-reference/, prefixed `c-` (see
 * scripts/reference-css.mjs). The markup is transcribed from the reference, so a component should
 * read like the frame it came from; when the two disagree, the reference is right.
 */

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

  useEffect(() => {
    if (inline) return;
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [inline, onClose]);

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
