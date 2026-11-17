import type { Queryable } from '../../db/db.js';
import { liveFeeChain, type FeeChain } from './chain.js';
import { assuranceFeeConfig, txLink, type AssuranceFeeConfig } from './config.js';
import { advancesOutstanding, monthOf, previousMonth, utcDay } from './feeMath.js';
import { txBuilderLink, safeQueueLink } from './proposals.js';
import { allItems, feeSoFar, interchangeRows, repaid, type Item } from './store.js';

/*
 * The "Assurance fees" card on Money (Pools, AssurancePool), as the API sends it: this month's fee
 * so far, last month's with its basis, every item and its state with links to its transactions, the
 * advances outstanding, the interchange proposals and whether the floor figures are due. Live from
 * the database and the pool once AssurancePoolV2 is configured; the prototype's figures otherwise.
 * Amounts go out as dollars, as the rest of Money's do.
 */

const $ = (units: bigint | string | number) => Number(BigInt(units)) / 1e6;
const FLOOR_STALE_DAYS = 31;

export interface AssuranceFeesPayload {
  configured: boolean;
  demo?: boolean;
  why?: string;
  chainId: number;
  pool: string | null;
  clFees: string | null;
  clOperating: string | null;
  treasurySafe: string | null;
  payerEnabled: boolean;
  feeBps: number;
  interchangeBps: number;
  coverage: { available: number; balance: number; floor: number; cap: number } | null;
  wallet: { address: string | null; balance: number | null };
  thisMonth: { month: string; days: number; read: number; average: number; fee: number } | null;
  lastMonth: { month: string; fee: number; status: string; days: number; read: number; filled: number; zero: number; average: number; sum: number } | null;
  items: Array<Record<string, unknown>>;
  advances: { released: number; repaidPaid: number; entered: number; outstanding: number; room: number; draws: number } | null;
  interchange: Array<{ month: string; interchange: number; bps: number; amount: number; note: string; safe: string; batch: unknown; link: string; queue: string; outbox: string | null }>;
  floor: { at: number | null; stale: boolean; days: number | null } | null;
  links: { clOperatingBuilder: string | null; clOperatingQueue: string | null; treasuryQueue: string | null };
}

const itemOut = (i: Item, chainId: number) => ({
  id: i.id,
  kind: i.kind,
  month: i.month,
  tag: i.sourceTag,
  amount: $(i.amount),
  units: i.amount.toString(),
  status: i.status,
  note: i.note,
  evidence: i.evidence,
  basis: i.basis ? { days: i.basis.days, read: i.basis.read, filled: i.basis.filled, zero: i.basis.zero, average: $(i.basis.average), sum: $(i.basis.sum), bps: i.basis.bps } : null,
  funding: i.funding ? { link: i.funding.link, queue: i.funding.queue, batch: i.funding.batch, safe: i.funding.safe, owner: i.funding.owner, why: i.funding.why } : null,
  fundingProposedAt: i.fundingProposedAt?.getTime() ?? null,
  fundedAt: i.fundedAt?.getTime() ?? null,
  approveTx: i.approveTx,
  approveLink: txLink(chainId, i.approveTx),
  depositTx: i.depositTx,
  depositLink: txLink(chainId, i.depositTx),
  paidAt: i.paidAt?.getTime() ?? null,
  error: i.error,
  created: i.createdAt.getTime(),
});

