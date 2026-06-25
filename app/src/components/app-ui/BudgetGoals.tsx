import { Plus, Shield, Plane, Car, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const budget = { spent: 3284, limit: 3700 };

interface Goal {
  name: string;
  current: number;
  target: number;
  icon: LucideIcon;
}
const goals: Goal[] = [
  { name: 'Emergency fund', current: 4200, target: 10000, icon: Shield },
  { name: 'Vacation', current: 1800, target: 3000, icon: Plane },
  { name: 'New car', current: 7400, target: 18000, icon: Car },
];

const fmt = (n: number) => `$${Math.abs(n).toLocaleString()}`;

/**
 * Budgets & goals — the place to set a monthly spending cap and savings goals. These feed
 * the spending chart's budget line and milestone trackers. Presentational scaffold with
 * progress meters; the add affordances are placeholders for the future editor.
 */
export default function BudgetGoals({ className }: { className?: string }) {
  const budgetPct = Math.min(100, Math.round((budget.spent / budget.limit) * 100));
  const over = budget.spent > budget.limit;
  const remaining = budget.limit - budget.spent;

  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">Budgets & goals</h3>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>

      {/* monthly budget */}
      <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-foreground">Monthly budget</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {fmt(budget.spent)} / {fmt(budget.limit)}
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-background">
          <div className={cn('h-full rounded-full', over ? 'bg-negative' : 'bg-foreground')} style={{ width: `${budgetPct}%` }} />
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {over ? (
            <span className="font-medium text-negative">{fmt(remaining)} over budget</span>
          ) : (
            <>
              <span className="font-medium text-foreground">{fmt(remaining)}</span> left this month
            </>
          )}
        </div>
      </div>

      {/* savings goals */}
      <div className="mt-4 flex-1">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Savings goals</div>
        <div className="space-y-4">
          {goals.map((g) => {
            const pct = Math.min(100, Math.round((g.current / g.target) * 100));
            const Icon = g.icon;
            return (
              <div key={g.name}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{g.name}</span>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">{pct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-positive" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                  {fmt(g.current)} of {fmt(g.target)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="mt-4 w-full rounded-lg border border-dashed border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        + New budget or goal
      </button>
    </div>
  );
}
