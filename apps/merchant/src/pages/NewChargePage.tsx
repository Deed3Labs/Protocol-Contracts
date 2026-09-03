import { Columns, Panel } from '@/shell/AppShell';

/**
 * Raising a charge. Amount, then straight to the code — two taps, no choice screen.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 2 and 3.
 */
export default function NewChargePage() {
  return (
    <Columns
      action={
        <Panel title="New charge">
          <div className="rounded-[var(--clear-radius)] border border-dashed border-[var(--clear-border-strong)] bg-[var(--clear-surface-1)] p-5 text-[13px] text-[var(--clear-text-secondary)]">
            Amount entry and the code go here.
          </div>
        </Panel>
      }
      context={
        <Panel title="Context">
          <div className="rounded-[var(--clear-radius)] border border-dashed border-[var(--clear-border)] bg-[var(--clear-surface-1)] p-5 text-[13px] text-[var(--clear-text-muted)]">
            Context sits here above 900px, and below the action under it.
          </div>
        </Panel>
      }
    />
  );
}
