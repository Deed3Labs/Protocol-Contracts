import { useState, type ReactNode } from 'react';
import { Plus, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import BudgetGoalModal, { GOAL_ICONS, type Budget, type Goal, type Editing } from './BudgetGoalModal';

const STREAK_MONTHS = 3; // consecutive months under the overall budget (collected)

const initialOverall: Budget = { category: 'Overall', limit: 3700, spent: 3284 };
const initialCats: Budget[] = [
  { category: 'Food', limit: 700, spent: 620 },
  { category: 'Shopping', limit: 800, spent: 890 },
  { category: 'Transport', limit: 300, spent: 210 },
];
const initialGoals: Goal[] = [
  { id: 'g1', name: 'Emergency fund', iconKey: 'shield', current: 4200, target: 10000, start: '2025-02-01', deadline: '2028-12-31' },
  { id: 'g2', name: 'Vacation', iconKey: 'plane', current: 1800, target: 3000, start: '2026-01-01', deadline: '2026-09-01' },
  { id: 'g3', name: 'New car', iconKey: 'car', current: 7400, target: 18000, start: '2024-06-01', deadline: '2029-06-01' },
];

const money = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString()}`;
const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

function pace(g: Goal) {
  const now = Date.now();
  const start = new Date(g.start).getTime();
  const end = new Date(g.deadline).getTime();
  const p = pct(g.current, g.target);
  const elapsed = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
  const onTrack = p >= Math.round(elapsed * 100) - 3;
  const deadlineLabel = new Date(g.deadline).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  return { p, onTrack, deadlineLabel };
}

/** Lightweight SVG progress ring (no chart lib). */
function Ring({ value, size, stroke, color, children }: { value: number; size: number; stroke: number; color: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, value)) / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--secondary))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      {children != null && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

/**
 * Budgets & goals — set an overall + per-category monthly budget and savings goals (target +
 * deadline). Moderate gamification with a mix of visuals: a radial gauge for the budget, an
 * under-budget streak, per-category over/under pills, and a progress ring per goal (icon in
 * the centre) with an on-track / behind pace badge. Any item opens the editor; "New" creates
 * one. State is local (scaffold) but mirrors the real data model.
 */
export default function BudgetGoals({ className }: { className?: string }) {
  const [overall, setOverall] = useState(initialOverall);
  const [cats, setCats] = useState(initialCats);
  const [goals, setGoals] = useState(initialGoals);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  const open = (e: Editing) => {
    setEditing(e);
    setModalOpen(true);
  };
  const saveBudget = (b: Budget) => {
    if (b.category === 'Overall') setOverall(b);
    else
      setCats((cs) => {
        const i = cs.findIndex((c) => c.category === b.category);
        return i >= 0 ? cs.map((c, j) => (j === i ? b : c)) : [...cs, b];
      });
  };
  const saveGoal = (g: Goal) =>
    setGoals((gs) => {
      const i = gs.findIndex((x) => x.id === g.id);
      return i >= 0 ? gs.map((x, j) => (j === i ? g : x)) : [...gs, g];
    });

  const overP = pct(overall.spent, overall.limit);
  const overBudget = overall.spent > overall.limit;
  const totalSaved = goals.reduce((s, g) => s + g.current, 0);
  const totalTarget = goals.reduce((s, g) => s + g.target, 0);

  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-5', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">Budgets &amp; goals</h3>
        <button
          type="button"
          onClick={() => open(null)}
          className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-transform active:scale-95"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>

      {/* overall budget — radial gauge */}
      <button type="button" onClick={() => open({ type: 'budget', data: overall })} className="mt-4 flex items-center gap-4 text-left">
        <Ring value={overP} size={86} stroke={9} color={overBudget ? 'rgb(var(--negative))' : 'rgb(var(--foreground))'}>
          <div className="text-center leading-none">
            <div className="font-display text-lg tabular-nums text-foreground">{overP}%</div>
            <div className="mt-0.5 text-[9px] text-muted-foreground">used</div>
          </div>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">Monthly budget</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {overBudget ? (
              <span className="font-medium text-negative">{money(overall.spent - overall.limit)} over</span>
            ) : (
              <>
                <span className="font-medium text-foreground">{money(overall.limit - overall.spent)}</span> left
              </>
            )}{' '}
            of {money(overall.limit)}
          </div>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
            <Flame className="h-3 w-3" /> {STREAK_MONTHS} mo under budget
          </span>
        </div>
      </button>

      {/* per-category budgets — pills */}
      <div className="mt-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">By category</div>
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => {
            const p = pct(c.spent, c.limit);
            const over = c.spent > c.limit;
            const close = !over && p >= 85;
            return (
              <button
                type="button"
                key={c.category}
                onClick={() => open({ type: 'budget', data: c })}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors',
                  over ? 'border-negative/30 bg-negative/5' : 'border-border bg-secondary/40 hover:bg-secondary',
                )}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', over ? 'bg-negative' : close ? 'bg-amber-500' : 'bg-positive')} />
                <span className="font-medium text-foreground">{c.category}</span>
                <span className="tabular-nums text-muted-foreground">{over ? 'over' : `${p}%`}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* savings goals — progress rings */}
      <div className="mt-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Savings goals</div>
        <div className="space-y-3.5">
          {goals.map((g) => {
            const { p, onTrack, deadlineLabel } = pace(g);
            const Icon = GOAL_ICONS[g.iconKey] ?? GOAL_ICONS.shield;
            return (
              <button type="button" key={g.id} onClick={() => open({ type: 'goal', data: g })} className="flex w-full items-center gap-3 text-left">
                <Ring value={p} size={46} stroke={4} color={onTrack ? 'rgb(var(--positive))' : '#f59e0b'}>
                  <Icon className="h-4 w-4 text-foreground" />
                </Ring>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{g.name}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        onTrack ? 'bg-positive/10 text-positive' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {onTrack ? 'On track' : 'Behind'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {money(g.current)} of {money(g.target)} · {deadlineLabel}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* combined summary */}
      <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-[11px]">
        <span className="text-muted-foreground">Saved across goals</span>
        <span className="font-medium tabular-nums text-foreground">
          {money(totalSaved)} <span className="text-muted-foreground">of {money(totalTarget)} · {pct(totalSaved, totalTarget)}%</span>
        </span>
      </div>

      <BudgetGoalModal open={modalOpen} onOpenChange={setModalOpen} editing={editing} onSaveBudget={saveBudget} onSaveGoal={saveGoal} />
    </div>
  );
}
