import { useMemo, useState } from 'react';
import { Search, Plus, X, Sparkles } from 'lucide-react';
import { usePay, creditsFor, BILL_TYPES, type BillType } from '@/context/PayContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { CATEGORY_TINT } from '@/components/app-ui/pay/categoryStyle';
import { BILL_PORTALS, rankPortals, matchPortal, type BillPortal, type PortalCategory } from '@/data/billPortals';
import { cn } from '@/lib/utils';

/*
 * Adding a bill, inline in the detail pane — not a modal.
 *
 * The pane is empty until you select something, so it's the natural home: no dialog stacked over the
 * page, the list stays visible beside you. Fields are labelled and grouped, provider results carry
 * the same category colour as the rest of the page, and a live line shows what the bill will earn —
 * so the value prop is present at the moment of creation, not just afterwards.
 */
const inputCls =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';

const CAT_TO_TYPE: Record<PortalCategory, BillType> = { electric: 'utility', utilities: 'utility', rent: 'rent', telecom: 'phone' };
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const iconFor = (t: BillType) => BILL_TYPES.find((x) => x.value === t)?.icon ?? BILL_TYPES[0].icon;

type Draft = { name: string; payee: string; type: BillType; amount: string; dueDay: string; portalUrl: string; address: string };
const empty: Draft = { name: '', payee: '', type: 'other', amount: '', dueDay: '', portalUrl: '', address: '' };

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
        {label}
        {hint && <span className="font-normal text-muted-foreground/70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export default function BillAddForm({ onDone }: { onDone: (createdId?: string) => void }) {
  const { bills, addBiller, streak } = usePay();
  const { accelerated } = useMemberProfile();
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

  const amountNum = Number(draft.amount) || 0;
  const valid = draft.name.trim().length > 0 && amountNum > 0;
  const earns = valid ? creditsFor({ type: draft.type, amount: amountNum }, streak, amountNum, accelerated) : 0;

  const save = () => {
    if (!valid) return;
    const day = draft.dueDay ? Math.min(Math.max(parseInt(draft.dueDay, 10) || 0, 1), 31) : null;
    const id = addBiller({
      name: draft.name.trim(),
      payee: draft.payee.trim() || draft.name.trim(),
      type: draft.type,
      amount: amountNum,
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

      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
        <Field label="Find your provider" hint="optional">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 100+ billers" className={cn(inputCls, 'pl-9')} />
          </div>
          {results.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {results.map((p) => {
                const t = CAT_TO_TYPE[p.category];
                const Icon = iconFor(t);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-secondary"
                  >
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', CATEGORY_TINT[t])}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                      {p.hint && <span className="block truncate text-[11px] text-muted-foreground">{p.hint}</span>}
                    </span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </Field>

        <Field label="Bill name">
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Rent — Oakwood" className={inputCls} />
        </Field>

        <Field label="Category">
          <div className="flex flex-wrap gap-1.5">
            {BILL_TYPES.map((t) => {
              const active = draft.type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, type: t.value }))}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    active ? CATEGORY_TINT[t.value] : 'text-muted-foreground hover:bg-secondary',
                    active && 'ring-1 ring-inset ring-current',
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value.replace(/[^0-9.]/g, '') }))}
                placeholder="0"
                className={cn(inputCls, 'pl-7 tabular-nums')}
              />
            </div>
          </Field>
          <Field label="Due day" hint="1–31">
            <input
              inputMode="numeric"
              value={draft.dueDay}
              onChange={(e) => setDraft((d) => ({ ...d, dueDay: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))}
              placeholder="e.g. 1"
              className={cn(inputCls, 'tabular-nums')}
            />
          </Field>
        </div>

        <Field label="Payment link" hint="optional">
          <input value={draft.portalUrl} onChange={(e) => setDraft((d) => ({ ...d, portalUrl: e.target.value }))} placeholder="pge.com/login" className={inputCls} />
        </Field>

        {more ? (
          <div className="space-y-3 border-t border-border pt-3">
            <Field label="Account or payee" hint="optional">
              <input value={draft.payee} onChange={(e) => setDraft((d) => ({ ...d, payee: e.target.value }))} placeholder="City Utilities" className={inputCls} />
            </Field>
            <Field label="Mailing address" hint="optional">
              <input value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} placeholder="123 Main St, City, ST" className={inputCls} />
            </Field>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMore(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> More details
          </button>
        )}
      </div>

      <div className="mt-4 shrink-0">
        {earns > 0 && (
          <p className="mb-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-positive" />
            Earns <span className="font-medium text-positive">+{earns.toLocaleString('en-US')} credits</span> each time you pay on time
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!valid}
          className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
        >
          Add bill
        </button>
      </div>
    </div>
  );
}
