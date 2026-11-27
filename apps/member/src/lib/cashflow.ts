import type { CashFlow } from '@/hooks/useClearTransactions';

/*
 * Shared time-bucketing for cash-flow charts (Income/Spending/Net, spending trend). Used by the
 * dashboard analytics chart + the Transactions page so the bucketing logic lives in one place.
 */
export type FlowRange = '1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'All';
export interface FlowBucket {
  start: number;
  end: number;
  label: string;
}

const DAY = 86_400_000;
const H = 3_600_000;

export function flowBuckets(range: FlowRange): FlowBucket[] {
  const now = new Date();
  const out: FlowBucket[] = [];
  const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (range === '1D') {
    for (let i = 23; i >= 0; i--) {
      const end = Date.now() - i * H;
      out.push({ start: end - H, end, label: `${String(new Date(end).getHours()).padStart(2, '0')}:00` });
    }
  } else if (range === '1W' || range === '1M') {
    const n = range === '1W' ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      d.setDate(d.getDate() - i);
      out.push({ start: d.getTime() - DAY + 1, end: d.getTime(), label: range === '1W' ? d.toLocaleDateString('en-US', { weekday: 'short' }) : String(d.getDate()) });
    }
  } else if (range === '3M' || range === '6M') {
    const weeks = range === '3M' ? 13 : 26;
    for (let i = weeks - 1; i >= 0; i--) {
      const end = Date.now() - i * 7 * DAY;
      out.push({ start: end - 7 * DAY, end, label: dayLabel(end) });
    }
  } else {
    const months = range === '1Y' ? 12 : range === 'YTD' ? now.getMonth() + 1 : 12;
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1).getTime();
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999).getTime();
      out.push({ start, end, label: new Date(start).toLocaleDateString('en-US', { month: 'short' }) });
    }
  }
  return out;
}

const within = (flows: CashFlow[], b: FlowBucket) => flows.filter((f) => f.ts >= b.start && f.ts <= b.end);
export const spendingIn = (flows: CashFlow[], b: FlowBucket) => Math.abs(within(flows, b).filter((f) => f.usd < 0).reduce((s, f) => s + f.usd, 0));
export const incomeIn = (flows: CashFlow[], b: FlowBucket) => within(flows, b).filter((f) => f.usd > 0).reduce((s, f) => s + f.usd, 0);
