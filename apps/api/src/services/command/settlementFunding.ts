import type { Queryable } from '../../db/db.js';
import { deskConfigFromEnv } from '../settlementFunding/config.js';
import { laneSetup, remainderBatches, type DeskAddresses } from '../settlementFunding/desk.js';
import { localDate, zonedInstant } from '../settlementFunding/schedule.js';
import { deskOverview, deskStore, type MoveRow } from '../settlementFunding/store.js';
import { settlementVerdict, type SettlementVerdict } from '../settlementFunding/verdict.js';
import { DEFAULT_DESK_CONFIG } from '../settlementFunding/config.js';

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
  /** The Savings-Backed Margin: its account's balance (null when it isn't read) and what is advanced and not yet restored. */
  margin: { held: number | null; advanced: number };
  /** When what's in flight to the CSA should land (ms): the newest forwarded move's time plus the latency; null with nothing in flight. */
  inFlightEta: number | null;
  /** Why nothing moves on its own: the desk halted (a person's stop, or a failed move) or the lane stopped on chain. */
  stopped: { by: string | null; at: number | null; why: string } | null;
  /** Will the swipes settle at the next cut-off (the desk's own rule); null while the CSA can't be read. */
  verdict: SettlementVerdict | null;
  /** The cut-off's own zone: every time the card says is in it, so the page and the verdict agree. */
  timeZone: string;
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

  const cfg = deskConfigFromEnv(env);
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
    ...extras({
      s,
      halted: o.halted,
      recent: o.recent,
      laneStopped: upgraded && !!lane.stopped,
      laneReady: upgraded && !setup.length,
      cfg,
    }),
  };
}

/* the card's new parts (the redesign): the Margin, the in-flight ETA, why nothing moves, and the verdict, from the check */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extras(x: { s: any; halted: MoveRow | null; recent: MoveRow[]; laneStopped: boolean; laneReady: boolean; cfg: ReturnType<typeof deskConfigFromEnv> }) {
  const { s, cfg } = x;
  const f = s.figures ?? {};
  const cov = s.coverage ?? {};
  const sec = (v: unknown) => (v == null ? 0 : Number(v) * 1000);
  const latencyMinutes = Number(f.latencyMinutes ?? 0);
  const inFlight = usd(f.inFlight);
  const forwarded = x.recent.find((m) => m.kind === 'deploy' && m.status === 'forwarded');
  const stopped = x.halted
    ? { by: x.halted.recordedBy ?? null, at: (x.halted.finishedAt ?? x.halted.createdAt)?.getTime() ?? null, why: x.halted.error || 'A move failed and a person has to look at it' }
    : x.laneStopped
      ? { by: null, at: null, why: 'The settlement lane was stopped on chain (stopSettlementFunder)' }
      : null;
  const csa = usdOrNull(f.csa);
  const verdict =
    csa === null
      ? null
      : settlementVerdict(
          {
            due: usd(f.due),
            buffer: usd(f.buffer),
            csa,
            inFlight,
            collection: usdOrNull(s.collection),
            laneRoom: usd(f.poolRoom),
            capLeft: usd(f.capLeft),
            forwardLeft: usd(f.forwardLeft),
            laneReady: x.laneReady,
            stopped: stopped ? { why: stopped.why } : null,
            dryRun: !!s.dryRun,
            cutoff: sec(cov.next),
            forcedAt: sec(f.forcedAt),
            latencyMinutes,
            timeZone: cfg.schedule.timeZone,
          },
          cfg,
        );
  return {
    margin: { held: usdOrNull(s.marginHeld), advanced: usd(s.marginOutstanding) },
    inFlightEta: inFlight > 0 && forwarded ? (forwarded.forwardedAt ?? forwarded.createdAt).getTime() + latencyMinutes * 60_000 : null,
    stopped,
    verdict,
    timeZone: cfg.schedule.timeZone,
  };
}

/** The reference's four states (Money → Overview): Covered, On track, Short and Stopped. */
export type SettlementSeedState = 'covered' | 'ontrack' | 'short' | 'stopped';

/**
 * The seeded card, in step with the reference: its "now" is 20 h 56 min before a 13:00 cut-off (16:04 the day before),
 * the desk's forced run at 08:00 and pool money by 09:00 (a 240-minute latency). Covered by default.
 */
