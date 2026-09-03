import { Columns, Panel } from '@/shell/AppShell';

/**
 * The charge list and, behind it, charge detail and the refund flow.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 6 and 15.
 */
export default function ChargesPage() {
  return (
    <Columns
      action={
        <Panel title="Charges">
          <div className="rounded-[var(--clear-radius)] border border-dashed border-[var(--clear-border-strong)] bg-[var(--clear-surface-1)] p-5 text-[13px] text-[var(--clear-text-secondary)]">
            Charge list goes here.
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
