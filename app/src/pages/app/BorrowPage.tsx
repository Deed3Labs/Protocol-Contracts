import { useState } from 'react';
import { TrendingUp, RefreshCw, Wallet, ArrowUpRight, Minus, Plus, ShieldCheck, Sparkles, ArrowRight, Trash2, X } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import { useCredit, type CreditProduct, type PurposeLine } from '@/context/CreditContext';
import { cn } from '@/lib/utils';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmt2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Borrow — consolidated borrowing power, the base Stable Credit line, and Clear credit products. */
export default function BorrowPage() {
  const { baseLimit, borrowed, available, totalPower, cycleDaysLeft, cycleLength, powerPct, products, lines, addPurposeLine, removePurposeLine, openBorrow, openRepay } = useCredit();
  const cycleProgress = ((cycleLength - cycleDaysLeft) / cycleLength) * 100;
  const usedLines = lines.filter((l) => l.used > 0);
  const shade = ['bg-foreground', 'bg-foreground/60', 'bg-foreground/35', 'bg-foreground/20'];

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const submitLine = () => {
    const lim = Number(newLimit) || 0;
    if (!newName.trim() || lim <= 0) return;
    addPurposeLine(newName.trim(), lim);
    setNewName('');
    setNewLimit('');
    setAddOpen(false);
  };

  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Borrow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Borrow against your savings — no interest, no fixed due dates. Your limit grows as your savings grow.
        </p>
      </header>

      <StatBar
        stats={[
          { label: 'Total borrowing power', value: fmt(totalPower), icon: TrendingUp },
          { label: 'Available now', value: fmt(available), icon: Wallet },
          { label: 'Currently borrowed', value: fmt(borrowed), icon: ArrowUpRight },
          { label: 'Credit cycle', value: `${cycleDaysLeft} days left`, icon: RefreshCw },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* base Stable Credit line */}
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Your credit line</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">Backed by savings</span>
          </div>

          <div className="mt-2 flex items-end justify-between gap-4">
            <div>
              <div className="font-display text-4xl tracking-tight text-foreground tabular-nums">{fmt2(available)}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">available of {fmt2(baseLimit)} limit</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-foreground tabular-nums">{fmt2(borrowed)}</div>
              <div className="text-[11px] text-muted-foreground">borrowed</div>
            </div>
          </div>

          {/* utilization — broken down by line */}
          <div className="mt-3 flex h-6 gap-0.5 overflow-hidden rounded-lg bg-secondary">
            {usedLines.map((l, i) => (
              <div key={l.id} className={shade[i % shade.length]} style={{ width: `${(l.used / baseLimit) * 100}%` }} />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[10px]">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
              {usedLines.length > 0 ? (
                usedLines.map((l) => (
                  <span key={l.id} className="whitespace-nowrap">
                    <span className="font-medium text-muted-foreground">{l.name}</span>{' '}
                    <span className="tabular-nums text-foreground">{fmt(l.used)}</span>
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">Nothing borrowed yet</span>
              )}
            </div>
            <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{fmt(available)} left</span>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => openBorrow()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" /> Borrow
            </button>
            <button
              type="button"
              onClick={() => openRepay()}
              disabled={borrowed <= 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
            >
              <Minus className="h-4 w-4" /> Repay
            </button>
          </div>

          {/* credit cycle / power */}
          <div className="mt-4 rounded-xl border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <RefreshCw className="h-3.5 w-3.5 text-info" /> Borrowing power {powerPct}%
              </span>
              <span className="text-muted-foreground">{cycleDaysLeft} days left in cycle</span>
            </div>
            <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-background">
              <div className="h-full rounded-full bg-info" style={{ width: `${cycleProgress}%` }} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              No fixed due date. Balance back to $0 within the cycle to keep full power — repay anytime from your balance or savings.
            </p>
          </div>

          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-positive" /> Add to savings to raise your limit 1:1.
          </div>
        </div>

        {/* how it works */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">How Clear credit works</h3>
          <ul className="mt-3 space-y-3 text-xs leading-relaxed text-muted-foreground">
            <li className="flex gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
              <span><span className="font-medium text-foreground">No interest, ever.</span> A small flat fee per draw — never compounding interest.</span>
            </li>
            <li className="flex gap-2.5">
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <span><span className="font-medium text-foreground">Cycles, not due dates.</span> Balance back to $0 within your cycle to keep full borrowing power.</span>
            </li>
            <li className="flex gap-2.5">
              <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <span><span className="font-medium text-foreground">Your savings set your limit.</span> Every dollar saved raises how much you can borrow.</span>
            </li>
          </ul>
        </div>
      </div>

      {/* purpose lines */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Your lines · all part of your one credit line</h3>
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            {addOpen ? <><X className="h-3.5 w-3.5" /> Cancel</> : <><Plus className="h-3.5 w-3.5" /> Add line</>}
          </button>
        </div>

        {addOpen && (
          <div className="mb-3 flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Line name</span>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Emergency"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
              />
            </label>
            <label className="sm:w-32">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Limit</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  inputMode="decimal"
                  value={newLimit}
                  onChange={(e) => setNewLimit(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-6 pr-2 text-sm tabular-nums text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                />
              </div>
            </label>
            <button
              type="button"
              onClick={submitLine}
              disabled={!newName.trim() || !(Number(newLimit) > 0)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lines.map((l) => (
            <PurposeLineCard
              key={l.id}
              line={l}
              onBorrow={() => openBorrow(l.id)}
              onRepay={() => openRepay(l.id)}
              onRemove={l.id !== 'general' && l.used === 0 ? () => removePurposeLine(l.id) : undefined}
            />
          ))}
        </div>
      </div>

      {/* credit products */}
      <div>
        <h3 className="mb-3 text-xs font-medium text-muted-foreground">More ways to borrow</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} onBorrow={openBorrow} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductCard({ product, onBorrow }: { product: CreditProduct; onBorrow: () => void }) {
  const { icon: Icon, name, desc, limit, status, terms } = product;
  const soon = status === 'soon';
  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-4', soon && 'opacity-70')}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{name}</span>
        {soon && <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Coming soon</span>}
      </div>
      <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{limit ? `Up to ${fmt(limit)}` : terms}</span>
        {soon ? (
          <span className="text-xs font-medium text-muted-foreground">Soon</span>
        ) : (
          <button type="button" onClick={() => onBorrow()} className="inline-flex items-center gap-1 text-xs font-semibold text-foreground transition-colors hover:text-info">
            Borrow <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {limit && !soon && <div className="mt-1 text-[11px] text-muted-foreground">{terms}</div>}
    </div>
  );
}

function PurposeLineCard({
  line,
  onBorrow,
  onRepay,
  onRemove,
}: {
  line: PurposeLine;
  onBorrow: () => void;
  onRepay: () => void;
  onRemove?: () => void;
}) {
  const Icon = line.icon;
  const pct = line.limit > 0 ? Math.min(100, (line.used / line.limit) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{line.name}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${line.name}`}
            className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-negative/10 hover:text-negative"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground tabular-nums">{fmt2(line.used)} of {fmt2(line.limit)}</span>
        <span className="text-foreground tabular-nums">{fmt2(Math.max(0, line.limit - line.used))} left</span>
      </div>
      <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={onBorrow} className="flex-1 rounded-lg border border-border py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
          Borrow
        </button>
        <button
          type="button"
          onClick={onRepay}
          disabled={line.used <= 0}
          className="flex-1 rounded-lg border border-border py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
        >
          Repay
        </button>
      </div>
    </div>
  );
}
