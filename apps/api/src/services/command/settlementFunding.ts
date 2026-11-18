import type { Queryable } from '../../db/db.js';
import { deskConfigFromEnv } from '../settlementFunding/config.js';
import { laneSetup, remainderBatches, type DeskAddresses } from '../settlementFunding/desk.js';
import { localDate, zonedInstant } from '../settlementFunding/schedule.js';
import { deskOverview, deskStore, type MoveRow } from '../settlementFunding/store.js';

/*
 * Money's "Card settlement funding" card (decision 54), on Pools → Yield pool; Build → Security's
 * automatic jobs read the same record for the desk's row (autoJobs.ts). The settlement funding desk
 * (jobs/fundingDesk.ts) funds the Credit Settlement Account before each card settlement cut-off;
 * this is what it last saw and did: the next
 * cut-off and what is due, the CSA and the buffer, the Collection Account and today's book transfers
 * (the netting that exists), Settlement Funding sent and returned, the settlement lane's period
 * limit, and what needs a person (a stop, lane setup, the cap's remainder, a shortfall).
 *
 * Live, it is read from what the desk recorded (migration 0081), never from the chain on page load,
 * as the top-ups card is; seeded, a fixed sample, as Money's other cards are. Dollars, as numbers.
 */

const EXPLORERS: Record<number, string> = { 84532: 'https://sepolia.basescan.org/tx/', 8453: 'https://basescan.org/tx/' };
const usd = (units: string | bigint | number | null | undefined) => Number(BigInt(String(units ?? 0))) / 1e6;
const usdOrNull = (units: string | bigint | number | null | undefined) => (units == null ? null : usd(units));
const big = (units: string | bigint | number | null | undefined) => BigInt(String(units ?? 0));

export interface SettlementMove {
  id: number;
  at: number;
  kind: string;
  status: string;
  amount: number;
  cutoffAt: number | null;
  txs: Array<[string, string]>;
  error: string | null;
}

export interface SettlementCard {
  enabled: boolean;
  dryRun: boolean;
  returnsEnabled: boolean;
  chainId: number;
  explorer: string;
  lastCheck: number | null;
  outcome: string;
  wallet: string;
  forwarder: string;
  safe: string;
  offRamp: { name: string; rail: string; address: string };
  bank: string;
  /** The next cut-off (and the last one this run funds for, when the weekend or a holiday follows it). */
  cutoff: { next: number; through: number; rollover: boolean; forcedAt: number; latencyMinutes: number; measuredMinutes: number | null };
  /** Due at each covered cut-off, oldest first. */
  byCutoff: Array<[number, number]>;
  due: number;
  dueSettled: number;
  duePending: number;
  buffer: number;
  target: number;
  csa: number | null;
  inFlight: number;
  need: number;
  surplus: number;
  pendingCredit: number;
  /**
   * The netting that exists today. Collections are the Collection Account's balance (members'
   * repayments, booked by automatic clearing); new draws are the credit portions due. Collections
   * net against draws through book transfers to the CSA, which are counted; the two flows are not
   * tracked one against the other.
   */
  netting: { collection: number | null; bookedToday: number; drawsDue: number };
  /** Moves finished today (the cut-off's zone), and the last reconciled days' totals. */
  today: { day: string; sent: number; booked: number; returnedPool: number; returnedMargin: number; marginAdvanced: number };
  week: { days: number; sent: number; booked: number; returnedPool: number; returnedMargin: number };
  lane: {
    /** The Yield Pool answers `settlementLane()` (the SL upgrade is live). */
    upgraded: boolean;
    /** Stopped by `stopSettlementFunder`: only two deployers restart it (SL-funder-1/2). */
    stopped: boolean;
    cap: number;
    used: number;
    left: number;
    periodSeconds: number;
    /** When the period running began (ms), or null before the lane is set. */
    periodStart: number | null;
    headroom: number;
    headroomUsed: number;
    principal: number;
    deployed: number;
    poolRoom: number;
  };
  allowance: { cap: number; spent: number; remaining: number; resetMinutes: number };
  /** Lane setup that is missing, as sentences; empty when it is all there. */
  setup: string[];
  needsHuman: { capShort: number; poolShort: number; blocked: string[]; batches: unknown | null } | null;
  halted: { id: number; error: string; at: number | null } | null;
  marginOutstanding: number;
  recent: SettlementMove[];
}

function move(r: MoveRow): SettlementMove {
  const txs = ([['deploySettlement', r.deployTx], ['forward', r.forwardTx], ['approve', r.approveTx], ['returnFunds', r.returnTx]] as const)
    .filter(([, h]) => !!h)
    .map(([k, h]) => [k, h!] as [string, string]);
  return { id: r.id, at: r.createdAt.getTime(), kind: r.kind, status: r.status, amount: usd(r.amount), cutoffAt: r.cutoffAt?.getTime() ?? null, txs, error: r.error };
}

