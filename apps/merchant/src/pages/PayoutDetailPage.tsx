import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { dollars, formatCalendarDate, merchantFee } from '@clear/domain';
import { Cap, Card, Inset } from '@/shell/ui';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';

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

export default function PayoutDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: position, loading } = useApi(() => api.payouts(), []);
  const { data: profile } = useApi(() => api.profile(), []);

  const payout = (position?.paid ?? []).find((p) => p.id === id);

  if (loading && !payout) {
    return <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">Loading…</p>;
  }
  if (!payout) return <Navigate to="/payouts" replace />;

  const rate = profile?.discountRate ?? null;
  const bank = profile?.payoutAccount ?? 'your bank account';
  const net = payout.amountCents / 100;
  // The payout is recorded net, so the gross it came from is derived rather than summed. There is
  // no charge-to-payout column yet — nothing batches charges into a payout run — so the individual
  // jobs behind this figure genuinely cannot be listed, and the screen says that rather than
  // showing a plausible sample that would not add up to the total above it.
  const gross = rate === null || rate >= 1 ? null : net / (1 - rate);

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

      <p className="m-0 mb-[3px] text-[26px] font-medium tabular-nums">{dollars(net)}</p>
      <p className="m-0 mb-4 text-[12.5px] text-[var(--clear-text-muted)]">
        {payout.charges} charges · {bank}
      </p>

      <Inset className="mb-4 !px-4 !py-3.5">
        <div className="flex justify-between text-[13px]">
          <span className="text-[var(--clear-text-secondary)]">Charged</span>
          <span className="tabular-nums">{gross === null ? '—' : dollars(gross)}</span>
        </div>
        <div className="mt-[7px] flex justify-between text-[13px]">
          <span className="text-[var(--clear-text-secondary)]">
            Fee{rate === null ? '' : ` · ${Math.round(rate * 1000) / 10}%`}
          </span>
          <span className="tabular-nums">
            {gross === null || rate === null ? '—' : dollars(merchantFee(gross, rate))}
          </span>
        </div>
        <div className="mt-[7px] flex justify-between border-t-[0.5px] border-[var(--clear-border)] pt-[9px] text-[13px]">
          <span className="text-[var(--clear-text-secondary)]">You received</span>
          <span className="font-medium tabular-nums">{dollars(net)}</span>
        </div>
      </Inset>

      <Cap>The charges inside it</Cap>
      <Card>
        <p className="m-0 text-[13px] leading-[1.6] text-[var(--clear-text-secondary)]">
          The {payout.charges} charges behind this payout are not itemised yet. Nothing batches
          charges into a payout run, so there is no record of which jobs produced this figure.
        </p>
      </Card>
    </>
  );
}
