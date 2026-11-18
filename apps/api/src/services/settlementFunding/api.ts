import type { Queryable } from '../../db/db.js';
import { getContractAddress } from '../../config/contracts.js';
import type { ChainReader } from '../command/onchain.js';
import { principalJson, readPoolTierPrincipal } from './principal.js';
import { deskOverview, deskStore, type MoveRow } from './store.js';

/*
 * What the Command Center and the signing page read about Settlement Funding (decision 54), through
 * GET /api/command/settlement-funding and GET /api/command/pool-tier-principal (routes/command.ts).
 * Read-only. The desk's state comes from what it recorded (migration 0079), never from the chain on
 * page load; the Pool Tier principal is read from the chain when asked, because it is a worksheet for
 * the two valuation signers and must be current.
 *
 * Amounts are USDC base units as strings, beside dollars, as the top-ups card has them.
 */

const usd = (v: bigint | null | undefined) => (v == null ? null : Number(v) / 1e6);

function move(r: MoveRow) {
  const txs = ([['deploySettlement', r.deployTx], ['forward', r.forwardTx], ['approve', r.approveTx], ['returnFunds', r.returnTx]] as const)
    .filter(([, h]) => !!h)
    .map(([k, h]) => [k, h!] as [string, string]);
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    amount: usd(r.amount),
    cutoffAt: r.cutoffAt?.getTime() ?? null,
    ref: r.ref,
    capShort: usd(r.capShort),
    poolShort: usd(r.poolShort),
    safeBatch: r.safeBatch,
    bankToken: r.bankToken,
    offRamp: r.offrampRef,
    txs,
    at: r.createdAt.getTime(),
    arrivedAt: r.arrivedAt?.getTime() ?? null,
    error: r.error,
    recordedBy: r.recordedBy,
    note: r.note,
  };
}

/** The desk's latest check, recent moves, halt, Margin outstanding and days; null when it has never checked. */
export async function settlementFundingStatus(db: Queryable) {
  const all = await deskOverview(db).catch(() => []);
  const o = all[0];
  if (!o) return null;
  return {
    chainId: o.chainId,
    pool: o.pool,
    lastCheck: o.lastCheck ? { at: o.lastCheck.checkedAt.getTime(), outcome: o.lastCheck.outcome, snapshot: o.lastCheck.snapshot } : null,
    recent: o.recent.map(move),
    halted: o.halted ? { id: o.halted.id, error: o.halted.error ?? '', at: o.halted.finishedAt?.getTime() ?? null } : null,
    marginOutstanding: usd(o.marginOutstanding),
    days: o.days.map((d) => ({
      day: d.day,
      authorized: usd(d.authorized),
      settled: usd(d.settled),
      fundedBook: usd(d.fundedBook),
      fundedPool: usd(d.fundedPool),
      returnedMargin: usd(d.returnedMargin),
      returnedPool: usd(d.returnedPool),
      marginAdvanced: usd(d.marginAdvanced),
      csaClose: usd(d.csaClose),
    })),
  };
}

/** The Pool Tier principal the valuation signers should post, with the Margin Advances the desk recorded. */
export async function poolTierPrincipalFor(db: Queryable, reader: ChainReader, chainId: number, env: Record<string, string | undefined> = process.env) {
  const pool = getContractAddress(chainId, 'LendingPool');
  const marginAdvances = pool ? await deskStore(db, chainId, pool).marginOutstanding().catch(() => 0n) : 0n;
  return principalJson(await readPoolTierPrincipal({ db, reader, marginAdvances, env }));
}
