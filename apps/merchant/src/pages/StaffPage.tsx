import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dollars, fromCents, type StaffRole } from '@clear/domain';
import { Columns } from '@/shell/AppShell';
import { Button, Cap, Card, Inset, PrimaryButton, Row } from '@/shell/ui';
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
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('counter');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
                    meta={`${
                      s.role === 'owner'
                        ? 'Owner · email or passkey'
                        : s.role === 'manager'
                          ? 'Manager · PIN 4 digits'
                          : 'Counter · PIN 4 digits'
                    } · ${s.chargesThisMonth} charges this month`}
                    right={
                      <span className="text-[11.5px] text-[var(--clear-text-muted)]">
                        {s.role === 'owner'
                          ? 'Full access'
                          : s.role === 'manager'
                            ? 'Runs the shop'
                            : 'Can charge'}
                      </span>
                    }
                  />
                ))
            )}
          </Card>
          {/* The button had no handler at all. Adding staff is what makes the name on a charge
              row mean anything, so a shop with one writer stays a shop with one writer. */}
          {!adding ? (
            <Button onClick={() => setAdding(true)} className="mb-4 w-full">
              Add someone
            </Button>
          ) : (
            <Card className="mb-4 !py-3.5">
              <p className="m-0 mb-1 text-[11px] text-[var(--clear-text-muted)]">Their name</p>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Jen R."
                className="mb-2.5 w-full rounded-[8px] border-[0.5px] border-[var(--clear-border-strong)] bg-[var(--clear-surface-1)] px-3 py-2 text-[13px] outline-none"
              />
              {/* Owner is deliberately absent. Changing who owns the business is not a self-serve
                  action, and the server refuses it too — the UI just does not pretend otherwise. */}
              <p className="m-0 mb-1 text-[11px] text-[var(--clear-text-muted)]">What they can do</p>
              <div className="mb-1 grid grid-cols-2 gap-2">
                {(['counter', 'manager'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setNewRole(r)}
                    className={`rounded-[8px] border-[0.5px] py-2 text-[12.5px] ${
                      newRole === r
                        ? 'border-[var(--clear-text-primary)] bg-[var(--clear-surface-1)]'
                        : 'border-[var(--clear-border)] bg-[var(--clear-surface-1)] text-[var(--clear-text-secondary)]'
                    }`}
                  >
                    {r === 'counter' ? 'Counter' : 'Manager'}
                  </button>
                ))}
              </div>
              <p className="m-0 mb-2.5 text-[11px] leading-[1.5] text-[var(--clear-text-muted)]">
                {newRole === 'counter'
                  ? 'Raise a charge, see what is waiting, cancel one they raised. No money figures.'
                  : 'Runs the shop: the money, the roster, payouts to your bank, and refunds under your limit. Cannot change your bank or your terms.'}
              </p>

              <p className="m-0 mb-1 text-[11px] text-[var(--clear-text-muted)]">
                A four-digit PIN
              </p>
              <input
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                maxLength={4}
                placeholder="4 digits"
                className="mb-1 w-full rounded-[8px] border-[0.5px] border-[var(--clear-border-strong)] bg-[var(--clear-surface-1)] px-3 py-2 text-[13px] outline-none"
              />
              <p className="m-0 mb-2.5 text-[11px] leading-[1.5] text-[var(--clear-text-muted)]">
                It starts their shift and attributes their charges. It is not what protects the
                money.
              </p>
              <div className="flex gap-2">
                <PrimaryButton
                  disabled={saving || !newName.trim() || newPin.length !== 4}
                  onClick={async () => {
                    setSaving(true);
                    setAddError(null);
                    try {
                      await api.addStaff({ name: newName.trim(), role: newRole, secret: newPin });
                      setStaff(await api.staff());
                      setNewName('');
                      setNewPin('');
                      setNewRole('counter');
                      setAdding(false);
                    } catch (e) {
                      setAddError(e instanceof Error ? e.message : 'That could not be saved.');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="!py-2 !text-[13px]"
                >
                  {saving ? 'Adding…' : 'Add to the roster'}
                </PrimaryButton>
                <Button onClick={() => setAdding(false)} className="!py-2 !text-[13px]">
                  Cancel
                </Button>
              </div>
              {addError && (
                <p role="alert" className="m-0 mt-2 text-[12.5px]">
                  {addError}
                </p>
              )}
            </Card>
          )}

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
            <p className="m-0 mb-[3px] font-medium">Manager</p>
            <p className="m-0 mb-3 leading-[1.65] text-[var(--clear-text-secondary)]">
              Runs the shop: the money, the roster, payouts to your bank, and refunds under your
              limit. Cannot change where payouts go or what you are charged.
            </p>
            <p className="m-0 mb-[3px] font-medium">Owner</p>
            <p className="m-0 leading-[1.65] text-[var(--clear-text-secondary)]">
              Everything, including the payout account, your terms, and refunds of any size. Added
              by Clear rather than from the app.
            </p>
          </div>
          <p className="m-0 mt-3.5 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
            Counter staff never see the payout figure, the bank account, your rate or the month's
            totals. A manager sees the money but cannot redirect it.
          </p>
        </Inset>
      }
    />
  );
}