/** The card from what the desk recorded; null when it has never checked (it is off, or cannot run yet). */
export async function settlementFundingLive(db: Queryable, env: Record<string, string | undefined> = process.env, nowMs = Date.now()): Promise<SettlementCard | null> {
  const all = await deskOverview(db, 8).catch(() => []);
  const o = all[0];
  if (!o || !o.lastCheck) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (o.lastCheck.snapshot ?? {}) as any;
  const f = s.figures ?? {};
  const lane = s.lane ?? {};
  const fw = s.forwarder ?? {};
  const al = fw.allowance ?? {};
  const a = (s.addresses ?? {}) as DeskAddresses;
  const cov = s.coverage ?? {};
  const d = s.decision ?? {};

  // "Today" in the cut-off's zone: moves finished since its midnight.
  const zone = deskConfigFromEnv(env).schedule.timeZone;
  const today = localDate(Math.floor(nowMs / 1000), zone);
  const store = deskStore(db, o.chainId, o.pool);
  const done = await store.doneBetween(new Date(zonedInstant(today, 0, zone) * 1000), new Date(nowMs + 1)).catch(() => null);
  const week = o.days.slice(0, 7);
  const sum = (k: 'fundedPool' | 'fundedBook' | 'returnedPool' | 'returnedMargin') => usd(week.reduce((t, x) => t + x[k], 0n));

  // The lane setup, as the desk words it (the same check it makes before it deploys): a pool from
  // before the SL upgrade reverts on settlementLane(), which the desk records as laneMissing.
  const upgraded = !s.laneMissing && lane.upgraded !== false;
  const setup = laneSetup(
    {
      lane: { upgraded, funder: String(lane.funder ?? '0x0000000000000000000000000000000000000000'), stopped: !!lane.stopped, capPerPeriod: big(lane.capPerPeriod) },
      forwarder: { moduleEnabled: !!fw.moduleEnabled, allowance: { amount: big(al.amount) }, offRamp: fw.offRamp ?? null, desk: fw.desk ?? null, safe: fw.safe ?? null, module: fw.module ?? null, token: fw.token ?? null },
    },
    { wallet: a.wallet ?? '', offRamp: a.offRamp ?? '', safe: a.safe, module: a.module, usdc: a.usdc },
  );

  const capShort = d.kind === 'fund' ? big(d.capShort) : 0n;
  const poolShort = d.kind === 'fund' ? big(d.poolShort) : 0n;
  const needsHuman =
    capShort > 0n || poolShort > 0n
      ? {
          capShort: usd(capShort),
          poolShort: usd(poolShort),
          blocked: Array.isArray(d.blocked) ? d.blocked.map(String) : [],
          batches: capShort > 0n && a.pool && s.ref ? remainderBatches(a, capShort, String(s.ref), o.lastCheck.checkedAt.getTime()) : null,
        }
      : null;

  const cap = big(lane.capPerPeriod);
  const used = big(lane.periodUsed);
  const principal = big(lane.principal);
  const deployed = big(lane.deployedBalance);
  const sec = (x: unknown) => (x == null ? 0 : Number(x) * 1000);
  return {
    enabled: s.enabled !== false,
    dryRun: !!s.dryRun,
    returnsEnabled: !!s.returnsEnabled,
    chainId: o.chainId,
    explorer: EXPLORERS[o.chainId] ?? '',
    lastCheck: o.lastCheck.checkedAt.getTime(),
    outcome: String(o.lastCheck.outcome ?? s.outcome ?? ''),
    wallet: a.wallet ?? '',
    forwarder: a.forwarder ?? '',
    safe: a.safe ?? '',
    offRamp: { name: String(s.offRamp?.name ?? ''), rail: String(s.offRamp?.rail ?? ''), address: String(s.offRamp?.address ?? a.offRamp ?? '') },
    bank: String(s.bank ?? ''),
    cutoff: {
      next: sec(cov.next),
      through: sec(cov.through ?? cov.next),
      rollover: !!cov.rollover,
      forcedAt: sec(f.forcedAt),
      latencyMinutes: Number(f.latencyMinutes ?? 0),
      measuredMinutes: s.measuredLatencyMinutes == null ? null : Number(s.measuredLatencyMinutes),
    },
    byCutoff: Object.entries(s.byCutoff ?? {})
      .map(([t, v]) => [Number(t) * 1000, usd(v as string)] as [number, number])
      .sort((x, y) => x[0] - y[0]),
    due: usd(f.due),
    dueSettled: usd(f.dueSettled),
    duePending: usd(f.duePending),
    buffer: usd(f.buffer),
    target: usd(f.target),
    csa: usdOrNull(f.csa),
    inFlight: usd(f.inFlight),
    need: usd(big(f.need) > 0n ? f.need : 0),
    surplus: usd(f.surplus),
    pendingCredit: usd(s.pendingCredit),
    netting: { collection: usdOrNull(s.collection), bookedToday: done ? usd(done.book) : 0, drawsDue: usd(f.due) },
    today: {
      day: today,
      sent: done ? usd(done.deploy) : 0,
      booked: done ? usd(done.book) : 0,
      returnedPool: done ? usd(done['return-pool']) : 0,
      returnedMargin: done ? usd(done['return-margin']) : 0,
      marginAdvanced: done ? usd(done['margin-advance']) : 0,
    },
    week: { days: week.length, sent: sum('fundedPool'), booked: sum('fundedBook'), returnedPool: sum('returnedPool'), returnedMargin: sum('returnedMargin') },
    lane: {
      upgraded,
      stopped: upgraded && !!lane.stopped,
      cap: usd(cap),
      used: usd(used),
      left: usd(cap > used ? cap - used : 0n),
      periodSeconds: Number(lane.periodSeconds ?? 0),
      periodStart: upgraded && lane.periodStart ? sec(lane.periodStart) : null,
      headroom: usd(lane.headroom),
      headroomUsed: usd(deployed > principal ? deployed - principal : 0n),
      principal: usd(principal),
      deployed: usd(deployed),
      poolRoom: usd(f.poolRoom),
    },
    allowance: {
      cap: usd(al.amount),
      spent: usd(al.spent),
      remaining: usd(f.forwardLeft),
      resetMinutes: Number(al.resetTimeMin ?? 0),
    },
    setup,
    needsHuman,
    halted: o.halted ? { id: o.halted.id, error: o.halted.error ?? '', at: o.halted.finishedAt?.getTime() ?? null } : null,
    marginOutstanding: usd(o.marginOutstanding),
    recent: o.recent.map(move),
  };
}

