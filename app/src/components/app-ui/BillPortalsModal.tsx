import { useMemo, useState } from 'react';
import { Search, ChevronRight, TrendingUp, Flame, Zap, Droplet, Home, Smartphone, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import BillPortalBrowser from '@/components/app-ui/BillPortalBrowser';
import { usePay, creditsFor, type Bill } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { BILL_PORTALS, PORTAL_CATEGORIES, rankPortals, matchPortal, type BillPortal, type PortalCategory } from '@/data/billPortals';

/*
 * "Pay a bill" — bills-first, styled to the dashboard design system (hairline-divided rows in a single
 * bordered card, tinted lucide icons, minimal chrome). Opens to the member's own billers (manual +
 * Plaid) with the equity credits each earns, then a short, smart provider list (top matches for their
 * billers + inferred state) with search to find more — not a long flat list.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const LIMIT = 6;

const CAT_ICON: Record<PortalCategory, LucideIcon> = { electric: Zap, utilities: Droplet, rent: Home, telecom: Smartphone };
const CAT_TINT: Record<PortalCategory, string> = {
  electric: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  utilities: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  rent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  telecom: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
};

export default function BillPortalsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { bills, summary, openPay, streak } = usePay();
  const { accelerated } = useMemberProfile();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PortalCategory | 'all'>('all');
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState<BillPortal | null>(null);

  // Infer the user's state from a state-specific biller they already have (e.g. a PG&E bill → CA).
  const inferredState = useMemo(() => {
    for (const b of bills) {
      const p = matchPortal(b.payee || b.name);
      if (p?.states?.length === 1) return p.states[0];
    }
    return undefined;
  }, [bills]);

  const mineIds = useMemo(
    () => new Set(bills.map((b) => matchPortal(b.payee || b.name)?.id).filter(Boolean)),
    [bills],
  );

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = BILL_PORTALS.filter(
      (p) => (category === 'all' || p.category === category) && (!q || `${p.name} ${p.hint ?? ''}`.toLowerCase().includes(q)),
    );
    return rankPortals(filtered, inferredState).sort((a, b) => (mineIds.has(b.id) ? 1 : 0) - (mineIds.has(a.id) ? 1 : 0));
  }, [query, category, inferredState, mineIds]);

  const searching = query.trim().length > 0;
  const visible = showAll || searching ? ranked : ranked.slice(0, LIMIT);

  const payBill = (bill: Bill) => {
    if (bill.payable) {
      onOpenChange(false);
      openPay(bill.id);
      return;
    }
    const p = matchPortal(bill.payee || bill.name);
    if (p) setActive(p);
    else { setCategory('all'); setQuery(bill.payee || bill.name); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[460px]">
        <div className="flex max-h-[86vh] flex-col">
          <div className="px-5 pt-5">
            <div className="text-base font-semibold text-foreground">Pay a bill</div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-4">
            {/* equity credits + streak */}
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
                  <TrendingUp className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <div className="font-display text-xl leading-none tabular-nums text-foreground">
                    {(summary?.totalEquity ?? 0).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Equity credits{summary?.pendingEquity ? ` · ${summary.pendingEquity.toLocaleString()} vesting` : ''}
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground">
                <Flame className="h-3.5 w-3.5 text-amber-500" /> {streak} mo
              </span>
            </div>

            {/* your bills */}
            {bills.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-foreground">Your bills</h3>
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="divide-y divide-border">
                    {bills.map((b) => {
                      const credits = creditsFor(b, streak, b.amount, accelerated);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => payBill(b)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                            <b.icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{b.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {b.amount > 0 ? fmt(b.amount) : 'Amount varies'}
                              {b.dueLabel ? ` · due ${b.dueLabel}` : ''}
                              {b.source === 'plaid' ? ' · detected' : ''}
                            </span>
                          </span>
                          {credits > 0 && (
                            <span className="shrink-0 rounded-md bg-positive/10 px-2 py-0.5 text-[11px] font-semibold text-positive">
                              +{credits.toLocaleString()}
                            </span>
                          )}
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* providers */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">{bills.length > 0 ? 'Find another provider' : 'Pay a provider'}</h3>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setShowAll(false); }}
                  placeholder="Search providers"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                />
              </div>

              <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <Chip active={category === 'all'} onClick={() => setCategory('all')}>All</Chip>
                {PORTAL_CATEGORIES.map((c) => (
                  <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</Chip>
                ))}
              </div>

              <div className="mt-2.5 overflow-hidden rounded-xl border border-border">
                <div className="divide-y divide-border">
                  {visible.map((p) => {
                    const Icon = CAT_ICON[p.category];
                    const mine = mineIds.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setActive(p)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                      >
                        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', CAT_TINT[p.category])}>
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{p.hint}</span>
                        </span>
                        {mine && (
                          <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Yours</span>
                        )}
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                  {visible.length === 0 && (
                    <div className="py-10 text-center text-sm text-muted-foreground">No providers match.</div>
                  )}
                </div>
              </div>

              {!searching && !showAll && ranked.length > LIMIT && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-2 w-full rounded-lg py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  See all {ranked.length} providers
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      <BillPortalBrowser portal={active} onClose={() => setActive(null)} />
    </Dialog>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
