import type { ReactNode } from 'react';

/**
 * The primitives, transcribed from the design reference's stylesheet.
 *
 * Not approximated — every number here is the reference's own: hairline borders at 0.5px, cards at
 * 10px radius on surface-2, buttons at 8px, rows at 13px with 12px of vertical padding and a rule
 * between but not after, the accent reserved for outlined pills, the primary action in
 * text-primary. Where a value looks arbitrary it is because it was copied rather than chosen.
 */

/**
 * The quiet label above a hero figure — "Today".
 *
 * Not the same as `Cap`, and the difference is easy to miss: this is 11px, sentence case, loosely
 * tracked. A section heading shouts a little; this one is just naming the number under it.
 */
export function Lbl({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mb-[3px] text-[11px] tracking-[0.3px] text-[var(--clear-text-muted)]">
      {children}
    </p>
  );
}

/** Uppercase section label — "WAITING", "TODAY", "NEXT PAYOUT". */
export function Cap({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mb-2 text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
      {children}
    </p>
  );
}

/** The hero figure. 40px, dropping to 32px once the layout is one column. */
export function Big({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 text-[32px] font-medium leading-[1.05] tracking-[-1.2px] @[900px]:text-[40px]">
      {children}
    </p>
  );
}

/**
 * A card.
 *
 * `rows` cards are padded sideways only — the rows bring their own vertical rhythm and their rules
 * need to reach the card's edges minus that padding.
 */
export function Card({
  children,
  rows = false,
  className = '',
}: {
  children: ReactNode;
  rows?: boolean;
  className?: string;
}) {
  return (
    <div
      className={[
        'rounded-[10px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-2)]',
        rows ? 'px-3.5' : 'px-3.5 py-3',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

/** A quieter block for guidance — no border, one step down the surface scale. */
export function Inset({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[10px] bg-[var(--clear-surface-1)] px-4 py-3.5 ${className}`}>
      {children}
    </div>
  );
}

/**
 * A list row: something on the left, a figure or a pill on the right.
 *
 * `meta` is the second line — the time and who raised it, or the amount and how long it has been
 * waiting. It is what makes the list answerable at a glance rather than a column of names.
 */
export function Row({
  title,
  meta,
  right,
}: {
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[var(--clear-border)] py-3 text-[13px] last:border-b-0">
      <div className="min-w-0">
        <div className="truncate">{title}</div>
        {meta && <div className="mt-0.5 text-[11.5px] text-[var(--clear-text-muted)]">{meta}</div>}
      </div>
      {right && <div className="shrink-0 tabular-nums">{right}</div>}
    </div>
  );
}

/**
 * A status pill.
 *
 * `pending` is the only one that draws the eye, because it is the only one anybody at a counter can
 * act on. A writer scanning the list is looking for what is still open.
 */
export function Pill({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'pending' | 'muted' | 'success';
}) {
  const tones = {
    pending:
      'text-[var(--clear-text-accent)] bg-[var(--clear-bg-accent)] border-[var(--clear-border-accent)]',
    success:
      'text-[var(--clear-text-success)] bg-[var(--clear-bg-success)] border-[var(--clear-border)]',
    muted: 'text-[var(--clear-text-muted)] bg-transparent border-[var(--clear-border)]',
  } as const;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border-[0.5px] px-[9px] py-0.5 text-[10.5px] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** The primary action. Near-black, not the accent — the accent is for pills. */
export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-[8px] border-[0.5px] border-[var(--clear-text-primary)] bg-[var(--clear-text-primary)] py-4 text-[16px] text-[var(--clear-surface-2)] disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/** A secondary action: the reference's default button, before `.prim` recolours it. */
export function Button({
  children,
  onClick,
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[8px] border-[0.5px] border-[var(--clear-border-strong)] bg-[var(--clear-surface-2)] px-[15px] py-2 text-[13px] text-[var(--clear-text-primary)] disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/** An accent-flagged aside — guidance that retires itself once the activity replaces it. */
export function Flag({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-r-[8px] border-l-[2.5px] border-[var(--clear-border-accent)] bg-[var(--clear-bg-accent)] px-3.5 py-3 text-[12px] leading-[1.6]">
      {children}
    </div>
  );
}

/**
 * Re-exported so a page reaches for one module of primitives.
 *
 * It lives with RoleChip because that is what it was built for — saying whose action a screen is
 * — and the directory listing's "Credit" tag is the same shape.
 */
export { Chip } from '@/auth/RoleChip';
