import { useMemo, useState } from 'react';
import { Search, ArrowUpRight, TrendingUp, Flame, Zap, Droplet, Home, Smartphone, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import BillPortalBrowser from '@/components/app-ui/BillPortalBrowser';
import BillDetailModal from '@/components/app-ui/BillDetailModal';
import { usePay, creditsFor, type Bill } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { BILL_PORTALS, PORTAL_CATEGORIES, rankPortals, matchPortal, type BillPortal, type PortalCategory } from '@/data/billPortals';

/*
 * "Pay a bill" — bills-first, card/grid layout matching the app's ActionTile system. Opens to the
 * member's own billers (manual + Plaid) as tiles with the equity credits each earns, then a short grid
 * of smart provider tiles (top matches for their billers + inferred state) with search to find more.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const LIMIT = 6; // 2×3 grid

const CAT_ICON: Record<PortalCategory, LucideIcon> = { electric: Zap, utilities: Droplet, rent: Home, telecom: Smartphone };
const CAT_TINT: Record<PortalCategory, string> = {
  electric: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  utilities: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  rent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  telecom: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
};

const TILE =
  'group relative flex min-h-[104px] flex-col justify-between overflow-hidden rounded-lg border border-border bg-card p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_10px_24px_-14px_rgba(0,0,0,0.3)] active:translate-y-0 active:scale-[0.99]';

export default function BillPortalsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { bills, summary, streak } = usePay();
  const { accelerated } = useMemberProfile();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PortalCategory | 'all'>('all');
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState<BillPortal | null>(null);
  const [activeBill, setActiveBill] = useState<Bill | null>(null);

  const inferredState = useMemo(() => {
    for (const b of bills) {
      const p = matchPortal(b.payee || b.name);
      if (p?.states?.length === 1) return p.states[0];
    }
    return undefined;
  }, [bills]);

  const mineIds = useMemo(() => new Set(bills.map((b) => matchPortal(b.payee || b.name)?.id).filter(Boolean)), [bills]);

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = BILL_PORTALS.filter(
      (p) => (category === 'all' || p.category === category) && (!q || `${p.name} ${p.hint ?? ''}`.toLowerCase().includes(q)),
    );
    return rankPortals(filtered, inferredState).sort((a, b) => (mineIds.has(b.id) ? 1 : 0) - (mineIds.has(a.id) ? 1 : 0));
  }, [query, category, inferredState, mineIds]);

  const searching = query.trim().length > 0;
  const visible = showAll || searching ? ranked : ranked.slice(0, LIMIT);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[480px]">
        <div className="flex max-h-[86vh] flex-col">
          <div className="px-5 pt-5">
            <div className="text-base font-semibold text-foreground">Pay a bill</div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-4">
            {/* equity credits + streak */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
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
                <h3 className="mb-3 text-xs font-medium text-muted-foreground">Your bills</h3>
                <div className="grid grid-cols-2 gap-3">
                  {bills.map((b) => {
                    const credits = creditsFor(b, streak, b.amount, accelerated);
                    return (
                      <button key={b.id} type="button" onClick={() => setActiveBill(b)} className={TILE}>
                        <div className="flex items-center justify-between">
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
                            <b.icon className="h-[18px] w-[18px]" />
                          </span>
                          {credits > 0 && (
                            <span className="rounded-md bg-positive/10 px-2 py-0.5 text-[11px] font-semibold text-positive">+{credits.toLocaleString()}</span>
                          )}
                        </div>
                        <div>
                          <div className="truncate text-sm font-medium text-foreground">{b.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {b.amount > 0 ? fmt(b.amount) : 'Amount varies'}
                            {b.dueLabel ? ` · ${b.dueLabel}` : ''}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* providers */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setShowAll(false); }}
                    placeholder="Search providers"
                    className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                  />
                </div>
              </div>

              <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <Chip active={category === 'all'} onClick={() => setCategory('all')}>All</Chip>
                {PORTAL_CATEGORIES.map((c) => (
                  <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</Chip>
                ))}
              </div>

              {visible.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {visible.map((p) => {
                    const Icon = CAT_ICON[p.category];
                    const mine = mineIds.has(p.id);
                    return (
                      <button key={p.id} type="button" onClick={() => setActive(p)} className={TILE}>
                        <div className="flex items-center justify-between">
                          <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg', CAT_TINT[p.category])}>
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                        </div>
                        <div>
                          <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{mine ? 'Your provider' : p.hint}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-border py-10 text-center text-sm text-muted-foreground">No providers match.</div>
              )}

              {!searching && !showAll && ranked.length > LIMIT && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-3 w-full rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  See all {ranked.length} providers
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      <BillPortalBrowser portal={active} onClose={() => setActive(null)} />
      <BillDetailModal bill={activeBill} onClose={() => setActiveBill(null)} />
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
