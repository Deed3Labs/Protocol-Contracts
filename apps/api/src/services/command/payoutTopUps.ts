import type { Queryable } from '../../db/db.js';
import { topUpOverview, type TopUpRow } from '../payoutFunding/topUpStore.js';

/*
 * Money's "Automatic top-ups" card (decision 51): the payout top-up job's last check, its low and
 * target projections, the spending limit used this period, recent top-ups with their transactions,
 * and what needs a person (the Safe batch for what the limit could not cover, or a stop). Live, it
 * is read from what the job recorded (migration 0078), never from the chain on page load; seeded,
 * a fixed sample, as Money's other cards are.
 */

export interface TopUpsCard {
  enabled: boolean;
  chainId: number;
  explorer: string;
  lastCheck: number | null;
  wallet: string;
  safe: string;
  low: { days: number; due: number; short: number; truncated: boolean };
  target: { days: number; due: number; short: number; truncated: boolean };
  margin: number;
  operating: number;
  allowance: { cap: number; spent: number; remaining: number; resetMinutes: number; resetsAt: number | null };
  outcome: string;
  recent: Array<{ id: number; at: number; amount: number; trigger: string; status: string; txs: Array<[string, string]> }>;
  needsHuman: { why: string; remainder: number; batch: unknown } | null;
  halted: { id: number; error: string } | null;
}

const usd = (units: string | bigint | number | null | undefined) => Number(BigInt(String(units ?? 0))) / 1e6;
const EXPLORERS: Record<number, string> = { 84532: 'https://sepolia.basescan.org/tx/', 8453: 'https://basescan.org/tx/' };

function recentRow(r: TopUpRow): TopUpsCard['recent'][number] {
  const txs = ([['pull', r.pullTx], ['approve', r.approveTx], ['fund', r.fundTx]] as const).filter(([, h]) => !!h).map(([k, h]) => [k, h!] as [string, string]);
  return { id: r.id, at: r.createdAt.getTime(), amount: usd(r.amount), trigger: r.trigger, status: r.status, txs };
}

/** The card from what the job recorded; null when it has never checked (it is off, or has not run yet). */
export async function payoutTopUpsLive(db: Queryable): Promise<TopUpsCard | null> {
  const all = await topUpOverview(db).catch(() => []);
  const o = all[0];
  if (!o) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = o.snapshot as any;
  const p = (x: any) => ({ days: Number(x?.days ?? 0), due: usd(x?.amount), short: usd(x?.short), truncated: !!x?.truncated });
  // What the cap could not cover stays on the card until the remainder arrives (a wallet-balance top-up after it).
  const owed = o.recent.findIndex((r) => r.remainder > 0n && r.status !== 'failed');
  const paid = o.recent.findIndex((r) => r.trigger === 'wallet-balance');
  const pendingRow = owed >= 0 && (paid < 0 || paid > owed) && Date.now() - o.recent[owed].createdAt.getTime() < 7 * 86_400_000 ? o.recent[owed] : null;
  const needs = s.needsHuman ?? pendingRow;
  return {
    enabled: true,
    chainId: o.chainId,
    explorer: EXPLORERS[o.chainId] ?? '',
    lastCheck: o.checkedAt.getTime(),
    wallet: s.addresses?.wallet ?? '',
    safe: s.addresses?.safe ?? '',
    low: p(s.low),
    target: p(s.target),
    margin: usd(s.margin),
    operating: usd(s.operatingBalance),
    allowance: {
      cap: usd(s.allowance?.cap),
      spent: usd(s.allowance?.spent),
      remaining: usd(s.allowance?.remaining),
      resetMinutes: Number(s.allowance?.resetMinutes ?? 0),
      resetsAt: s.allowance?.resetsAt ? Number(s.allowance.resetsAt) * 1000 : null,
    },
    outcome: String(s.outcome ?? ''),
    recent: o.recent.map(recentRow),
    needsHuman: needs
      ? 'batch' in needs
        ? { why: String(needs.why), remainder: usd(needs.remainder), batch: needs.batch }
        : { why: 'remainder', remainder: usd((needs as TopUpRow).remainder), batch: (needs as TopUpRow).safeBatch }
      : null,
    halted: o.halted ? { id: o.halted.id, error: o.halted.error ?? '' } : null,
  };
}

/** The seeded card: a quiet week with one automatic top-up, as the other seeded cards are samples. */
export function payoutTopUpsSeed(now: number): TopUpsCard {
  const DAY = 86_400_000;
  const h = (n: number) => '0x' + n.toString(16).padStart(64, '0');
  return {
    enabled: true,
    chainId: 84532,
    explorer: EXPLORERS[84532],
    lastCheck: now - 6 * 60_000,
    wallet: '0xC0C4EC7875D1838C0AE610accC16AAdCDb475068',
    safe: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
    low: { days: 14, due: 4_820.4, short: 0, truncated: false },
    target: { days: 30, due: 9_310.75, short: 0, truncated: false },
    margin: 100,
    operating: 18_400,
    allowance: { cap: 5_000, spent: 3_216.3, remaining: 1_783.7, resetMinutes: 10_080, resetsAt: now + 3 * DAY },
    outcome: 'idle',
    recent: [{ id: 1, at: now - 4 * DAY, amount: 3_216.3, trigger: 'low-water', status: 'funded', txs: [['pull', h(0xa1)], ['approve', h(0xa2)], ['fund', h(0xa3)]] }],
    needsHuman: null,
    halted: null,
  };
}
