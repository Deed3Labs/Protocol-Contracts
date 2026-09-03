/**
 * Merchant onboarding.
 *
 * Outside the signed-in shell: a shop working through this does not have a counter session yet,
 * and the nav would offer them places they cannot go.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 13.
 */
export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-[560px] px-4 py-10">
      <p className="mb-1 text-[13px] text-[var(--clear-text-muted)]">Clear for Merchants</p>
      <h1 className="mb-4 text-[26px] font-semibold tracking-[-0.01em]">Set up your shop</h1>
      <div className="rounded-[var(--clear-radius)] border border-dashed border-[var(--clear-border-strong)] bg-[var(--clear-surface-1)] p-5 text-[13px] text-[var(--clear-text-secondary)]">
        Onboarding goes here.
      </div>
    </div>
  );
}
