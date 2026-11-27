import {
  bondPledgeMode,
  isPledgeKeeperConfigured,
  pledgeDeps,
  pledgeWiringProblem,
  poolEnforceMode,
  runPledgeKeepers,
} from '../services/chain/pledgeEnforcement.js';

/*
 * The pledge keepers' clock (decision 53). See services/chain/pledgeEnforcement for what they send
 * and when.
 *
 * Hourly, like the enforcement keeper that notices the shortfall: a shortfall's wait is 72 hours or
 * more, and an hour after it ends, or after a default, is prompt. A pass with nothing due is a few
 * reads per member. Two switches, one pass: pool shares (POOL_ENFORCE_KEEPER_ENABLED=1: enforce,
 * settle, cancelExcess) and bonds (BOND_PLEDGE_KEEPER_ENABLED=1: payPledged), each off by default and
 * each with `_DRY_RUN=1`. Bounded per run (POOL_ENFORCE_KEEPER_MAX_PER_RUN and
 * BOND_PLEDGE_KEEPER_MAX_PER_RUN, 25 each). A member under a Liquidation Hold or a 10c pause is left
 * alone. Gas: the card settler's key.
 */

const HOUR_MS = 60 * 60 * 1000;

async function tick(): Promise<void> {
  const deps = pledgeDeps();
  if (!deps) return;
  try {
    const run = await runPledgeKeepers(deps);
    const sent = run.results.filter((r) => r.outcome === 'sent');
    const wouldSend = run.results.filter((r) => r.outcome === 'would_send');
    const failed = run.results.filter((r) => r.outcome === 'failed');
    if (sent.length) console.log(`[pledge-keepers] ${sent.map((r) => `${r.action} ${r.wallet} ${r.txHash}`).join(', ')}`);
    if (wouldSend.length) console.log(`[pledge-keepers] dry run: ${wouldSend.map((r) => `${r.action} ${r.wallet}`).join(', ')}`);
    if (run.held) console.log(`[pledge-keepers] ${run.held} member(s) under a Liquidation Hold or a pause, left alone`);
    if (run.deferred) console.log(`[pledge-keepers] ${run.deferred} call(s) left for the next run`);
    if (failed.length) console.warn(`[pledge-keepers] ${failed.length} failed; alerted`);
  } catch (error) {
    console.error('[pledge-keepers] pass failed:', (error as Error)?.message);
  }
}

const word = (mode: string) => (mode === 'dry_run' ? 'dry run' : mode === 'live' ? 'on' : 'off');

export async function startPledgeKeepers(): Promise<void> {
  const pool = poolEnforceMode();
  const bond = bondPledgeMode();
  if (pool === 'off' && bond === 'off') {
    console.log('[pledge-keepers] disabled (set POOL_ENFORCE_KEEPER_ENABLED=1 and/or BOND_PLEDGE_KEEPER_ENABLED=1, with _DRY_RUN=1 first)');
    return;
  }
  if (!isPledgeKeeperConfigured()) {
    console.log('[pledge-keepers] disabled (needs the Liquidator, PoolShareEnforcer, LendingPool and BurnerBond, CARD_SETTLER_PRIVATE_KEY for gas, and the members DB)');
    return;
  }
  const problem = await pledgeWiringProblem();
  if (problem) {
    console.log(`[pledge-keepers] disabled: ${problem}`);
    return;
  }
  setInterval(() => void tick(), HOUR_MS).unref?.();
  void tick();
  console.log(`[pledge-keepers] started (hourly; pool shares ${word(pool)}, bonds ${word(bond)})`);
}
