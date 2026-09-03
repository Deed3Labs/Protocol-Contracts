import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dollars, fromCents } from '@clear/domain';
import { Columns } from '@/shell/AppShell';
import { Button, Cap, Card, Inset, Row } from '@/shell/ui';
import { api, type StaffMember } from '@/data/apiClient';

/**
 * Staff — reference section 08.
 *
 * The tablet is shared and the roles are not. Without accounts, whoever picks it up has the
 * owner's powers, and the first time a writer taps *Withdraw now* out of curiosity the
 * relationship is over.
 *
 * **A PIN, not a login.** Nobody types a password forty times a shift, so counter staff get four
 * digits on a shared device. The reference's own staff list says "Owner · password", which
 * sections 19 and 20 later contradict outright — there is no password anywhere in this product,
 * because Clear holds no owner credential to check. An owner signs in through Privy with an
 * emailed code, a passkey or an existing wallet. The row says that instead of describing a
 * credential that does not exist.
 *
 * **Two roles, not a permission matrix.** A shop with four staff does not want checkboxes. If a
 * third is ever needed it will be "manager", and it can wait until somebody asks.
 *
 * Owner-only, guarded on the route: this is where the powers are handed out.
 */
export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [limitCents, setLimitCents] = useState<number | null>(null);

  useEffect(() => {
    api.staff().then(setStaff).catch(() => setStaff([]));
    // The threshold is read here rather than only on its own screen so the summary states the
    // current rule, not an invitation to go and look it up.
    api
      .refundThreshold()
      .then(({ limitCents: l }) => setLimitCents(l))
      .catch(() => setLimitCents(null));
  }, []);

  return (
    <Columns
      action={
        <>
          <Cap>Who can use this tablet</Cap>
          <Card rows className="mb-3.5">
            {staff === null ? (
              <Row title={<span className="text-[var(--clear-text-muted)]">Loading…</span>} />
            ) : staff.filter((s) => s.active).length === 0 ? (
              // An empty card collapses to a hairline and reads as a broken page. A shop always
              // has at least the owner, so getting here means the list could not be reached —
              // which is worth saying rather than showing nothing.
              <Row
                title={
                  <span className="text-[var(--clear-text-secondary)]">
                    Nobody is set up on this tablet yet
                  </span>
                }
                meta="Add someone below to put them on the roster"
              />
            ) : (
              staff
                .filter((s) => s.active)
                .map((s) => (
                  <Row
                    key={s.id}
                    title={s.name}
                    // The charge count is the useful by-product of per-person sign-in: it shows
                    // who is actually offering it, which is how a shop finds out why one counter
                    // converts and another does not.
                    // The reference states "this month" on the first row only; said on every row
                    // it survives the list being reordered, which a live one will be.
                    meta={`${s.role === 'owner' ? 'Owner · email or passkey' : 'Counter · PIN 4 digits'} · ${s.chargesThisMonth} charges this month`}
                    right={
                      <span className="text-[11.5px] text-[var(--clear-text-muted)]">
                        {s.role === 'owner' ? 'Full access' : 'Can charge'}
                      </span>
                    }
                  />
                ))
            )}
          </Card>
          <Button className="mb-4 w-full">Add someone</Button>

          {/* Stated as the rule it is, with the consequence attached. An owner reading this is
              deciding whether their weekend cover should be able to clear a refund alone. */}
          <Cap>Refunds</Cap>
          <Card rows>
            <Row
              title="Clear with your code"
              meta="Above this, only from your phone"
              right={
                <Link to="/staff/refunds" className="text-[12.5px] text-[var(--clear-text-accent)]">
                  {limitCents === null
                    ? 'Set'
                    : limitCents === 0
                      ? 'Off'
                      : `Up to ${dollars(fromCents(limitCents))}`}
                </Link>
              }
            />
          </Card>
          <p className="m-0 mt-2.5 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
            Set it to zero and every refund waits for your phone.
          </p>
        </>
      }
      context={
        <Inset className="!px-4 !py-[15px]">
          <Cap>What each role can do</Cap>
          <div className="text-[12.5px] leading-[1.9]">
            <p className="m-0 mb-[3px] font-medium">Counter</p>
            <p className="m-0 mb-3 leading-[1.65] text-[var(--clear-text-secondary)]">
              Raise a charge. See what is waiting. Cancel one they raised. Nothing else.
            </p>
            <p className="m-0 mb-[3px] font-medium">Full access</p>
            <p className="m-0 leading-[1.65] text-[var(--clear-text-secondary)]">
              Everything, including payouts, bank details, terms and staff.
            </p>
          </div>
          <p className="m-0 mt-3.5 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
            Counter staff never see the payout figure, the bank account, your rate or the month's
            totals.
          </p>
        </Inset>
      }
    />
  );
}
