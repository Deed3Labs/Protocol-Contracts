import {
  identityUnreadable,
  onboardingDeps,
  onboardingMode,
  onboardingUnconfigured,
  runCreditOnboarding,
  summarize,
} from '../services/chain/creditOnboarding.js';

/*
 * Credit onboarding's clock: attest each verified member's state, then open their line. See
 * services/chain/creditOnboarding for what it sends and when; docs/operators/keepers.md.
 *
 * Hourly, and once at startup to catch up after a deploy. Off unless CREDIT_ONBOARDING_ENABLED=1;
 * CREDIT_ONBOARDING_DRY_RUN=1 simulates and reports without sending. Bounded per run
 * (CREDIT_ONBOARDING_MAX_PER_RUN, default 25 members). One summary line per run; until the attester
 * holds STATE_ATTESTER_ROLE, that line says attestations are paused and nothing else is logged.
 * Signup and a passed identity check also onboard their member at once (onboardInBackground).
 */

const HOUR_MS = 60 * 60 * 1000;

async function tick(mode: 'dry_run' | 'live'): Promise<void> {
  const deps = onboardingDeps(mode);
  if (!deps) return;
  try {
    const run = await runCreditOnboarding(deps);
    if (run.checked) console.log(summarize(run, mode));
  } catch (error) {
    console.error('[credit-onboarding] pass failed:', (error as Error)?.message);
  }
}

export function startCreditOnboarding(): void {
  const mode = onboardingMode();
  if (mode === 'off') {
    console.log('[credit-onboarding] disabled (CREDIT_ONBOARDING_ENABLED unset)');
    return;
  }
  const missing = onboardingUnconfigured();
  const deps = missing ? null : onboardingDeps(mode);
  if (!deps) {
    console.log(`[credit-onboarding] disabled (${missing ?? 'needs the RevolvingIssuer, the NetworkRegistry and CREDIT_OPERATOR_PRIVATE_KEY'})`);
    return;
  }
  const identity = identityUnreadable();
  if (identity) console.warn(`[credit-onboarding] ${identity}: no state will be attested`);
  setInterval(() => void tick(mode), HOUR_MS).unref?.();
  void tick(mode);
  console.log(`[credit-onboarding] started (hourly; ${mode === 'dry_run' ? 'dry run' : 'on'}; attester ${deps.attester.from})`);
}
