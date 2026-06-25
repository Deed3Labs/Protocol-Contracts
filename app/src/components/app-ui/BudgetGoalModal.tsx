import { useEffect, useState } from 'react';
import { Shield, Plane, Car, Home, PiggyBank, Gift, GraduationCap, Heart, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type BudgetCategory = 'Overall' | 'Food' | 'Shopping' | 'Transport' | 'Subs' | 'Other';
export const BUDGET_CATEGORIES: BudgetCategory[] = ['Overall', 'Food', 'Shopping', 'Transport', 'Subs', 'Other'];

export interface Budget {
  category: BudgetCategory;
  limit: number;
  spent: number; // collected from transactions
}
export interface Goal {
  id: string;
  name: string;
  iconKey: string;
  current: number;
  target: number;
  start: string; // ISO date the goal was opened
  deadline: string; // ISO target date
}

export const GOAL_ICONS: Record<string, LucideIcon> = {
  shield: Shield,
  plane: Plane,
  car: Car,
  home: Home,
  piggy: PiggyBank,
  gift: Gift,
  grad: GraduationCap,
  heart: Heart,
};
const ICON_KEYS = Object.keys(GOAL_ICONS);

export type Editing = { type: 'budget'; data: Budget } | { type: 'goal'; data: Goal } | null;

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';
const labelCls = 'mb-1.5 block text-xs font-medium text-muted-foreground';
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Create / edit a budget or a savings goal. A budget sets a monthly limit on a category
 * (or Overall); a goal captures name, icon, target, amount saved, and a target date (which
 * drives the panel's on-track pacing). Commits via onSaveBudget / onSaveGoal.
 */
export default function BudgetGoalModal({
  open,
  onOpenChange,
  editing,
  onSaveBudget,
  onSaveGoal,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Editing;
  onSaveBudget: (b: Budget) => void;
  onSaveGoal: (g: Goal) => void;
}) {
  const [kind, setKind] = useState<'budget' | 'goal'>('goal');
  const [category, setCategory] = useState<BudgetCategory>('Overall');
  const [limit, setLimit] = useState('');
  const [name, setName] = useState('');
  const [iconKey, setIconKey] = useState('shield');
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('');
  const [deadline, setDeadline] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing?.type === 'budget') {
      setKind('budget');
      setCategory(editing.data.category);
      setLimit(String(editing.data.limit));
    } else if (editing?.type === 'goal') {
      setKind('goal');
      setName(editing.data.name);
      setIconKey(editing.data.iconKey);
      setTarget(String(editing.data.target));
      setCurrent(String(editing.data.current));
      setDeadline(editing.data.deadline);
    } else {
      setKind('goal');
      setCategory('Overall');
      setLimit('');
      setName('');
      setIconKey('shield');
      setTarget('');
      setCurrent('');
      setDeadline('');
    }
  }, [open, editing]);

  const isEdit = !!editing;
  const canSave = kind === 'budget' ? Number(limit) > 0 : Boolean(name.trim()) && Number(target) > 0 && Boolean(deadline);

  const save = () => {
    if (kind === 'budget') {
      onSaveBudget({ category, limit: Number(limit), spent: editing?.type === 'budget' ? editing.data.spent : 0 });
    } else {
      onSaveGoal({
        id: editing?.type === 'goal' ? editing.data.id : `g${Date.now()}`,
        name: name.trim(),
        iconKey,
        target: Number(target),
        current: Number(current) || 0,
        start: editing?.type === 'goal' ? editing.data.start : todayISO(),
        deadline,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit' : 'New'} {kind}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {!isEdit && (
            <div className="flex rounded-lg border border-border bg-secondary p-1">
              {(['budget', 'goal'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    'flex-1 rounded-md py-1.5 text-xs font-medium capitalize transition-all',
                    kind === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          {kind === 'budget' ? (
            <>
              <div>
                <label className={labelCls}>Category</label>
                <Select value={category} onValueChange={(v) => setCategory(v as BudgetCategory)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUDGET_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className={labelCls}>Monthly limit</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    placeholder="0"
                    className={cn(inputCls, 'pl-7')}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className={labelCls}>Goal name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Icon</label>
                <div className="flex flex-wrap gap-1.5">
                  {ICON_KEYS.map((k) => {
                    const Icon = GOAL_ICONS[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setIconKey(k)}
                        aria-label={k}
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                          iconKey === k ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-secondary',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Target</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <input type="number" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0" className={cn(inputCls, 'pl-7')} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Saved so far</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <input type="number" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="0" className={cn(inputCls, 'pl-7')} />
                  </div>
                </div>
              </div>
              <div>
                <label className={labelCls}>Target date</label>
                <input type="date" value={deadline} min={todayISO()} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {isEdit ? 'Save' : 'Create'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