/** The card's data, live. Chain reads that fail leave their parts null rather than failing the page. */
export async function assuranceFeesLive(db: Queryable, now: Date, deps: { config?: AssuranceFeeConfig; chain?: FeeChain } = {}): Promise<AssuranceFeesPayload> {
  const config = deps.config ?? assuranceFeeConfig();
  const base = {
    chainId: config.chainId,
    pool: config.pool,
    clFees: config.clFees,
    clOperating: config.clOperating,
    treasurySafe: config.treasurySafe,
    payerEnabled: config.payerEnabled,
    feeBps: Number(config.feeBps),
    interchangeBps: Number(config.interchangeBps),
    links: {
      clOperatingBuilder: config.clOperating ? txBuilderLink(config.chainId, config.clOperating) : null,
      clOperatingQueue: config.clOperating ? safeQueueLink(config.chainId, config.clOperating) : null,
      treasuryQueue: config.treasurySafe ? safeQueueLink(config.chainId, config.treasurySafe) : null,
    },
  };
  if (!config.pool) {
    return { configured: false, why: `The new Assurance Pool isn’t deployed on chain ${config.chainId} yet (ASSURANCE_POOL_V2_${config.chainId}).`, ...base, coverage: null, wallet: { address: config.clFees, balance: null }, thisMonth: null, lastMonth: null, items: [], advances: null, interchange: [], floor: null };
  }
  const chain = deps.chain ?? liveFeeChain(config.chainId);
  const pool = config.pool;
  const soft = <T>(p: Promise<T>) => p.catch(() => null);
  const [reading, floorAt, draws, token] = await Promise.all([soft(chain.readPool(pool)), soft(chain.floorInputsAt(pool)), soft(chain.releasedDraws(pool)), soft(chain.asset(pool))]);
  const balance = token && config.clFees ? await soft(chain.balanceOf(token, config.clFees)) : null;
  const today = utcDay(now);
  const so = await feeSoFar(db, config.chainId, today, config.feeBps);
  const items = await allItems(db, config.chainId);
  const last = items.find((i) => i.kind === 'fee' && i.month === previousMonth(monthOf(today))) ?? null;
  const r = await repaid(db, config.chainId);
  const ix = await interchangeRows(db, config.chainId);
  const { rows: outbox } = await db.query<{ month: string; status: string }>(
    `SELECT payload->>'month' AS month, status FROM command.outbox WHERE section = 'money' AND kind = 'assurance-interchange' ORDER BY created_at DESC`,
  );
  const floorDays = floorAt != null && floorAt > 0n ? Math.floor((now.getTime() / 1000 - Number(floorAt)) / 86_400) : null;
  return {
    configured: true,
    ...base,
    coverage: reading ? { available: $(reading.availableCoverage), balance: $(reading.backstopBalance), floor: $(reading.backstopFloor), cap: $(reading.coverageCap) } : null,
    wallet: { address: config.clFees, balance: balance == null ? null : $(balance) },
    thisMonth: { month: so.month, days: so.days, read: so.read, average: $(so.average), fee: $(so.fee) },
    lastMonth: last?.basis
      ? { month: last.month, fee: $(last.amount), status: last.status, days: last.basis.days, read: last.basis.read, filled: last.basis.filled, zero: last.basis.zero, average: $(last.basis.average), sum: $(last.basis.sum) }
      : null,
    items: items.map((i) => itemOut(i, config.chainId)),
    advances: draws
      ? { released: $(draws.total), repaidPaid: $(r.paid), entered: $(r.entered), outstanding: $(advancesOutstanding(draws.total, r.paid)), room: $(advancesOutstanding(draws.total, r.entered)), draws: draws.count }
      : null,
    interchange: ix.map((x) => ({
      month: x.month,
      interchange: $(x.interchange),
      bps: x.bps,
      amount: $(x.amount),
      note: x.note,
      safe: x.safe,
      batch: x.batch,
      link: txBuilderLink(config.chainId, x.safe),
      queue: safeQueueLink(config.chainId, x.safe),
      outbox: outbox.find((o) => o.month === x.month)?.status ?? null,
    })),
    floor: floorAt == null ? null : { at: floorAt > 0n ? Number(floorAt) * 1000 : null, stale: floorDays == null || floorDays > FLOOR_STALE_DAYS, days: floorDays },
  };
}

/** The prototype's card: the same shape, the reference's day (21 Oct 2026), nothing real. */
export function assuranceFeesDemo(): AssuranceFeesPayload {
  const at = (d: string) => Date.parse(`${d}T15:00:00Z`);
  const hash = (n: number) => `0x${n.toString(16).padStart(64, 'a')}`;
  const demoItem = (o: Record<string, unknown>) => ({ tag: 0, note: '', evidence: '', basis: null, funding: null, fundingProposedAt: null, fundedAt: null, approveTx: null, approveLink: null, depositTx: null, depositLink: null, paidAt: null, error: null, ...o });
  return {
    configured: true,
    demo: true,
    chainId: 84532,
    pool: '0x0000000000000000000000000000000000000000',
    clFees: '0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd',
    clOperating: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
    treasurySafe: '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50',
    payerEnabled: false,
    feeBps: 800,
    interchangeBps: 2500,
    coverage: { available: 4200, balance: 6120.4, floor: 1850, cap: 4200 },
    wallet: { address: '0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd', balance: 0 },
    thisMonth: { month: '2026-10', days: 31, read: 21, average: 2845.16, fee: 19.33 },
    lastMonth: { month: '2026-09', fee: 26.3, status: 'funding_proposed', days: 30, read: 30, filled: 1, zero: 0, average: 4000, sum: 120000 },
    items: [
      demoItem({ id: 'demo-fee-09', kind: 'fee', month: '2026-09', amount: 26.3, units: '26301369', status: 'funding_proposed', basis: { days: 30, read: 30, filled: 1, zero: 0, average: 4000, sum: 120000, bps: 800 }, fundingProposedAt: at('2026-10-02'), created: at('2026-10-01') }),
      demoItem({ id: 'demo-fee-08', kind: 'fee', month: '2026-08', amount: 18.12, units: '18120000', status: 'paid', paidAt: at('2026-09-04'), approveTx: hash(1), depositTx: hash(2), created: at('2026-09-01') }),
      demoItem({ id: 'demo-rec-08', kind: 'recovery', tag: 1, month: '2026-08', amount: 40, units: '40000000', status: 'paid', note: 'Recovered on a charged-off line', paidAt: at('2026-09-05'), approveTx: hash(3), depositTx: hash(4), created: at('2026-09-02') }),
    ],
    advances: { released: 120, repaidPaid: 40, entered: 40, outstanding: 80, room: 80, draws: 1 },
    interchange: [],
    floor: { at: at('2026-09-02'), stale: false, days: 19 },
    links: { clOperatingBuilder: null, clOperatingQueue: null, treasuryQueue: null },
  };
}
