import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import { Bar } from '@/components/clear/brand/anatomy';
import { PlusIcon } from '@/components/clear/brand/icons';
import MilestonePath from '@/components/clear/MilestonePath';
import ProjectionCard from '@/components/clear/ProjectionCard';
import AssuranceList from '@/components/clear/AssuranceList';
import VestingList from '@/components/clear/VestingList';
import ConnectedMoveMoney from '@/components/clear/ConnectedMoveMoney';
import AutoSaveDialog from '@/components/clear/AutoSaveDialog';
import { SAVINGS_DAY_ONE } from '@/data/clearPlaceholder';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { money } from '@clear/domain';
import { savingsTotal, type SavingsData } from '@/lib/clearModel';

/**
 * Savings — converted entirely from rules already set.
 *
 * Hero on paper: the balance, its bar, and a one-line key — name then figure, colour on the name,
 * nothing trying to sit under its own segment. It states a figure and carries no controls.
 *
 * Everything else is one slab, two cells to a column so neither side stretches: Path to a home over
 * Credits vesting, On track for over Assurance. The page's one button sits in the On track footer,
 * beside Adjust auto-save. The phone stacks path, on track, assurance, then vesting, and puts Save on
 * the nav's action button.
 *
 * Day one needs no separate design: the milestone states, the protections and the counters all
 * derive from the credit balance, so at zero it's the same page with nothing unlocked.
 */
export default function SavingsPage({ data = SAVINGS_DAY_ONE }: { data?: SavingsData }) {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const [autoSaveOpen, setAutoSaveOpen] = useState(false);
  const { savings } = data;

  // Adding to savings is the page's whole point, so it's the mobile action — and reachable from
  // anywhere as /savings?do=add.
  useSetMobileAction({ label: 'Save', icon: PlusIcon, onSelect: () => setAddOpen(true) });

  useEffect(() => {
    if (params.get('do') !== 'add') return;
    setAddOpen(true);
    params.delete('do');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const total = savingsTotal(savings);
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  const path = <MilestonePath milestones={data.milestones} savings={savings} />;
  const vesting = <VestingList rows={data.vesting} />;
  const onTrack = (
    <ProjectionCard
      savings={savings}
      projection={data.projection}
      onAddMoney={() => setAddOpen(true)}
      onAdjust={() => setAutoSaveOpen(true)}
    />
  );
  const assurance = (
    <AssuranceList items={data.assurance} credits={savings.credits} onOpen={() => navigate('/assurance')} />
  );

  return (
    <>
      <div className="mb-s3">
        <p className="c-label mb-s1">Savings balance</p>
        <p className="c-fig text-hero-m leading-[1.05] lg:text-hero">{money(total, { cents: true })}</p>
        <Bar
          className="mt-s2"
          label="Savings by state: cash, vested, vesting"
          segments={[
            { label: 'Cash', pct: share(savings.cash), color: 'var(--vest-cash)' },
            { label: 'Vested', pct: share(savings.vested), color: 'var(--vest-vested)' },
            { label: 'Vesting', pct: share(savings.vesting), color: 'var(--vest-vesting)' },
          ]}
        />
        <p className="c-keyline">
          Cash (CLRUSD) <strong>{money(savings.cash, { cents: true })}</strong>
          <span className="c-sep">&middot;</span>
          <span className="c-t-sav">Vested</span> <strong>{money(savings.vested)}</strong>
          <span className="c-sep">&middot;</span>
          <span className="c-t-inc">Vesting</span> <strong>{money(savings.vesting)}</strong>
        </p>
      </div>

      {desktop ? (
        <div className="c-slab">
          <div className="c-col">
            {path}
            {vesting}
          </div>
          <div className="c-col">
            {onTrack}
            {assurance}
          </div>
        </div>
      ) : (
        <div className="c-slab c-one">
          {path}
          {onTrack}
          {assurance}
          {vesting}
        </div>
      )}

      <ConnectedMoveMoney data={data} open={addOpen} onOpenChange={setAddOpen} />
      <AutoSaveDialog data={data} open={autoSaveOpen} onOpenChange={setAutoSaveOpen} />
    </>
  );
}
