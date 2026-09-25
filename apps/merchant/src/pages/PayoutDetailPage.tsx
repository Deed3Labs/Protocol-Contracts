import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { formatCalendarDate, merchantFee } from '@clear/domain';
import { IconBackChevron } from '@/brand/chargeIcons';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { usd } from '@/home/model';

/**
 * What a payout was made of — the Statement link on a payout row.
 *
 * Not drawn in the reference, but required by it: "every payout traces to its charges". A merchant
 * reconciling a bank deposit against their own books has to get back to the tickets, and without
 * that they will not trust the number. Drawn with the reference's pieces: a back row and one cell.
 */
export default function PayoutDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: position, loading } = useApi(() => api.payouts(), []);
  const { data: profile } = useApi(() => api.profile(), []);

  const payout = (position?.paid ?? []).find((p) => p.id === id);

  if (loading && !payout) return null;
  if (!payout) return <Navigate to="/payouts" replace />;

  const rate = profile?.discountRate ?? null;
  const bank = profile?.payoutAccount ?? 'your bank account';
  const net = payout.amountCents;
  const gross = rate === null || rate >= 1 ? null : Math.round(net / (1 - rate));

  const kv = (k: string, v: string, ink?: boolean) => (
    <div>
      <div className="c-kv">
        <span>{k}</span>
        <span className={ink ? 'c-v c-ink' : 'c-v'}>{v}</span>
      </div>
    </div>
  );

  return (
    <>
      <div className="c-paneback" style={{ margin: 'var(--s1) 0 var(--s2)' }}>
        <button type="button" aria-label="Back" onClick={() => navigate('/payouts')} style={{ display: 'flex' }}>
          <IconBackChevron />
        </button>
        <p className="c-panetitle">{formatCalendarDate(payout.on)}</p>
      </div>
      <div className="c-slab c-one">
        <div className="c-cell">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">This payout</p>
              <span className="c-det">
                {payout.charges} charges · {bank}
              </span>
            </div>
          </div>
          <div className="c-cmain">
            <div className="c-rows">
              {kv('Charged', gross === null ? '—' : usd(gross))}
              {kv(`Fee${rate === null ? '' : ` · ${Math.round(rate * 1000) / 10}%`}`, gross === null || rate === null ? '—' : usd(Math.round(merchantFee(gross / 100, rate) * 100)))}
              {kv('You received', usd(net), true)}
            </div>
          </div>
          <div className="c-cfoot">
            <p className="c-det">
              The {payout.charges} charges behind this payout are not itemised yet. Nothing batches charges into a payout run, so there is no
              record of which jobs produced this figure.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
