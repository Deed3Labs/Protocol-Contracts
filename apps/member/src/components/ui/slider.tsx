import { cn } from '@/lib/utils';

interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  className?: string;
}

/**
 * Dual-thumb range slider (no Radix dep) — two overlaid native range inputs with
 * pointer-events isolated to the thumbs (see `.dual-range` in index.css). A filled
 * bar marks the selected span.
 */
export function RangeSlider({ min, max, step = 1, value, onChange, className }: RangeSliderProps) {
  const [lo, hi] = value;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div className={cn('relative h-5 w-full', className)}>
      <div className="pointer-events-none absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-secondary" />
      <div
        className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={lo}
        onChange={(e) => onChange([Math.min(Number(e.target.value), hi - step), hi])}
        className="dual-range absolute left-0 top-0 h-5 w-full"
        aria-label="Minimum amount"
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={hi}
        onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo + step)])}
        className="dual-range absolute left-0 top-0 h-5 w-full"
        aria-label="Maximum amount"
      />
    </div>
  );
}
