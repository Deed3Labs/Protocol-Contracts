import { ethers } from 'ethers';
import { capRemaining, formatUsdc, type AllowanceRead } from '../payoutFunding/topUp.js';
import { DESK_FORBIDDEN, DESK_SELECTORS, erc20Interface, twoPersonDeployInterface } from './abi.js';
import type { DeskConfig } from './config.js';
import { forcedRunAt, type Coverage } from './schedule.js';

/*
 * Settlement Funding (decision 54; L-01 §8.4A, I-02 §4.9(a), I-07 §4.10, IV-02 §4.3A): what the desk
 * decides at each run. Pure: every figure arrives as an argument.
 *
 * The Credit Settlement Account (CSA) at the bank partner must hold, at each settlement cut-off, the
 * credit portions due in that settlement plus a Settlement Buffer. At each run:
 *
 *   need = due at the next cut-off + buffer - CSA balance - in flight
 *
 * and it is covered in this order, never more than the lane's cap:
 *   1. a book transfer from the Collection Account (same bank) to the CSA;
 *   2. a Yield Pool Deployment through the settlement lane (`deploySettlement`), forwarded to the
 *      off-ramp, which pays the CSA. What the lane's cap (or the forwarder's allowance) cannot cover
 *      is prepared as Transaction Builder batches for people, as payout top-ups do;
 *   3. otherwise an alert naming the Savings-Backed Margin and the manual options.
 *
 * Cash in the CSA above the next cut-off plus the buffer, idle past the return window, goes back:
 * first to restore the Margin, then as a Return to the pool, then to the BondVault (by people).
 *
 * The ESA vault is never a source or a destination here. Nothing in this file can name it.
 *
 * Amounts are USDC base units (6 decimals). Credit portions arrive from Lithic in cents and are
 * converted once, by `centsToUnits`.
 */

export const CENTS_TO_UNITS = 10_000n;
export const centsToUnits = (cents: bigint | number) => BigInt(cents) * CENTS_TO_UNITS;
/** Utilization after a Deployment must be at most 90% (IV-02 §4.3, FIXED). */
export const MAX_UTILIZATION_BPS = 9_000n;

const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
const max = (...xs: bigint[]) => xs.reduce((a, b) => (b > a ? b : a));
const pos = (x: bigint) => (x > 0n ? x : 0n);

/* ========== READS ========== */

/**
 * The Yield Pool's settlement lane (`settlementLane()`, with the period's rollover applied) and the
 * conditions every Deployment meets.
 */
export interface LaneReads {
  /** The pool answers `settlementLane()`: false before the SL upgrade, and the lane fields are then zero. */
  upgraded: boolean;
  funder: string;
  capPerPeriod: bigint;
  periodSeconds: number;
  /** The start of the period running now (unix seconds). */
  periodStart: number;
  /** What the lane has deployed in the period running now (`usedInPeriod`). */
  periodUsed: bigint;
  /** Stopped by `stopSettlementFunder`: the funder stays registered, and only two deployers restart it. */
  stopped: boolean;
  /** The stop count, part of a `setSettlementFunder` proposal's action hash. */
  epoch: number;
  headroom: bigint;
  principal: bigint;
  principalPosted: boolean;
  deployedBalance: bigint;
  availableCash: bigint;
  vaultCash: bigint;
  queuedShares: bigint;
  suspended: boolean;
  /** A Pool Loss Charge is being applied (`pendingLossCharge()`): no Deployment until it is done. */
  chargePending: boolean;
}

/** CL Operating's AllowanceModule allowance for the SettlementForwarder (its delegate). */
export interface ForwarderReads {
  moduleEnabled: boolean;
  allowance: AllowanceRead;
  /** The forwarder's own off-ramp address, when its view answers. */
  offRamp: string | null;
  /** The forwarder's desk, when its view answers. */
  desk: string | null;
  /** What the forwarder was built with (immutable), when its views answer. */
  safe?: string | null;
  module?: string | null;
  token?: string | null;
}

