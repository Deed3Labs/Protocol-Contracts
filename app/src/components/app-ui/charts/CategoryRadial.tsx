import { useMemo, useState } from 'react';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import type { Category } from '@/components/app-ui/TransactionFilterModal';
import { cn } from '@/lib/utils';

type Range = 'week' | 'month' | 'year';
const RANGES: { value: Range; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];
const WINDOW_DAYS: Record<Range, number> = { week: 7, month: 30, year: 365 };
const SUB: Record<Range, string> = { week: 'this week', month: 'this month', year: 'this year' };

// Per-category slice colors (spending categories are the outflow ones).
const CATEGORY_COLORS: Record<Category, string> = {
  Card: 'rgb(var(--info))',
  Bill: '#8b5cf6',
  Subscription: '#06b6d4',
  Transfer: '#f59e0b',
  Deposit: '#10b981',
  Payroll: '#22c55e',
};

const fmtTotal = (n: number) => (n >= 10000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n).toLocaleString()}`);

// Fixed drawing space — the SVG scales responsively via viewBox, so coordinates never depend on the
// container width and labels can be laid out (and kept in-bounds) deterministically.
const VB_W = 540;
const VB_H = 340;
const CX = 270;
const CY = 168;
const R_OUT = 112;
const R_IN = 74;
const LABEL_TOP = 20;
const LABEL_BOTTOM = 316;
const LABEL_GAP = 24; // min vertical spacing between labels on a side
const COL_R = CX + R_OUT + 22; // right-side label column x
const COL_L = CX - R_OUT - 22; // left-side label column x

const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
};

/** Annular-sector (donut slice) path between two angles (degrees, screen coords). */
function slicePath(rOut: number, rIn: number, startDeg: number, endDeg: number) {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const o0 = polar(rOut, startDeg);
  const o1 = polar(rOut, endDeg);
  const i1 = polar(rIn, endDeg);
  const i0 = polar(rIn, startDeg);
  return `M ${o0.x} ${o0.y} A ${rOut} ${rOut} 0 ${large} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${rIn} ${rIn} 0 ${large} 0 ${i0.x} ${i0.y} Z`;
}

/** Spread labels down a side so they don't overlap, keeping within [top, bottom]. */
function distribute<T extends { yNat: number }>(items: T[], top: number, bottom: number, gap: number): (T & { y: number })[] {
  const sorted = [...items].sort((a, b) => a.yNat - b.yNat) as (T & { y: number })[];
  let cursor = top;
  for (const it of sorted) {
    it.y = Math.max(it.yNat, cursor);
    cursor = it.y + gap;
  }
  // If we ran past the bottom, push the whole stack up, then re-clamp to the top.
  const overflow = cursor - gap - bottom;
  if (overflow > 0) {
    for (const it of sorted) it.y -= overflow;
    let up = top;
    for (const it of sorted) {
      it.y = Math.max(it.y, up);
      up = it.y + gap;
    }
  }
  return sorted;
}

/**
 * Spending-by-category donut from real transaction history (useClearTransactions). Sums outflows by
 * category over the selected window, with the period total in the middle. Labels are laid out with
 * proper leader lines: each is nudged up/down into a side column so they never overlap or clip, and an
 * angled 3-segment line (radial → diagonal → nub) connects each slice to its label. Week/Month/Year
 * switcher in the footer.
 */
export default function CategoryRadial({ className }: { className?: string }) {
  const [range, setRange] = useState<Range>('month');
  const { items, loading } = useClearTransactions();

  const data = useMemo(() => {
    const cutoff = Date.now() - WINDOW_DAYS[range] * 86_400_000;
    const byCat = new Map<Category, number>();
    for (const it of items) {
      if (it.amount < 0 && it.ts > 0 && it.ts >= cutoff) {
        byCat.set(it.category, (byCat.get(it.category) ?? 0) + Math.abs(it.amount));
      }
    }
    return [...byCat.entries()]
      .map(([name, value]) => ({ name, value, fill: CATEGORY_COLORS[name] ?? '#94a3b8' }))
      .sort((a, b) => b.value - a.value);
  }, [items, range]);

  const total = data.reduce((s, d) => s + d.value, 0);
  const isEmpty = data.length === 0 || total <= 0;

  // Build slice geometry + leader-line label layout.
  const { slices, labels } = useMemo(() => {
    if (isEmpty) return { slices: [], labels: [] };
    let acc = -90; // start at top
    const raw = data.map((d) => {
      const frac = d.value / total;
      const start = acc;
      const end = acc + frac * 360;
      const mid = (start + end) / 2;
      acc = end;
      const midRad = (mid * Math.PI) / 180;
      const side: 'left' | 'right' = Math.cos(midRad) >= 0 ? 'right' : 'left';
      return {
        name: d.name,
        fill: d.fill,
        value: d.value,
        pct: Math.round(frac * 100),
        d: slicePath(R_OUT, R_IN, start, Math.max(end, start + 0.5)),
        mid,
        side,
        edge: polar(R_OUT, mid),
        elbow: polar(R_OUT + 12, mid),
        yNat: CY + (R_OUT + 12) * Math.sin(midRad),
      };
    });

    const laid = [
      ...distribute(raw.filter((r) => r.side === 'left'), LABEL_TOP, LABEL_BOTTOM, LABEL_GAP),
      ...distribute(raw.filter((r) => r.side === 'right'), LABEL_TOP, LABEL_BOTTOM, LABEL_GAP),
    ].map((r) => {
      const dir = r.side === 'right' ? 1 : -1;
      const col = r.side === 'right' ? COL_R : COL_L;
      return {
        key: r.name,
        fill: r.fill,
        text: `${r.name} ${r.pct}%`,
        points: `${r.edge.x},${r.edge.y} ${r.elbow.x},${r.elbow.y} ${col},${r.y} ${col + dir * 8},${r.y}`,
        textX: col + dir * 12,
        textY: r.y,
        anchor: (dir > 0 ? 'start' : 'end') as 'start' | 'end',
      };
    });

    return { slices: raw, labels: laid };
  }, [data, total, isEmpty]);

  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
      <h3 className="text-xs font-medium text-muted-foreground">Spending by category</h3>

      <div className="flex flex-1 items-center justify-center">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="mx-auto w-full max-w-[560px]" role="img" aria-label="Spending by category">
          {isEmpty ? (
            <path d={slicePath(R_OUT, R_IN, -90, 269.5)} fill="rgb(var(--muted))" />
          ) : (
            <>
              {slices.map((s) => (
                <path key={s.name} d={s.d} fill={s.fill} stroke="rgb(var(--card))" strokeWidth={2}>
                  <title>{`${s.name}: $${s.value.toLocaleString()}`}</title>
                </path>
              ))}
              {labels.map((l) => (
                <g key={l.key}>
                  <polyline points={l.points} stroke="rgb(var(--border))" strokeWidth={1} fill="none" />
                  <text
                    x={l.textX}
                    y={l.textY}
                    textAnchor={l.anchor}
                    dominantBaseline="central"
                    className="fill-foreground"
                    fontSize={12}
                    fontWeight={500}
                  >
                    {l.text}
                  </text>
                </g>
              ))}
            </>
          )}

          <text x={CX} y={CY} textAnchor="middle">
            <tspan x={CX} y={CY - 8} className="fill-foreground font-display" style={{ fontSize: 30, fontWeight: 600 }}>
              {fmtTotal(isEmpty ? 0 : total)}
            </tspan>
            <tspan x={CX} y={CY + 18} className="fill-muted-foreground" style={{ fontSize: 12 }}>
              {loading && isEmpty ? 'loading…' : `spent ${SUB[range]}`}
            </tspan>
          </text>
        </svg>
      </div>

      {isEmpty && <p className="-mt-1 text-center text-xs text-muted-foreground">No spending {SUB[range]}.</p>}

      {/* range footer */}
      <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRange(r.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              range === r.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
