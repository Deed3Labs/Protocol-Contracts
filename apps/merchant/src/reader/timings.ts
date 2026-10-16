import type { ReaderInfo, ReaderService } from './types';

/**
 * How long the M2 takes (the Pay case addendum: "Measure how long connect and disconnect take on a
 * real M2"). Every discover, connect and let-go the table reader queue does is timed and kept on
 * the tablet, the last 200. On a tablet with an M2, from Safari's Web Inspector (iPad) or
 * chrome://inspect (Android), with the app open:
 *
 *   await clearReaderTimings.measure('STRM26…', 10)   // the M2's serial; 10 rounds
 *   clearReaderTimings.summary()
 *
 * docs/hardware/m2-timing.md has the steps and what the figures decide.
 */

export type TimedStep = 'discover' | 'connect' | 'disconnect' | 'counter';

export interface Timing {
  step: TimedStep;
  ms: number;
  at: string;
  reader: string;
  ok: boolean;
}

const KEY = 'clear.reader.timings';
const KEEP = 200;

function load(): Timing[] {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as Timing[];
  } catch {
    return [];
  }
}

let list: Timing[] = load();

export function recordTiming(t: Timing): void {
  list = [...list, t].slice(-KEEP);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
  } catch {
    // A tablet that can't store keeps them for this session.
  }
}

/** Time one step; a failure is recorded too, then thrown on. */
export async function timed<T>(step: TimedStep, reader: string, fn: () => Promise<T>, now: () => number = () => performance.now()): Promise<T> {
  const start = now();
  const at = new Date().toISOString();
  try {
    const out = await fn();
    recordTiming({ step, ms: Math.round(now() - start), at, reader, ok: true });
    return out;
  } catch (e) {
    recordTiming({ step, ms: Math.round(now() - start), at, reader, ok: false });
    throw e;
  }
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;

/** Per step: how many, how many failed, and the median, 90th percentile and longest, in ms. */
export function timingSummary(from: Timing[] = list) {
  const out: Partial<Record<TimedStep, { n: number; failed: number; median: number; p90: number; max: number }>> = {};
  for (const step of ['discover', 'connect', 'disconnect', 'counter'] as TimedStep[]) {
    const ok = from.filter((t) => t.step === step && t.ok).map((t) => t.ms).sort((a, b) => a - b);
    const failed = from.filter((t) => t.step === step && !t.ok).length;
    if (!ok.length && !failed) continue;
    out[step] = ok.length ? { n: ok.length, failed, median: pct(ok, 50), p90: pct(ok, 90), max: ok[ok.length - 1]! } : { n: 0, failed, median: 0, p90: 0, max: 0 };
  }
  return out;
}

/**
 * A measured series against one M2: find it, connect, let go, `rounds` times, with the pause a
 * table's turn leaves between. Nothing is charged; no payment starts.
 */
export async function measureReader(service: ReaderService, serial: string, rounds = 10, pauseMs = 2000): Promise<ReturnType<typeof timingSummary>> {
  // Whatever was connected (the counter's reader) goes first, outside the series.
  if (service.connected()) await service.disconnect();
  const before = list.length;
  for (let i = 0; i < rounds; i += 1) {
    const found = await timed('discover', serial, () => service.discover('bluetooth'));
    const reader: ReaderInfo | undefined = found.find((r) => r.id === serial || r.label.includes(serial));
    if (!reader) throw new Error(`No M2 ${serial} nearby. Is it on and charged?`);
    await timed('connect', serial, () => service.connect(reader));
    await new Promise((r) => setTimeout(r, pauseMs));
    await timed('disconnect', serial, () => service.disconnect());
    await new Promise((r) => setTimeout(r, pauseMs));
  }
  return timingSummary(list.slice(before));
}

export const readerTimings = () => list;
export const clearReaderTimings = () => {
  list = [];
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Nothing kept, nothing to clear.
  }
};