export interface DeskReads {
  now: number;
  coverage: Coverage;
  /** Settled credit portions due at the covered cut-offs. */
  dueSettled: bigint;
  /** Credit portions authorized and not settled (what the Settlement Headroom is for). */
  pendingCredit: bigint;
  /** Credit settled over the last `velocityDays`, for the buffer's velocity part. */
  recentSettled: bigint;
  /** Available balances; null when they cannot be read (the desk then moves nothing). */
  csa: bigint | null;
  collection: bigint | null;
  /** Money on its way to the CSA: book transfers not landed, and off-ramp payouts not arrived. */
  inFlight: { book: bigint; offRamp: bigint };
  lane: LaneReads;
  forwarder: ForwarderReads;
  /** USDC in CL Operating, and in the desk wallet (zero except during a Return). */
  operatingBalance: bigint;
  walletBalance: bigint;
  /** The lowest surplus seen over the return window; null until the window has history. */
  idleSurplus: bigint | null;
  /** Savings-Backed Margin advanced to the CSA and not yet restored. */
  marginOutstanding: bigint;
  /** The longest off-ramp latency measured recently, minutes; null with no history. */
  measuredLatencyMinutes: number | null;
}

export interface DeskAddresses {
  chainId: number;
  pool: string;
  forwarder: string;
  /** CL Operating: the Safe Deployments land in and the forwarder spends from. */
  safe: string;
  module: string;
  usdc: string;
  /** The desk wallet (a CDP server wallet): the lane's funder and the forwarder's caller. */
  wallet: string;
  /** The off-ramp's deposit address, bound to the CSA. */
  offRamp: string;
}

/* ========== FIGURES ========== */

export interface DeskFigures {
  due: bigint;
  dueSettled: bigint;
  duePending: bigint;
  buffer: bigint;
  velocityBuffer: bigint;
  target: bigint;
  csa: bigint | null;
  inFlight: bigint;
  need: bigint;
  surplus: bigint;
  latencyMinutes: number;
  forcedAt: number;
  windowOpensAt: number;
  capLeft: bigint;
  forwardLeft: bigint;
  poolRoom: bigint;
  headroomUsed: bigint;
}

/** What the lane lets the desk deploy this period: the chain's cap less what is used, and the override. */
export function laneCapLeft(lane: LaneReads, capOverride: bigint | null): bigint {
  const chain = pos(lane.capPerPeriod - lane.periodUsed);
  if (capOverride === null) return chain;
  return min(chain, pos(capOverride - lane.periodUsed));
}

/**
 * What the pool itself allows now, by every `deploy` condition: no open queue request, no
 * Suspension, no pending loss charge, a posted principal; within vault cash; Utilization at most
 * 90% afterwards; and the Deployed Balance within the ceiling. The lane's ceiling is the posted Pool
 * Tier principal plus the Settlement Headroom; the two-person `deploy` (`twoPerson`) keeps the
 * posted principal alone. `after` is what the lane deploys first in the same run.
 */
export function poolRoom(lane: LaneReads, opts: { twoPerson?: boolean; after?: bigint } = {}): { room: bigint; blocked: string[] } {
  const blocked: string[] = [];
  if (lane.queuedShares > 0n) blocked.push('a redemption request is open in the queue');
  if (lane.suspended) blocked.push('the pool is in a Suspension');
  if (lane.chargePending) blocked.push('a Pool Loss Charge is being applied');
  if (!lane.principalPosted) blocked.push('no Pool Tier principal has been posted');
  if (blocked.length) return { room: 0n, blocked };
  const after = opts.after ?? 0n;
  const deployed = lane.deployedBalance + after;
  const cash = pos(lane.availableCash - after);
  const vault = pos(lane.vaultCash - after);
  const ceiling = lane.principal + (opts.twoPerson ? 0n : lane.headroom);
  const tier = pos(ceiling - deployed);
  const util = pos((MAX_UTILIZATION_BPS * (deployed + vault)) / 10_000n - deployed);
  const room = min(cash, tier, util);
  if (room === 0n) {
    if (cash === 0n) blocked.push('the pool has no available cash');
    else if (tier === 0n) {
      blocked.push(
        opts.twoPerson
          ? 'the Deployed Balance is at the posted Pool Tier principal (a two-person deploy has no Settlement Headroom)'
          : 'the Deployed Balance is at the posted Pool Tier principal plus the Settlement Headroom',
      );
    } else blocked.push('a Deployment would take Utilization over 90%');
  }
  return { room, blocked };
}