export function settlementFundingSeed(now: number, state: SettlementSeedState = 'covered'): SettlementCard {
  const h = (n: number) => '0x' + n.toString(16).padStart(64, '0');
  const MIN = 60_000,
    HOUR = 60 * MIN;
  const next = now + 20 * HOUR + 56 * MIN;
  const forcedAt = next - 5 * HOUR;
  const short = state === 'short',
    ontrack = state === 'ontrack',
    stoppedState = state === 'stopped';
  const due = short ? 5_850 : 2_316.4,
    dueSettled = short ? 5_120.4 : 1_890.2;
  const inFlight = ontrack || stoppedState ? 0 : 2_196.25;
  const csa = 1_120.15,
    buffer = 1_000;
  const used = short ? 3_980 : 1_783.65;
  const collection = short ? 0 : 412.6;
  const bookedToday = ontrack ? 1_000 : 1_412.6;
  const stopped = stoppedState ? { by: 'Dana Ruiz', at: now - 54 * MIN, why: 'A forward reverted: CL Operating’s allowance was spent' } : null;
  const lane = { upgraded: true, stopped: false, cap: 5_000, used, left: 5_000 - used, periodSeconds: 604_800, periodStart: now - 3 * 86_400_000, headroom: 1_000, headroomUsed: 0, principal: 9_400, deployed: 8_870, poolRoom: 3_412.98 };
  const verdict = settlementVerdict(
    { due, buffer, csa, inFlight, collection, laneRoom: lane.poolRoom, capLeft: lane.left, forwardLeft: lane.left, laneReady: true, stopped, dryRun: false, cutoff: next, forcedAt, latencyMinutes: 240, timeZone: DEFAULT_DESK_CONFIG.schedule.timeZone },
    DEFAULT_DESK_CONFIG,
  );
  // what the desk moved for this cut-off, newest first
  const deployMove = { id: 3, at: now - 2 * HOUR, kind: 'deploy', status: 'forwarded', amount: 2_196.25, cutoffAt: next, txs: [['deploySettlement', h(0xb1)], ['forward', h(0xb2)]] as Array<[string, string]>, error: null };
  const bookMove = { id: 2, at: now - 2 * HOUR - MIN, kind: 'book', status: 'booked', amount: bookedToday, cutoffAt: next, txs: [] as Array<[string, string]>, error: null };
  const stopMove = { id: 4, at: now - 54 * MIN, kind: 'stop', status: 'failed', amount: 0, cutoffAt: next, txs: [] as Array<[string, string]>, error: 'Dana Ruiz · forward reverted' };
  const recent = stoppedState ? [stopMove, bookMove] : inFlight ? [deployMove, bookMove] : [bookMove];
  return {
    enabled: true,
    dryRun: false,
    returnsEnabled: false,
    chainId: 84532,
    explorer: EXPLORERS[84532],
    lastCheck: now - 9 * MIN,
    outcome: stoppedState ? 'halted' : 'funded',
    wallet: '0x5e77ed5fd1b3a6a0c3e5c0de57a1c0b3d5a9e2f4',
    forwarder: '0x9f0ad1e3a9cb0e7f2d4c5b6a7e8f9a0b1c2d3e4f',
    safe: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
    offRamp: { name: 'mock', rail: 'same-day ACH', address: '0x0ff0000000000000000000000000000000000c5a' },
    bank: 'lithic',
    cutoff: { next, through: next, rollover: false, forcedAt, latencyMinutes: 240, measuredMinutes: 212 },
    byCutoff: [[next, due]],
    due,
    dueSettled,
    duePending: Math.round((due - dueSettled) * 100) / 100,
    buffer,
    target: due + buffer,
    csa,
    inFlight,
    need: Math.max(0, Math.round((due + buffer - csa - inFlight) * 100) / 100),
    surplus: 0,
    pendingCredit: 684.9,
    netting: { collection, bookedToday, drawsDue: due },
    today: { day: new Date(now).toISOString().slice(0, 10), sent: inFlight, booked: bookedToday, returnedPool: 0, returnedMargin: 0, marginAdvanced: 0 },
    week: { days: 5, sent: 3_850, booked: 6_204.35, returnedPool: 640, returnedMargin: 0 },
    lane,
    allowance: { cap: 5_000, spent: used, remaining: 5_000 - used, resetMinutes: 10_080 },
    setup: [],
    needsHuman: null,
    halted: stoppedState ? { id: 4, error: stopped!.why, at: stopped!.at } : null,
    marginOutstanding: 0,
    recent,
    margin: { held: 1_840, advanced: 0 },
    inFlightEta: inFlight ? now + 92 * MIN : null,
    stopped,
    verdict,
    timeZone: DEFAULT_DESK_CONFIG.schedule.timeZone,
  };
}
