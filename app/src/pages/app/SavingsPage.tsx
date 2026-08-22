import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import SegmentedBar from '@/components/clear/SegmentedBar';
import CreditsProgress from '@/components/clear/CreditsProgress';
import MilestonePath from '@/components/clear/MilestonePath';
import ProjectionCard from '@/components/clear/ProjectionCard';
import AssuranceList from '@/components/clear/AssuranceList';
import VestingList from '@/components/clear/VestingList';
import AddToSavingsDialog from '@/components/clear/AddToSavingsDialog';
import AutoSaveDialog from '@/components/clear/AutoSaveDialog';
import { SAVINGS_DAY_ONE } from '@/data/clearPlaceholder';
import { money } from '@/lib/money';
import { savingsTotal, type SavingsData } from '@/lib/clearModel';

/**
 * Savings — design spec §5. Assurance lives here rather than on its own page in
 * summary form, with the detail a level down.
 *
 * The header carries the composition, not just the total: the balance, the
 * cash/vested/vesting split, and the actions. Progress toward the Clear Deed then
 * runs full width beneath it, because it measures the goal rather than any one
 * account — everything else on the page is either the route to it or what it
 * unlocks along the way.
 *
 * Day one needs no separate design: the milestone states, the protections and the
 * counters all derive from the credit balance, so at zero it's the same page with
 * nothing unlocked. Only the vesting list has its own empty copy.
 */
export default function SavingsPage({ data = SAVINGS_DAY_ONE }: { data?: SavingsData }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const [autoSaveOpen, setAutoSaveOpen] = useState(false);
  const { savings } = data;

  // Adding to savings is the page's whole point, so it's the mobile action —
  // and reachable from anywhere as /savings?do=add.
  useSetMobileAction({ label: 'Save', icon: Plus, onSelect: () => setAddOpen(true) });

  useEffect(() => {
    if (params.get('do') !== 'add') return;
    setAddOpen(true);
    params.delete('do');
    setParams(params, { replace: true });
  }, [params, setParams]);
  const total = savingsTotal(savings);

  const actions = (
    <div className="flex gap-2">
      <Button variant="clear" size="xs" className="flex-1" onClick={() => setAddOpen(true)}>
        Add money
      </Button>
      <Button variant="clear" size="xs" className="flex-1" onClick={() => setAutoSaveOpen(true)}>
        Auto-save
      </Button>
    </div>
  );

  return (
    <>
      {/* Balance and its composition, with the actions beside it on desktop */}
      <div className="mb-5 grid items-end gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
        <div>
          <p className="mb-1 text-xs text-foreground-secondary">Savings balance</p>
          <p className="font-display mb-3 text-[32px] font-medium leading-none tracking-[-0.5px] lg:text-[38px] lg:tracking-[-0.8px]">
            {money(total, { cents: true })}
          </p>

          <SegmentedBar
            className="mb-2.5"
            total={total}
            label="Savings by state"
            segments={[
              { value: savings.cash, className: 'bg-vest-cash', label: 'Cash' },
              { value: savings.vested, className: 'bg-vest-vested', label: 'Vested' },
              { value: savings.vesting, className: 'bg-vest-vesting', label: 'Vesting' },
            ]}
          />

          {/* Cash on its own line, then the two vesting states together: cash is
              spendable today and the other two aren't, which is the split that
              matters more than the three-way one. */}
          <div className="text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-3 leading-[1.9]">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-vest-cash" />
                Cash (CLRUSD)
              </span>
              <span className="tabular-nums">{money(savings.cash, { cents: true })}</span>
            </div>
            <div className="flex items-center justify-between gap-3 leading-[1.9]">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-vest-vested" />
                Vested
                <span aria-hidden className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-vest-vesting" />
                Vesting
              </span>
              <span className="tabular-nums">
                {money(savings.vested)} · {money(savings.vesting)}
              </span>
            </div>
          </div>
        </div>

        {actions}
      </div>

      <div className="mb-3">
        <CreditsProgress savings={savings} />
      </div>

      {/* The path gets the wider column — its rows carry a title and a status */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <MilestonePath milestones={data.milestones} credits={savings.credits} />

        <div className="flex flex-col gap-3">
          <ProjectionCard
            savings={savings}
            projection={data.projection}
            onAdjust={() => setAutoSaveOpen(true)}
          />
          <AssuranceList
            items={data.assurance}
            credits={savings.credits}
            onOpen={() => navigate('/assurance')}
          />
          <VestingList rows={data.vesting} />
        </div>
      </div>

      <AddToSavingsDialog data={data} open={addOpen} onOpenChange={setAddOpen} />
      <AutoSaveDialog data={data} open={autoSaveOpen} onOpenChange={setAutoSaveOpen} />
    </>
  );
}
