import { useNavigate } from 'react-router-dom';
import ReservePanel from '@/components/clear/ReservePanel';
import { BackIcon } from '@/components/clear/brand/icons';
import { ASSURANCE_RESERVE } from '@/data/clearPlaceholder';

/**
 * The assurance reserve — reached from the Assurance pane's footer.
 *
 * A pane, not a modal: it is a place. The figures are the whole point of it — a protection nobody
 * can check is a promise — so the balance, who it covers, what it has paid, and whether that is
 * enough all sit on one page, with the way through to the statements and to a claim.
 */
export default function AssuranceReservePage() {
  const navigate = useNavigate();

  return (
    <div className="max-w-[560px]">
      <div className="c-paneback mb-s2! hidden lg:flex">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="c-mclose">
          <BackIcon />
        </button>
        <h1 className="c-panetitle text-body!">The assurance reserve</h1>
      </div>
      <p className="c-det mb-s3">
        The co-op&rsquo;s shared safety fund. It is what makes the protections real rather than a promise.
      </p>
      <div className="c-slab c-one">
        <ReservePanel
          reserve={ASSURANCE_RESERVE}
          onReports={() => navigate('/assurance/reports')}
          onClaim={() => navigate('/assurance/claim')}
        />
      </div>
    </div>
  );
}
