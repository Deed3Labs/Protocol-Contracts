import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { DESK_SELECTORS, erc20Interface, forwarderInterface, isSettlementDeployedFor, laneInterface, SETTLEMENT_DEPLOYED_TOPIC, twoPersonDeployInterface } from './abi';
import { DEFAULT_DESK_CONFIG, deskConfigFromEnv, type DeskConfig } from './config';
import { assertDeskCall, decideFunding, figures, LANE_NOT_UPGRADED, poolRoom, remainderBatches, settlementRef, type DeskAddresses, type DeskReads, type LaneReads } from './desk';
import { addBusinessDays, businessDaysAfter, coverage, cutoffOn, dueCutoffFor, forcedRunAt, isBusinessDay, localDate, nextCutoff, previousCutoff, zonedInstant, type CutoffSchedule } from './schedule';

const U = 1_000_000n;
const NY: CutoffSchedule = { timeZone: 'America/New_York', cutoffMinutes: 14 * 60, businessDays: [1, 2, 3, 4, 5], holidays: ['2026-11-26'], lagDays: 0 };
const iso = (t: number) => new Date(t * 1000).toISOString();
/** A New York wall-clock time as unix seconds. */
const ny = (date: string, hh: number, mm = 0) => zonedInstant(date, hh * 60 + mm, 'America/New_York');

const a: DeskAddresses = {
  chainId: 84532,
  pool: '0x1000000000000000000000000000000000000001',
  forwarder: '0x2000000000000000000000000000000000000002',
  safe: '0x3000000000000000000000000000000000000003',
  module: '0x4000000000000000000000000000000000000004',
  usdc: '0x5000000000000000000000000000000000000005',
  wallet: '0x6000000000000000000000000000000000000006',
  offRamp: '0x7000000000000000000000000000000000000007',
};

const lane = (over: Partial<LaneReads> = {}): LaneReads => ({
  upgraded: true,
  funder: a.wallet,
  capPerPeriod: 5_000n * U,
  periodSeconds: 604_800,
  periodStart: 0,
  periodUsed: 0n,
  stopped: false,
  epoch: 0,
  headroom: 1_000n * U,
  principal: 50_000n * U,
  principalPosted: true,
  deployedBalance: 20_000n * U,
  availableCash: 100_000n * U,
  vaultCash: 100_000n * U,
  queuedShares: 0n,
  suspended: false,
  chargePending: false,
  ...over,
});

const config: DeskConfig = { ...DEFAULT_DESK_CONFIG, enabled: true, schedule: NY, buffer: 500n * U, offRampLatencyMinutes: 120, marginMinutes: 30, windowMinutes: 180, minMove: 10n * U };

function reads(now: number, over: Partial<DeskReads> = {}): DeskReads {
  return {
    now,
    coverage: coverage(now, NY),
    dueSettled: 3_000n * U,
    pendingCredit: 0n,
    recentSettled: 0n,
    csa: 1_000n * U,
    collection: 0n,
    inFlight: { book: 0n, offRamp: 0n },
    lane: lane(),
    forwarder: { moduleEnabled: true, allowance: { amount: 5_000n * U, spent: 0n, resetTimeMin: 10_080, lastResetMin: 0, nonce: 1 }, offRamp: a.offRamp, desk: a.wallet },
    operatingBalance: 0n,
    walletBalance: 0n,
    idleSurplus: null,
    marginOutstanding: 0n,
    measuredLatencyMinutes: null,
    ...over,
  };
}

// Tuesday 17 Nov 2026, 11:00 New York: inside the window for the 14:00 cut-off (forced at 11:30).
const TUE = ny('2026-11-17', 11);

