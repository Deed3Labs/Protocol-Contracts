import { Columns } from '@/shell/AppShell';
import { Cap, Inset } from '@/shell/ui';

/**
 * The charge list and, behind it, charge detail and the refund flow.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 6 and 15.
 */
export default function ChargesPage() {
  return (
    <Columns
      action={
        <><Cap>Charges</Cap>
          <Inset>
            Charge list goes here.
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
