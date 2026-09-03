import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingDown, Calendar, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlaidRecentTransactions } from "@/hooks/usePlaidRecentTransactions";
import type { PlaidRecentTransaction } from "@/utils/apiClient";

const TRANSFER_NAME_HINTS = ["transfer", "zelle", "venmo", "cash app", "cashapp", "xfer", "ach"];
const INTERNAL_TRANSFER_MATCH_WINDOW_MS = 72 * 60 * 60 * 1000; // 3 days
const toAmountCents = (amount: number) => Math.round(Math.abs(amount) * 100);

type SpendFlowEntry = {
  id: string;
  direction: "inflow" | "outflow";
  amount: number;
  dateMs: number;
  isTransfer: boolean;
  accountKey: string;
};

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

const isTransferLikePlaidTx = (tx: PlaidRecentTransaction): boolean => {
  const categoryText = `${tx.category_primary || ""} ${tx.category_detailed || ""}`.toLowerCase();
  if (categoryText.includes("transfer")) return true;
  const descriptor = `${tx.name || ""} ${tx.merchant_name || ""}`.toLowerCase();
  return TRANSFER_NAME_HINTS.some((hint) => descriptor.includes(hint));
};

const getPlaidTxDateMs = (tx: PlaidRecentTransaction): number | null => {
  const primary = Date.parse(tx.date || "");
  if (!Number.isNaN(primary)) return primary;
  const fallback = Date.parse(tx.authorized_date || "");
  if (!Number.isNaN(fallback)) return fallback;
  return null;
};

const detectInternalTransferIds = (entries: SpendFlowEntry[]): Set<string> => {
  const internalIds = new Set<string>();
  const unmatchedInflows = new Map<number, SpendFlowEntry[]>();
  const unmatchedOutflows = new Map<number, SpendFlowEntry[]>();

  const transferEntries = entries
    .filter((entry) => entry.isTransfer && entry.amount > 0 && Number.isFinite(entry.dateMs))
    .sort((a, b) => a.dateMs - b.dateMs);

  for (const entry of transferEntries) {
    const amountKey = toAmountCents(entry.amount);
    const oppositeMap = entry.direction === "inflow" ? unmatchedOutflows : unmatchedInflows;
    const ownMap = entry.direction === "inflow" ? unmatchedInflows : unmatchedOutflows;
    const candidates = oppositeMap.get(amountKey) ?? [];

    let matchIndex = -1;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (candidate.accountKey === entry.accountKey) continue;
      if (Math.abs(candidate.dateMs - entry.dateMs) > INTERNAL_TRANSFER_MATCH_WINDOW_MS) continue;
      matchIndex = i;
      break;
    }

    if (matchIndex >= 0) {
      const [matched] = candidates.splice(matchIndex, 1);
      internalIds.add(entry.id);
      internalIds.add(matched.id);
      if (candidates.length === 0) {
        oppositeMap.delete(amountKey);
      } else {
        oppositeMap.set(amountKey, candidates);
      }
      continue;
    }

    const ownCandidates = ownMap.get(amountKey) ?? [];
    ownCandidates.push(entry);
    ownMap.set(amountKey, ownCandidates);
  }

  return internalIds;
};

export interface SpendTrackerProps {
  className?: string;
  /** Wallet address for Plaid spend data; when set, fetches real data. Omit to show empty. */
  walletAddress?: string;
}

export function SpendTracker({ className, walletAddress }: SpendTrackerProps) {
  const { transactions, linked, notReady, isLoading, refresh } = usePlaidRecentTransactions(walletAddress, {
    enabled: !!walletAddress,
    limit: 1000,
  });

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentDay = today.getDate();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const monthName = today.toLocaleDateString("en-US", { month: "long" });

  const { spendingByDay, totalSpent } = useMemo(() => {
    const startOfMonthMs = new Date(currentYear, currentMonth, 1).getTime();
    const endOfTodayMs = new Date(currentYear, currentMonth, currentDay, 23, 59, 59, 999).getTime();
    const entries: SpendFlowEntry[] = [];

    for (const tx of transactions) {
      const dateMs = getPlaidTxDateMs(tx);
      if (dateMs == null || dateMs < startOfMonthMs || dateMs > endOfTodayMs) continue;

      const amount = Math.abs(Number(tx.amount) || 0);
      if (!(amount > 0)) continue;

      entries.push({
        id: `plaid-${tx.item_id}-${tx.transaction_id}`,
        direction: tx.direction,
        amount,
        dateMs,
        isTransfer: isTransferLikePlaidTx(tx),
        accountKey: `bank:${tx.item_id}:${tx.account_id || tx.account_name || "unknown"}`,
      });
    }

    const internalTransferIds = detectInternalTransferIds(entries);
    const byDay: Record<number, number> = {};
    let total = 0;

    for (const entry of entries) {
      if (entry.direction !== "outflow") continue;
      if (internalTransferIds.has(entry.id)) continue;
      const day = new Date(entry.dateMs).getDate();
      byDay[day] = (byDay[day] ?? 0) + entry.amount;
      total += entry.amount;
    }

    return { spendingByDay: byDay, totalSpent: total };
  }, [currentDay, currentMonth, currentYear, transactions]);

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
          <div className="flex flex-col">
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
              {monthName} 1 - {currentDay}
            </span>
            {linked && notReady && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                Syncing transactions from your institution...
              </span>
            )}
          </div>
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
