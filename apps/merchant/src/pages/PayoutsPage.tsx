import { Columns, Panel } from '@/shell/AppShell';

/**
 * What the shop is owed, when it lands, and withdrawing early. Owner only.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 7.
 */
export default function PayoutsPage() {
  return (
    <Columns
      action={
        <Panel title="Payouts">
          <div className="rounded-[var(--clear-radius)] border border-dashed border-[var(--clear-border-strong)] bg-[var(--clear-surface-1)] p-5 text-[13px] text-[var(--clear-text-secondary)]">
            Payouts go here.
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
