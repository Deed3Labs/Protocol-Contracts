import { X, ExternalLink, Bell, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/*
 * Unified expanded detail view for a bill OR a transaction (a bill is just a recurring transaction).
 * Purely presentational — callers map their data into a `DetailInfo` and pass optional pay `actions`
 * (bills get them; transactions don't). Shared by the Pay bill detail + the transaction/activity detail.
 */
export type Tone = 'positive' | 'pending' | 'negative' | 'muted';

export interface DetailMetric {
  label: string;
  value: string;
}
export interface DetailHistoryEntry {
  id: string;
  title: string;
  subtitle?: string;
  amount: string;
  tone?: Tone;
}
export interface DetailAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}
export interface DetailInfo {
  icon: LucideIcon;
  iconTint?: string; // e.g. 'bg-amber-500/10 text-amber-600'
  title: string;
  subtitle?: string; // "Bill" · "Payment" · counterparty
  typeLabel?: string; // "Utility" · "Rent" · category
  status?: { label: string; tone: Tone };
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
  positive: 'bg-positive/10 text-positive',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  negative: 'bg-negative/10 text-negative',
  muted: 'bg-secondary text-muted-foreground',
};
const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-positive',
  pending: 'text-amber-600 dark:text-amber-400',
  negative: 'text-negative',
  muted: 'text-muted-foreground',
};

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
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[460px]">
        <div className="flex max-h-[88vh] flex-col">
          {/* header */}
          <div className="flex items-center justify-between px-5 pt-4">
            <span className="text-sm font-medium text-muted-foreground">{item.subtitle ?? 'Details'}</span>
            <button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="-mr-1 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4 pt-3">
            {/* identity */}
            <div className="flex items-center gap-3">
              <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', item.iconTint ?? 'bg-secondary text-foreground')}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-lg font-semibold text-foreground">{item.title}</span>
                  {item.status && (
                    <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium', TONE_BADGE[item.status.tone])}>
                      {item.status.label}
                    </span>
                  )}
                </div>
                {item.typeLabel && <div className="mt-0.5 text-xs text-muted-foreground">{item.typeLabel}</div>}
              </div>
            </div>

            {/* info rows */}
            {(item.address || item.portalHost || item.notifications) && (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="divide-y divide-border">
                  {item.address && (
                    <div className="flex items-start justify-between gap-3 px-4 py-3">
                      <span className="text-sm text-muted-foreground">Address</span>
                      <span className="max-w-[65%] text-right text-sm text-foreground">{item.address}</span>
                    </div>
                  )}
                  {item.portalHost && (
                    <button type="button" onClick={item.onPortal} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40">
                      <span className="text-sm text-muted-foreground">Portal</span>
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {item.portalHost} <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    </button>
                  )}
                  {item.notifications && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <Bell className="h-4 w-4" /> Reminders
                      </span>
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
                </div>
              </div>
            )}

            {/* metrics */}
            {item.metrics.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {item.metrics.map((m) => (
                  <div key={m.label} className="rounded-xl border border-border p-3">
                    <div className="font-display text-lg leading-none tabular-nums text-foreground">{m.value}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{m.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* history */}
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.historyTitle ?? 'History'}</h3>
              {item.history.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="divide-y divide-border">
                    {item.history.map((h) => (
                      <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{h.title}</div>
                          {h.subtitle && <div className="truncate text-xs text-muted-foreground">{h.subtitle}</div>}
                        </div>
                        <span className={cn('shrink-0 text-sm font-medium tabular-nums', h.tone ? TONE_TEXT[h.tone] : 'text-foreground')}>{h.amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border py-8 text-center text-sm text-muted-foreground">No history yet.</div>
              )}
            </div>
          </div>

          {/* pay actions (bills only) */}
          {item.actions && item.actions.length > 0 && (
            <div className="flex gap-2 border-t border-border px-5 py-4">
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