describe('the cut-off calendar', () => {
  test('business days, holidays, and the next and previous cut-off in the bank\'s zone', () => {
    expect(isBusinessDay('2026-11-17', NY)).toBe(true);
    expect(isBusinessDay('2026-11-21', NY)).toBe(false); // Saturday
    expect(isBusinessDay('2026-11-26', NY)).toBe(false); // the holiday
    expect(iso(nextCutoff(TUE, NY))).toBe('2026-11-17T19:00:00.000Z'); // 14:00 EST
    expect(iso(previousCutoff(TUE, NY))).toBe('2026-11-16T19:00:00.000Z');
    expect(iso(nextCutoff(ny('2026-11-17', 15), NY))).toBe('2026-11-18T19:00:00.000Z');
    // Across the DST change: 14:00 New York is 18:00 UTC in summer.
    expect(iso(cutoffOn('2026-07-01', NY))).toBe('2026-07-01T18:00:00.000Z');
    expect(localDate(ny('2026-11-17', 23, 30), 'America/New_York')).toBe('2026-11-17');
  });

  test('a weekday run covers the next cut-off only', () => {
    const c = coverage(TUE, NY);
    expect(c.rollover).toBe(false);
    expect(c.cutoffs).toEqual([c.next]);
  });

  test("Friday's run covers through Monday", () => {
    const c = coverage(ny('2026-11-20', 10), NY);
    expect(c.rollover).toBe(true);
    expect(iso(c.next)).toBe('2026-11-20T19:00:00.000Z');
    expect(iso(c.through)).toBe('2026-11-23T19:00:00.000Z');
  });

  test('the day before a holiday covers through the next business day; the holiday has no cut-off', () => {
    const c = coverage(ny('2026-11-25', 10), NY); // Wednesday; Thursday is the holiday
    expect(c.rollover).toBe(true);
    expect(iso(c.through)).toBe('2026-11-27T19:00:00.000Z');
    expect(iso(nextCutoff(ny('2026-11-25', 15), NY))).toBe('2026-11-27T19:00:00.000Z');
  });

  test('which cut-off a clearing is debited at, with and without a lag', () => {
    expect(iso(dueCutoffFor(ny('2026-11-17', 13), NY))).toBe('2026-11-17T19:00:00.000Z');
    expect(iso(dueCutoffFor(ny('2026-11-17', 14), NY))).toBe('2026-11-17T19:00:00.000Z'); // exactly at the cut-off
    expect(iso(dueCutoffFor(ny('2026-11-21', 12), NY))).toBe('2026-11-23T19:00:00.000Z'); // Saturday -> Monday
    const lag = { ...NY, lagDays: 1 };
    expect(iso(dueCutoffFor(ny('2026-11-17', 13), lag))).toBe('2026-11-18T19:00:00.000Z');
    expect(iso(dueCutoffFor(ny('2026-11-25', 13), lag))).toBe('2026-11-27T19:00:00.000Z'); // over the holiday
  });

  test('the forced run and the return deadline', () => {
    expect(forcedRunAt(1_000_000, 120, 30)).toBe(1_000_000 - 150 * 60);
    expect(addBusinessDays('2026-11-25', 2, NY)).toBe('2026-11-30');
    expect(iso(businessDaysAfter(ny('2026-11-20', 10), 2, NY))).toBe('2026-11-25T04:59:59.000Z');
  });
});

describe('the configuration', () => {
  test('placeholders by default, every owner value from the environment', () => {
    const c = deskConfigFromEnv({});
    expect(c.enabled).toBe(false);
    expect(c.dryRun).toBe(false);
    expect(c.returnsEnabled).toBe(false);
    const e = deskConfigFromEnv({
      SETTLEMENT_FUNDING_ENABLED: '1',
      SETTLEMENT_FUNDING_DRY_RUN: 'true',
      SETTLEMENT_RETURNS_ENABLED: 'yes',
      SETTLEMENT_CUTOFF_TIME: '16:30',
      SETTLEMENT_CUTOFF_TZ: 'America/Chicago',
      SETTLEMENT_BUSINESS_DAYS: '1,2,3,4',
      SETTLEMENT_HOLIDAYS: '2026-12-25, 2027-01-01, nonsense',
      SETTLEMENT_LAG_BUSINESS_DAYS: '1',
      SETTLEMENT_BUFFER_USDC: '2500',
      SETTLEMENT_CSA_MINIMUM_USDC: '1,000',
      SETTLEMENT_OFFRAMP_LATENCY_MINUTES: '90',
      SETTLEMENT_BOOK_TRANSFER_SAME_DAY: '1',
      SETTLEMENT_FUNDING_CAP_USDC: '5000',
      SETTLEMENT_RETURN_BUSINESS_DAYS: '5',
    });
    expect(e).toMatchObject({ enabled: true, dryRun: true, returnsEnabled: true, offRampLatencyMinutes: 90, bookSameDay: true, buffer: 2_500n * U, csaMinimum: 1_000n * U, capOverride: 5_000n * U, returnBusinessDays: 2 });
    expect(e.schedule).toEqual({ timeZone: 'America/Chicago', cutoffMinutes: 990, businessDays: [1, 2, 3, 4], holidays: ['2026-12-25', '2027-01-01'], lagDays: 1 });
    expect(deskConfigFromEnv({ SETTLEMENT_CUTOFF_TZ: 'Not/AZone', SETTLEMENT_CUTOFF_TIME: '25:00' }).schedule).toMatchObject({ timeZone: 'America/New_York', cutoffMinutes: 840 });
  });
});

