import { type ReactNode } from 'react';
import { X, ExternalLink, Check, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/*
 * Unified detail view for a bill OR a transaction, styled as a RECEIPT — the modal itself is the paper:
 * one surface, dashed tear-lines between sections, dotted leader rows, monospace figures, a hero total,
 * and (bills only) a bottom action bar. No nested cards. Purely presentational — callers map to DetailInfo.
 */
export type Tone = 'positive' | 'pending' | 'negative' | 'muted';

export interface DetailMetric {
  label: string;
  value: string;
  unit?: string;
}
export interface DetailHistoryEntry {
  id: string;
  title: string;
  subtitle?: string;
  value: string;
  unit?: string;
  tone?: Tone;
  success?: boolean;
}
export interface DetailAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}
export interface DetailInfo {
  icon: LucideIcon;
  iconTint?: string;
  title: string;
  subtitle?: string;
  typeLabel?: string;
  status?: { label: string; tone: Tone };
  nextDue?: string | null;
  address?: string | null;
  portalHost?: string | null;
  onPortal?: () => void;
  notifications?: { enabled: boolean; onToggle: (v: boolean) => void };
  metrics: DetailMetric[];
  historyTitle?: string;
  history: DetailHistoryEntry[];
  actions?: DetailAction[];
}

const TONE_BADGE: Record<Tone, string> = {
  positive: 'bg-positive/15 text-positive',
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  negative: 'bg-negative/15 text-negative',
  muted: 'bg-secondary text-muted-foreground',
};
const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-positive',
  pending: 'text-amber-600 dark:text-amber-400',
  negative: 'text-negative',
  muted: 'text-foreground',
};

/** Receipt tear-line. */
const Tear = () => <div className="mx-6 border-t border-dashed border-border" aria-hidden />;

/** A label — dotted leader — value row (the receipt line-item look). */
function Leader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-3 flex-1 translate-y-[-3px] border-b border-dotted border-border" aria-hidden />
      <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">{children}</span>
    </div>
  );
}

export default function ActivityDetailModal({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: DetailInfo | null;
}) {
  if (!item) return null;
  const Icon = item.icon;
  const [hero, ...mini] = item.metrics;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[400px]">
        <button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" />
        </button>

        <div className="flex max-h-[90vh] flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* header */}
            <div className="px-6 pb-5 pt-9 text-center">
              <span className={cn('mx-auto flex h-14 w-14 items-center justify-center rounded-2xl', item.iconTint ?? 'bg-secondary text-foreground')}>
                <Icon className="h-6 w-6" />
              </span>
              {(item.typeLabel || item.subtitle) && (
                <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {[item.typeLabel, item.subtitle].filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="mt-1 font-display text-2xl tracking-tight text-foreground">{item.title}</div>
              {item.status && (
                <span className={cn('mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium', TONE_BADGE[item.status.tone])}>
                  {item.status.label}
                </span>
              )}
            </div>

            {/* info leaders */}
            {(item.nextDue || item.notifications || item.portalHost || item.address) && (
              <>
                <Tear />
                <div className="space-y-3 px-6 py-4">
                  {item.nextDue && <Leader label="Next due">{item.nextDue}</Leader>}
                  {item.notifications && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Reminders</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.notifications.enabled}
                        onClick={() => item.notifications!.onToggle(!item.notifications!.enabled)}
                        className={cn('relative h-6 w-10 rounded-full transition-colors', item.notifications.enabled ? 'bg-primary' : 'bg-secondary')}
                      >
                        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all', item.notifications.enabled ? 'left-[18px]' : 'left-0.5')} />
                      </button>
                    </div>
                  )}
                  {item.portalHost && (
                    <button type="button" onClick={item.onPortal} className="flex w-full items-baseline gap-2 text-left">
                      <span className="shrink-0 text-sm text-muted-foreground">Portal</span>
                      <span className="min-w-3 flex-1 translate-y-[-3px] border-b border-dotted border-border" aria-hidden />
                      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-sm text-foreground">{item.portalHost}<ExternalLink className="h-3.5 w-3.5 text-muted-foreground" /></span>
                    </button>
                  )}
                  {item.address && (
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-sm text-muted-foreground">Address</span>
                      <span className="min-w-3 flex-1 translate-y-[-3px] border-b border-dotted border-border" aria-hidden />
                      <span className="max-w-[210px] shrink-0 truncate text-right text-sm text-foreground">{item.address}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* hero total + mini stats */}
            {hero && (
              <>
                <Tear />
                <div className="px-6 py-6 text-center">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{hero.label}</div>
                  <div className="mt-1.5 flex items-baseline justify-center gap-2">
                    <span className="font-display text-[42px] leading-none tracking-tight text-foreground tabular-nums">{hero.value}</span>
                    {hero.unit && <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{hero.unit}</span>}
                  </div>
                  {mini.length > 0 && (
                    <div className="mt-6 grid divide-x divide-border" style={{ gridTemplateColumns: `repeat(${mini.length}, minmax(0,1fr))` }}>
                      {mini.map((m) => (
                        <div key={m.label} className="px-2">
                          <div className="font-mono text-base tabular-nums text-foreground">{m.value}{m.unit ? <span className="ml-0.5 text-[10px] text-muted-foreground">{m.unit}</span> : null}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* history */}
            <Tear />
            <div className="px-6 py-4">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.historyTitle ?? 'History'}</div>
              {item.history.length > 0 ? (
                <div className="space-y-2.5">
                  {item.history.map((h) => (
                    <div key={h.id} className="flex items-center gap-2.5">
                      {h.success && (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive">
                          <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                        </span>
                      )}
                      <span className="min-w-0 truncate text-sm text-foreground">{h.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{h.subtitle}</span>
                      <span className="min-w-3 flex-1 translate-y-[-3px] border-b border-dotted border-border" aria-hidden />
                      <span className={cn('shrink-0 font-mono text-sm tabular-nums', h.tone ? TONE_TEXT[h.tone] : 'text-foreground')}>
                        {h.value}{h.unit ? <span className="ml-1 text-[10px] text-muted-foreground">{h.unit}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center font-mono text-xs uppercase tracking-wider text-muted-foreground">— no history yet —</div>
              )}
            </div>

            {/* scalloped receipt bottom */}
            <div
              className="h-3 bg-border"
              aria-hidden
              style={{ WebkitMaskImage: 'radial-gradient(6px at 6px 100%, transparent 98%, #000)', WebkitMaskSize: '12px 12px', WebkitMaskRepeat: 'repeat-x', maskImage: 'radial-gradient(6px at 6px 100%, transparent 98%, #000)', maskSize: '12px 12px', maskRepeat: 'repeat-x' }}
            />
          </div>

          {/* pay actions (bills only) */}
          {item.actions && item.actions.length > 0 && (
            <div className="flex gap-2 border-t border-border p-4">
              {item.actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  disabled={a.disabled}
                  onClick={a.onClick}
                  className={cn(
                    'flex-1 rounded-xl py-3 text-sm font-semibold transition-transform active:scale-[0.99] disabled:opacity-40',
                    a.primary ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground hover:bg-secondary',
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
