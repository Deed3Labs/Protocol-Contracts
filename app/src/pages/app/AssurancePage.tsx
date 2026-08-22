import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import Card from '@/components/clear/Card';
import AssurancePanel from '@/components/clear/AssurancePanel';
import ReservePanel from '@/components/clear/ReservePanel';
import { SAVINGS_DAY_ONE, ASSURANCE_RESERVE } from '@/data/clearPlaceholder';
import type { AssuranceReserve, SavingsData } from '@/lib/clearModel';

/**
 * Assurance — design spec §5. Reached from the Assurance card on Savings.
 *
 * Desktop puts the reserve beside the protections rather than a level down: the
 * fund is the answer to "is this real", and on a wide screen there's no reason to
 * make someone navigate for it. Mobile keeps it as a row through to the explainer.
 */
export default function AssurancePage({
  data = SAVINGS_DAY_ONE,
  reserve = ASSURANCE_RESERVE,
}: {
  data?: SavingsData;
  reserve?: AssuranceReserve;
}) {
  const navigate = useNavigate();

  return (
    <>
      <div className="mb-4 hidden items-center gap-2.5 lg:flex">
        <ShieldCheck
          aria-hidden
          className="h-[18px] w-[18px] shrink-0 text-foreground-secondary"
          strokeWidth={1.75}
        />
        <h1 className="text-[17px] font-medium lg:text-xl">Assurance</h1>
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-3">
        <Card className="lg:h-full">
          <AssurancePanel
            items={data.assurance}
            credits={data.savings.credits}
            onExplainReserve={() => navigate('/learn/assurance-reserve')}
          />
        </Card>

        {/* Desktop only — mobile reaches the same content through the row above */}
        <Card className="hidden lg:block lg:h-full">
          <ReservePanel reserve={reserve} />
        </Card>
      </div>
    </>
  );
}
