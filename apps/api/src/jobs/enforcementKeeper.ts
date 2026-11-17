import { enforcementDeps, isEnforcementConfigured, liquidatorHasSection12, runEnforcementKeeper } from '../services/chain/enforcement.js';

/*
 * The enforcement keeper's clock (Phase 2b, 12.5 and 12.8), the cycle keeper's sibling. See
 * services/chain/enforcement for what it calls and why.
 *
 * Hourly. A shortfall's wait is at least 72 hours and an excess is settled once it stands, so an hour
 * is prompt; a pass with nothing due is a few reads per member. Bounded per run
 * (ENFORCEMENT_KEEPER_MAX_PER_RUN, default 25). A member under an active Liquidation Hold is skipped.
 * Only on a Liquidator with the section 12 paths.
 */

const HOUR_MS = 60 * 60 * 1000;

async function tick(): Promise<void> {
  const deps = enforcementDeps();
  if (!deps) return;
  try {
    const run = await runEnforcementKeeper(deps);
    const sent = run.results.filter((r) => r.ok && r.txHash);
    if (sent.length) console.log(`[enforcement] ${sent.map((r) => `${r.action} ${r.wallet}`).join(', ')}`);
    if (run.held) console.log(`[enforcement] ${run.held} member(s) under a Liquidation Hold, left alone`);
    if (run.deferred) console.log(`[enforcement] ${run.deferred} call(s) left for the next run`);
  } catch (error) {
    console.error('[enforcement] pass failed:', (error as Error)?.message);
  }
}

export async function startEnforcementKeeper(): Promise<void> {
  if (!isEnforcementConfigured()) {
    console.log('[enforcement] disabled (needs the Liquidator, the RevolvingIssuer, CARD_SETTLER_PRIVATE_KEY for gas, and the members DB)');
    return;
  }
  if (!(await liquidatorHasSection12())) {
    console.log('[enforcement] disabled: this Liquidator has no section 12 paths (before Phase 2b)');
    return;
  }
  setInterval(() => void tick(), HOUR_MS).unref?.();
  void tick();
  console.log('[enforcement] started (hourly)');
}