export function figures(r: DeskReads, c: DeskConfig): DeskFigures {
  const latencyMinutes = Math.max(c.offRampLatencyMinutes, r.measuredLatencyMinutes ?? 0);
  const forcedAt = forcedRunAt(r.coverage.next, latencyMinutes, c.marginMinutes);
  const windowOpensAt = forcedAt - c.windowMinutes * 60;
  // Card spend that settles between the forced run and the cut-off: the buffer must carry it.
  const perMinute = r.recentSettled / BigInt(c.velocityDays * 1_440);
  const velocityBuffer = perMinute * BigInt(latencyMinutes + c.marginMinutes);
  const buffer = max(c.buffer, c.csaMinimum + velocityBuffer);
  const duePending = r.coverage.rollover ? (r.pendingCredit * BigInt(Math.round(c.rolloverPendingShare * 10_000))) / 10_000n : 0n;
  const due = r.dueSettled + duePending;
  const target = due + buffer;
  const inFlight = r.inFlight.book + r.inFlight.offRamp;
  const need = r.csa === null ? 0n : target - r.csa - inFlight;
  const surplus = r.csa === null ? 0n : pos(r.csa - target);
  const capLeft = laneCapLeft(r.lane, c.capOverride);
  const forwardLeft = capRemaining(r.forwarder.allowance, null);
  return {
    due,
    dueSettled: r.dueSettled,
    duePending,
    buffer,
    velocityBuffer,
    target,
    csa: r.csa,
    inFlight,
    need,
    surplus,
    latencyMinutes,
    forcedAt,
    windowOpensAt,
    capLeft,
    forwardLeft,
    poolRoom: poolRoom(r.lane).room,
    headroomUsed: pos(r.lane.deployedBalance - r.lane.principal),
  };
}

/* ========== THE DECISION ========== */

export type DeskDecision =
  /** A balance could not be read: nothing moves. */
  | { kind: 'unknown'; why: string; f: DeskFigures }
  /** The CSA holds what is due plus the buffer (with what is in flight). */
  | { kind: 'covered'; f: DeskFigures }
  /** Short, but before the funding window: recorded only, so a run never chases a swipe. */
  | { kind: 'wait'; f: DeskFigures }
  | {
      kind: 'fund';
      f: DeskFigures;
      /** From the Collection Account, by book transfer. */
      book: bigint;
      /** Through the lane: deploySettlement then forward. */
      deploy: bigint;
      /**
       * What the lane could not cover (its cap, the forwarder's allowance, or its setup) but a
       * two-person Deployment could, within the posted principal alone: for people.
       */
      capShort: bigint;
      /** What neither the Collection Account nor the pool can cover: the Margin, or people. */
      poolShort: bigint;
      /** Lane setup that is missing (the deploy is then zero and its share goes to people). */
      setup: string[];
      /** Why the pool cannot give more. */
      blocked: string[];
      /** Whether each source lands after the cut-off (the Margin covers until it does). */
      late: { book: boolean; deploy: boolean };
    }
  /** Idle surplus to send back, in the order L-01 §8.4A gives. */
  | { kind: 'return'; f: DeskFigures; margin: bigint; pool: bigint; bondVault: bigint };

/** The lane's setup as sentences, when the pool has no lane yet. */
export const LANE_NOT_UPGRADED =
  'the settlement lane is not set up: the Yield Pool has no settlementLane() yet (the SL upgrade, a new Earn timelock proposal, has not run)';

/** The lane setup the desk needs, as sentences; empty when it is all there. */
export function laneSetup(
  r: { lane: Pick<LaneReads, 'upgraded' | 'funder' | 'stopped' | 'capPerPeriod'>; forwarder: Pick<ForwarderReads, 'moduleEnabled' | 'offRamp' | 'desk' | 'safe' | 'module' | 'token'> & { allowance: Pick<AllowanceRead, 'amount'> } },
  a: Pick<DeskAddresses, 'wallet' | 'offRamp'> & Partial<Pick<DeskAddresses, 'safe' | 'module' | 'usdc'>>,
): string[] {
  const missing: string[] = [];
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  if (!r.lane.upgraded) missing.push(LANE_NOT_UPGRADED);
  else {
    if (r.lane.funder === ethers.ZeroAddress) missing.push('the settlement lane has no funder (SL-funder-1/2 not signed yet)');
    else if (!same(r.lane.funder, a.wallet)) missing.push(`the settlement lane's funder is ${r.lane.funder}, not the desk wallet ${a.wallet}`);
    if (r.lane.stopped) missing.push('the settlement lane is stopped (stopSettlementFunder); two DEPLOYER_ROLE signers restart it (SL-funder-1/2)');
    if (r.lane.capPerPeriod === 0n) missing.push('the settlement lane has no cap per period (SL-funder-1/2)');
  }
  const fw = r.forwarder;
  if (!fw.moduleEnabled) missing.push('the AllowanceModule is not enabled on CL Operating (TU-safe-module)');
  if (fw.allowance.amount === 0n) missing.push('the SettlementForwarder has no allowance on CL Operating (SL-cl-operating-allowance)');
  if (fw.offRamp === ethers.ZeroAddress) missing.push('the SettlementForwarder has no off-ramp (SL-cl-operating-offramp)');
  else if (fw.offRamp && !same(fw.offRamp, a.offRamp)) missing.push(`the SettlementForwarder pays ${fw.offRamp}, not the configured off-ramp ${a.offRamp}`);
  if (fw.desk === ethers.ZeroAddress) missing.push('the SettlementForwarder has no desk (SL-cl-operating-desk)');
  else if (fw.desk && !same(fw.desk, a.wallet)) missing.push(`the SettlementForwarder's desk is ${fw.desk}, not the desk wallet ${a.wallet}`);
  if (fw.safe && a.safe && !same(fw.safe, a.safe)) missing.push(`the SettlementForwarder spends from ${fw.safe}, not CL Operating ${a.safe}`);
  if (fw.module && a.module && !same(fw.module, a.module)) missing.push(`the SettlementForwarder calls the AllowanceModule at ${fw.module}, not ${a.module}`);
  if (fw.token && a.usdc && !same(fw.token, a.usdc)) missing.push(`the SettlementForwarder moves ${fw.token}, not the pool's USDC ${a.usdc}`);
  return missing;
}

