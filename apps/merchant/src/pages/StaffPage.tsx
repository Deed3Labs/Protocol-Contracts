import { Columns } from '@/shell/AppShell';
import { Button, Cap, Card, Inset, Row } from '@/shell/ui';
import { STUB_CHARGE_COUNTS, STUB_STAFF } from '@/data/stubs';

/**
 * Staff — reference section 08.
 *
 * The tablet is shared and the roles are not. Without accounts, whoever picks it up has the
 * owner's powers, and the first time a writer taps *Withdraw now* out of curiosity the
 * relationship is over.
 *
 * **A PIN, not a login.** Nobody types a password forty times a shift. Four digits on a shared
 * device, with the owner on a real password because they reach the money.
 *
 * **Two roles, not a permission matrix.** A shop with four staff does not want checkboxes. If a
 * third is ever needed it will be "manager", and it can wait until somebody asks.
 *
 * Owner-only, guarded on the route: this is where the powers are handed out.
 */
export default function StaffPage() {
  return (
    <Columns
      action={
        <>
          <Cap>Who can use this tablet</Cap>
          <Card rows className="mb-3.5">
            {STUB_STAFF.filter((s) => s.active).map((s) => {
              const count = STUB_CHARGE_COUNTS[s.id] ?? 0;
              const credential = s.role === 'owner' ? 'password' : 'PIN 4 digits';
              return (
                <Row
                  key={s.id}
                  title={s.name}
                  // The charge count is the useful by-product of per-person sign-in: it shows who
                  // is actually offering it.
                  // The reference states "this month" on the first row only; said on every row it
                  // survives the list being reordered, which a live one will be.
                  meta={`${s.role === 'owner' ? 'Owner' : 'Counter'} · ${credential} · ${count} charges this month`}
                  right={
                    <span className="text-[11.5px] text-[var(--clear-text-muted)]">
                      {s.role === 'owner' ? 'Full access' : 'Can charge'}
                    </span>
                  }
                />
              );
            })}
          </Card>
          <Button className="w-full">Add someone</Button>
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
