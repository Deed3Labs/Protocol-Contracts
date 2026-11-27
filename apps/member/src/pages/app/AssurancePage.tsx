import { useNavigate } from 'react-router-dom';
import AssurancePanel from '@/components/clear/AssurancePanel';
import { BackIcon } from '@/components/clear/brand/icons';
import { SAVINGS_DAY_ONE } from '@/data/clearPlaceholder';
import type { SavingsData } from '@/lib/clearModel';

/**
 * Assurance — reached from See all in the Assurance footer on Savings.
 *
 * A pane, not a modal: it is a place, not an action. A way back and the title, one line on what the
 * protections are, then the one cell. What the reserve covers is a row through to its explainer.
 *
 * On a phone the shell's header already draws the way back and the title, so the pane only draws its
 * own on desktop, where the top bar carries neither.
 */
export default function AssurancePage({ data = SAVINGS_DAY_ONE }: { data?: SavingsData }) {
  const navigate = useNavigate();

  return (
    <div className="max-w-[560px]">
      <div className="c-paneback mb-s2! hidden lg:flex">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="c-mclose">
          <BackIcon />
        </button>
        <h1 className="c-panetitle text-body!">Assurance</h1>
      </div>
      <p className="c-det mb-s3">Protections that unlock as your credits grow. Backed by the co-op assurance reserve.</p>
      <div className="c-slab c-one">
        <AssurancePanel
          items={data.assurance}
          credits={data.savings.credits}
          onExplainReserve={() => navigate('/assurance/reserve')}
        />
      </div>
    </div>
  );
}
