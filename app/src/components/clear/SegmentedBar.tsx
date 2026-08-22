import { cn } from '@/lib/utils';

export interface Segment {
  /** Share of the whole track, 0–1. Zero-width segments are skipped. */
  value: number;
  /** Tailwind background utility, e.g. `bg-tier-savings`. */
  className: string;
  label: string;
}

/**
 * Stacked progress bar — design spec §2: 8px tall, 4px radius.
 *
 * One bar means one thing (spec §3, rule 4): segments are sized from real values
 * against `total`, and whatever is left over stays as empty track. A tier that
 * hasn't been drawn on contributes nothing, so the bar sits empty while cash is
 * being spent and only fills once credit is actually engaged.
 */
export default function SegmentedBar({
  segments,
  total,
  className,
  label,
}: {
  segments: Segment[];
  /** Denominator. A zero or negative total renders an empty track. */
  total: number;
  className?: string;
  label: string;
}) {
  const filled = segments.filter((s) => s.value > 0);
  const pct = (v: number) => (total > 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : 0);
  const used = filled.reduce((sum, s) => sum + s.value, 0);

  return (
    <div
      role="img"
      aria-label={`${label}: ${filled.map((s) => s.label).join(', ') || 'nothing used'}`}
      // Track uses the border color, not `secondary`: the spec's empty-track step is
      // clearly darker than the page, and `secondary` sits only 5 levels off `background`.
      className={cn('flex h-2 overflow-hidden rounded-[4px] bg-border', className)}
    >
      {filled.map((s) => (
        <div key={s.label} className={s.className} style={{ width: `${pct(s.value)}%` }} />
      ))}
      {/* Remainder is left as visible track — never padded out to full width. */}
      <div className="flex-1" style={{ minWidth: used >= total ? 0 : undefined }} />
    </div>
  );
}
