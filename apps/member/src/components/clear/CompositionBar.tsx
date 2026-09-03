/*
 * One bar, two jobs.
 *
 * On "Spending from" it splits what a member *can* spend; on "On this card" it splits what they
 * *did*. One visual idea reused rather than two invented — the second reads instantly because they
 * learned it on the first.
 *
 * A composition bar earns its place in both cases: it shows what a figure is MADE OF, which is the
 * one thing a bar does better than a number. A single ratio would not qualify and should stay a
 * number.
 */

export interface Segment {
  /** Drives the width. Zero-weight segments are dropped rather than drawn as slivers. */
  value: number;
  color: string;
  label: string;
}

export function CompositionBar({ segments, className }: { segments: Segment[]; className?: string }) {
  const shown = segments.filter((s) => s.value > 0);
  if (shown.length === 0) return null;
  return (
    <div
      className={`flex h-[7px] gap-[1.5px] overflow-hidden rounded ${className ?? ''}`}
      style={{ background: 'var(--surface-0, rgba(0,0,0,.06))' }}
      role="img"
      aria-label={shown.map((s) => s.label).join(', ')}
    >
      {shown.map((segment) => (
        <span key={segment.label} style={{ flex: segment.value, background: segment.color }} />
      ))}
    </div>
  );
}

/**
 * A legend row: dot, what it is, what it is worth.
 *
 * `off` is a hollow dot and the word Off. The tier stays on the list because it is something the
 * member turned off and may want back — not because it is spendable.
 */
export function LegendRow({
  color,
  label,
  value,
  off = false,
}: {
  color: string;
  label: string;
  value: string;
  off?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-[6.5px] text-[12.5px] ${off ? 'text-muted-foreground' : ''}`}>
      <span className="flex min-w-0 items-center gap-2">
        <i
          className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
          style={off ? { boxShadow: 'inset 0 0 0 1.5px currentColor' } : { background: color }}
        />
        {label}
      </span>
      <span className={`whitespace-nowrap ${off ? '' : 'text-foreground-secondary'}`}>{value}</span>
    </div>
  );
}
