/*
 * Making memory visible before it becomes an outage.
 *
 * Right now "we are running out of memory" is something you learn from a bill or a restart. There
 * is no record of whether the process sits flat at 400MB and spikes, or climbs steadily for six
 * hours and gets killed — and those two have completely different fixes. Without the shape of the
 * curve, every diagnosis is a guess, including mine.
 *
 * So this logs the numbers on a slow interval and says something louder when growth looks
 * monotonic. It is deliberately cheap: one call to process.memoryUsage(), no allocation of
 * consequence, five minutes apart. Diagnosing a CPU problem by adding work would be its own joke.
 *
 * What to look for in the logs:
 *
 *   rss flat, heapUsed sawtooth        healthy — GC is keeping up
 *   heapUsed climbing across sawteeth  a leak; the floor rising is the tell, not the peaks
 *   rss >> heapTotal                   the leak is outside the JS heap: buffers, sockets, native
 *   heapUsed near heapTotal, sustained GC pressure — this is what burns CPU without doing work
 */

const INTERVAL_MS = 5 * 60 * 1000;

/** Growth over this many samples before it is worth saying out loud. */
const TREND_SAMPLES = 6;

const MB = 1024 * 1024;

const recentHeapFloor: number[] = [];

function mb(bytes: number): number {
  return Math.round(bytes / MB);
}

/**
 * True when every sample is above the one before it.
 *
 * Monotonic growth across half an hour is the signature worth flagging. A single high reading is
 * just a busy moment, and warning on those trains people to ignore the warnings.
 */
function isClimbing(samples: number[]): boolean {
  if (samples.length < TREND_SAMPLES) return false;
  return samples.every((value, i) => i === 0 || value > samples[i - 1]);
}

function tick(): void {
  const { rss, heapUsed, heapTotal, external } = process.memoryUsage();

  recentHeapFloor.push(heapUsed);
  if (recentHeapFloor.length > TREND_SAMPLES) recentHeapFloor.shift();

  const line =
    `[memory] rss=${mb(rss)}MB heap=${mb(heapUsed)}/${mb(heapTotal)}MB external=${mb(external)}MB`;

  // Heap pressing against its own total is the state that burns CPU without doing any work: the
  // collector runs constantly and reclaims almost nothing. It shows up on a bill as CPU, not memory.
  if (heapTotal > 0 && heapUsed / heapTotal > 0.9) {
    console.warn(`${line} — heap over 90% of total, GC will be spending CPU here`);
    return;
  }

  if (isClimbing(recentHeapFloor)) {
    const growthMb = mb(recentHeapFloor[recentHeapFloor.length - 1] - recentHeapFloor[0]);
    console.warn(`${line} — heap climbed ${growthMb}MB across ${TREND_SAMPLES} samples, no plateau`);
    return;
  }

  console.log(line);
}

export function startMemoryMonitor(): void {
  if ((process.env.MEMORY_MONITOR || 'on').trim().toLowerCase() === 'off') return;
  setInterval(tick, INTERVAL_MS).unref();
  tick();
  console.log('[memory] monitor started (5m interval, MEMORY_MONITOR=off to silence)');
}
