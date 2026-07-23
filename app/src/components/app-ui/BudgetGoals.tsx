import { useState, type ReactNode } from 'react';
import { Plus, Flame, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import BudgetGoalModal, { GOAL_ICONS, type Budget, type BudgetCategory, type Goal, type Editing } from './BudgetGoalModal';

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
  { id: 'g4', name: 'Home down payment', iconKey: 'home', current: 12400, target: 40000, start: '2024-01-01', deadline: '2030-01-01' },
  { id: 'g5', name: 'New laptop', iconKey: 'piggy', current: 640, target: 1800, start: '2026-04-01', deadline: '2026-12-01' },
  { id: 'g6', name: 'Holiday gifts', iconKey: 'gift', current: 300, target: 1200, start: '2026-06-01', deadline: '2026-12-01' },
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
  const monthsLeft = (end - now) / (1000 * 60 * 60 * 24 * 30.44);
  const remaining = Math.max(0, g.target - g.current);
  const perMonth = remaining <= 0 ? 'reached' : monthsLeft < 0.5 ? 'due now' : `${money(remaining / monthsLeft)}/mo`;
  return { p, onTrack, deadlineLabel, perMonth };
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

function GoalRow({ g, onClick, detailed, className }: { g: Goal; onClick: () => void; detailed?: boolean; className?: string }) {
  const { p, onTrack, deadlineLabel, perMonth } = pace(g);
  const Icon = GOAL_ICONS[g.iconKey] ?? GOAL_ICONS.shield;
  return (
    <button type="button" onClick={onClick} className={cn('flex w-full items-center gap-3 text-left', className)}>
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
          {detailed && <span> · {perMonth}</span>}
        </div>
      </div>
    </button>
  );
}

/**
 * Budgets & goals — set an overall + per-category monthly budget and savings goals (target +
 * deadline). Moderate gamification with mixed visuals: a balance figure + bar for the budget
 * (radials are reserved for goals), an under-budget streak, per-category over/under pills, and
 * a progress ring per goal with an on-track / behind pace badge. Shows 3 goals on desktop /
 * 5 on mobile; "View all" opens the full list with per-goal monthly pace. State is local.
 */
export default function BudgetGoals({ className }: { className?: string }) {
  const [overall, setOverall] = useState(initialOverall);
  const [cats, setCats] = useState(initialCats);
  const [goals, setGoals] = useState(initialGoals);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [allOpen, setAllOpen] = useState(false);

  const open = (e: Editing) => {
    setAllOpen(false);
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
  const deleteGoal = (id: string) => setGoals((gs) => gs.filter((g) => g.id !== id));
  const deleteBudget = (category: BudgetCategory) => setCats((cs) => cs.filter((c) => c.category !== category));

  const overP = pct(overall.spent, overall.limit);
  const overBudget = overall.spent > overall.limit;
  const totalSaved = goals.reduce((s, g) => s + g.current, 0);
  const totalTarget = goals.reduce((s, g) => s + g.target, 0);

  return (
    <div className={cn('flex flex-col', className)}>
      <h3 className="text-xs font-medium text-muted-foreground">Budgets &amp; goals</h3>

      {/* overall budget — balance figure + streak pill on one row */}
      <button type="button" onClick={() => open({ type: 'budget', data: overall })} className="mt-3 block w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <div className="font-display text-3xl tracking-tight text-foreground tabular-nums">
            {money(overall.spent)}
            <span className="ml-1 align-baseline text-sm font-normal text-muted-foreground">/ {money(overall.limit)}</span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
            <Flame className="h-3 w-3" /> {STREAK_MONTHS} mo under
          </span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className={cn('h-full rounded-full', overBudget ? 'bg-negative' : 'bg-foreground')} style={{ width: `${overP}%` }} />
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {overBudget ? (
            <span className="font-medium text-negative">{money(overall.spent - overall.limit)} over budget</span>
          ) : (
            <>
              <span className="font-medium text-foreground">{money(overall.limit - overall.spent)}</span> left this month
            </>
          )}
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

      {/* savings goals — rings (3 on desktop, 5 on mobile) */}
      <div className="mt-5 mb-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Savings goals</div>
        <div className="space-y-3.5">
          {goals.map((g, i) => (
            <GoalRow key={g.id} g={g} onClick={() => open({ type: 'goal', data: g })} className={cn(i >= 3 && 'lg:hidden', i >= 5 && 'hidden')} />
          ))}
        </div>
        {goals.length > 3 && (
          <button
            type="button"
            onClick={() => setAllOpen(true)}
            className={cn(
              'mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
              goals.length <= 5 && 'hidden lg:inline-flex',
            )}
          >
            View all {goals.length} goals <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* combined summary + primary action */}
      <div className="mt-auto">
        <div className="flex items-center justify-between border-t border-border pt-3 text-[11px]">
          <span className="text-muted-foreground">Saved across goals</span>
          <span className="font-medium tabular-nums text-foreground">
            {money(totalSaved)} <span className="text-muted-foreground">of {money(totalTarget)} · {pct(totalSaved, totalTarget)}%</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => open(null)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground transition-transform active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" /> New budget or goal
        </button>
      </div>

      <BudgetGoalModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        editing={editing}
        onSaveBudget={saveBudget}
        onSaveGoal={saveGoal}
        onDeleteBudget={deleteBudget}
        onDeleteGoal={deleteGoal}
      />

      {/* expanded all-goals modal */}
      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Savings goals</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto py-1">
            {goals.map((g) => (
              <div key={g.id} className="rounded-lg px-1 py-2 transition-colors hover:bg-secondary/50">
                <GoalRow g={g} detailed onClick={() => open({ type: 'goal', data: g })} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
            <span className="text-muted-foreground">Saved across goals</span>
            <span className="font-medium tabular-nums text-foreground">
              {money(totalSaved)} of {money(totalTarget)} · {pct(totalSaved, totalTarget)}%
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
