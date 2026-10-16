import { beforeEach, describe, expect, test } from 'bun:test';
import { mockReader } from './mock';
import { readerQueue } from './tables';
import { clearReaderTimings, measureReader, readerTimings, timed, timingSummary, type Timing } from './timings';

beforeEach(() => clearReaderTimings());

describe('timing the M2 (Pay case addendum)', () => {
  test('a step is timed, and a failed one is kept as failed', async () => {
    let t = 0;
    const clock = () => t;
    await timed('connect', 'STRM2-1A3F', async () => void (t += 1840), clock);
    await expect(timed('connect', 'STRM2-1A3F', async () => ((t += 9000), Promise.reject(new Error('timed out'))), clock)).rejects.toThrow('timed out');
    expect(readerTimings().map((x) => [x.step, x.ms, x.ok])).toEqual([
      ['connect', 1840, true],
      ['connect', 9000, false],
    ]);
  });

  test('the summary: median, 90th percentile and longest, failures counted apart', () => {
    const at = new Date().toISOString();
    const runs: Timing[] = [1200, 1500, 1800, 2100, 6400].map((ms) => ({ step: 'connect', ms, at, reader: 'm2', ok: true }));
    runs.push({ step: 'connect', ms: 30000, at, reader: 'm2', ok: false }, { step: 'disconnect', ms: 300, at, reader: 'm2', ok: true });
    expect(timingSummary(runs)).toEqual({
      connect: { n: 5, failed: 1, median: 1800, p90: 6400, max: 6400 },
      disconnect: { n: 1, failed: 0, median: 300, p90: 300, max: 300 },
    });
  });

  test('the table queue times what it does: find, let the counter’s go, connect, let go, the counter back', async () => {
    const q = readerQueue(async () => mockReader('ios'), { counter: () => ({ id: 'tap', kind: 'bluetooth', label: 'Clear Tap', detail: '' }) });
    await q.connectFor({ pointId: 't12', externalReaderId: 'STRM2-1A3F' });
    await q.done('t12');
    expect(readerTimings().map((x) => [x.step, x.reader])).toEqual([
      ['discover', 'STRM2-1A3F'],
      ['disconnect', 'm2'],
      ['connect', 'STRM2-1A3F'],
      ['disconnect', 'STRM2-1A3F'],
      ['counter', 'tap'],
    ]);
  });

  test('a measured series connects and lets go the asked number of times, charging nothing', async () => {
    const svc = mockReader('ios');
    const found = (await svc.discover('bluetooth'))[0]!;
    const summary = await measureReader(svc, found.id, 3, 0);
    expect(summary.connect?.n).toBe(3);
    expect(summary.disconnect?.n).toBe(3);
    expect(svc.connected()).toBeNull();
    await expect(measureReader(svc, 'NOT-HERE', 1, 0)).rejects.toThrow('No M2 NOT-HERE nearby');
  });
});