export function decideFunding(r: DeskReads, a: DeskAddresses, c: DeskConfig, opts: { forced?: boolean } = {}): DeskDecision {
  const f = figures(r, c);
  if (r.csa === null) return { kind: 'unknown', why: 'the CSA balance cannot be read', f };

  if (f.need < c.minMove || f.need <= 0n) {
    const idle = r.idleSurplus ?? 0n;
    if (idle >= c.minMove && f.surplus >= c.minMove) {
      const back = min(idle, f.surplus);
      const margin = min(back, r.marginOutstanding);
      const pool = min(back - margin, r.lane.deployedBalance);
      return { kind: 'return', f, margin, pool, bondVault: back - margin - pool };
    }
    return { kind: 'covered', f };
  }
  if (!opts.forced && r.now < f.windowOpensAt) return { kind: 'wait', f };

  const collectionFree = r.collection === null ? 0n : pos(r.collection - c.collectionReserve);
  let book = min(f.need, collectionFree);
  if (book < c.minMove && book < f.need) book = 0n;
  const rest = f.need - book;

  const setup = laneSetup(r, a);
  const lane = poolRoom(r.lane);
  let deploy = setup.length ? 0n : min(rest, lane.room, f.capLeft, f.forwardLeft);
  if (deploy < c.minMove && deploy < rest) deploy = 0n;
  // The rest is for two deployers, whose deploy has no Settlement Headroom: within the posted
  // principal alone, after what the lane sends first.
  const two = poolRoom(r.lane, { twoPerson: true, after: deploy });
  const capShort = min(rest - deploy, two.room);
  const poolShort = rest - deploy - capShort;
  const blocked = [...new Set([...lane.blocked, ...two.blocked])];
  if (!blocked.length) {
    blocked.push(
      `the pool allows ${formatUsdc(deploy + capShort)} more now (the lane up to the posted Pool Tier principal plus the Settlement Headroom, a two-person deploy up to the posted principal alone)`,
    );
  }
  return {
    kind: 'fund',
    f,
    book,
    deploy,
    capShort,
    poolShort,
    setup,
    blocked: poolShort > 0n ? blocked : [],
    late: { book: book > 0n && !c.bookSameDay, deploy: deploy > 0n && r.now + f.latencyMinutes * 60 > r.coverage.next },
  };
}

/* ========== THE CALLS ========== */

/** The settlement's ref: the hash of the cut-off it funds and the credit-portion total (the spec's `ref`). */
export function settlementRef(cutoff: number, due: bigint): string {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [BigInt(cutoff), due]));
}

const lower = (x: string) => x.toLowerCase();
const word = (data: string, i: number) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
const addressAt = (data: string, i: number) => '0x' + word(data, i).slice(24);
const uintAt = (data: string, i: number) => BigInt('0x' + word(data, i));

export type DeskStep = 'deploy' | 'forward' | 'approve' | 'return';

/**
 * Refuses any transaction the desk wallet should never send. It may send exactly four calls: the
 * lane's `deploySettlement` and the forwarder's `forward` (funding), and USDC `approve` to the pool
 * and the pool's `returnFunds` (a Return), each to its own contract with the exact amount. The
 * two-person `deploy`, and any USDC transfer, are refused by name.
 */
