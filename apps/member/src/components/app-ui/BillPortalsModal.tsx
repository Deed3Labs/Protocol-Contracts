import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronLeft, Plus, Landmark, Trash2, Zap, Droplet, Home, Smartphone, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import BillDetailModal from '@/components/app-ui/BillDetailModal';
import { usePay, BILL_TYPES, type Bill, type BillType } from '@/context/PayContext';
import { BILL_PORTALS, rankPortals, matchPortal, type BillPortal, type PortalCategory } from '@/data/billPortals';

/*
 * "Pay a bill" — a manager for the member's bills (manual + Plaid-detected). The main view is just their
 * bills + "Add a biller"; the provider directory lives ONLY in the add flow (search a provider to autofill
 * name/type/payment link, or enter manually). Tap a bill → its detail drawer; a provider row → the portal.
 */
const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inputCls = 'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';

const CAT_ICON: Record<PortalCategory, LucideIcon> = { electric: Zap, utilities: Droplet, rent: Home, telecom: Smartphone };
const CAT_TINT: Record<PortalCategory, string> = {
  electric: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  utilities: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  rent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  telecom: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
};
const CAT_TO_TYPE: Record<PortalCategory, BillType> = { electric: 'utility', utilities: 'utility', rent: 'rent', telecom: 'phone' };
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

type Draft = { name: string; payee: string; type: BillType; amount: string; dueDay: string; portalUrl: string; address: string };
const emptyDraft: Draft = { name: '', payee: '', type: 'other', amount: '', dueDay: '', portalUrl: '', address: '' };

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-negative">*</span>}
      </span>
      {children}
    </label>
  );
}

