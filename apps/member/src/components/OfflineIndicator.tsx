import { useEffect, useRef, useState } from 'react';
import { WifiOff, Wifi, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useOffline } from '@/hooks/useOffline';
import { cn } from '@/lib/utils';

/**
 * Connectivity toast: a small floating pill that slides in when the connection state flips (or if the
 * app opens offline) and auto-dismisses after a few seconds — instead of a persistent full-width banner.
 * It lingers while queued actions are actively syncing, then hides itself.
 */
export function OfflineIndicator() {
  const { isOffline, queuedActions } = useOffline();
  const [show, setShow] = useState(false);
  const prevOffline = useRef(isOffline);

  useEffect(() => {
    const flipped = prevOffline.current !== isOffline;
    prevOffline.current = isOffline;
    // Nothing to say when we're online and nothing changed (e.g. a normal mount).
    if (!flipped && !isOffline) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), isOffline ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [isOffline]);

  const syncing = !isOffline && queuedActions.length > 0;
  const open = show || syncing; // keep it up until the queue drains

  if (!open) return null;

  const Icon = isOffline ? WifiOff : syncing ? Loader2 : Wifi;
  const label = isOffline
    ? "You're offline"
    : syncing
      ? `Syncing ${queuedActions.length} action${queuedActions.length > 1 ? 's' : ''}…`
      : 'Back online';

  return (
    <AnimatePresence>
      {open && (
        <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[60] flex justify-center px-4">
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-popover/95 px-4 py-2 shadow-lg backdrop-blur"
          >
            <Icon
              className={cn(
                'h-4 w-4 shrink-0',
                isOffline ? 'text-amber-500' : syncing ? 'animate-spin text-muted-foreground' : 'text-positive',
              )}
            />
            <span className="text-sm font-medium text-foreground">{label}</span>
            {isOffline && (
              <span className="hidden text-xs text-muted-foreground sm:inline">· some features are limited</span>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
