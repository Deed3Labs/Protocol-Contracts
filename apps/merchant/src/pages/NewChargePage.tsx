import { Columns } from '@/shell/AppShell';
import { Cap, Inset } from '@/shell/ui';

/**
 * Raising a charge. Amount, then straight to the code — two taps, no choice screen.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 2 and 3.
 */
export default function NewChargePage() {
  return (
    <Columns
      action={
        <><Cap>New charge</Cap>
          <Inset>
            Amount entry and the code go here.
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
