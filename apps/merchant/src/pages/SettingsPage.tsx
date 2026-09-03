import { Columns } from '@/shell/AppShell';
import { Cap, Inset } from '@/shell/ui';

/**
 * The shop's own details, and its bank.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 9.
 */
export default function SettingsPage() {
  return (
    <Columns
      action={
        <><Cap>Settings</Cap>
          <Inset>
            Settings go here.
          </Inset>
        </>
      }
      context={
        <><Cap>Context</Cap>
          <Inset>
            Context sits here above 900px, and below the action under it.
          </Inset>
        </>
      }
    />
  );
}
