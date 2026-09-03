import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { AddSomeoneModal, RefundLimitModal } from '@/staff/StaffModals';
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
  const [adding, setAdding] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [maxCents, setMaxCents] = useState<number | null>(null);

  useEffect(() => {
    api.staff().then(setStaff).catch(() => setStaff([]));
    // The threshold is read here rather than only on its own screen so the summary states the
    // current rule, not an invitation to go and look it up.
    api
      .refundThreshold()
      .then(({ limitCents: l, maxCents: m }) => {
        setLimitCents(l);
        setMaxCents(m);
      })
      .catch(() => setLimitCents(null));
  }, []);

  return (
    <>
      {adding && (
        <AddSomeoneModal
          onClose={() => setAdding(false)}
          onAdd={async ({ name, role }) => {
            // The invite link needs an SMS provider we do not have, so the row is created now and
            // the PIN is set on first shift. The mobile is collected and not yet used — saying so
            // beats pretending a link went out.
            await api.addStaff({ name, role, secret: '' });
            setStaff(await api.staff());
          }}
        />
      )}
      {limitOpen && (
        <RefundLimitModal
          limitCents={limitCents}
          maxCents={maxCents}
          onClose={() => setLimitOpen(false)}
          onSave={async (cents) => {
            await api.setRefundThreshold(cents);
            setLimitCents(cents);
          }}
        />
      )}
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
                    meta={`${
                      s.role === 'owner'
                        ? 'Owner · Privy sign-in'
                        : s.role === 'manager'
                          ? 'Manager · PIN'
                          : 'Counter · PIN'
                    } · ${s.chargesThisMonth} charges this month`}
                    /* The manager's label is the accent one: it is the only row that says this
                       person can approve something, which is the fact an owner scans for. */
                    right={
                      <span
                        className={`text-[11.5px] ${
                          s.role === 'manager'
                            ? 'text-[var(--clear-text-accent)]'
                            : 'text-[var(--clear-text-muted)]'
                        }`}
                      >
                        {s.role === 'owner'
                          ? 'Full access'
                          : s.role === 'manager'
                            ? 'Can approve'
                            : 'Can charge'}
                      </span>
                    }
                  />
                ))
            )}
          </Card>
          {/* Add someone is a modal — one decision, taken from here and returning here. */}
          <Button onClick={() => setAdding(true)} className="w-full">
            Add someone
          </Button>
        </>
      }
      context={
        <Inset className="!px-4 !py-[15px]">
          <Cap>What each role can do</Cap>
          <div className="text-[12.5px] leading-[1.9]">
            <p className="m-0 mb-[3px] font-medium">Counter</p>
            <p className="m-0 mb-3 leading-[1.65] text-[var(--clear-text-secondary)]">
              Raise a charge. See what is waiting. Cancel one they raised. Ask for a refund, but not
              approve one.
            </p>
            <p className="m-0 mb-[3px] font-medium">Manager</p>
            <p className="m-0 mb-3 leading-[1.65] text-[var(--clear-text-secondary)]">
              All of the above, plus approve refunds up to your limit, add and remove counter staff,
              and send payouts to your business bank.
            </p>
            <p className="m-0 mb-[3px] font-medium">Owner</p>
            <p className="m-0 leading-[1.65] text-[var(--clear-text-secondary)]">
              Everything, including where payouts go, your terms, and who is a manager.
            </p>
          </div>
          <p className="m-0 mt-3.5 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
            A manager can move money along the paths you set. Only you can change the paths.
          </p>
          {/*
            The refund limit lives in this panel, not as a card of its own — reference section 08.
            It is a statement about what a role can do, so it belongs beside the roles.
          */}
          <p className="m-0 mb-2 mt-[18px] text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
            Refunds
          </p>
          <button
            type="button"
            onClick={() => setLimitOpen(true)}
            className="flex w-full items-center justify-between gap-3 border-t-[0.5px] border-[var(--clear-border)] py-[11px] text-left text-[13px]"
          >
            <span>
              <span className="block">A manager can approve</span>
              <span className="mt-0.5 block text-[11.5px] text-[var(--clear-text-muted)]">
                Above this, only you
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-[7px] whitespace-nowrap text-[var(--clear-text-secondary)]">
              {limitCents === null
                ? 'Set'
                : limitCents === 0
                  ? 'Off'
                  : `Up to ${dollars(fromCents(limitCents))}`}
              <ChevronRight size={14} className="text-[var(--clear-text-muted)]" />
            </span>
          </button>
          <p className="m-0 mt-[11px] text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
            Every refund needs a PIN. This sets whose.
          </p>

        </Inset>
      }
    />
    </>
  );
}
