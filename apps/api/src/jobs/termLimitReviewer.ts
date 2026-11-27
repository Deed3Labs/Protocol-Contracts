import { autoTermLimitsOn, isTermLimitsConfigured, reviewTermLimits } from '../services/credit/termLimitService.js';

/*
 * Term limits growing with a member's record, which nothing else does.
 *
 * Hourly, because growth is counted in installments a month apart: an hour's delay in a raise is
 * nothing, and a pass where nobody has earned one is reads and no transactions.
 *
 * It runs once at startup too. Every verified member who joined before this existed is sitting on a
 * zero limit right now, and the first pass is what gives them the starter line. It also catches
 * members whose identity check cleared after they finished joining, which the join hook cannot see.
 */

const HOUR_MS = 60 * 60 * 1000;

// A pass over many members takes a while; a slow chain must not stack a second one on top of it.
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const results = await reviewTermLimits();
    const raised = results.filter((r) => r.action === 'raised');
    const late = results.filter((r) => r.action === 'late');
    const failed = results.filter((r) => r.action === 'failed');
    if (raised.length) console.log(`[term-limit] raised ${raised.length} limit(s)`);
    if (late.length) console.log(`[term-limit] ${late.length} member(s) behind; growth reset`);
    if (failed.length) console.warn(`[term-limit] ${failed.length} review(s) failed`);
  } catch (error) {
    console.error('[term-limit] review failed:', (error as Error)?.message);
  } finally {
    running = false;
  }
}

export function startTermLimitReviewer(): void {
  if (!isTermLimitsConfigured()) {
    console.log('[term-limit] reviewer disabled (needs the term issuer, the operator key and both databases)');
    return;
  }
  if (!autoTermLimitsOn()) {
    console.log('[term-limit] reviewer disabled (AUTO_TERM_LIMITS is off on this chain)');
    return;
  }
  setInterval(() => void tick(), HOUR_MS).unref?.();
  void tick();
  console.log('[term-limit] reviewer started (hourly)');
}
