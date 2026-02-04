import { Card, CardContent } from "@/components/ui/card";
import { Plus, Music, Tv, Home, ShoppingBag, Gamepad2, Cloud, Video, TrendingUp, Calendar, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

interface Subscription {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  amount: number;
  day: number;
}

// Mock subscription data
const mockSubscriptions: Subscription[] = [
  { id: "1", name: "Spotify", icon: <Music className="w-3 h-3" />, color: "bg-green-500", amount: 10.99, day: 1 },
  { id: "2", name: "Netflix", icon: <Tv className="w-3 h-3" />, color: "bg-red-500", amount: 15.99, day: 1 },
  { id: "3", name: "Home Insurance", icon: <Home className="w-3 h-3" />, color: "bg-blue-400", amount: 2300, day: 5 },
  { id: "4", name: "Amazon Prime", icon: <ShoppingBag className="w-3 h-3" />, color: "bg-purple-500", amount: 14.99, day: 8 },
  { id: "5", name: "Xbox Game Pass", icon: <Gamepad2 className="w-3 h-3" />, color: "bg-green-600", amount: 16.99, day: 8 },
  { id: "6", name: "iCloud", icon: <Cloud className="w-3 h-3" />, color: "bg-gray-400", amount: 2.99, day: 12 },
  { id: "7", name: "YouTube Premium", icon: <Video className="w-3 h-3" />, color: "bg-red-600", amount: 13.99, day: 15 },
  { id: "8", name: "Disney+", icon: <Tv className="w-3 h-3" />, color: "bg-blue-600", amount: 10.99, day: 8 },
  { id: "9", name: "HBO Max", icon: <Tv className="w-3 h-3" />, color: "bg-purple-700", amount: 15.99, day: 22 },
  { id: "10", name: "Gym", icon: <Home className="w-3 h-3" />, color: "bg-orange-500", amount: 49.99, day: 28 },
];

const formatAmount = (amount: number): string => {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }
  return `$${amount.toFixed(0)}`;
};

const getDaySubscriptions = (day: number): Subscription[] => {
  return mockSubscriptions.filter((sub) => sub.day === day);
};

const getDayTotal = (day: number): number => {
  return getDaySubscriptions(day).reduce((sum, sub) => sum + sub.amount, 0);
};

export interface UpcomingTransactionsProps {
  className?: string;
}

export function UpcomingTransactions({ className }: UpcomingTransactionsProps) {
  const today = new Date();
  const currentDay = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthName = today.toLocaleDateString("en-US", { month: "long" });

  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startingDayOfWeek = firstDayOfMonth.getDay();

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const paddingDays = Array.from({ length: startingDayOfWeek }, () => null);
  const allDays = [...paddingDays, ...days];

  const totalUpcoming = mockSubscriptions
    .filter((sub) => sub.day >= currentDay)
    .reduce((sum, sub) => sum + sub.amount, 0);

  const upcomingCount = mockSubscriptions.filter((sub) => sub.day >= currentDay).length;

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
            Upcoming Transactions
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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

        {/* Total Amount - matches hero balance font style */}
        <p className="text-3xl font-light tracking-tight text-black dark:text-white mb-4">
          ${totalUpcoming.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>

        {/* Week day headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekDays.map((day) => (
            <div key={day} className="text-center">
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{day}</span>
            </div>
          ))}
        </div>

        {/* Calendar Grid - Full month; all cells same min-height (with or without subscriptions) */}
        <div className="grid grid-cols-7 gap-1">
          {allDays.map((day, index) => {
            if (day === null) {
              return (
                <div
                  key={`pad-${index}`}
                  className="aspect-square min-h-[2.25rem] md:min-h-[3.5rem] rounded-lg"
                  aria-hidden
                />
              );
            }

            const subscriptions = getDaySubscriptions(day);
            const total = getDayTotal(day);
            const isToday = day === currentDay;
            const isPast = day < currentDay;
            const displaySubs = subscriptions.slice(0, 2);
            const hasMore = subscriptions.length > 2;

            return (
              <div
                key={day}
                className={cn(
                  "aspect-square min-h-[2.25rem] md:min-h-[3.5rem] rounded-lg border flex flex-col items-center justify-between p-1 transition-all",
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

                {/* Subscription Icons - Overlapping */}
                {subscriptions.length > 0 && (
                  <div className="flex items-center justify-center -space-x-1.5">
                    {displaySubs.map((sub, i) => (
                      <div
                        key={sub.id}
                        className={cn(
                          "w-4 h-4 rounded-full flex items-center justify-center text-white border-2 border-zinc-50 dark:border-zinc-900/20",
                          sub.color
                        )}
                        style={{ zIndex: displaySubs.length - i }}
                      >
                        {sub.icon}
                      </div>
                    ))}
                    {hasMore && (
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 border-2 border-zinc-50 dark:border-zinc-900/20"
                        style={{ zIndex: 0 }}
                      >
                        <Plus className="w-2.5 h-2.5" />
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
            <div className="flex -space-x-1">
              {mockSubscriptions.slice(0, 3).map((sub, i) => (
                <div
                  key={sub.id}
                  className={cn(
                    "w-4 h-4 rounded-full border-2 border-zinc-50 dark:border-zinc-900/20",
                    sub.color
                  )}
                  style={{ zIndex: 3 - i }}
                />
              ))}
              {mockSubscriptions.length > 3 && (
                <div className="w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[8px] text-zinc-600 dark:text-zinc-300 border-2 border-zinc-50 dark:border-zinc-900/20">
                  +{mockSubscriptions.length - 3}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
