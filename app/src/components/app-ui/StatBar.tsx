import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Stat {
  /** Number → shows exact value, rolls/flashes only on a real change; string → rendered as-is. */
  value: number | string;
  label: string;
  change?: string;
  changePositive?: boolean;
  icon?: LucideIcon;
}

const fmtUsd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CHANGE_EPS = 0.01; // ignore sub-cent poll jitter

// Last value shown per stat, kept at module scope so it survives unmount/remount. This is why
// navigating away and back does NOT re-animate: on remount the value already matches what's stored.
const lastShown = new Map<string, number>();

/**
 * Shows the exact balance, and only PLAYS the rolling/flash animation when the value actually changes
 * by a meaningful amount (a deposit/withdraw/transfer, or a poll detecting a real balance change) —
 * not on every re-render, navigation, or sub-cent jitter. It always settles on the precise figure.
 */
function AnimatedStatValue({ value, statKey }: { value: number; statKey: string }) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const rafRef = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = lastShown.has(statKey) ? (lastShown.get(statKey) as number) : value;
    lastShown.set(statKey, value);
    const delta = value - prev;

    // No meaningful change (first mount, navigation to the same value, or micro-jitter) → snap.
    if (Math.abs(delta) < CHANGE_EPS) {
      setDisplay(value);
      return;
    }

    // Real change → roll from the previous value to the new one and flash the direction.
    setFlash(delta > 0 ? 'up' : 'down');
    const from = prev;
    const to = value;
    const start = performance.now();
    const duration = 600;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(to); // settle on the exact figure
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 1500);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, statKey]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  return (
    <span className={cn('transition-colors duration-300', flash === 'up' && 'text-emerald-500', flash === 'down' && 'text-rose-500')}>
      {fmtUsd(display)}
    </span>
  );
}

/**
 * A single stat container divided by faint grid lines (gap-px over bg-border),
 * instead of N separate cards. One strategic highlight container, hairline-divided.
 */
export default function StatBar({ stats, loading, className }: { stats: Stat[]; loading?: boolean; className?: string }) {
  return (
    // Flat: metrics live on the page, separated by hairline dividers (the gap-px lines), no card box.
    <div className={cn('grid grid-cols-2 gap-px bg-border lg:grid-cols-4', className)}>
      {stats.map((s) => {
        const Icon = s.icon;
        const negative = s.changePositive === false;
        return (
          <div key={s.label} className="bg-background p-4 lg:p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
                {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="mt-2 font-display text-2xl tracking-tight text-foreground tabular-nums">
                {loading ? (
                  <span className="text-muted-foreground">—</span>
                ) : typeof s.value === 'number' ? (
                  <AnimatedStatValue value={s.value} statKey={s.label} />
                ) : (
                  s.value
                )}
              </div>
              {s.change && (
                <div
                  className={cn(
                    'mt-1.5 inline-flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[11px] font-medium',
                    negative ? 'bg-negative/10 text-negative' : 'bg-positive/10 text-positive',
                  )}
                >
                  {negative ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                  {s.change}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
