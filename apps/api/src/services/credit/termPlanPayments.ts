import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';

/*
 * Payments against term plans, for Activity.
 *
 * Not card debt, so not in the card books: a term plan is its own obligation on chain, and
 * TermIssuer is the record of what it owes. This table only remembers each payment so a member can
 * see it -- which plan, how much, how it was paid, and how far through the schedule it took them.
 *
 * Written from `PlanPaid` events in the transaction's own receipt, never from a client's figure.
 * One row per plan per transaction: an undirected Repay can pay several plans at once.
 */

export type PlanPaymentMethod = 'manual' | 'auto' | 'savings';

const TERM_EVENTS = new ethers.Interface([
  'event PlanPaid(uint256 indexed planId, uint256 amount, uint256 principalPortion)',
]);
const TERM_READS = [
  'function planAt(uint256 planId) external view returns (address member, uint256 principal, uint256 principalOutstanding, uint256 repaid, uint64 openedAt, uint32 installments, uint64 installmentLength, uint256 ratePerCycle, bool closed)',
  'function scheduleOf(uint256 planId) external view returns (uint256 installmentAmount, uint256 scheduleTotal, uint32 installments, uint64 scheduleStart)',
  'function installmentsDue(uint256 planId) external view returns (uint256)',
  'function scheduledPrincipalDue(uint256 planId) external view returns (uint256)',
];

export interface PlanPaidLog {
  planId: number;
  units: bigint;
}

/** The `PlanPaid` events a receipt carries from TermIssuer. */
export function planPaymentsIn(receipt: ethers.TransactionReceipt, termIssuer: string): PlanPaidLog[] {
  const out: PlanPaidLog[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== termIssuer.toLowerCase()) continue;
    try {
      const parsed = TERM_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'PlanPaid') out.push({ planId: Number(parsed.args.planId), units: BigInt(parsed.args.amount) });
    } catch {
      /* not an event we read */
    }
  }
  return out;
}

/**
 * How many installments a plan's repayments now cover, of how many.
 *
 * `scheduledPrincipalDue` is `floor + installment × due` (or `floor + total` once the last one is
 * due); the floor -- what a re-split carried in -- is recovered from it. Repaid past `floor + total`
 * is every installment; otherwise it is how many whole installments the repaid figure spans. At
 * least one: a part payment is a payment towards the first.
 */
export function installmentsCovered(p: {
  repaid: bigint;
  installments: number;
  installmentAmount: bigint;
  scheduleTotal: bigint;
  due: bigint;
  scheduledDue: bigint;
  closed: boolean;
}): number {
  const n = BigInt(p.installments);
  if (p.closed || n === 0n) return p.installments;
  const floor = p.due >= n ? p.scheduledDue - p.scheduleTotal : p.scheduledDue - p.installmentAmount * p.due;
  if (p.repaid >= floor + p.scheduleTotal) return p.installments;
  if (p.installmentAmount === 0n || p.repaid <= floor) return 1;
  const k = (p.repaid - floor) / p.installmentAmount;
  const capped = k >= n ? n - 1n : k;
  return Math.max(1, Number(capped));
}

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS term_plan_payments (
      tx_hash TEXT NOT NULL,
      plan_id BIGINT NOT NULL,
      wallet TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      method TEXT NOT NULL,
      installment_index INT NOT NULL,
      installment_count INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tx_hash, plan_id)
    )`);
}

/**
 * Remember the plan payments in a transaction. Returns the cents that went to plans, so the caller
 * can tell the card share from the term share of the same repayment.
 */
export async function recordPlanPayments(input: {
  wallet: string;
  txHash: string;
  receipt: ethers.TransactionReceipt;
  termIssuer: string;
  provider: ethers.Provider;
  method: PlanPaymentMethod;
}): Promise<number> {
  const paid = planPaymentsIn(input.receipt, input.termIssuer);
  if (paid.length === 0) return 0;
  const cents = paid.reduce((sum, p) => sum + Number(p.units / 10_000n), 0);
  const pool = getPayPool();
  if (!pool) return cents;
  await ensureTable();

  const term = new ethers.Contract(input.termIssuer, TERM_READS, input.provider);
  const wallet = input.wallet.trim().toLowerCase();
  for (const p of paid) {
    // Read now, straight after the payment landed: how far through the schedule it took them.
    const [plan, schedule, due, scheduledDue] = await Promise.all([
      term.planAt(p.planId),
      term.scheduleOf(p.planId),
      term.installmentsDue(p.planId).catch(() => 0n),
      term.scheduledPrincipalDue(p.planId).catch(() => 0n),
    ]);
    const count = Number(schedule[2]);
    const index = installmentsCovered({
      repaid: BigInt(plan[3]),
      installments: count,
      installmentAmount: BigInt(schedule[0]),
      scheduleTotal: BigInt(schedule[1]),
      due: BigInt(due),
      scheduledDue: BigInt(scheduledDue),
      closed: Boolean(plan[8]),
    });
    await pool.query(
      `INSERT INTO term_plan_payments (tx_hash, plan_id, wallet, amount_cents, method, installment_index, installment_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tx_hash, plan_id) DO NOTHING`,
      [input.txHash.toLowerCase(), p.planId, wallet, Number(p.units / 10_000n), input.method, index, count],
    );
  }
  return cents;
}

export interface PlanPaymentRow {
  txHash: string;
  planId: number;
  amountCents: number;
  method: PlanPaymentMethod;
  index: number;
  count: number;
  at: string;
}

export async function planPaymentHistory(walletInput: string, limit = 50): Promise<PlanPaymentRow[]> {
  const pool = getPayPool();
  if (!pool) return [];
  const wallet = walletInput.trim().toLowerCase();
  return pool
    .query<{ tx_hash: string; plan_id: string; amount_cents: string; method: string; installment_index: number; installment_count: number; created_at: Date }>(
      `SELECT tx_hash, plan_id, amount_cents, method, installment_index, installment_count, created_at
         FROM term_plan_payments WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2`,
      [wallet, limit],
    )
    .then((r) =>
      r.rows.map((row) => ({
        txHash: row.tx_hash,
        planId: Number(row.plan_id),
        amountCents: Number(row.amount_cents),
        method: row.method as PlanPaymentMethod,
        index: row.installment_index,
        count: row.installment_count,
        at: row.created_at.toISOString(),
      })),
    )
    // No table yet is no plan payments yet.
    .catch(() => []);
}
