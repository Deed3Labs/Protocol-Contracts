import { Columns } from '@/shell/AppShell';
import { Button, Cap, Card, Inset, Row } from '@/shell/ui';
import { useAuth } from '@/auth/authContext';
import { STUB_MERCHANT } from '@/data/stubs';

/**
 * The shop's own details, and its bank.
 *
 * Signing out lives here rather than in the top bar: it is looked for once a day at most, and a
 * counter tablet with a sign-out control beside the nav is a tablet somebody taps by accident
 * mid-queue.
 *
 * Scaffolded in Phase 3; built from the design reference in Phase 4, section 9.
 */
export default function SettingsPage() {
  const { session, canSeeMoney, signOut } = useAuth();

  return (
    <Columns
      action={
        <>
          <Cap>Shop</Cap>
          <Card rows className="mb-3.5">
            <Row title="Name" right={<span>{STUB_MERCHANT.name}</span>} />
            {/* The rate and the bank are money: counter staff never see either. */}
            {canSeeMoney && (
              <Row title="Bank account" right={<span>Chase ····{STUB_MERCHANT.payoutAccountLast4}</span>} />
            )}
            {canSeeMoney && (
              <Row title="Rate" right={<span>{Math.round(STUB_MERCHANT.discountRate * 1000) / 10}%</span>} />
            )}
          </Card>

          <Cap>This device</Cap>
          <Card rows>
            <Row
              title={session ? `Signed in as ${session.staff.name}` : 'Not signed in'}
              meta={session?.staff.role === 'owner' ? 'Owner · full access' : 'Counter'}
              right={<Button onClick={signOut}>Sign out</Button>}
            />
          </Card>
        </>
      }
      context={
        <>
          <Cap>Context</Cap>
          <Inset>The rest of Settings is built in Phase 4, section 9.</Inset>
        </>
      }
    />
  );
}