export default function BillPortalsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { bills, addBiller, openPay, removeBiller } = usePay();
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [query, setQuery] = useState('');
  const [pQuery, setPQuery] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [activeBill, setActiveBill] = useState<Bill | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('list'); setQuery(''); setPQuery(''); setDraft(emptyDraft);
  }, [open]);

  const inferredState = useMemo(() => {
    for (const b of bills) { const p = matchPortal(b.payee || b.name); if (p?.states?.length === 1) return p.states[0]; }
    return undefined;
  }, [bills]);

  const filteredBills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bills.filter((b) => !q || `${b.name} ${b.payee ?? ''}`.toLowerCase().includes(q));
  }, [bills, query]);

  const providerResults = useMemo(() => {
    const q = pQuery.trim().toLowerCase();
    const filtered = BILL_PORTALS.filter((p) => `${p.name} ${p.hint ?? ''}`.toLowerCase().includes(q));
    return rankPortals(filtered, inferredState).slice(0, 8);
  }, [pQuery, inferredState]);

  const pickProvider = (p: BillPortal) => { setDraft((d) => ({ ...d, name: p.name, payee: p.name, type: CAT_TO_TYPE[p.category], portalUrl: p.url })); setPQuery(''); };

  const save = () => {
    if (!draft.name.trim()) return;
    const day = draft.dueDay ? Math.min(Math.max(parseInt(draft.dueDay, 10) || 0, 1), 31) : null;
    addBiller({
      name: draft.name.trim(),
      payee: draft.payee.trim() || draft.name.trim(),
      type: draft.type,
      amount: Number(draft.amount) || 0,
      dueLabel: day ? `Due on the ${ordinal(day)}` : 'Due soon',
      dueDay: day,
      portalUrl: draft.portalUrl.trim() || null,
      address: draft.address.trim() || null,
    });
    setMode('list'); setDraft(emptyDraft);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[440px]">
        <div className="flex max-h-[86vh] flex-col">
          {mode === 'list' ? (
            <>
              <div className="px-5 pt-5">
                <div className="text-base font-semibold text-foreground">Pay a bill</div>
                {bills.length > 0 && (
                  <div className="relative mt-3">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your bills" className={cn(inputCls, 'pl-9')} />
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
                {filteredBills.length > 0 ? (
                  <div className="space-y-1.5">
                    {filteredBills.map((b) => (
                      <div key={b.id} className="group flex items-center gap-1 rounded-xl border border-border pr-1.5 transition-colors hover:bg-secondary/40">
                        <button type="button" onClick={() => setActiveBill(b)} className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-left">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground"><b.icon className="h-[18px] w-[18px]" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-foreground">{b.name}</span>
                              {b.source === 'plaid' && <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Auto</span>}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{b.amount > 0 ? fmt(b.amount) : 'Amount varies'}{b.dueLabel ? ` · ${b.dueLabel}` : ''}</span>
                          </span>
                        </button>
                        <button type="button" onClick={() => { onOpenChange(false); openPay(b.id); }} aria-label={`Pay ${b.name}`} className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"><Landmark className="h-4 w-4" /></button>
                        <button type="button" onClick={() => removeBiller(b.id)} aria-label={`Delete ${b.name}`} className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-negative"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <div className="text-sm font-medium text-foreground">{query ? 'No bills match.' : 'No bills yet'}</div>
                    {!query && <div className="mt-1 text-xs text-muted-foreground">Add your rent, utilities, and subscriptions to pay and earn equity.</div>}
                  </div>
                )}
              </div>

              <div className="border-t border-border px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button type="button" onClick={() => setMode('add')} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]">
                  <Plus className="h-4 w-4" /> Add a biller
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 px-3 py-2.5">
                <button type="button" onClick={() => setMode('list')} className="inline-flex items-center gap-1 rounded-lg py-1.5 pl-1.5 pr-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <span className="text-base font-semibold text-foreground">Add a biller</span>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-2">
                <div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input value={pQuery} onChange={(e) => setPQuery(e.target.value)} placeholder="Find your provider (optional)" className={cn(inputCls, 'pl-9')} />
                  </div>
                  {pQuery.trim() && (
                    <div className="mt-2 space-y-1.5">
                      {providerResults.map((p) => (
                        <button key={p.id} type="button" onClick={() => pickProvider(p)} className="flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-left transition-colors hover:bg-secondary/50">
                          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', CAT_TINT[p.category])}>{(() => { const I = CAT_ICON[p.category]; return <I className="h-[18px] w-[18px]" />; })()}</span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.hint}</span></span>
                          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                      {providerResults.length === 0 && <div className="py-3 text-center text-xs text-muted-foreground">No match — enter the details below.</div>}
                    </div>
                  )}
                </div>

                <div className="space-y-3.5">
                  <Field label="Biller name" required><input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Water — City Utilities" className={inputCls} /></Field>
                  <Field label="Account / payee"><input value={draft.payee} onChange={(e) => setDraft((d) => ({ ...d, payee: e.target.value }))} placeholder="City Utilities" className={inputCls} /></Field>
                  <Field label="Type">
                    <div className="grid grid-cols-3 gap-2">
                      {BILL_TYPES.map((t) => {
                        const Icon = t.icon;
                        const active = draft.type === t.value;
                        return (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() => setDraft((d) => ({ ...d, type: t.value }))}
                            className={cn(
                              'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-[11px] font-medium transition-colors',
                              active ? 'border-foreground bg-secondary/60 text-foreground' : 'border-border text-muted-foreground hover:bg-secondary/40',
                            )}
                          >
                            <Icon className="h-4 w-4" />
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount" required>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                        <input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder="0" className={cn(inputCls, 'pl-7 tabular-nums')} />
                      </div>
                    </Field>
                    <Field label="Due day of month"><input inputMode="numeric" value={draft.dueDay} onChange={(e) => setDraft((d) => ({ ...d, dueDay: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))} placeholder="1–31" className={cn(inputCls, 'tabular-nums')} /></Field>
                  </div>
                  <Field label="Biller portal"><input value={draft.portalUrl} onChange={(e) => setDraft((d) => ({ ...d, portalUrl: e.target.value }))} placeholder="pge.com/login — pay on their site" className={inputCls} /></Field>
                  <Field label="Mailing address"><input value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} placeholder="Optional" className={inputCls} /></Field>
                </div>
              </div>

              <div className="border-t border-border px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button type="button" onClick={save} disabled={!draft.name.trim() || !(Number(draft.amount) > 0)} className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40">
                  Add biller
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>

      <BillDetailModal bill={activeBill} onClose={() => setActiveBill(null)} />
    </Dialog>
  );
}
