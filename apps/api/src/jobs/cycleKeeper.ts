import {
  creditDefaultMode,
  cycleSyncMode,
  isKeeperConfigured,
  issuerJudgesCycles,
  keeperDeps,
  runCycleKeeper,
} from '../services/chain/cycleKeeper.js';

/*
 * The credit keeper's clock (Phase 2b; decision 53). See services/chain/cycleKeeper for what it
 * sends and when.
 *
 * Hourly: a cycle ends at 23:59:59 Pacific on the member's Cycle End Day, so an hour after it is
 * "within hours", and a pass with nothing due is a few reads per member and no transactions. Bounded
 * per run (CYCLE_KEEPER_MAX_PER_RUN, default 50); a backlog drains oldest first. It runs once at
 * startup too, to catch up after a deploy.
 *
 * Two switches, one pass: syncCreditPeriod (CYCLE_KEEPER_ENABLED, on unless set to 0, as it has been
 * since Phase 2b) and triggerDefault (CREDIT_DEFAULT_KEEPER_ENABLED=1, off by default). Each takes
 * `_DRY_RUN=1`. Only on an issuer that judges cycles itself (Phase 2b); before that,
 * creditPeriodRenewer rolls periods, and on a 2b issuer the renewer stands down.
 */

const HOUR_MS = 60 * 60 * 1000;

async function tick(): Promise<void> {
  const deps = keeperDeps();
  if (!deps) return;
  try {
    const run = await runCycleKeeper(deps);
    const judged = run.results.filter((r) => r.action === 'judged');
    const defaulted = run.results.filter((r) => r.action === 'defaulted');
    const wouldSend = run.results.filter((r) => r.action === 'would_send');
    const failed = run.results.filter((r) => r.action === 'failed');
    if (judged.length) {
      const missed = judged.filter((r) => r.clean === false).length;
      console.log(`[cycle-keeper] judged ${judged.length} member(s) (${judged.length - missed} clean, ${missed} missed) of ${run.checked}`);
    }
    if (defaulted.length) console.log(`[cycle-keeper] recorded ${defaulted.length} default(s): ${defaulted.map((r) => `${r.wallet} ${r.txHash}`).join(', ')}`);
    if (wouldSend.length) console.log(`[cycle-keeper] dry run: ${wouldSend.length} call(s) would be sent`);
    if (run.deferred) console.log(`[cycle-keeper] ${run.deferred} due call(s) left for the next run`);
    if (failed.length) console.warn(`[cycle-keeper] ${failed.length} failed; alerted`);
  } catch (error) {
    console.error('[cycle-keeper] pass failed:', (error as Error)?.message);
  }
}

const describeMode = (mode: string) => (mode === 'dry_run' ? 'dry run' : mode === 'live' ? 'on' : 'off');

export async function startCycleKeeper(): Promise<void> {
  const sync = cycleSyncMode();
  const def = creditDefaultMode();
  const modes = `syncCreditPeriod ${describeMode(sync)}, triggerDefault ${describeMode(def)}`;
  if (sync === 'off' && def === 'off') {
    console.log('[cycle-keeper] disabled (CYCLE_KEEPER_ENABLED=0 and CREDIT_DEFAULT_KEEPER_ENABLED unset)');
    return;
  }
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
  console.log(`[cycle-keeper] started (hourly; ${modes})`);
}
