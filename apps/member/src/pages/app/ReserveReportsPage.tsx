import { useNavigate } from 'react-router-dom';
import ReserveReportsPanel from '@/components/clear/ReserveReportsPanel';
import { BackIcon } from '@/components/clear/brand/icons';
import { RESERVE_REPORTS } from '@/data/clearPlaceholder';
import { useIsDesktop } from '@/lib/useIsDesktop';

/**
 * Reserve reports — what the reserve held, what it paid out, and who checked it.
 *
 * The last link in the reserve that had nowhere to go. Four statements and, plainly, the fact that
 * they are reviewed rather than independently audited.
 */
export default function ReserveReportsPage() {
  const navigate = useNavigate();
  const desktop = useIsDesktop();

  return (
    <div>
      <div className="c-paneback mb-s2! hidden lg:flex">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="c-mclose">
          <BackIcon />
        </button>
        <h1 className="c-panetitle text-body!">Reserve reports</h1>
      </div>
      <p className="c-det mb-s3">What the reserve held, what it paid out, and who checked it.</p>
      {/* The statements and what they are: two cells, side by side on desktop. */}
      <div className={desktop ? 'c-slab' : 'c-slab c-one'}>
        <ReserveReportsPanel reports={RESERVE_REPORTS} />
      </div>
    </div>
  );
}
