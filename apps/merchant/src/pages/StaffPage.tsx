import { Columns, Panel } from '@/shell/AppShell';

/**
 * Who can raise a charge, and who can authorise a refund. Owner only.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 8.
 */
export default function StaffPage() {
  return (
    <Columns
      action={
        <Panel title="Staff">
          <div className="rounded-[var(--clear-radius)] border border-dashed border-[var(--clear-border-strong)] bg-[var(--clear-surface-1)] p-5 text-[13px] text-[var(--clear-text-secondary)]">
            Staff list goes here.
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
