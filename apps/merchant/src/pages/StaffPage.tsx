import { Columns } from '@/shell/AppShell';
import { Cap, Inset } from '@/shell/ui';

/**
 * Who can raise a charge, and who can authorise a refund. Owner only.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 8.
 */
export default function StaffPage() {
  return (
    <Columns
      action={
        <><Cap>Staff</Cap>
          <Inset>
            Staff list goes here.
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
