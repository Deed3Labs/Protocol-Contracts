import { Card, CardContent } from "@/components/ui/card";
import { TrendingDown, Calendar, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// Mock spending data - in reality this would come from props or API
const generateMockSpending = () => {
  const today = new Date().getDate();
  const spending: Record<number, number> = {};

  for (let i = 1; i <= today; i++) {
    const hasSpending = Math.random() > 0.3;
    spending[i] = hasSpending ? Math.floor(Math.random() * 1500) : 0;
  }

  return spending;
};

const mockSpending = generateMockSpending();

const formatAmount = (amount: number): string => {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }
  return amount > 0 ? `$${amount}` : "-";
};

const getIntensity = (amount: number, maxAmount: number): number => {
  if (amount === 0 || maxAmount === 0) return 0;
  return Math.min(amount / maxAmount, 1);
};

export interface SpendTrackerProps {
  className?: string;
}

export function SpendTracker({ className }: SpendTrackerProps) {
  const today = new Date();
  const currentDay = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthName = today.toLocaleDateString("en-US", { month: "long" });

  const totalSpent = Object.values(mockSpending).reduce((sum, val) => sum + val, 0);
  const maxDaySpend = Math.max(...Object.values(mockSpending), 1);

  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startingDayOfWeek = firstDayOfMonth.getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const paddingDays = Array.from({ length: startingDayOfWeek }, () => null);
  const allDays = [...paddingDays, ...days];

  const weekDays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  return (
    <Card
      className={cn(
        "border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/20 rounded-xl",
        className
      )}
    >
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
            Spend this month
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <TrendingDown className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            </button>
            <button
              type="button"
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Calendar className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            </button>
            <button
              type="button"
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Sparkles className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            </button>
          </div>
        </div>

        {/* Total Amount - matches hero balance font style */}
        <p className="text-3xl font-light tracking-tight text-black dark:text-white mb-4">
          ${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>

        {/* Week day headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekDays.map((day) => (
            <div key={day} className="text-center min-w-0">
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{day}</span>
            </div>
          ))}
        </div>

        {/* Calendar Grid - cells sized by column width so gaps stay visible */}
        <div className="grid grid-cols-7 gap-1">
          {allDays.map((day, index) => {
            if (day === null) {
              return (
                <div
                  key={`pad-${index}`}
                  className="h-9 min-w-0 rounded-lg"
                  aria-hidden
                />
              );
            }

            const amount = mockSpending[day] || 0;
            const intensity = getIntensity(amount, maxDaySpend);
            const isPast = day <= currentDay;
            const isToday = day === currentDay;

            return (
              <div
                key={day}
                className={cn(
                  "h-9 min-w-0 w-full rounded-lg border flex flex-col items-start justify-between p-1.5 transition-all",
                  isPast ? "border-zinc-200 dark:border-zinc-800" : "border-zinc-200/50 dark:border-zinc-800/50",
                  isToday && "ring-1 ring-zinc-400 dark:ring-zinc-500"
                )}
                style={{
                  backgroundColor:
                    isPast && amount > 0
                      ? `rgb(var(--foreground) / ${0.08 + intensity * 0.35})`
                      : "transparent",
                }}
              >
                <span
                  className={cn(
                    "text-xs font-medium",
                    isPast ? "text-black dark:text-white" : "text-zinc-400 dark:text-zinc-500"
                  )}
                >
                  {day}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-medium truncate w-full",
                    amount > 0 ? "text-black/80 dark:text-white/80" : "text-zinc-400 dark:text-zinc-500"
                  )}
                >
                  {isPast ? formatAmount(amount) : "-"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer - spacing aligned with UpcomingTransactions */}
        <div className="flex items-center justify-between mt-4 pt-3 min-h-[2rem] border-t border-zinc-200 dark:border-zinc-800">
          <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
            {monthName} 1 - {currentDay}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">Less</span>
            <div className="flex gap-0.5">
              {[0.1, 0.25, 0.4, 0.55, 0.7].map((opacity, i) => (
                <div
                  key={i}
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: `rgb(var(--foreground) / ${opacity})` }}
                />
              ))}
            </div>
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">More</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
