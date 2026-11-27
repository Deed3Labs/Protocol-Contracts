import { creditsMintDeps, creditsMintMode, creditsMintUnconfigured, runCreditsMint, summarize } from '../services/chain/creditsMint.js';

/*
 * The credits minting job's clock: vested ledger rows, minted on chain by the Points Issuer. See
 * services/chain/creditsMint for the rules; docs/operators/keepers.md.
 *
 * Hourly, and once at startup. Off unless CREDITS_MINT_ENABLED=1; CREDITS_MINT_DRY_RUN=1 simulates
 * and reports without sending.
 */

const HOUR_MS = 60 * 60 * 1000;

export function startCreditsMint(): void {
  const mode = creditsMintMode();
  if (mode === 'off') {
    console.log('[credits-mint] disabled (CREDITS_MINT_ENABLED unset)');
    return;
  }
  const missing = creditsMintUnconfigured();
  const deps = missing ? null : creditsMintDeps(mode);
  if (!deps) {
    console.log(`[credits-mint] disabled (${missing ?? 'not configured'})`);
    return;
  }
  const tick = async () => {
    try {
      const run = await runCreditsMint(deps);
      if (run.checked) console.log(summarize(run, mode));
    } catch (error) {
      console.error('[credits-mint] pass failed:', (error as Error)?.message);
    }
  };
  setInterval(() => void tick(), HOUR_MS).unref?.();
  void tick();
  console.log(`[credits-mint] started (hourly; ${mode === 'dry_run' ? 'dry run' : 'on'}; minter ${deps.runner.from}; ${deps.network})`);
}