/** The seeded card: a weekday with one book transfer and one lane Deployment, as the other seeded cards are samples. */
export function settlementFundingSeed(now: number): SettlementCard {
  const h = (n: number) => '0x' + n.toString(16).padStart(64, '0');
  const next = now + 5 * 3_600_000;
  return {
    enabled: true,
    dryRun: false,
    returnsEnabled: false,
    chainId: 84532,
    explorer: EXPLORERS[84532],
    lastCheck: now - 9 * 60_000,
    outcome: 'funded',
    wallet: '0x5e77ed5fd1b3a6a0c3e5c0de57a1c0b3d5a9e2f4',
    forwarder: '0x9f0ad1e3a9cb0e7f2d4c5b6a7e8f9a0b1c2d3e4f',
    safe: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
    offRamp: { name: 'mock', rail: 'same-day ACH', address: '0x0ff0000000000000000000000000000000000c5a' },
    bank: 'lithic',
    cutoff: { next, through: next, rollover: false, forcedAt: next - 5 * 3_600_000, latencyMinutes: 240, measuredMinutes: 212 },
    byCutoff: [[next, 2_316.4]],
    due: 2_316.4,
    dueSettled: 2_316.4,
    duePending: 0,
    buffer: 1_000,
    target: 3_316.4,
    csa: 1_120.15,
    inFlight: 2_196.25,
    need: 0,
    surplus: 0,
    pendingCredit: 684.9,
    netting: { collection: 412.6, bookedToday: 1_412.6, drawsDue: 2_316.4 },
    today: { day: new Date(now).toISOString().slice(0, 10), sent: 0, booked: 1_412.6, returnedPool: 0, returnedMargin: 0, marginAdvanced: 0 },
    week: { days: 5, sent: 3_850, booked: 6_204.35, returnedPool: 640, returnedMargin: 0 },
    lane: { upgraded: true, stopped: false, cap: 5_000, used: 1_783.65, left: 3_216.35, periodSeconds: 604_800, periodStart: now - 3 * 86_400_000, headroom: 1_000, headroomUsed: 0, principal: 9_400, deployed: 8_870, poolRoom: 1_530 },
    allowance: { cap: 5_000, spent: 1_783.65, remaining: 3_216.35, resetMinutes: 10_080 },
    setup: [],
    needsHuman: null,
    halted: null,
    marginOutstanding: 0,
    recent: [
      { id: 2, at: now - 2 * 3_600_000, kind: 'deploy', status: 'forwarded', amount: 783.65, cutoffAt: next, txs: [['deploySettlement', h(0xb1)], ['forward', h(0xb2)]], error: null },
      { id: 1, at: now - 2 * 3_600_000, kind: 'book', status: 'booked', amount: 1_412.6, cutoffAt: next, txs: [], error: null },
    ],
  };
}
