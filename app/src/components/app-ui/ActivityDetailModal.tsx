import { type ReactNode } from 'react';
import { ChevronLeft, BadgeCheck, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/*
 * Unified expanded detail view for a bill OR a transaction, aligned to the app design system:
 * back-bar + title; an identity card (icon + name + status pill + subtitle) with grouped label/value
 * rows; a StatBar-style hairline metrics grid; an editorial PAYMENT HISTORY list (divider rows, no
 * cards); and floating bottom actions (bills only). Full-round radius is reserved for chips/pills/
 * toggles/buttons — cards use the app's rounded-xl. Purely presentational — callers map to `DetailInfo`.
 */
export type Tone = 'positive' | 'pending' | 'negative' | 'muted';

export interface DetailMetric {
  label: string;
  value: string;
  icon?: LucideIcon;
}
export interface DetailHistoryEntry {
  id: string;
  title: string;
  subtitle?: string;
  value: string;
  tone?: Tone;
  success?: boolean;
}
export interface DetailAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon?: LucideIcon; // when set, renders as a circular icon button instead of a pill
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

/** One label/value row inside the identity card. */
function Row({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cn('flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left', onClick && 'transition-colors hover:bg-foreground/[0.03]')}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">{children}</div>
    </Tag>
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
  const tintText = item.iconTint?.split(' ').find((c) => c.startsWith('text-')) ?? 'text-muted-foreground';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[420px]">
        <div className="flex max-h-[90vh] flex-col">
          {/* back bar */}
          <div className="flex items-center gap-1 px-3 py-3">
            <button type="button" onClick={() => onOpenChange(false)} aria-label="Back" className="rounded-full p-1 text-foreground hover:bg-secondary">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-base font-semibold text-foreground">{item.title}</span>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            {/* identity card + grouped rows */}
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-3 p-4">
                <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', item.iconTint ?? 'bg-secondary text-foreground')}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold text-foreground">{item.title}</span>
                    {item.status && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', TONE_BADGE[item.status.tone])}>{item.status.label}</span>}
                  </div>
                  {item.subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{item.subtitle}</div>}
                </div>
              </div>

              <div className="divide-y divide-border border-t border-border">
                {item.typeLabel && (
                  <Row label="Category">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                      <Icon className={cn('h-3.5 w-3.5', tintText)} /> {item.typeLabel}
                    </span>
                  </Row>
                )}
                {item.nextDue && <Row label="Next due">{item.nextDue}</Row>}
                {item.notifications && (
                  <Row label="Alerts">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.notifications.enabled}
                      onClick={() => item.notifications!.onToggle(!item.notifications!.enabled)}
                      className={cn('relative h-6 w-10 rounded-full transition-colors', item.notifications.enabled ? 'bg-primary' : 'bg-border')}
                    >
                      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', item.notifications.enabled ? 'left-[18px]' : 'left-0.5')} />
                    </button>
                  </Row>
                )}
                {item.portalHost && <Row label="Portal" onClick={item.onPortal}>{item.portalHost}</Row>}
                {item.address && <Row label="Address"><span className="max-w-[210px] truncate text-right">{item.address}</span></Row>}
              </div>
            </div>

            {/* metrics — StatBar hairline grid */}
            {item.metrics.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-border bg-border">
                <div className="grid grid-cols-2 gap-px bg-border">
                  {item.metrics.map((m) => (
                    <div key={m.label} className="bg-card p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
                        {m.icon && <m.icon className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="mt-2 font-display text-2xl tracking-tight tabular-nums text-foreground">{m.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* history — editorial divider rows */}
            <div>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{item.historyTitle ?? 'History'}</h3>
              {item.history.length > 0 ? (
                <div className="divide-y divide-border border-t border-border">
                  {item.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {h.success && <BadgeCheck className="h-[18px] w-[18px] shrink-0 text-positive" />}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{h.title}</div>
                          {h.subtitle && <div className="truncate text-xs text-muted-foreground">{h.subtitle}</div>}
                        </div>
                      </div>
                      <span className={cn('shrink-0 font-display text-sm tabular-nums', h.tone ? TONE_TEXT[h.tone] : 'text-foreground')}>{h.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border-t border-border py-8 text-center text-sm text-muted-foreground">No history yet.</div>
              )}
            </div>
          </div>

          {/* floating bottom actions (bills only) */}
          {item.actions && item.actions.length > 0 && (
            <div className="flex items-center justify-center gap-3 px-4 py-4">
              {item.actions.map((a) =>
                a.icon ? (
                  <button
                    key={a.label}
                    type="button"
                    aria-label={a.label}
                    disabled={a.disabled}
                    onClick={a.onClick}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-40"
                  >
                    <a.icon className="h-5 w-5" />
                  </button>
                ) : (
                  <button
                    key={a.label}
                    type="button"
                    disabled={a.disabled}
                    onClick={a.onClick}
                    className={cn(
                      'rounded-full px-6 py-3 text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-40',
                      a.primary ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground',
                    )}
                  >
                    {a.label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
