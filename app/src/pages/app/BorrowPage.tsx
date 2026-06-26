import { TrendingUp, RefreshCw, Wallet, ArrowUpRight, Minus, Plus, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import { useCredit, type CreditProduct } from '@/context/CreditContext';
import { cn } from '@/lib/utils';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmt2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Borrow — consolidated borrowing power, the base Stable Credit line, and Clear credit products. */
export default function BorrowPage() {
  const { baseLimit, borrowed, available, totalPower, cycleDaysLeft, cycleLength, powerPct, products, openBorrow, openRepay } = useCredit();
  const used = baseLimit > 0 ? Math.min(100, (borrowed / baseLimit) * 100) : 0;
  const cycleProgress = ((cycleLength - cycleDaysLeft) / cycleLength) * 100;

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

          {/* utilization bar */}
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${used}%` }} />
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={openBorrow}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" /> Borrow
            </button>
            <button
              type="button"
              onClick={openRepay}
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
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
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
          <button type="button" onClick={onBorrow} className="inline-flex items-center gap-1 text-xs font-semibold text-foreground transition-colors hover:text-info">
            Borrow <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {limit && !soon && <div className="mt-1 text-[11px] text-muted-foreground">{terms}</div>}
    </div>
  );
}
