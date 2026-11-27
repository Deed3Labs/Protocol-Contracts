import { getPayPool } from '../../config/postgres.js';
import { chargeStore } from '../chargeStore.js';
import { planPaymentHistory } from './termPlanPayments.js';

/*
 * Every repayment a member has made, whichever way they made it — for Activity.
 *
 *   manual    a Repay tap, in USDC, on chain
 *   auto      automatic repayment from a USDC deposit, on chain
 *   savings   out of their own savings (the Liquidator), on chain
 *   bank      a bank deposit that paid down credit on arrival (then cleared on chain by netting)
 *
 * On-chain repayments are read from `card_onchain_repayments`, which is written from each
 * transaction's own events; bank repayments from the deposit's settlement entries in the ledger.
 * Amounts are what was repaid, carry included.
 *
 * A payment against a term plan is its own row, named for the plan, because a plan is a schedule
 * the member is working through. One transaction can pay both -- an undirected Repay reaches the
 * card tiers and the plans in rate order -- so the card row keeps only what did not go to a plan.
 */

export type RepaymentMethod = 'manual' | 'auto' | 'savings' | 'bank';

export interface RepaymentEntry {
  id: string;
  at: string;
  amountCents: number;
  method: RepaymentMethod;
  /** The on-chain transaction, when there is one — so Activity can fold the token transfer into this row. */
  txHash: string | null;
  /** Set when this paid a term plan: which one, and how far through its schedule it now is. */
  plan?: { planId: number; name: string | null; index: number; count: number };
}

export async function repaymentHistory(walletInput: string, limit = 50): Promise<RepaymentEntry[]> {
  const pool = getPayPool();
  if (!pool) return [];
  const wallet = walletInput.trim().toLowerCase();

  // `method` arrived after the first repayments were recorded. Read it where it exists, and fall back
  // to the table as it was rather than showing nothing.
  type OnChainRow = { tx_hash: string; total_cents: string; method: string | null; created_at: Date };
  const onChain: OnChainRow[] = await pool
    .query<OnChainRow>(
      `SELECT tx_hash, total_cents, method, created_at FROM card_onchain_repayments
        WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2`,
      [wallet, limit],
    )
    .then((r) => r.rows)
    .catch(() =>
      pool
        .query<OnChainRow>(
          `SELECT tx_hash, total_cents, NULL::text AS method, created_at FROM card_onchain_repayments
            WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2`,
          [wallet, limit],
        )
        .then((r) => r.rows)
        .catch(() => []),
    );

  // For repayments recorded before `method` existed: one paid out of savings has a savings leg in the
  // books (the entry, or its correction), so it can still be named correctly.
  const fromSavings = new Set(
    await pool
      .query<{ external_id: string }>(
        `SELECT external_id FROM lithic_ledger_entries
          WHERE wallet = $1 AND account = 'member_savings' AND direction = 'debit'`,
        [wallet],
      )
      .then((r) => r.rows.map((x) => x.external_id.toLowerCase()))
      .catch(() => [] as string[]),
  );
  const paidFromSavings = (tx: string) => [...fromSavings].some((id) => id.includes(tx.toLowerCase()));

  // A bank deposit's settlement: one entry group per deposit, the credit legs summed.
  const bank = await pool
    .query<{ entry_group: string; cents: string; at: Date }>(
      `SELECT entry_group, SUM(amount_cents) AS cents, MIN(created_at) AS at
         FROM lithic_ledger_entries
        WHERE wallet = $1 AND rail = 'fiat' AND direction = 'credit'
          AND ((event_type = 'credit_settlement' AND account LIKE 'member_credit_%')
            -- Carry a refunded plan left behind, paid by the same deposit. A plan's own share is
            -- listed as that plan's payment once the co-op has paid it on chain.
            OR (event_type = 'term_settlement' AND account = 'member_term_carry'))
        GROUP BY entry_group ORDER BY MIN(created_at) DESC LIMIT $2`,
      [wallet, limit],
    )
    .then((r) => r.rows)
    .catch(() => []);

  const planPayments = await planPaymentHistory(wallet, limit);
  const toPlans = new Map<string, number>();
  for (const p of planPayments) toPlans.set(p.txHash, (toPlans.get(p.txHash) ?? 0) + p.amountCents);
  const names = await chargeStore
    .merchantNamesByPlanId([...new Set(planPayments.map((p) => p.planId))])
    .catch(() => ({}) as Record<number, string>);

  const entries: RepaymentEntry[] = [
    ...onChain.map((r) => ({
      id: `repay:${r.tx_hash}`,
      at: r.created_at.toISOString(),
      // Only the card's share; what went to a plan is listed as that plan's payment below.
      amountCents: Number(r.total_cents) - (toPlans.get(r.tx_hash.toLowerCase()) ?? 0),
      method: ((r.method as RepaymentMethod | null) ?? (paidFromSavings(r.tx_hash) ? 'savings' : 'manual')) as RepaymentMethod,
      txHash: r.tx_hash,
    })),
    ...bank.map((r) => ({
      id: `repay:${r.entry_group}`,
      at: new Date(r.at).toISOString(),
      amountCents: Number(r.cents),
      method: 'bank' as const,
      txHash: null,
    })),
    ...planPayments.map((p) => ({
      id: `plan:${p.txHash}:${p.planId}`,
      at: p.at,
      amountCents: p.amountCents,
      method: p.method as RepaymentMethod,
      txHash: p.txHash,
      plan: { planId: p.planId, name: names[p.planId] ?? null, index: p.index, count: p.count },
    })),
  ];
  return entries.filter((e) => e.amountCents > 0).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
