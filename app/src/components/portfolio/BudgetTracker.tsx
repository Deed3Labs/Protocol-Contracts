import { Card, CardContent } from "@/components/ui/card";
import { Utensils, Car, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface BudgetCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  spent: number;
  budget: number;
}

// Mock budget data
const mockBudgetCategories: BudgetCategory[] = [
  { id: "1", name: "Food", icon: <Utensils className="w-4 h-4" />, spent: 823, budget: 2000 },
  { id: "2", name: "Auto & Transport", icon: <Car className="w-4 h-4" />, spent: 167, budget: 2000 },
  { id: "3", name: "Everything Else", icon: <MoreHorizontal className="w-4 h-4" />, spent: 1244, budget: 1000 },
];

const totalBudget = 5000;
const totalSpent = mockBudgetCategories.reduce((sum, cat) => sum + cat.spent, 0);

interface BudgetProgressBarProps {
  spent: number;
  budget: number;
}

function BudgetProgressBar({ spent, budget }: BudgetProgressBarProps) {
  const percentage = Math.min((spent / budget) * 100, 100);
  const isOverBudget = spent > budget;

  return (
    <div className="relative h-2 w-full rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-800">
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-all",
          isOverBudget ? "bg-red-500 dark:bg-red-600" : "bg-zinc-600 dark:bg-zinc-500"
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export interface BudgetTrackerProps {
  className?: string;
}

export function BudgetTracker({ className }: BudgetTrackerProps) {
  const totalPercentage = ((totalSpent / totalBudget) * 100).toFixed(1);

  return (
    <Card
      className={cn(
        "border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/20 rounded-xl",
        className
      )}
    >
      <CardContent className="p-4">
        {/* Header */}
        <span className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
          Budget
        </span>

        {/* Total Budget Section */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg font-serif font-semibold text-black dark:text-white">
              Total Budget
            </span>
            <span className="text-base tabular-nums">
              <span className="font-semibold text-black dark:text-white">
                ${totalSpent.toLocaleString()}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400"> of ${totalBudget.toLocaleString()}</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <BudgetProgressBar spent={totalSpent} budget={totalBudget} />
            </div>
            <span className="text-sm text-zinc-500 dark:text-zinc-400 font-medium shrink-0 w-10 text-right">
              {totalPercentage}%
            </span>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="mt-5 space-y-4">
          {mockBudgetCategories.map((category) => {
            const percentage = ((category.spent / category.budget) * 100).toFixed(1);
            const isOverBudget = category.spent > category.budget;

            return (
              <div key={category.id} className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400 shrink-0">
                    {category.icon}
                  </div>
                  <span className="flex-1 font-medium text-black dark:text-white min-w-0 truncate">
                    {category.name}
                  </span>
                </div>

                <div className="flex items-center gap-3 pl-11">
                  <div className="flex-1 min-w-0">
                    <BudgetProgressBar spent={category.spent} budget={category.budget} />
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium min-w-[45px] text-right shrink-0 tabular-nums",
                      isOverBudget
                        ? "text-red-600 dark:text-red-500"
                        : "text-zinc-500 dark:text-zinc-400"
                    )}
                  >
                    {percentage}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
