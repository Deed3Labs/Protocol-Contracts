import { describe, expect, test } from 'bun:test';
import { settlementFundingSeed } from '../command/settlementFunding.js';
import { DEFAULT_DESK_CONFIG } from './config.js';
import { fundingPlan } from './desk.js';
import { settlementVerdict, type VerdictInput } from './verdict.js';

/* Card settlement's verdict (decision 54): the reference's four states, and the desk's own rule underneath. */

const cutoff = Date.UTC(2026, 9, 22, 13);
const base: VerdictInput = {
  due: 2316.4,
  buffer: 1000,
  csa: 1120.15,
  inFlight: 2196.25,
  collection: 412.6,
  laneRoom: 3412.98,
  capLeft: 3216.35,
  forwardLeft: 3216.35,
  laneReady: true,
  stopped: null,
  dryRun: false,
  cutoff,
  forcedAt: cutoff - 5 * 3_600_000,
  latencyMinutes: 240,
  timeZone: 'UTC',
};
const v = (x: Partial<VerdictInput> = {}) => settlementVerdict({ ...base, ...x }, DEFAULT_DESK_CONFIG);

describe('the verdict', () => {
  test('Covered: the account and what’s arriving hold what’s due and the buffer', () => {
    const r = v();
    expect([r.state, r.label, r.tone]).toEqual(['covered', 'Covered', 'settled']);
    expect(r.willMove).toEqual({ book: 0, lane: 0 });
    expect([r.gapDue, r.gapBuffer, r.after]).toEqual([0, 0, 3316.4]);
    expect(r.cells.map((c) => [c.label, c.value, c.sub])).toEqual([
      ['Due at 13:00', '$2,316.40', 'Members’ credit swipes'],
      ['Will be there', '$3,316.40', 'In the account and arriving'],
      ['Short', '$0.00', '$1,000.00 buffer kept'],
      ['Act by', '—', 'Nothing to do'],
    ]);
    expect([r.head, r.brief]).toEqual(['Covered', 'Covered · $0.00 spare']);
  });

  test('On track: the desk books the repayments, then the lane covers the rest', () => {
    const r = v({ inFlight: 0 });
    expect([r.state, r.label]).toEqual(['ontrack', 'On track']);
    expect(r.willMove).toEqual({ book: 412.6, lane: 1783.65 });
    expect([r.gapDue, r.gapBuffer]).toEqual([0, 0]);
    expect(r.cells[3]).toEqual({ label: 'Desk runs', value: '08:00', sub: 'On its own', tone: null });
    expect([r.head, r.when]).toEqual(['On track', 'Desk moves it at 08:00']);
  });

  test('Short: what the desk can move falls short of what’s due; fund by the cut-off less the latency', () => {
    const r = v({ due: 5850, collection: 0, capLeft: 1020, forwardLeft: 1020 });
    expect([r.state, r.label, r.tone]).toEqual(['short', 'Short', 'absent']);
    expect(r.willMove).toEqual({ book: 0, lane: 1020 });
    expect([r.after, r.gapDue, r.gapBuffer]).toEqual([4336.4, 1513.6, 2513.6]);
    expect(r.fundBy).toBe(cutoff - 240 * 60_000);
    expect(r.cells[2]).toEqual({ label: 'Short', value: '$1,513.60', sub: '$2,513.60 with the buffer', tone: 'absent' });
    expect(r.cells[3]).toEqual({ label: 'Fund by', value: '09:00', sub: 'Or swipes decline', tone: 'absent' });
    expect([r.head, r.when]).toEqual(['$1,513.60 short', 'Fund by 09:00']);
  });

  test('Buffer short: the swipes are covered, the buffer isn’t', () => {
    const r = v({ inFlight: 1500, collection: 0, capLeft: 0, forwardLeft: 0 });
    expect([r.state, r.label]).toEqual(['thin', 'Buffer short']);
    expect(r.gapDue).toBe(0);
    expect(r.cells[2]).toEqual({ label: 'Buffer short', value: '$696.25', sub: 'Swipes are covered', tone: 'underway' });
  });

  test('Stopped: nothing moves on its own, and the pill says why it’s short', () => {
    const r = v({ inFlight: 0, stopped: { why: 'A forward reverted' } });
    expect([r.state, r.label]).toEqual(['short', 'Desk stopped']);
    expect(r.willMove).toEqual({ book: 0, lane: 0 });
    expect([r.gapDue, r.gapBuffer]).toEqual([1196.25, 2196.25]);
    expect(r.cells[3].sub).toBe('Desk stopped');
    expect(r.line).toContain('The desk is stopped (a forward reverted)');
  });

  test('a dry run moves nothing either', () => {
    expect(v({ inFlight: 0, dryRun: true }).label).toBe('Dry run');
  });

  test('the lane moves nothing until it’s set up', () => {
    expect(v({ inFlight: 0, laneReady: false }).willMove).toEqual({ book: 412.6, lane: 0 });
  });

  test('the seed follows the reference’s four states', () => {
    const now = Date.UTC(2026, 9, 21, 16, 4);
    expect((['covered', 'ontrack', 'short', 'stopped'] as const).map((s) => settlementFundingSeed(now, s).verdict!.label)).toEqual(['Covered', 'On track', 'Short', 'Desk stopped']);
  });
});

describe('fundingPlan, the desk’s rule', () => {
  const c = { ...DEFAULT_DESK_CONFIG, minMove: 10_000_000n, collectionReserve: 100_000_000n };
  test('books above the Collection Account’s reserve, then the lane within its limits', () => {
    expect(fundingPlan({ need: 500_000_000n, collection: 300_000_000n, laneRoom: 10_000_000_000n, capLeft: 250_000_000n, forwardLeft: 10_000_000_000n, laneReady: true }, c)).toEqual({ book: 200_000_000n, deploy: 250_000_000n });
  });
  test('a move under the minimum that doesn’t close the gap is left for people', () => {
    expect(fundingPlan({ need: 500_000_000n, collection: 105_000_000n, laneRoom: 0n, capLeft: 0n, forwardLeft: 0n, laneReady: true }, c)).toEqual({ book: 0n, deploy: 0n });
  });
});

describe('before the desk has ever checked', () => {
  test('the card is its real state, nothing yet, tagged Queued while the lane waits on its timelock, Not on after', async () => {
    const { settlementFundingOff } = await import('../command/settlementFunding.js');
    const q = settlementFundingOff({}, Date.UTC(2026, 10, 18, 16), false);
    expect(q.off?.tag).toBe('Queued');
    expect([q.due, q.csa, q.inFlight, q.lane.cap]).toEqual([0, 0, 0, 0]);
    expect(q.verdict?.label).toBe('Queued');
    expect(q.verdict?.cells.map((c) => c.value)).toEqual(['$0.00', '$0.00', '$0.00', '—']);
    expect(q.cutoff.next).toBeGreaterThan(Date.UTC(2026, 10, 18, 16));
    expect(settlementFundingOff({}, Date.UTC(2026, 10, 18, 16), true).off?.tag).toBe('Not on');
    // a pool that couldn't be asked counts as queued, never as on
    expect(settlementFundingOff({}, Date.UTC(2026, 10, 18, 16), null).off?.tag).toBe('Queued');
  });
});