describe('need, and the order it is covered in', () => {
  test('need = due + buffer - CSA - in flight', () => {
    const d = decideFunding(reads(TUE, { inFlight: { book: 200n * U, offRamp: 300n * U } }), a, config);
    expect(d.f.need).toBe(3_000n * U + 500n * U - 1_000n * U - 500n * U);
    expect(d.kind).toBe('fund');
  });

  test('the Collection Account first, then the lane for the remainder', () => {
    const d = decideFunding(reads(TUE, { collection: 1_200n * U }), a, config);
    if (d.kind !== 'fund') throw new Error(d.kind);
    expect(d.book).toBe(1_200n * U);
    expect(d.deploy).toBe(1_300n * U);
    expect(d.capShort + d.poolShort).toBe(0n);
  });

  test('the Collection Account keeps its reserve; covering all of it moves nothing from the pool', () => {
    const d = decideFunding(reads(TUE, { collection: 9_000n * U }), a, { ...config, collectionReserve: 1_000n * U });
    if (d.kind !== 'fund') throw new Error(d.kind);
    expect(d.book).toBe(2_500n * U);
    expect(d.deploy).toBe(0n);
  });

  test('never more than the cap: the rest is for people, as two Transaction Builder batches', () => {
    const d = decideFunding(reads(TUE, { lane: lane({ periodUsed: 4_000n * U }) }), a, config);
    if (d.kind !== 'fund') throw new Error(d.kind);
    expect(d.deploy).toBe(1_000n * U);
    expect(d.capShort).toBe(1_500n * U);
    expect(d.poolShort).toBe(0n);
    const ref = settlementRef(d.f.dueSettled ? reads(TUE).coverage.next : 0, d.f.due);
    const b = remainderBatches(a, d.capShort, ref, 1);
    expect(b.deployers.transactions).toEqual([{ to: a.pool, value: '0', data: twoPersonDeployInterface.encodeFunctionData('deploy', [1_500n * U, ref]) }]);
    expect(b.clOperating.transactions).toEqual([{ to: a.usdc, value: '0', data: erc20Interface.encodeFunctionData('transfer', [a.offRamp, 1_500n * U]) }]);
  });

  test("the forwarder's allowance and the bot's own cap clamp it too", () => {
    const r = reads(TUE);
    r.forwarder.allowance.spent = 4_200n * U;
    const d = decideFunding(r, a, config);
    if (d.kind !== 'fund') throw new Error(d.kind);
    expect(d.deploy).toBe(800n * U);
    const o = decideFunding(reads(TUE), a, { ...config, capOverride: 2_000n * U });
    if (o.kind !== 'fund') throw new Error(o.kind);
    expect(o.deploy).toBe(2_000n * U);
    expect(o.capShort).toBe(500n * U);
  });

  test('above the posted principal only by the Settlement Headroom; past that, the Margin', () => {
    const d = decideFunding(reads(TUE, { lane: lane({ deployedBalance: 50_200n * U }) }), a, config);
    if (d.kind !== 'fund') throw new Error(d.kind);
    expect(d.deploy).toBe(800n * U);
    expect(d.poolShort).toBe(1_700n * U);
    expect(d.capShort).toBe(0n);
    expect(d.f.headroomUsed).toBe(200n * U);
  });

  test('a two-person deploy has no Settlement Headroom: what the lane cannot send stops at the posted principal', () => {
    // D 49,500; principal 50,000 + headroom 1,000; the lane has 300 left this period.
    const d = decideFunding(reads(TUE, { lane: lane({ deployedBalance: 49_500n * U, periodUsed: 4_700n * U }) }), a, config);
    if (d.kind !== 'fund') throw new Error(d.kind);
    expect(d.deploy).toBe(300n * U);
    expect(d.capShort).toBe(200n * U); // 50,000 - (49,500 + 300)
    expect(d.poolShort).toBe(2_000n * U);
    expect(d.blocked.join(' ')).toContain('a two-person deploy up to the posted principal alone');
    const at = decideFunding(reads(TUE, { lane: lane({ deployedBalance: 50_000n * U, periodUsed: 5_000n * U }) }), a, config);
    if (at.kind !== 'fund') throw new Error(at.kind);
    expect(at.capShort).toBe(0n);
    expect(at.blocked.join(' ')).toContain('a two-person deploy has no Settlement Headroom');
  });

  test('every deploy condition: an open queue, a Suspension, a pending loss charge, no posted principal, 90% Utilization', () => {
    for (const over of [{ queuedShares: 1n }, { suspended: true }, { chargePending: true }, { principalPosted: false }]) {
      const d = decideFunding(reads(TUE, { lane: lane(over) }), a, config);
      if (d.kind !== 'fund') throw new Error(d.kind);
      expect(d.deploy).toBe(0n);
      expect(d.poolShort).toBe(2_500n * U);
      expect(d.blocked.length).toBe(1);
    }
    // D 20,000, cash 2,500: (20,000 + x) / 22,500 <= 90% -> x <= 250.
    const u = poolRoom(lane({ vaultCash: 2_500n * U, availableCash: 2_500n * U }));
    expect(u.room).toBe(250n * U);
  });

  test('the lane not set up (before its upgrade, or stopped): nothing deployed, the pool share goes to people', () => {
    const d = decideFunding(reads(TUE, { lane: lane({ funder: ethers.ZeroAddress, capPerPeriod: 0n }) }), a, config);
    if (d.kind !== 'fund') throw new Error(d.kind);
    expect(d.deploy).toBe(0n);
    expect(d.capShort).toBe(2_500n * U);
    expect(d.setup.join(' ')).toContain('no funder');
    // Before the SL upgrade settlementLane() reverts: the lane is not set up, whatever else is.
    const before = decideFunding(reads(TUE, { lane: lane({ upgraded: false, funder: ethers.ZeroAddress, capPerPeriod: 0n, headroom: 0n }) }), a, config);
    if (before.kind !== 'fund') throw new Error(before.kind);
    expect(before.deploy).toBe(0n);
    expect(before.setup).toEqual([LANE_NOT_UPGRADED]);
    expect(before.setup[0]).toContain('settlement lane is not set up');
    // Stopped: the funder stays registered, and nothing goes through the lane until two deployers restart it.
    const stopped = decideFunding(reads(TUE, { lane: lane({ stopped: true, epoch: 1 }) }), a, config);
    if (stopped.kind !== 'fund') throw new Error(stopped.kind);
    expect(stopped.deploy).toBe(0n);
    expect(stopped.capShort).toBe(2_500n * U);
    expect(stopped.setup.join(' ')).toContain('stopped');
    // The forwarder built for another Safe, module or token is not set up either.
    const other = reads(TUE);
    other.forwarder = { ...other.forwarder, safe: a.safe, module: a.module, token: a.pool };
    const o = decideFunding(other, a, config);
    if (o.kind !== 'fund') throw new Error(o.kind);
    expect(o.deploy).toBe(0n);
    expect(o.setup).toEqual([`the SettlementForwarder moves ${a.pool}, not the pool's USDC ${a.usdc}`]);
    const wrong = reads(TUE);
    wrong.forwarder.offRamp = '0x9999999999999999999999999999999999999999';
    const w = decideFunding(wrong, a, config);
    if (w.kind !== 'fund') throw new Error(w.kind);
    expect(w.deploy).toBe(0n);
    expect(w.setup.join(' ')).toContain('not the configured off-ramp');
  });

  test('before the funding window it only waits; the forced run acts', () => {
    const early = ny('2026-11-17', 7); // the window opens at 08:30 (forced 11:30 - 180 min)
    expect(decideFunding(reads(early), a, config).kind).toBe('wait');
    expect(decideFunding(reads(early), a, config, { forced: true }).kind).toBe('fund');
  });

  test('below the minimum move, nothing moves (no chasing a swipe)', () => {
    expect(decideFunding(reads(TUE, { csa: 3_495n * U }), a, config).kind).toBe('covered');
  });

  test('the CSA unreadable: nothing moves', () => {
    expect(decideFunding(reads(TUE, { csa: null }), a, config).kind).toBe('unknown');
  });

  test('late: the off-ramp cannot land before the cut-off; the book transfer is not same-day', () => {
    const d = decideFunding(reads(ny('2026-11-17', 13), { collection: 100n * U }), a, config);
    if (d.kind !== 'fund') throw new Error(d.kind);
    expect(d.late).toEqual({ book: true, deploy: true });
    const ok = decideFunding(reads(TUE, { collection: 100n * U }), a, { ...config, bookSameDay: true });
    if (ok.kind !== 'fund') throw new Error(ok.kind);
    expect(ok.late).toEqual({ book: false, deploy: false });
  });
});

