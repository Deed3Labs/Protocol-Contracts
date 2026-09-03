import { Columns, Panel } from '@/shell/AppShell';

/**
 * The shop's own details, and its bank.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 9.
 */
export default function SettingsPage() {
  return (
    <Columns
      action={
        <Panel title="Settings">
          <div className="rounded-[var(--clear-radius)] border border-dashed border-[var(--clear-border-strong)] bg-[var(--clear-surface-1)] p-5 text-[13px] text-[var(--clear-text-secondary)]">
            Settings go here.
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