export function assertDeskCall(a: DeskAddresses, tx: { to: string; data: string }, expect: { step: DeskStep; amount: bigint; ref?: string }): void {
  const sel = lower(tx.data.slice(0, 10));
  const fail = (why: string) => {
    throw new Error(`Refusing a settlement desk transaction: ${why}.`);
  };
  if (sel === DESK_FORBIDDEN.deploy) fail('the desk never calls the two-person deploy');
  if (sel === DESK_FORBIDDEN.transfer || sel === DESK_FORBIDDEN.transferFrom) fail('the desk never transfers tokens itself');
  const want = { deploy: DESK_SELECTORS.deploySettlement, forward: DESK_SELECTORS.forward, approve: DESK_SELECTORS.approve, return: DESK_SELECTORS.returnFunds }[expect.step];
  if (sel !== want) fail(`selector ${sel} is not the ${expect.step} call`);
  if (expect.amount <= 0n) fail('the amount is not positive');
  switch (expect.step) {
    case 'deploy':
      if (lower(tx.to) !== lower(a.pool)) fail('deploySettlement goes only to the Yield Pool');
      if (uintAt(tx.data, 0) !== expect.amount) fail('deploySettlement is not the exact amount');
      if (expect.ref && lower('0x' + word(tx.data, 1)) !== lower(expect.ref)) fail('deploySettlement does not carry the settlement ref');
      return;
    case 'forward':
      if (lower(tx.to) !== lower(a.forwarder)) fail('forward goes only to the SettlementForwarder');
      if (uintAt(tx.data, 0) !== expect.amount) fail('forward is not the exact amount');
      return;
    case 'approve':
      if (lower(tx.to) !== lower(a.usdc)) fail('approve goes only to USDC');
      if (lower(addressAt(tx.data, 0)) !== lower(a.pool)) fail('approve names only the Yield Pool');
      if (uintAt(tx.data, 1) !== expect.amount) fail('approve is not the exact amount');
      return;
    case 'return':
      if (lower(tx.to) !== lower(a.pool)) fail('returnFunds goes only to the Yield Pool');
      if (uintAt(tx.data, 0) !== expect.amount) fail('returnFunds is not the exact amount');
      return;
  }
}

/* ========== FOR PEOPLE ========== */

function batch(chainId: number, createdAt: number, name: string, description: string, transactions: Array<{ to: string; value: string; data: string }>) {
  return { version: '1.0', chainId: String(chainId), createdAt, meta: { name, description }, transactions };
}

/**
 * What the lane's cap (or the forwarder's allowance) could not cover, as two Transaction Builder
 * batches: the two-person Deployment of the remainder, which each DEPLOYER_ROLE signer sends, and
 * CL Operating's transfer of it to the off-ramp once it has landed there.
 */
export function remainderBatches(a: DeskAddresses, amount: bigint, ref: string, createdAt: number) {
  const usd = formatUsdc(amount);
  return {
    deployers: batch(
      a.chainId,
      createdAt,
      `Settlement Funding remainder: Deploy ${usd}`,
      `The two-person Deployment of ${usd} to CL Operating, for the settlement ref ${ref}: what the settlement lane's cap could not cover this period. ` +
        'Each of the two DEPLOYER_ROLE signers sends this same call; the second one sends the money. Every deploy condition still applies.',
      [{ to: a.pool, value: '0', data: twoPersonDeployInterface.encodeFunctionData('deploy', [amount, ref]) }],
    ),
    clOperating: batch(
      a.chainId,
      createdAt,
      `Settlement Funding remainder: ${usd} to the off-ramp`,
      `Once the Deployment has landed, CL Operating sends ${usd} USDC to the off-ramp ${a.offRamp}, which pays the Credit Settlement Account. Review the address before signing.`,
      [{ to: a.usdc, value: '0', data: erc20Interface.encodeFunctionData('transfer', [a.offRamp, amount]) }],
    ),
  };
}

/** The manual options when the pool cannot cover the rest, in the order the agreements give. */
export function marginWords(short: bigint, blocked: string[]): string {
  return (
    `${formatUsdc(short)} of the settlement is covered by neither the Collection Account nor the Yield Pool` +
    (blocked.length ? ` (${blocked.join('; ')})` : '') +
    '. Options, in order: (1) the Savings-Backed Margin covers it at the bank (record it afterwards with ' +
    '`bun src/scripts/recordSettlementMarginAdvance.ts <dollars> "<your name>" "<note>"`, so the Pool Tier principal and the Return include it); ' +
    '(2) BondVault excess, where its documents allow, through the Collateral Agent; (3) Clear Lending\'s treasury. ' +
    'The ESA vault is never a source.'
  );
}
