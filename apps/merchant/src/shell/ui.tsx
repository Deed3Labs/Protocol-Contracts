import type { ReactNode } from 'react';

/**
 * The primitives, taken from the design reference rather than invented.
 *
 * Every value here is lifted from the reference's own stylesheet: hairline borders at 0.5px, cards
 * at 10px radius on `surface-2`, rows at 13px with 12px of vertical padding and a rule between but
 * not after, the primary button in near-black rather than the accent, and the accent reserved for
 * outlined pills and links.
 *
 * The lightness is the point and it is mostly the hairlines. A counter screen is read at arm's
 * length all day; at 1px the rules start to feel like a grid the writer has to look past, and the
 * amounts stop being the loudest thing on it.
 */

/** Uppercase section label — "WAITING", "TODAY", "NEXT PAYOUT". */
export function Cap({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mb-2 text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
      {children}
    </p>
  );
}

/** The hero figure. 40px on a tablet, 32px once the layout is one column. */
export function Big({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 text-[32px] font-medium leading-[1.05] tracking-[-1.2px] @[900px]:text-[40px]">
      {children}
    </p>
  );
}

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  /** Rows supply their own vertical padding, so a card of rows is only padded sideways. */
  padded?: boolean;
}) {
  return (
    <div
      className={[
        'rounded-[10px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-2)]',
        padded ? 'px-3.5' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

/** A quieter block for asides and tips — no border, one step down the surface scale. */
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
 * `meta` is the second line — the time, who raised it, how long it has been waiting. It is what
 * makes the list answerable at a glance rather than a column of names.
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
        {meta && (
          <div className="mt-0.5 text-[11.5px] text-[var(--clear-text-muted)]">{meta}</div>
        )}
      </div>
      {right && <div className="shrink-0 tabular-nums">{right}</div>}
    </div>
  );
}

/**
 * A status pill.
 *
 * `pending` is the only one that draws the eye, because it is the only one anybody at a counter
 * can act on. Settled states are muted: a writer scanning the list is looking for what is still
 * open, not admiring what is finished.
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
    muted:
      'text-[var(--clear-text-muted)] bg-transparent border-[var(--clear-border)]',
  } as const;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border-[0.5px] px-2.5 py-0.5 text-[10.5px] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** The primary action. Near-black, not the accent — the accent is for pills and links. */
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
      className={`w-full rounded-[10px] border-[0.5px] border-[var(--clear-text-primary)] bg-[var(--clear-text-primary)] py-4 text-[16px] text-[var(--clear-surface-2)] disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/** A small outlined action sitting at the end of a row — "Add", "Print". */
export function RowButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border-[0.5px] border-[var(--clear-border-strong)] px-3.5 py-1 text-[12px] text-[var(--clear-text-primary)]"
    >
      {children}
    </button>
  );
}