describe('the buffer, the rollover and the measured latency', () => {
  test('the CSA minimum is the floor; card velocity over the latency raises it', () => {
    expect(figures(reads(TUE), { ...config, csaMinimum: 800n * U }).buffer).toBe(800n * U);
    // $10,080 settled over 7 days is $1 a minute; latency 120 + margin 30 = 150 minutes.
    const f = figures(reads(TUE, { recentSettled: 10_080n * U }), { ...config, csaMinimum: 100n * U });
    expect(f.velocityBuffer).toBe(150n * U);
    expect(f.buffer).toBe(500n * U);
    expect(figures(reads(TUE, { recentSettled: 100_800n * U }), { ...config, csaMinimum: 100n * U }).buffer).toBe(1_600n * U);
  });

  test("Friday's run adds what is authorized and not settled, by the configured share", () => {
    const fri = ny('2026-11-20', 11);
    expect(figures(reads(fri, { pendingCredit: 2_000n * U }), config).due).toBe(5_000n * U);
    expect(figures(reads(fri, { pendingCredit: 2_000n * U }), { ...config, rolloverPendingShare: 0.5 }).due).toBe(4_000n * U);
    expect(figures(reads(TUE, { pendingCredit: 2_000n * U }), config).due).toBe(3_000n * U);
  });

  test('a measured latency longer than the configured one moves the forced run earlier', () => {
    const r = reads(TUE);
    expect(figures(r, config).forcedAt).toBe(r.coverage.next - 150 * 60);
    expect(figures({ ...r, measuredLatencyMinutes: 300 }, config).forcedAt).toBe(r.coverage.next - 330 * 60);
    expect(figures({ ...r, measuredLatencyMinutes: 60 }, config).latencyMinutes).toBe(120);
  });
});

