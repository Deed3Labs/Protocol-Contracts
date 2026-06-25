import { useState } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { X, Landmark, Sparkles, Gift, ArrowRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Accent = 'blue' | 'green' | 'violet';

interface Cta {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  action: string;
  accent: Accent;
}

const CTAS: Cta[] = [
  { id: 'link', icon: Landmark, title: 'Link your bank', body: 'Connect an account to move money in seconds.', action: 'Connect', accent: 'blue' },
  { id: 'match', icon: Sparkles, title: 'Earn your 1:1 match', body: 'Move cash to savings and grow equity credits.', action: 'Move to savings', accent: 'green' },
  { id: 'refer', icon: Gift, title: 'Give $25, get $25', body: 'Invite a friend — you both earn when they join.', action: 'Invite friends', accent: 'violet' },
];

const ACCENT: Record<Accent, { wash: string; chip: string; btn: string }> = {
  blue: { wash: 'from-info/[0.10]', chip: 'bg-info/15 text-info', btn: 'text-info' },
  green: { wash: 'from-positive/[0.10]', chip: 'bg-positive/15 text-positive', btn: 'text-positive' },
  violet: { wash: 'from-violet-500/[0.12]', chip: 'bg-violet-500/15 text-violet-600 dark:text-violet-400', btn: 'text-violet-600 dark:text-violet-400' },
};

/**
 * A small deck of dismissible CTA cards above the quick actions. The top card is
 * swipeable (drag horizontally) or closeable (×); the next card animates forward.
 * Each card carries a color accent + gradient wash. Dismissals are in-memory.
 */
export default function CtaStack({ className }: { className?: string }) {
  const [cards, setCards] = useState<Cta[]>(CTAS);
  const dismiss = (id: string) => setCards((cs) => cs.filter((c) => c.id !== id));

  if (cards.length === 0) return null;
  const visible = cards.slice(0, 3);

  return (
    <div className={cn('relative h-[132px] select-none', className)}>
      <AnimatePresence initial={false}>
        {visible.map((c, i) => {
          const isTop = i === 0;
          const a = ACCENT[c.accent];
          const Icon = c.icon;
          return (
            <motion.div
              key={c.id}
              drag={isTop ? 'x' : false}
              dragSnapToOrigin
              dragElastic={0.6}
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={(_, info: PanInfo) => {
                if (Math.abs(info.offset.x) > 90) dismiss(c.id);
              }}
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: i * 7, scale: 1 - i * 0.04 }}
              exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              style={{ zIndex: visible.length - i }}
              className={cn(
                'absolute inset-x-0 top-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm',
                isTop ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none',
              )}
            >
              <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent', a.wash)} aria-hidden />
              <div className="relative flex items-start gap-3 p-4">
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', a.chip)}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{c.title}</h4>
                    <button
                      type="button"
                      onClick={() => dismiss(c.id)}
                      aria-label="Dismiss"
                      className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{c.body}</p>
                  <button type="button" className={cn('mt-2 inline-flex items-center gap-1 text-xs font-semibold', a.btn)}>
                    {c.action} <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
