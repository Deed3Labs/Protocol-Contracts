import { useMemo, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { usePay, BILL_TYPES, type BillType } from '@/context/PayContext';
import { BILL_PORTALS, rankPortals, matchPortal, type BillPortal, type PortalCategory } from '@/data/billPortals';
import { cn } from '@/lib/utils';

/*
 * Adding a bill, inline in the detail pane — not a modal.
 *
 * The pane is empty until you select something, so it's the natural home for this: no dialog stacked
 * over the page, and the list stays visible beside you while you type. Kept deliberately short — name,
 * amount and when it's due are the only required things; everything else is optional and folded away.
 */
const inputCls =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';

const CAT_TO_TYPE: Record<PortalCategory, BillType> = { electric: 'utility', utilities: 'utility', rent: 'rent', telecom: 'phone' };
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

type Draft = { name: string; payee: string; type: BillType; amount: string; dueDay: string; portalUrl: string; address: string };
const empty: Draft = { name: '', payee: '', type: 'other', amount: '', dueDay: '', portalUrl: '', address: '' };

export default function BillAddForm({ onDone }: { onDone: (createdId?: string) => void }) {
  const { bills, addBiller } = usePay();
  const [draft, setDraft] = useState<Draft>(empty);
  const [query, setQuery] = useState('');
  const [more, setMore] = useState(false);

  const inferredState = useMemo(() => {
    for (const b of bills) { const p = matchPortal(b.payee || b.name); if (p?.states?.length === 1) return p.states[0]; }
    return undefined;
  }, [bills]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return rankPortals(BILL_PORTALS.filter((p) => `${p.name} ${p.hint ?? ''}`.toLowerCase().includes(q)), inferredState).slice(0, 5);
  }, [query, inferredState]);

  const pick = (p: BillPortal) => {
    setDraft((d) => ({ ...d, name: p.name, payee: p.name, type: CAT_TO_TYPE[p.category], portalUrl: p.url }));
    setQuery('');
  };

  const valid = draft.name.trim().length > 0 && Number(draft.amount) > 0;

  const save = () => {
    if (!valid) return;
    const day = draft.dueDay ? Math.min(Math.max(parseInt(draft.dueDay, 10) || 0, 1), 31) : null;
    const id = addBiller({
      name: draft.name.trim(),
      payee: draft.payee.trim() || draft.name.trim(),
      type: draft.type,
      amount: Number(draft.amount) || 0,
      dueLabel: day ? `Due on the ${ordinal(day)}` : 'Due soon',
      dueDay: day,
      portalUrl: draft.portalUrl.trim() || null,
      address: draft.address.trim() || null,
    });
    onDone(id);
  };

  return (
    <div className="flex h-full flex-col p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-base font-semibold tracking-tight text-foreground">Add a bill</span>
        <button
          type="button"
          onClick={() => onDone()}
          aria-label="Cancel"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find your provider"
              className={cn(inputCls, 'pl-9')}
            />
          </div>
          {results.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-secondary"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.name}</span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Bill name"
          className={inputCls}
        />

        <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value.replace(/[^0-9.]/g, '') }))}
              placeholder="Amount"
              className={cn(inputCls, 'pl-7 tabular-nums')}
            />
          </div>
          <input
            inputMode="numeric"
            value={draft.dueDay}
            onChange={(e) => setDraft((d) => ({ ...d, dueDay: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))}
            placeholder="Due day (1–31)"
            className={cn(inputCls, 'tabular-nums')}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {BILL_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, type: t.value }))}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                draft.type === t.value
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-muted-foreground hover:bg-secondary',
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <input
          value={draft.portalUrl}
          onChange={(e) => setDraft((d) => ({ ...d, portalUrl: e.target.value }))}
          placeholder="Payment link (optional)"
          className={inputCls}
        />

        {more ? (
          <div className="space-y-2">
            <input
              value={draft.payee}
              onChange={(e) => setDraft((d) => ({ ...d, payee: e.target.value }))}
              placeholder="Account or payee"
              className={inputCls}
            />
            <input
              value={draft.address}
              onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
              placeholder="Mailing address"
              className={inputCls}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMore(true)}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            More details
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={save}
        disabled={!valid}
        className="mt-4 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
      >
        Add bill
      </button>
    </div>
  );
}
