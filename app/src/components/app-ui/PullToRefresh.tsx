import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * Pull-to-refresh for the installed PWA / mobile web.
 *
 * Backgrounded apps get their timers suspended by the OS, so an installed PWA can sit on stale data
 * with no obvious way to force a fetch — there's no browser reload button in standalone mode. The
 * visibility listeners handle the resume case; this covers "I'm looking at it and want it fresh now".
 *
 * Refresh is broadcast as `clear:activity`, the event balances, transactions and wallet balances
 * already listen to, so there's no separate refresh path to keep in sync.
 *
 * Touch only: it attaches nothing on pointer devices, where the browser's own reload exists.
 */

const THRESHOLD = 68; // px of pull (after resistance) that commits to a refresh
const MAX_PULL = 104; // clamp so the indicator can't be dragged down the whole screen
const RESISTANCE = 0.5; // drag feels weighted rather than 1:1 with the finger
const MIN_SPIN_MS = 550; // keep the spinner up long enough to read as deliberate, not a flicker

export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Touch handlers are bound once; refs let them read current values without rebinding per frame.
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  const setPullBoth = useCallback((v: number) => {
    pullRef.current = v;
    setPull(v);
  }, []);

  const runRefresh = useCallback(async () => {
    refreshingRef.current = true;
    setRefreshing(true);
    setPullBoth(THRESHOLD);
    window.dispatchEvent(new Event('clear:activity'));
    await new Promise((r) => setTimeout(r, MIN_SPIN_MS));
    refreshingRef.current = false;
    setRefreshing(false);
    setPullBoth(0);
  }, [setPullBoth]);

  useEffect(() => {
    // Pointer devices have a reload button; don't intercept their gestures.
    if (typeof window === 'undefined' || !('ontouchstart' in window)) return;

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || window.scrollY > 0 || e.touches.length !== 1) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current == null || refreshingRef.current) return;
      // Scrolled away from the top mid-gesture → hand it back to the browser.
      if (window.scrollY > 0) {
        startY.current = null;
        setPullBoth(0);
        return;
      }
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        setPullBoth(0);
        return; // upward drag is a normal scroll
      }
      const next = Math.min(MAX_PULL, dy * RESISTANCE);
      setPullBoth(next);
      // Only swallow the event once it's clearly a pull, so small jitters still scroll normally.
      if (next > 4 && e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
      if (startY.current == null) return;
      startY.current = null;
      if (pullRef.current >= THRESHOLD) void runRefresh();
      else setPullBoth(0);
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [runRefresh, setPullBoth]);

  const armed = pull >= THRESHOLD;
  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div className="relative">
      <div
        aria-hidden={pull === 0}
        className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center"
        style={{ transform: `translateY(${Math.max(0, pull - 34)}px)`, opacity: progress }}
      >
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background shadow-sm',
            armed && 'border-foreground/30',
          )}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin text-foreground" />
          ) : (
            <ArrowDown
              className={cn('h-4 w-4 text-muted-foreground transition-transform', armed && 'rotate-180 text-foreground')}
            />
          )}
        </span>
      </div>

      {/* Content follows the finger, then springs back once the gesture ends. */}
      <div
        style={{ transform: pull > 0 ? `translateY(${pull}px)` : undefined }}
        className={cn(startY.current == null && 'transition-transform duration-200')}
      >
        {children}
      </div>
    </div>
  );
}
