import { type ReactNode, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronLeft, ChevronDown, BadgeCheck, Check, X, Pencil, Copy, ExternalLink, Plus,
  ArrowDownLeft, ArrowUpRight, Share2, Download, type LucideIcon,
} from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { downloadReceiptPdf } from '@/lib/receiptPdf';

/*
 * Unified detail view for a bill OR a transaction, as a right-side drawer (full-screen sheet on mobile).
 * Tabs (Details · History); Details has collapsible sections (Summary, Transaction, Latest receipt), a
 * metrics grid, editable portal/address, and copyable reference fields; History is grouped with
 * directional in/out icons + signed colored amounts. Bills get a pinned pay bar; transactions don't.
 * Purely presentational — callers map into `DetailInfo`.
 */
export type Tone = 'positive' | 'pending' | 'negative' | 'muted';

export interface DetailMetric { label: string; value: string; icon?: LucideIcon; animateTo?: number; format?: (n: number) => string }
export interface DetailHistoryEntry {
  id: string;
  title: string;
  subtitle?: string;
  value: string;
  tone?: Tone;
  success?: boolean;
  direction?: 'in' | 'out';
  group?: string;
}
export interface DetailReceipt {
  lines: { label: string; value: string; tone?: Tone }[];
  total?: { label: string; value: string };
  onShare?: () => void;
}
export interface DetailAction { label: string; onClick: () => void; primary?: boolean; disabled?: boolean; icon?: LucideIcon }
export interface DetailInfo {
  icon: LucideIcon;
  iconTint?: string;
  title: string;
  subtitle?: string;
  typeLabel?: string;
  status?: { label: string; tone: Tone };
  nextDue?: string | null;
  /** For transfers/sends: who it was to/from (shown instead of payment-link/address). */
  parties?: { label: string; value: string; sub?: string }[];
  reference?: string | null;
  account?: string | null;
  dateTime?: string | null;
  portal?: { url: string | null; onOpen?: () => void; onSave: (v: string) => void };
  address?: { value: string | null; onSave: (v: string) => void };
  notifications?: { enabled: boolean; onToggle: (v: boolean) => void };
  metrics: DetailMetric[];
  receipt?: DetailReceipt;
  historyTitle?: string;
  history: DetailHistoryEntry[];
  actions?: DetailAction[];
  /** Shows skeletons in the metrics + history while data loads. */
  loading?: boolean;
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

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

function Section({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mb-2 flex w-full items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
      </button>
      {open && children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[46px] items-center justify-between gap-3 px-4">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-1.5 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  // Middle-ellipsis long refs/hashes; copy the full value.
  const display = value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value;
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="inline-flex min-w-0 items-center gap-1.5 text-sm text-foreground"
      title={value}
    >
      <span className="truncate">{display}</span>
      {copied ? <Check className="h-3.5 w-3.5 shrink-0 text-positive" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/** Inline-editable row (empty → "Add …"); `display` shown, `value` edited. */
function EditableRow({ label, value, display, placeholder, onSave, onOpen }: {
  label: string; value: string | null; display?: string; placeholder: string; onSave: (v: string) => void; onOpen?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const save = () => { onSave(draft.trim()); setEditing(false); };
  if (editing) {
    return (
      <div className="flex min-h-[46px] items-center gap-2 px-4">
        <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
        <input
          autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); } }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-right text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button type="button" onClick={save} aria-label="Save" className="shrink-0 rounded-full p-1 text-positive hover:bg-secondary"><Check className="h-4 w-4" /></button>
        <button type="button" onClick={() => { setDraft(value ?? ''); setEditing(false); }} aria-label="Cancel" className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
      </div>
    );
  }
  return (
    <Row label={label}>
      {value ? (
        <>
          <button type="button" onClick={onOpen} disabled={!onOpen} className="inline-flex min-w-0 items-center gap-1.5 disabled:cursor-default">
            <span className="truncate">{display ?? value}</span>
            {onOpen && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          </button>
          <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${label.toLowerCase()}`} className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
        </>
      ) : (
        <button type="button" onClick={() => { setDraft(''); setEditing(true); }} className="inline-flex items-center gap-1 text-primary"><Plus className="h-3.5 w-3.5" /> Add {label.toLowerCase()}</button>
      )}
    </Row>
  );
}

/** Eases 0 → target once on mount (StatBar-style number roll-up). */
function CountUp({ to, format }: { to: number; format: (n: number) => string }) {
  const [n, setN] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const start = performance.now();
    const dur = 650;
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1);
      setN(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setN(to);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [to]);
  return <>{format(n)}</>;
}

const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded bg-secondary', className)} />;

const fade = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: 'easeOut' as const } } };
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const HISTORY_CAP = 6;

export default function ActivityDetailModal({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item: DetailInfo | null }) {
  const [tab, setTab] = useState<'details' | 'history'>('details');
  const [showAllHistory, setShowAllHistory] = useState(false);
  useEffect(() => { if (open) { setTab('details'); setShowAllHistory(false); } }, [open]);
  if (!item) return null;
  const Icon = item.icon;
  const tintText = item.iconTint?.split(' ').find((c) => c.startsWith('text-')) ?? 'text-muted-foreground';

  // Group history entries in order, capped until "View all".
  const shownHistory = showAllHistory ? item.history : item.history.slice(0, HISTORY_CAP);
  const groups: { label: string; entries: DetailHistoryEntry[] }[] = [];
  for (const h of shownHistory) {
    const g = h.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.label === g) last.entries.push(h);
    else groups.push({ label: g, entries: [h] });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-label={item.title} onDismiss={() => onOpenChange(false)} className="gap-0 p-0">
        {/* header — breadcrumb-style back button */}
        <div className="flex shrink-0 items-center justify-between px-3 py-2.5">
          <button type="button" onClick={() => onOpenChange(false)} className="inline-flex items-center gap-1 rounded-lg py-1.5 pl-1.5 pr-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          {item.receipt?.onShare && (
            <button type="button" onClick={item.receipt.onShare} aria-label="Share" className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><Share2 className="h-4 w-4" /></button>
          )}
        </div>

        {/* identity */}
        <div className="flex shrink-0 items-center gap-3 px-4 pb-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', item.iconTint ?? 'bg-secondary text-foreground')}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-display text-lg font-semibold tracking-tight text-foreground">{item.title}</span>
              {item.status && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', TONE_BADGE[item.status.tone])}>{item.status.label}</span>}
            </div>
            {(item.typeLabel || item.subtitle) && <div className="mt-0.5 truncate text-xs text-muted-foreground">{[item.typeLabel, item.subtitle].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>

        {/* tabs */}
        <div className="flex shrink-0 gap-5 border-b border-border px-4">
          {(['details', 'history'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn('-mb-px flex items-center gap-1.5 border-b-2 py-2.5 text-sm capitalize', tab === t ? 'border-foreground font-semibold text-foreground' : 'border-transparent font-medium text-muted-foreground hover:text-foreground')}>
              {t}
              {t === 'history' && <span className="rounded-full bg-secondary px-1.5 text-[11px] font-medium">{item.history.length}</span>}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {tab === 'details' ? (
            <motion.div key="details" variants={stagger} initial="hidden" animate="show" className="space-y-4">
              <motion.div variants={fade}>
              <Section title="Summary">
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
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
                      <button type="button" role="switch" aria-checked={item.notifications.enabled} onClick={() => item.notifications!.onToggle(!item.notifications!.enabled)} className={cn('relative h-6 w-10 rounded-full transition-colors', item.notifications.enabled ? 'bg-primary' : 'bg-border')}>
                        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', item.notifications.enabled ? 'left-[18px]' : 'left-0.5')} />
                      </button>
                    </Row>
                  )}
                  {item.parties?.map((p) => (
                    <Row key={p.label + p.value} label={p.label}>
                      <span className="max-w-[240px] text-right">
                        <span className="block truncate">{p.value}</span>
                        {p.sub && <span className="block truncate text-xs font-normal text-muted-foreground">{p.sub}</span>}
                      </span>
                    </Row>
                  ))}
                  {item.portal && <EditableRow label="Payment link" value={item.portal.url} display={item.portal.url ? hostOf(item.portal.url) : undefined} placeholder="pge.com/login" onOpen={item.portal.onOpen} onSave={item.portal.onSave} />}
                  {item.address && <EditableRow label="Address" value={item.address.value} placeholder="123 Main St, City, ST" onSave={item.address.onSave} />}
                </div>
              </Section>
              </motion.div>

              {(item.reference || item.account || item.dateTime || item.status) && (
                <motion.div variants={fade}>
                <Section title="Transaction">
                  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {item.reference && <Row label="Reference"><CopyValue value={item.reference} /></Row>}
                    {item.account && <Row label="Account"><span>{item.account}</span></Row>}
                    {item.dateTime && <Row label="Date">{item.dateTime}</Row>}
                    {item.status && <Row label="Status"><span className={cn('inline-flex items-center gap-1', TONE_TEXT[item.status.tone])}><BadgeCheck className="h-4 w-4" /> {item.status.label}</span></Row>}
                  </div>
                </Section>
                </motion.div>
              )}

              {(item.loading || item.metrics.length > 0) && (
                <motion.div variants={fade} className="grid grid-cols-2 overflow-hidden rounded-xl border border-border">
                  {item.loading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className={cn('p-3.5', i % 2 === 0 && 'border-r border-border', i < 2 && 'border-b border-border')}>
                          <Skeleton className="h-3 w-16" />
                          <Skeleton className="mt-2.5 h-6 w-14" />
                        </div>
                      ))
                    : item.metrics.map((m, i) => (
                        <div key={m.label} className={cn('p-3.5', i % 2 === 0 && 'border-r border-border', i + 2 < item.metrics.length && 'border-b border-border')}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
                            {m.icon && <m.icon className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                          <div className="mt-1.5 font-display text-xl tracking-tight tabular-nums text-foreground">
                            {m.animateTo != null && m.format ? <CountUp to={m.animateTo} format={m.format} /> : m.value}
                          </div>
                        </div>
                      ))}
                </motion.div>
              )}

              {item.receipt && (
                <motion.div variants={fade}>
                <Section title="Latest receipt">
                  <div className="rounded-xl border border-border p-4">
                    {item.receipt.lines.map((l) => (
                      <div key={l.label} className="flex justify-between py-1 text-sm">
                        <span className="text-muted-foreground">{l.label}</span>
                        <span className={cn('font-display tabular-nums', l.tone ? TONE_TEXT[l.tone] : 'text-foreground')}>{l.value}</span>
                      </div>
                    ))}
                    {item.receipt.total && (
                      <div className="mt-1 flex justify-between border-t border-border pt-2.5 text-sm font-semibold">
                        <span className="text-foreground">{item.receipt.total.label}</span>
                        <span className="font-display tabular-nums text-foreground">{item.receipt.total.value}</span>
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => downloadReceiptPdf({ title: item.title, subtitle: item.subtitle, dateTime: item.dateTime, reference: item.reference, account: item.account, lines: item.receipt!.lines.map((l) => ({ label: l.label, value: l.value })), total: item.receipt!.total })}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-secondary"
                      >
                        <Download className="h-4 w-4" /> Download PDF
                      </button>
                      {item.receipt.onShare && (
                        <button type="button" onClick={item.receipt.onShare} aria-label="Share receipt" className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg border border-border text-foreground hover:bg-secondary">
                          <Share2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </Section>
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div key="history" variants={stagger} initial="hidden" animate="show">
              {item.loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-1">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <div className="flex-1"><Skeleton className="h-3.5 w-28" /><Skeleton className="mt-1.5 h-3 w-16" /></div>
                      <Skeleton className="h-4 w-12" />
                    </div>
                  ))}
                </div>
              ) : shownHistory.length > 0 ? (
                <>
                  {groups.map((g) => (
                    <motion.div variants={fade} key={g.label || 'all'} className="mb-2">
                      {g.label && <div className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>}
                      <div className="divide-y divide-border">
                        {g.entries.map((h) => (
                          <div key={h.id} className="flex items-center justify-between gap-3 py-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              {h.direction === 'in' ? (
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive"><ArrowDownLeft className="h-4 w-4" /></span>
                              ) : h.direction === 'out' ? (
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-negative/10 text-negative"><ArrowUpRight className="h-4 w-4" /></span>
                              ) : h.success ? (
                                <BadgeCheck className="h-[18px] w-[18px] shrink-0 text-positive" />
                              ) : null}
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{h.title}</div>
                                {h.subtitle && <div className="truncate text-xs text-muted-foreground">{h.subtitle}</div>}
                              </div>
                            </div>
                            <span className={cn('shrink-0 font-display text-sm tabular-nums', h.tone ? TONE_TEXT[h.tone] : 'text-foreground')}>{h.value}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                  {!showAllHistory && item.history.length > HISTORY_CAP && (
                    <button type="button" onClick={() => setShowAllHistory(true)} className="mt-2 w-full rounded-lg border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">View all {item.history.length}</button>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-border py-10 text-center text-sm text-muted-foreground">No activity yet.</div>
              )}
            </motion.div>
          )}
        </div>

        {/* pay bar (bills only) */}
        {item.actions && item.actions.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {item.actions.map((a) =>
              a.icon ? (
                <button key={a.label} type="button" aria-label={a.label} disabled={a.disabled} onClick={a.onClick} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-40"><a.icon className="h-5 w-5" /></button>
              ) : (
                <button key={a.label} type="button" disabled={a.disabled} onClick={a.onClick} className={cn('flex-1 rounded-xl py-3 text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-40', a.primary ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground hover:bg-secondary')}>{a.label}</button>
              ),
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
