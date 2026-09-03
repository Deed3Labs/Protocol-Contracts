import { Columns } from '@/shell/AppShell';
import { Cap, Inset } from '@/shell/ui';

/**
 * What the shop is owed, when it lands, and withdrawing early. Owner only.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 7.
 */
export default function PayoutsPage() {
  return (
    <Columns
      action={
        <><Cap>Payouts</Cap>
          <Inset>
            Payouts go here.
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
