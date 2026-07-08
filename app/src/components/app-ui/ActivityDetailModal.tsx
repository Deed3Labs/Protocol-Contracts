import { type ReactNode } from 'react';
import { X, ExternalLink, Check, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/*
 * Unified expanded detail view for a bill OR a transaction, following the reference layout exactly:
 * identity card (icon + name + status pill + subtitle, category chip on the right) with grouped info
 * rows, a big-number metrics block, an uppercase history section with check-badge rows, and a bottom
 * action bar (pay buttons on bills only). Purely presentational — callers map into `DetailInfo`.
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
  subtitle?: string; // "Bill" · "Transaction"
  typeLabel?: string; // category chip on the right — "Utility", "Rent", …
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

function UnitChip({ unit }: { unit: string }) {
  return <span className="rounded bg-secondary px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{unit}</span>;
}

/** One grouped label/value/control row inside the identity card. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">{children}</div>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[440px]">
        <div className="flex max-h-[90vh] flex-col">
          {/* top bar */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="truncate text-base font-semibold text-foreground">{item.title}</span>
            <button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="-mr-1 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
            {/* identity card + grouped rows */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex items-start justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', item.iconTint ?? 'bg-secondary text-foreground')}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-foreground">{item.title}</span>
                      {item.status && (
                        <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium', TONE_BADGE[item.status.tone])}>{item.status.label}</span>
                      )}
                    </div>
                    {item.subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{item.subtitle}</div>}
                  </div>
                </div>
                {item.typeLabel && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {item.typeLabel}
                  </span>
                )}
              </div>

              {(item.nextDue || item.notifications || item.portalHost || item.address) && (
                <div className="divide-y divide-border border-t border-border">
                  {item.nextDue && <Row label="Next due">{item.nextDue}</Row>}
                  {item.notifications && (
                    <Row label="Reminders">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.notifications.enabled}
                        onClick={() => item.notifications!.onToggle(!item.notifications!.enabled)}
                        className={cn('relative h-6 w-10 rounded-full transition-colors', item.notifications.enabled ? 'bg-primary' : 'bg-secondary')}
                      >
                        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all', item.notifications.enabled ? 'left-[18px]' : 'left-0.5')} />
                      </button>
                    </Row>
                  )}
                  {item.portalHost && (
                    <button type="button" onClick={item.onPortal} className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/40">
                      <span className="text-sm text-muted-foreground">Portal</span>
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">{item.portalHost} <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" /></span>
                    </button>
                  )}
                  {item.address && (
                    <Row label="Address"><span className="max-w-[220px] truncate text-right">{item.address}</span></Row>
                  )}
                </div>
              )}
            </div>

            {/* metrics block */}
            {item.metrics.length > 0 && (
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
                {item.metrics.map((m) => (
                  <div key={m.label} className="bg-card p-4">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-2xl leading-none tabular-nums text-foreground">{m.value}</span>
                      {m.unit && <UnitChip unit={m.unit} />}
                    </div>
                    <div className="mt-1.5 text-xs text-muted-foreground">{m.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* history */}
            <div>
              <h3 className="px-1 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{item.historyTitle ?? 'History'}</h3>
              {item.history.length > 0 ? (
                <div className="space-y-2">
                  {item.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {h.success && (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive">
                            <Check className="h-3 w-3" strokeWidth={3} />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{h.title}</div>
                          {h.subtitle && <div className="truncate text-xs text-muted-foreground">{h.subtitle}</div>}
                        </div>
                      </div>
                      <span className={cn('flex shrink-0 items-baseline gap-1.5 text-sm font-medium tabular-nums', h.tone ? TONE_TEXT[h.tone] : 'text-foreground')}>
                        {h.value}
                        {h.unit && <UnitChip unit={h.unit} />}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-border py-8 text-center text-sm text-muted-foreground">No history yet.</div>
              )}
            </div>
          </div>

          {/* bottom action bar (bills only) */}
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
