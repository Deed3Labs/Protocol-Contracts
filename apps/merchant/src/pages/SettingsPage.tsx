import { Columns } from '@/shell/AppShell';
import { dollars } from '@clear/domain';
import { Button, Cap, Card, Chip, Row } from '@/shell/ui';
import { useAuth } from '@/auth/authContext';
import {
  STUB_LISTING,
  STUB_MERCHANT,
  STUB_NOTIFICATIONS,
  STUB_TERMS,
} from '@/data/stubs';

/**
 * Settings — reference section 09.
 *
 * One page with sections, not a rail. A merchant has few settings and visits them rarely; a nav
 * would be more structure than content.
 *
 * **Terms are shown but not editable.** They live in the signed agreement. A settings page that
 * lets a merchant change their own rate is a settings page that will be used to change their own
 * rate — so there is nothing to edit here, and the copy says why.
 *
 * Counter staff see almost none of this: the rate, the bank and the terms are all money. What is
 * left for them is the device itself, which is why signing out lives here.
 *
 * One discrepancy with the drawing, flagged rather than resolved by guesswork. The reference lists
 * "Rate 2% · for life", but every screen that does arithmetic uses 2.5% — $23.50 on $940, $10.30
 * on $412, $401.70 paid out — and those figures are asserted in the domain's tests. The rate is
 * rendered from the merchant record so it agrees with the money; if 2% is the real term, changing
 * `discountRate` corrects all of it at once.
 */
export default function SettingsPage() {
  const { session, canSeeMoney, signOut } = useAuth();
  const ratePercent = Math.round(STUB_MERCHANT.discountRate * 1000) / 10;

  return (
    <Columns
      action={
        <>
          {canSeeMoney && (
            <>
              <Cap>Your terms</Cap>
              <Card rows className="mb-4">
                <Row
                  title={<span className="text-[var(--clear-text-secondary)]">Rate</span>}
                  right={<span>{ratePercent}%{STUB_TERMS.rateForLife ? ' · for life' : ''}</span>}
                />
                <Row
                  title={<span className="text-[var(--clear-text-secondary)]">Payout</span>}
                  right={<span>{STUB_TERMS.payoutTerms}</span>}
                />
                <Row
                  title={<span className="text-[var(--clear-text-secondary)]">Approval cap</span>}
                  right={<span>{dollars(STUB_TERMS.approvalCap)} per charge</span>}
                />
                <Row
                  title={<span className="text-[var(--clear-text-secondary)]">Partner since</span>}
                  right={
                    <span>
                      {STUB_TERMS.partnerSince}
                      {STUB_TERMS.founding ? ' · founding' : ''}
                    </span>
                  }
                />
              </Card>
              <p className="m-0 mb-4 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
                Terms are set in your agreement. To change one, talk to us — there is nothing to
                edit here.
              </p>

              <Cap>Where payouts go</Cap>
              <Card rows className="mb-4">
                <Row
                  title={`Chase ····${STUB_MERCHANT.payoutAccountLast4}`}
                  meta="Business checking"
                  right={<Button className="!px-[11px] !py-1 !text-[12px]">Change</Button>}
                />
              </Card>
            </>
          )}

          <Cap>This device</Cap>
          <Card rows>
            <Row
              title={session ? `Signed in as ${session.staff.name}` : 'Not signed in'}
              meta={session?.staff.role === 'owner' ? 'Owner · full access' : 'Counter · can charge'}
              right={
                <Button onClick={signOut} className="!px-[11px] !py-1 !text-[12px]">
                  Sign out
                </Button>
              }
            />
          </Card>
        </>
      }
      context={
        <>
          {/* The artefact that makes the waiting-room path work, which is why it is here rather
              than buried in a menu — a merchant should be able to reorder without asking. */}
          <Cap>Counter materials</Cap>
          <Card className="mb-4 !py-[15px]">
            <p className="m-0 mb-3 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
              The printed card carries the same code as this tablet. Send it home with an estimate
              and they can sign up while they wait.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1 !text-[12px]">Print counter cards</Button>
              <Button className="flex-1 !text-[12px]">Order more</Button>
            </div>
          </Card>

          {canSeeMoney && (
            <>
              <Cap>Notifications</Cap>
              <Card rows className="mb-4">
                {STUB_NOTIFICATIONS.map((n) => (
                  <Row
                    key={n.id}
                    title={<span className="text-[var(--clear-text-secondary)]">{n.label}</span>}
                    right={
                      <span className="text-[11.5px] text-[var(--clear-text-muted)]">
                        {n.on ? 'On' : 'Off'}
                      </span>
                    }
                  />
                ))}
              </Card>

              <Cap>How members see you</Cap>
              <Card className="mb-4 !py-[15px]">
                <div className="mb-3 flex items-center gap-[11px]">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--clear-bg-success)] text-[11.5px] text-[var(--clear-text-success)]">
                    {STUB_LISTING.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="m-0 text-[13px]">{STUB_MERCHANT.name}</p>
                    <p className="m-0 mt-0.5 text-[11.5px] text-[var(--clear-text-muted)]">
                      {STUB_LISTING.category} · {STUB_LISTING.town}
                    </p>
                  </div>
                  {STUB_LISTING.creditTag && (
                    <span className="ml-auto shrink-0">
                      <Chip tone="accent">Credit</Chip>
                    </span>
                  )}
                </div>
                <p className="m-0 mb-3 text-[11.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
                  Your entry in the Clear Partners directory, where members look for somewhere to
                  spend. The{' '}
                  <strong className="font-medium text-[var(--clear-text-primary)]">Credit</strong>{' '}
                  tag marks you as a shop where they can split a purchase.
                </p>
                <Button className="w-full !text-[12px]">Edit listing</Button>
              </Card>

              {/* Small and deliberate: the one place the co-op is stated plainly, away from the
                  counter where it would only slow a sale down. */}
              <Cap>Your membership</Cap>
              <Card className="!py-[15px]">
                <p className="m-0 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
                  {STUB_MERCHANT.name} is a partner member of the Clear co-op. One member, one vote
                  — the same as every other member.
                </p>
              </Card>
            </>
          )}
        </>
      }
    />
  );
}
