import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RangeSlider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export type Category = 'Transfer' | 'Deposit' | 'Payroll' | 'Bill' | 'Card' | 'Subscription';
export type StatusFilter = 'all' | 'completed' | 'pending' | 'failed';
export type DirectionFilter = 'all' | 'in' | 'out';

export interface AdvFilters {
  categories: Record<Category, boolean>;
  status: StatusFilter;
  direction: DirectionFilter;
  amount: [number, number];
}

export const ALL_CATEGORIES: Category[] = ['Transfer', 'Deposit', 'Payroll', 'Bill', 'Card', 'Subscription'];
export const AMOUNT_MIN = 0;
export const AMOUNT_MAX = 3500;

export const DEFAULT_ADV: AdvFilters = {
  categories: { Transfer: true, Deposit: true, Payroll: true, Bill: true, Card: true, Subscription: true },
  status: 'all',
  direction: 'all',
  amount: [AMOUNT_MIN, AMOUNT_MAX],
};

/** How many advanced filter groups differ from the defaults (for the button badge). */
export function advCount(a: AdvFilters): number {
  let n = 0;
  if (ALL_CATEGORIES.some((c) => !a.categories[c])) n++;
  if (a.status !== 'all') n++;
  if (a.direction !== 'all') n++;
  if (a.amount[0] !== AMOUNT_MIN || a.amount[1] !== AMOUNT_MAX) n++;
  return n;
}

const DIRECTIONS: { id: DirectionFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'Money in' },
  { id: 'out', label: 'Money out' },
];

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

/**
 * Advanced transaction filters in a modal: direction (segmented), status (dropdown),
 * an amount range (dual slider), and per-category switches. Edits a local draft and
 * commits on Apply; closing without applying discards the draft.
 */
export default function TransactionFilterModal({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: AdvFilters;
  onApply: (v: AdvFilters) => void;
}) {
  const [draft, setDraft] = useState<AdvFilters>(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const setCategory = (c: Category, v: boolean) => setDraft((d) => ({ ...d, categories: { ...d.categories, [c]: v } }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Filter transactions</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* direction */}
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Direction</div>
            <div className="flex rounded-lg border border-border bg-secondary p-1">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDraft((s) => ({ ...s, direction: d.id }))}
                  className={cn(
                    'flex-1 rounded-md py-1.5 text-xs font-medium transition-all',
                    draft.direction === d.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* status */}
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Status</div>
            <Select value={draft.status} onValueChange={(v) => setDraft((s) => ({ ...s, status: v as StatusFilter }))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* amount */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Amount</span>
              <span className="text-xs font-medium tabular-nums text-foreground">
                {money(draft.amount[0])} – {money(draft.amount[1])}
                {draft.amount[1] === AMOUNT_MAX ? '+' : ''}
              </span>
            </div>
            <RangeSlider
              min={AMOUNT_MIN}
              max={AMOUNT_MAX}
              step={50}
              value={draft.amount}
              onChange={(v) => setDraft((s) => ({ ...s, amount: v }))}
            />
          </div>

          {/* categories */}
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Categories</div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
              {ALL_CATEGORIES.map((c) => (
                <div key={c} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{c}</span>
                  <Switch checked={draft.categories[c]} onCheckedChange={(v) => setCategory(c, v)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <button
            type="button"
            onClick={() => setDraft(DEFAULT_ADV)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            Apply filters
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
