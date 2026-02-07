import { Card, CardContent } from "@/components/ui/card";
import { TrendingDown, Calendar, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpendTransactions } from "@/hooks/useSpendTransactions";

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
  /** Wallet address for Plaid spend data; when set, fetches real data. Omit to show empty. */
  walletAddress?: string;
}

export function SpendTracker({ className, walletAddress }: SpendTrackerProps) {
  const { spendingByDay, totalSpent: totalSpentFromApi, linked, isLoading, refresh } = useSpendTransactions(walletAddress);

  const today = new Date();
  const currentDay = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthName = today.toLocaleDateString("en-US", { month: "long" });

  const totalSpent = totalSpentFromApi;
  const dayValues = Object.keys(spendingByDay).map((d) => spendingByDay[Number(d)]).filter((v) => v > 0);
  const maxDaySpend = dayValues.length > 0 ? Math.max(...dayValues, 1) : 1;

  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startingDayOfWeek = firstDayOfMonth.getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const paddingDays = Array.from({ length: startingDayOfWeek }, () => null);
  const allDays = [...paddingDays, ...days];

  const weekDays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  return (
    <Card
      className={cn(
        "border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/20 rounded py-3",
        className
      )}
    >
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs md:text-[11px] font-normal tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
            Spend this month
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => refresh()}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Refresh spend data"
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
          {isLoading && linked ? (
            <span className="text-zinc-400 dark:text-zinc-500">—</span>
          ) : (
            `$${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          )}
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
                  className="min-h-13 min-w-0 rounded-md"
                  aria-hidden
                />
              );
            }

            const amount = spendingByDay[day] ?? 0;
            const intensity = getIntensity(amount, maxDaySpend);
            const isPast = day <= currentDay;
            const isToday = day === currentDay;

            const hasSpendFill = isPast && amount > 0;
            const fillOpacity = hasSpendFill ? intensity : 0;
            const useInvertedText = hasSpendFill && intensity > 0.5;

            return (
              <div
                key={day}
                className={cn(
                  "relative min-h-13 min-w-0 w-full rounded-md border flex flex-col items-start justify-between p-1.5 transition-all",
                  isPast ? "border-zinc-200 dark:border-zinc-800" : "border-zinc-200/50 dark:border-zinc-800/50",
                  isToday && "ring-1 ring-zinc-400 dark:ring-zinc-500"
                )}
              >
                {/* Scale: transparent → #0e0e0e (light) / white (dark) */}
                <div
                  className="absolute inset-0 rounded-md bg-[#0e0e0e] dark:bg-white pointer-events-none"
                  style={{ opacity: fillOpacity }}
                  aria-hidden
                />
                <span
                  className={cn(
                    "relative z-10 text-xs font-medium",
                    isPast
                      ? useInvertedText
                        ? "text-white dark:text-black"
                        : "text-black dark:text-white"
                      : "text-zinc-400 dark:text-zinc-500"
                  )}
                >
                  {day}
                </span>
                <span
                  className={cn(
                    "relative z-10 text-[10px] font-medium truncate w-full",
                    amount > 0
                      ? useInvertedText
                        ? "text-white dark:text-black"
                        : "text-black/80 dark:text-white/80"
                      : "text-zinc-400 dark:text-zinc-500"
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
              {[0.2, 0.4, 0.6, 0.8, 1].map((opacity, i) => (
                <div
                  key={i}
                  className="w-3 h-3 rounded bg-[#0e0e0e] dark:bg-white"
                  style={{ opacity }}
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
