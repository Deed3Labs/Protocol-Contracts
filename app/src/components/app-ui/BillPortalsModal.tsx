import { useMemo, useState } from 'react';
import { Search, ChevronRight, Info, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import BillPortalBrowser from '@/components/app-ui/BillPortalBrowser';
import {
  BILL_PORTALS,
  PORTAL_CATEGORIES,
  US_STATES,
  rankPortals,
  type BillPortal,
  type PortalCategory,
} from '@/data/billPortals';

/*
 * "Pay a bill" via the biller's own portal, using the member's Clear card (Bridge / Stripe Issuing,
 * funded just-in-time from their Base USDC). The web app can't autofill a third-party site (cross-origin),
 * so the flow is: reveal + copy the Clear card, open the provider's portal in a new tab, paste to pay.
 *
 * P1 (this): directory + card wallet panel scaffold. P2 drops the PCI-compliant Stripe Issuing Element
 * into <CardPanel/> so the real PAN/CVV render + copy; the card status comes from the Bridge cardholder.
 */
export default function BillPortalsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PortalCategory | 'all'>('all');
  const [state, setState] = useState<string>('');
  const [active, setActive] = useState<BillPortal | null>(null);

  const portals = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = BILL_PORTALS.filter(
      (p) =>
        (category === 'all' || p.category === category) &&
        (!q || `${p.name} ${p.hint ?? ''}`.toLowerCase().includes(q)),
    );
    return rankPortals(filtered, state || undefined);
  }, [query, category, state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <div className="flex max-h-[86vh] flex-col">
          {/* header */}
          <div className="px-5 pt-5">
            <div className="text-base font-semibold text-foreground">Pay a bill</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Open your provider and pay with your Clear card — funded from your Cash balance.
            </p>
          </div>

          {/* controls */}
          <div className="space-y-2.5 px-5 pb-3 pt-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search providers"
                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-1 overflow-x-auto">
                <Chip active={category === 'all'} onClick={() => setCategory('all')}>All</Chip>
                {PORTAL_CATEGORIES.map((c) => (
                  <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
                    {c.emoji} {c.label}
                  </Chip>
                ))}
              </div>
              <div className="relative shrink-0">
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="appearance-none rounded-full border border-border bg-background py-1.5 pl-3 pr-7 text-xs font-medium text-foreground focus:border-foreground/30 focus:outline-none"
                  aria-label="Filter by state"
                >
                  <option value="">All states</option>
                  {US_STATES.map((s) => (
                    <option key={s.code} value={s.code}>{s.code}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
          </div>

          {/* portal list */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <div className="space-y-1.5">
              {portals.map((p) => {
                const cat = PORTAL_CATEGORIES.find((c) => c.id === p.category);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActive(p)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-left transition-colors hover:bg-secondary/50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-base">
                      {cat?.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.hint}
                        {p.states && state && p.states.includes(state) ? ' · in your area' : ''}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
              {portals.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No providers match. Try a different category or search.
                </div>
              )}
            </div>

            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Don't see your biller? You can still add it manually and pay by bank transfer from “Pay a bill”.
            </p>
          </div>
        </div>
      </DialogContent>

      {/* In-app browser sheet for the selected biller (opens over the directory) */}
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
        'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors',
        active ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-secondary',
      )}
    >
      {children}
    </button>
  );
}
