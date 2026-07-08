import { useMemo, useState } from 'react';
import { Search, ChevronRight, Info, ChevronDown, TrendingUp, Flame } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import BillPortalBrowser from '@/components/app-ui/BillPortalBrowser';
import { usePay, creditsFor, type Bill } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import {
  BILL_PORTALS,
  PORTAL_CATEGORIES,
  US_STATES,
  rankPortals,
  matchPortal,
  type BillPortal,
  type PortalCategory,
} from '@/data/billPortals';

/*
 * "Pay a bill" — bills-first. Opens to the member's own billers (manual + Plaid-detected) with the
 * equity credits each earns, a gamification banner (credits + streak), and a smart provider directory
 * below that bubbles the user's matched billers + their inferred state. Paying routes to the ACH flow
 * for billers with payout details, else the in-app portal browser (pay on the biller's site with the
 * Clear card). See PayContext (bills/summary/creditsFor) + BillPortalBrowser.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BillPortalsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { bills, summary, openPay, streak } = usePay();
  const { accelerated } = useMemberProfile();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PortalCategory | 'all'>('all');
  const [state, setState] = useState('');
  const [active, setActive] = useState<BillPortal | null>(null);

  // Infer the user's state from a state-specific biller they already have (e.g. a PG&E bill → CA).
  const inferredState = useMemo(() => {
    for (const b of bills) {
      const p = matchPortal(b.payee || b.name);
      if (p?.states?.length === 1) return p.states[0];
    }
    return '';
  }, [bills]);
  const effState = state || inferredState;

  const portals = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = BILL_PORTALS.filter(
      (p) => (category === 'all' || p.category === category) && (!q || `${p.name} ${p.hint ?? ''}`.toLowerCase().includes(q)),
    );
    const mine = new Set(bills.map((b) => matchPortal(b.payee || b.name)?.id).filter(Boolean));
    // Bubble the user's own providers first, then in-state, then the rest.
    return rankPortals(filtered, effState || undefined).sort((a, b) => (mine.has(b.id) ? 1 : 0) - (mine.has(a.id) ? 1 : 0));
  }, [query, category, effState, bills]);

  const payBill = (bill: Bill) => {
    if (bill.payable) {
      onOpenChange(false); // ACH direct-pay flow (biller has payout details on file)
      openPay(bill.id);
      return;
    }
    const p = matchPortal(bill.payee || bill.name);
    if (p) {
      setActive(p); // pay on the biller's own portal with the Clear card
      return;
    }
    setCategory('all'); // no match → drop them into the directory pre-filtered to this biller
    setQuery(bill.payee || bill.name);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <div className="flex max-h-[86vh] flex-col">
          {/* header */}
          <div className="px-5 pt-5">
            <div className="text-base font-semibold text-foreground">Pay a bill</div>
          </div>

          {/* gamification banner */}
          <div className="px-5 pt-3">
            <div className="flex items-center justify-between rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/50 p-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-background">
                  <TrendingUp className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <div className="font-display text-xl leading-none tabular-nums text-foreground">
                    {(summary?.totalEquity ?? 0).toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Equity credits{summary?.pendingEquity ? ` · ${summary.pendingEquity.toLocaleString()} vesting` : ''}
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs font-medium text-foreground">
                <Flame className="h-3.5 w-3.5 text-amber-500" /> {streak} mo
              </span>
            </div>
          </div>

          {/* scroll body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
            {/* Your bills */}
            {bills.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">Your bills</h3>
                <div className="space-y-1.5">
                  {bills.map((b) => {
                    const credits = creditsFor(b, streak, b.amount, accelerated);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => payBill(b)}
                        className="flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-left transition-colors hover:bg-secondary/50"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
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
                          <span className="shrink-0 rounded-full bg-positive/10 px-2 py-0.5 text-[11px] font-semibold text-positive">
                            +{credits.toLocaleString()}
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Find a provider (directory) */}
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                {bills.length > 0 ? 'Find another provider' : 'Find your provider'}
              </h3>
              <div className="space-y-2.5">
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
                      value={effState}
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

              <div className="mt-2.5 space-y-1.5">
                {portals.map((p) => {
                  const cat = PORTAL_CATEGORIES.find((c) => c.id === p.category);
                  const mine = bills.some((b) => matchPortal(b.payee || b.name)?.id === p.id);
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
                          {mine ? ' · your provider' : p.states && effState && p.states.includes(effState) ? ' · in your area' : ''}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
                {portals.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">No providers match. Try a different category or search.</div>
                )}
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Don't see your biller? Add it manually and pay by bank transfer from the bill timeline.
              </p>
            </section>
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