describe('surplus and the return window', () => {
  test('only surplus idle past the window goes back: the Margin first, then the pool, then the BondVault', () => {
    const r = reads(TUE, { csa: 10_000n * U, idleSurplus: 6_000n * U, marginOutstanding: 1_000n * U, lane: lane({ deployedBalance: 4_000n * U }) });
    const d = decideFunding(r, a, config);
    if (d.kind !== 'return') throw new Error(d.kind);
    expect(d.f.surplus).toBe(6_500n * U);
    expect([d.margin, d.pool, d.bondVault]).toEqual([1_000n * U, 4_000n * U, 1_000n * U]);
  });

  test('surplus not yet idle for the window, or under the minimum, stays', () => {
    expect(decideFunding(reads(TUE, { csa: 10_000n * U, idleSurplus: null }), a, config).kind).toBe('covered');
    expect(decideFunding(reads(TUE, { csa: 10_000n * U, idleSurplus: 5n * U }), a, config).kind).toBe('covered');
    // It never returns more than the surplus now.
    const d = decideFunding(reads(TUE, { csa: 4_000n * U, idleSurplus: 9_000n * U }), a, config);
    if (d.kind !== 'return') throw new Error(d.kind);
    expect(d.margin + d.pool + d.bondVault).toBe(500n * U);
  });
});

