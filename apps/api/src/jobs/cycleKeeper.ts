import { isKeeperConfigured, issuerJudgesCycles, keeperDeps, runCycleKeeper } from '../services/chain/cycleKeeper.js';

/*
 * The cycle keeper's clock (Phase 2b). See services/chain/cycleKeeper for what it does and why.
 *
 * Hourly: a cycle is thirty days and its grace window days more, so an hour after a member's grace
 * ends (or after a clean line's period expires) is "within hours", and a pass with nothing due is a
 * few reads per member and no transactions. Bounded per run (CYCLE_KEEPER_MAX_PER_RUN, default 50);
 * a backlog drains oldest first. It runs once at startup too, to catch up after a deploy.
 *
 * Only on an issuer that judges cycles itself (Phase 2b). Before that, creditPeriodRenewer rolls
 * periods; on a 2b issuer the renewer stands down, because renewing a period by hand would skip the
 * judgement and the member would never earn a Clean Cycle.
 */

const HOUR_MS = 60 * 60 * 1000;

async function tick(): Promise<void> {
  const deps = keeperDeps();
  if (!deps) return;
  try {
    const run = await runCycleKeeper(deps);
    const judged = run.results.filter((r) => r.action === 'judged');
    const failed = run.results.filter((r) => r.action === 'failed');
    if (judged.length) {
      const missed = judged.filter((r) => r.clean === false).length;
      console.log(`[cycle-keeper] judged ${judged.length} cycle(s) (${judged.length - missed} clean, ${missed} missed) of ${run.checked} members`);
    }
    if (run.deferred) console.log(`[cycle-keeper] ${run.deferred} due member(s) left for the next run`);
    if (failed.length) console.warn(`[cycle-keeper] ${failed.length} failed; alerted`);
  } catch (error) {
    console.error('[cycle-keeper] pass failed:', (error as Error)?.message);
  }
}

export async function startCycleKeeper(): Promise<void> {
  if (!isKeeperConfigured()) {
    console.log('[cycle-keeper] disabled (needs the RevolvingIssuer, CARD_SETTLER_PRIVATE_KEY for gas, and the members DB)');
    return;
  }
  if (!(await issuerJudgesCycles())) {
    console.log('[cycle-keeper] disabled: this RevolvingIssuer does not judge cycles (before Phase 2b)');
    return;
  }
  setInterval(() => void tick(), HOUR_MS).unref?.();
  void tick();
  console.log('[cycle-keeper] started (hourly)');
}
