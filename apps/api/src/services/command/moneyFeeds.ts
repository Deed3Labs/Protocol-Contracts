import { DAY } from '@clear/command-types';
import type { Queryable } from '../../db/db.js';
import type { FeedRow } from './feeds.js';

/*
 * The sandbox feeds' figures in Money (Phase 6b), from what each feed last read (6a): the operating
 * account from Plaid, Stripe's payouts on their way to it, Bridge's deposits in flight, and Lithic's
 * card spend. A feed that hasn't read anything gives nothing, and Money keeps its own records there.
 */

export interface BankLive {
  balance: number;
  /** At the end of each of the last six weeks, then now, worked back from the transactions. */
  weeks: number[];
  entries: Array<{ at: number; what: string; detail: string; amount: number }>;
}

/**
 * The co-op's operating account, as Plaid has it. The balance is the bank's; each week before it is
 * that balance with the transactions since put back. Plaid's sign is the bank's view (positive is
 * money out), so a line's amount is the other way round. Stripe payouts not yet in the bank come
 * first, as on their way.
 */
export async function bankLive(db: Queryable, plaid: FeedRow | undefined, stripe: FeedRow | undefined, now: number): Promise<BankLive | null> {
  if (!plaid?.figures?.accounts) return null;
  const balance = Number(plaid.figures.balance ?? 0);
  const { rows } = await db.query<{ posted_on: Date; name: string; amount: string; pending: boolean }>(
    `SELECT t.posted_on, t.name, t.amount, t.pending FROM command.bank_transactions t
       JOIN command.plaid_items i ON i.id = t.item
      WHERE t.account_id = ANY($1) ORDER BY t.posted_on DESC, t.id`,
    [plaid.figures.accounts.filter((a: any) => a.type === 'depository').map((a: any) => a.id)],
  );
  const posted = rows.filter((r) => !r.pending).map((r) => ({ at: new Date(r.posted_on).getTime(), out: Number(r.amount) }));
  const today = Math.floor(now / DAY) * DAY;
  const at = (t: number) => Math.round((balance + posted.filter((p) => p.at >= t).reduce((s, p) => s + p.out, 0)) * 100) / 100;
  const coming = ((stripe?.figures?.payouts ?? []) as Array<{ arrival: number; amount: number; status: string }>)
    .filter((p) => p.status === 'pending' || p.status === 'in_transit')
    .map((p) => ({ at: p.arrival, what: 'Card sales', detail: 'Stripe payout · on its way', amount: p.amount }));
  return {
    balance,
    weeks: [...[6, 5, 4, 3, 2, 1].map((k) => at(today + DAY - k * 7 * DAY)), balance],
    entries: [
      ...coming,
      ...rows.slice(0, 50).map((r) => ({ at: new Date(r.posted_on).getTime(), what: r.name, detail: r.pending ? 'Plaid · pending' : 'Plaid', amount: -Number(r.amount) })),
    ],
  };
}

/** Card spend this month, as Lithic has it, by merchant. */
export function cardSpend(lithic: FeedRow | undefined) {
  const f = lithic?.figures;
  return f?.month ? { month: f.month as string, spent: Number(f.spent), count: Number(f.count), merchants: f.merchants as Array<{ name: string; amount: number; count: number }> } : null;
}

/** What's moving through Bridge, the deposit rail: transfers not yet settled. */
export function depositRail(bridge: FeedRow | undefined) {
  const f = bridge?.figures;
  return f?.inFlight ? { count: Number(f.inFlight.count), amount: Number(f.inFlight.amount) } : null;
}