describe('the code allowlist of calls', () => {
  const ref = settlementRef(1_795_000_000, 3_000n * U);
  test('the four calls, exact, to their own contracts', () => {
    expect(() => assertDeskCall(a, { to: a.pool, data: laneInterface.encodeFunctionData('deploySettlement', [5n, ref]) }, { step: 'deploy', amount: 5n, ref })).not.toThrow();
    expect(() => assertDeskCall(a, { to: a.forwarder, data: forwarderInterface.encodeFunctionData('forward', [5n]) }, { step: 'forward', amount: 5n })).not.toThrow();
    expect(() => assertDeskCall(a, { to: a.usdc, data: erc20Interface.encodeFunctionData('approve', [a.pool, 5n]) }, { step: 'approve', amount: 5n })).not.toThrow();
    expect(() => assertDeskCall(a, { to: a.pool, data: laneInterface.encodeFunctionData('returnFunds', [5n]) }, { step: 'return', amount: 5n })).not.toThrow();
  });

  test('refused: the two-person deploy, transfers, the wrong amount, contract, ref or spender', () => {
    const bad: Array<[{ to: string; data: string }, Parameters<typeof assertDeskCall>[2], string]> = [
      [{ to: a.pool, data: twoPersonDeployInterface.encodeFunctionData('deploy', [5n, ref]) }, { step: 'deploy', amount: 5n, ref }, 'two-person deploy'],
      [{ to: a.usdc, data: erc20Interface.encodeFunctionData('transfer', [a.offRamp, 5n]) }, { step: 'forward', amount: 5n }, 'never transfers'],
      [{ to: a.pool, data: laneInterface.encodeFunctionData('deploySettlement', [6n, ref]) }, { step: 'deploy', amount: 5n, ref }, 'exact amount'],
      [{ to: a.usdc, data: laneInterface.encodeFunctionData('deploySettlement', [5n, ref]) }, { step: 'deploy', amount: 5n, ref }, 'only to the Yield Pool'],
      [{ to: a.pool, data: laneInterface.encodeFunctionData('deploySettlement', [5n, ethers.ZeroHash]) }, { step: 'deploy', amount: 5n, ref }, 'settlement ref'],
      [{ to: a.usdc, data: erc20Interface.encodeFunctionData('approve', [a.forwarder, 5n]) }, { step: 'approve', amount: 5n }, 'names only the Yield Pool'],
      [{ to: a.pool, data: forwarderInterface.encodeFunctionData('forward', [5n]) }, { step: 'forward', amount: 5n }, 'only to the SettlementForwarder'],
      [{ to: a.pool, data: laneInterface.encodeFunctionData('returnFunds', [5n]) }, { step: 'deploy', amount: 5n }, 'not the deploy call'],
    ];
    for (const [tx, want, why] of bad) expect(() => assertDeskCall(a, tx, want)).toThrow(why);
  });

  test('the selectors, and SettlementDeployed(uint256 indexed id, amount, ref, periodUsed) found by its ref', () => {
    expect(DESK_SELECTORS.forward).toBe(forwarderInterface.getFunction('forward')!.selector);
    const log = laneInterface.encodeEventLog('SettlementDeployed', [7n, 5n, ref, 9n]);
    expect(log.topics[0]).toBe(SETTLEMENT_DEPLOYED_TOPIC);
    expect(log.topics[1]).toBe(ethers.zeroPadValue('0x07', 32));
    expect(isSettlementDeployedFor(log, ref)).toBe(true);
    expect(isSettlementDeployedFor(log, ethers.ZeroHash)).toBe(false);
    // The ref only counts in its own place: not as the amount or the period's use.
    const elsewhere = laneInterface.encodeEventLog('SettlementDeployed', [7n, BigInt(ref), ethers.ZeroHash, BigInt(ref)]);
    expect(isSettlementDeployedFor(elsewhere, ref)).toBe(false);
    expect(isSettlementDeployedFor({ topics: [ethers.id('Other()')], data: log.data }, ref)).toBe(false);
  });

  test('the ref is the cut-off and the credit-portion total, hashed', () => {
    expect(settlementRef(1, 2n)).toBe(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [1n, 2n])));
    expect(settlementRef(1, 2n)).not.toBe(settlementRef(1, 3n));
  });
});
