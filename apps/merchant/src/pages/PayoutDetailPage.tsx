import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { dollars, formatCalendarDate, merchantFee, merchantPayout } from '@clear/domain';
import { Cap, Card, Inset, Row } from '@/shell/ui';
import { ALL_CHARGES, STUB_MERCHANT, STUB_PAID_PAYOUTS, STUB_STAFF } from '@/data/stubs';

/**
 * What a payout was made of.
 *
 * Not drawn in the reference, but required by it: "each payout opens to the charges inside it, so
 * any figure can be traced to the jobs that produced it". A merchant reconciling a bank deposit
 * against their own books has to get back to the tickets, and without that they will not trust the
 * number — they will ask for a spreadsheet every month instead.
 *
 * Built from the charge list's own vocabulary rather than a new one, because it answers the same
 * question in the same shape.
 */

const staffName = (id: string) => STUB_STAFF.find((s) => s.id === id)?.name ?? '—';

export default function PayoutDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const payout = STUB_PAID_PAYOUTS.find((p) => p.id === id);
  if (!payout) return <Navigate to="/payouts" replace />;

  // Stubbed: the settled charges behind this payout. Wired when the data layer is.
  const charges = ALL_CHARGES.filter((c) => c.state === 'approved');
  const gross = charges.reduce((sum, c) => sum + c.amount, 0);

  return (
    <>
      <div className="mb-4 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => navigate('/payouts')}
          aria-label="Back"
          className="text-[var(--clear-text-secondary)]"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-[16px] font-medium">{formatCalendarDate(payout.on)}</span>
      </div>

      <p className="m-0 mb-[3px] text-[26px] font-medium tabular-nums">{dollars(payout.amount)}</p>
      <p className="m-0 mb-4 text-[12.5px] text-[var(--clear-text-muted)]">
        {payout.charges} charges · Chase ····{STUB_MERCHANT.payoutAccountLast4}
      </p>

      <Inset className="mb-4 !px-4 !py-3.5">
        <div className="flex justify-between text-[13px]">
          <span className="text-[var(--clear-text-secondary)]">Charged</span>
          <span className="tabular-nums">{dollars(gross)}</span>
        </div>
        <div className="mt-[7px] flex justify-between text-[13px]">
          <span className="text-[var(--clear-text-secondary)]">
            Fee · {Math.round(STUB_MERCHANT.discountRate * 1000) / 10}%
          </span>
          <span className="tabular-nums">
            {dollars(merchantFee(gross, STUB_MERCHANT.discountRate))}
          </span>
        </div>
        <div className="mt-[7px] flex justify-between border-t-[0.5px] border-[var(--clear-border)] pt-[9px] text-[13px]">
          <span className="text-[var(--clear-text-secondary)]">You received</span>
          <span className="font-medium tabular-nums">
            {dollars(merchantPayout(gross, STUB_MERCHANT.discountRate))}
          </span>
        </div>
      </Inset>

      <Cap>The charges inside it</Cap>
      <Card rows>
        {charges.map((c) => (
          <Row
            key={c.id}
            title={c.member?.displayName ?? 'Not opened yet'}
            meta={`${formatCalendarDate(c.createdAt)} · ${staffName(c.raisedByStaffId)}`}
            right={<span>{dollars(c.amount)}</span>}
          />
        ))}
      </Card>
      <p className="m-0 mt-[13px] text-[11.5px] text-[var(--clear-text-muted)]">
        Showing a sample while the data layer is stubbed — the real payout carries all{' '}
        {payout.charges}.
      </p>
    </>
  );
}
