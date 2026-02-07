import { Card, CardContent } from "@/components/ui/card";
import { Plus, CreditCard, TrendingUp, Calendar, Bell, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRecurringTransactions } from "@/hooks/useRecurringTransactions";

interface Subscription {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  amount: number;
  day: number;
}

interface RecurringDeposit {
  id: string;
  name: string;
  amount: number;
  day: number;
}

const SUBSCRIPTION_COLORS = [
  "bg-red-500", "bg-blue-400", "bg-purple-500", "bg-green-600", "bg-orange-500",
  "bg-gray-400", "bg-red-600", "bg-blue-600", "bg-purple-700",
];

const formatAmount = (amount: number): string => {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }
  return `$${amount.toFixed(0)}`;
};

export interface UpcomingTransactionsProps {
  className?: string;
  /** Wallet address for Plaid recurring streams; when set, fetches real data. Omit to show empty. */
  walletAddress?: string;
}

export function UpcomingTransactions({ className, walletAddress }: UpcomingTransactionsProps) {
  const { inflowStreams, outflowStreams, linked, isLoading, refresh } = useRecurringTransactions(walletAddress);

  const subscriptions: Subscription[] = outflowStreams.map((s, i) => ({
    id: s.stream_id,
    name: s.name,
    icon: <CreditCard className="w-2.5 h-2.5" />,
    color: SUBSCRIPTION_COLORS[i % SUBSCRIPTION_COLORS.length],
    amount: s.amount,
    day: s.day,
  }));

  const deposits: RecurringDeposit[] = inflowStreams.map((s) => ({
    id: s.stream_id,
    name: s.name,
    amount: s.amount,
    day: s.day,
  }));

  const getDaySubscriptions = (day: number): Subscription[] =>
    subscriptions.filter((sub) => sub.day === day);
  const getDayDeposits = (day: number): RecurringDeposit[] =>
    deposits.filter((d) => d.day === day);
  const getDayTotal = (day: number): number =>
    getDaySubscriptions(day).reduce((sum, sub) => sum + sub.amount, 0);

  const today = new Date();
  const currentDay = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthName = today.toLocaleDateString("en-US", { month: "long" });

  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startingDayOfWeek = firstDayOfMonth.getDay();

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const paddingDays = Array.from({ length: startingDayOfWeek }, () => null);
  const allDays = [...paddingDays, ...days];

  const totalUpcoming = subscriptions
    .filter((sub) => sub.day >= currentDay)
    .reduce((sum, sub) => sum + sub.amount, 0);

  const upcomingSubCount = subscriptions.filter((sub) => sub.day >= currentDay).length;
  const upcomingDepositCount = deposits.filter((d) => d.day >= currentDay).length;
  const upcomingCount = upcomingSubCount + upcomingDepositCount;

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
            Upcoming Transactions
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => refresh()}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Refresh recurring transactions"
            >
              <TrendingUp className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
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
              <Bell className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            </button>
          </div>
        </div>

        {/* Total Amount - matches hero balance font style (upcoming outflows only) */}
        <p className="text-3xl font-light tracking-tight text-black dark:text-white mb-4">
          {isLoading && linked ? (
            <span className="text-zinc-400 dark:text-zinc-500">—</span>
          ) : (
            `$${totalUpcoming.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          )}
        </p>

        {/* Week day headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekDays.map((day) => (
            <div key={day} className="text-center">
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{day}</span>
            </div>
          ))}
        </div>

        {/* Calendar Grid - Full month; all cells same size, constrained by column so gaps stay visible */}
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

            const subscriptions = getDaySubscriptions(day);
            const deposits = getDayDeposits(day);
            const total = getDayTotal(day);
            const isToday = day === currentDay;
            const isPast = day < currentDay;
            const displayDeposits = deposits.slice(0, 2);
            const displaySubs = subscriptions.slice(0, 2);
            const hasMoreDeposits = deposits.length > 2;
            const hasMoreSubs = subscriptions.length > 2;
            const hasMore = hasMoreDeposits || hasMoreSubs;
            const hasAny = deposits.length > 0 || subscriptions.length > 0;

            return (
              <div
                key={day}
                className={cn(
                  "min-h-13 min-w-0 w-full rounded-md border flex flex-col items-center justify-between p-1 transition-all",
                  isPast ? "border-zinc-200/50 dark:border-zinc-800/50 opacity-60" : "border-zinc-200 dark:border-zinc-800",
                  isToday && "ring-1 ring-zinc-400 dark:ring-zinc-500 bg-zinc-200/50 dark:bg-zinc-800/30"
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-medium",
                    isToday
                      ? "bg-black dark:bg-white text-white dark:text-black rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-medium"
                      : "text-black dark:text-white"
                  )}
                >
                  {day}
                </span>

                {/* Recurring deposits (green circle + USD) and subscription icons */}
                {hasAny && (
                  <div className="flex items-center justify-center -space-x-1.5">
                    {displayDeposits.map((dep, i) => (
                      <div
                        key={dep.id}
                        className="w-4 h-4 rounded-full flex items-center justify-center text-white border border-black/10 dark:border-white/10 bg-green-500"
                        style={{ zIndex: displayDeposits.length + displaySubs.length - i }}
                      >
                        <DollarSign className="w-2.5 h-2.5" />
                      </div>
                    ))}
                    {displaySubs.map((sub, i) => (
                      <div
                        key={sub.id}
                        className={cn(
                          "w-4 h-4 rounded-full flex items-center justify-center text-white border border-black/10 dark:border-white/10",
                          sub.color
                        )}
                        style={{ zIndex: displaySubs.length - i }}
                      >
                        {sub.icon}
                      </div>
                    ))}
                    {hasMore && (
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 border border-black/10 dark:border-white/10"
                        style={{ zIndex: 0 }}
                      >
                        <Plus className="w-2 h-2" />
                      </div>
                    )}
                  </div>
                )}

                {/* Amount - reserve space so empty days match filled days */}
                {total > 0 ? (
                  <span className="text-[8px] font-medium text-zinc-500 dark:text-zinc-400 truncate w-full text-center">
                    {formatAmount(total)}
                  </span>
                ) : (
                  <span className="text-[8px] invisible" aria-hidden>&nbsp;</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer - spacing aligned with SpendTracker */}
        <div className="flex items-center justify-between mt-4 pt-3 min-h-[2rem] border-t border-zinc-200 dark:border-zinc-800">
          <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
            {monthName} {currentDay} - {daysInMonth}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{upcomingCount} upcoming</span>
            <div className="flex -space-x-1 items-center">
              {deposits.length > 0 && (
                <div
                  className="w-4 h-4 rounded-full border border-black/10 dark:border-white/10 bg-green-500 flex items-center justify-center"
                  title="Recurring deposits"
                >
                  <DollarSign className="w-2.5 h-2.5 text-white" />
                </div>
              )}
              {subscriptions.slice(0, deposits.length > 0 ? 2 : 3).map((sub, i) => (
                <div
                  key={sub.id}
                  className={cn(
                    "w-4 h-4 rounded-full border border-black/10 dark:border-white/10",
                    sub.color
                  )}
                  style={{ zIndex: 3 - i }}
                />
              ))}
              {subscriptions.length + (deposits.length > 0 ? 1 : 0) > 3 && (
                <div className="w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[8px] text-zinc-600 dark:text-zinc-300 border border-black/10 dark:border-white/10">
                  +{subscriptions.length + (deposits.length > 0 ? 1 : 0) - 3}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
