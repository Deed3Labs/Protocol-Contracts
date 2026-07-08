import { useMemo, useState } from 'react';
import { Search, ChevronRight, Zap, Droplet, Home, Smartphone, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import BillPortalBrowser from '@/components/app-ui/BillPortalBrowser';
import BillDetailModal from '@/components/app-ui/BillDetailModal';
import { usePay, type Bill } from '@/context/PayContext';
import { BILL_PORTALS, rankPortals, matchPortal, type BillPortal, type PortalCategory } from '@/data/billPortals';

/*
 * "Pay a bill" — sleek search-over-rows, matching the app's other modals (Send etc.). Your bills up top,
 * a short "add a biller" provider list below (search to find more). No banner/grid/chips. Tap a bill →
 * its detail drawer; tap a provider → the in-app portal.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PREVIEW = 4;

const CAT_ICON: Record<PortalCategory, LucideIcon> = { electric: Zap, utilities: Droplet, rent: Home, telecom: Smartphone };
const CAT_TINT: Record<PortalCategory, string> = {
  electric: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  utilities: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  rent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  telecom: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
};

function Row({ icon: Icon, tint, name, sub, onClick }: { icon: LucideIcon; tint: string; name: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-left transition-colors hover:bg-secondary/50">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tint)}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export default function BillPortalsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { bills } = usePay();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState<BillPortal | null>(null);
  const [activeBill, setActiveBill] = useState<Bill | null>(null);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const inferredState = useMemo(() => {
    for (const b of bills) {
      const p = matchPortal(b.payee || b.name);
      if (p?.states?.length === 1) return p.states[0];
    }
    return undefined;
  }, [bills]);
  const mineIds = useMemo(() => new Set(bills.map((b) => matchPortal(b.payee || b.name)?.id).filter(Boolean)), [bills]);

  const filteredBills = useMemo(() => bills.filter((b) => !q || `${b.name} ${b.payee ?? ''}`.toLowerCase().includes(q)), [bills, q]);
  const rankedProviders = useMemo(() => {
    const filtered = BILL_PORTALS.filter((p) => !q || `${p.name} ${p.hint ?? ''}`.toLowerCase().includes(q));
    return rankPortals(filtered, inferredState).sort((a, b) => (mineIds.has(b.id) ? 1 : 0) - (mineIds.has(a.id) ? 1 : 0));
  }, [q, inferredState, mineIds]);
  const visibleProviders = showAll || searching ? rankedProviders : rankedProviders.slice(0, PREVIEW);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[440px]">
        <div className="flex max-h-[86vh] flex-col">
          <div className="px-5 pt-5">
            <div className="text-base font-semibold text-foreground">Pay a bill</div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowAll(false); }}
                placeholder="Search bills or providers"
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
            {filteredBills.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">Your bills</h3>
                <div className="space-y-1.5">
                  {filteredBills.map((b) => (
                    <Row
                      key={b.id}
                      icon={b.icon}
                      tint="bg-secondary text-foreground"
                      name={b.name}
                      sub={`${b.amount > 0 ? fmt(b.amount) : 'Amount varies'}${b.dueLabel ? ` · ${b.dueLabel}` : ''}`}
                      onClick={() => setActiveBill(b)}
                    />
                  ))}
                </div>
              </div>
            )}

            {visibleProviders.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">{searching ? 'Providers' : 'Add a biller'}</h3>
                <div className="space-y-1.5">
                  {visibleProviders.map((p) => (
                    <Row
                      key={p.id}
                      icon={CAT_ICON[p.category]}
                      tint={CAT_TINT[p.category]}
                      name={p.name}
                      sub={mineIds.has(p.id) ? 'Your provider' : p.hint ?? ''}
                      onClick={() => setActive(p)}
                    />
                  ))}
                </div>
                {!searching && !showAll && rankedProviders.length > PREVIEW && (
                  <button type="button" onClick={() => setShowAll(true)} className="mt-2 w-full py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                    Show all {rankedProviders.length} providers
                  </button>
                )}
              </div>
            )}

            {searching && filteredBills.length === 0 && visibleProviders.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">No matches.</div>
            )}
          </div>
        </div>
      </DialogContent>

      <BillPortalBrowser portal={active} onClose={() => setActive(null)} />
      <BillDetailModal bill={activeBill} onClose={() => setActiveBill(null)} />
    </Dialog>
  );
}
