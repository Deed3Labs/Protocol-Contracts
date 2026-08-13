import { useState } from 'react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/clear/PageHeader';
import MilestonePath from '@/components/clear/MilestonePath';
import AssuranceList from '@/components/clear/AssuranceList';
import VestingList from '@/components/clear/VestingList';
import AddToSavingsDialog from '@/components/clear/AddToSavingsDialog';
import { SAVINGS_IN_USE } from '@/data/clearPlaceholder';
import { money, count } from '@/lib/money';
import { savingsTotal, type SavingsData } from '@/lib/clearModel';

/**
 * Savings — design spec §5. Assurance lives here rather than on its own page,
 * because protections are unlocked by saving.
 *
 * There's no separate empty state to design: the milestone path, the protections
 * list and the credit counters all derive from the credit balance, so day one is
 * the same page with nothing yet unlocked. Only the vesting list needs its own
 * empty copy, since it has no rows at all.
 */
export default function SavingsPage({ data = SAVINGS_IN_USE }: { data?: SavingsData }) {
  const [addOpen, setAddOpen] = useState(false);
  const { savings } = data;

  return (
    <>
      <PageHeader
        label="Savings balance"
        value={money(savingsTotal(savings))}
        sub={`${count(savings.credits)} of ${count(savings.creditsGoal)} credits toward your Clear Deed`}
        trailing={
          <div className="flex gap-2">
            <Button variant="clear" size="xs" className="flex-1 lg:flex-none" onClick={() => setAddOpen(true)}>
              Add money
            </Button>
            <Button variant="clear" size="xs" className="flex-1 lg:flex-none">
              Auto-save
            </Button>
          </div>
        }
      />

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <MilestonePath milestones={data.milestones} credits={savings.credits} />
        <div className="flex flex-col gap-3">
          <AssuranceList items={data.assurance} credits={savings.credits} />
          <VestingList rows={data.vesting} />
        </div>
      </div>

      <AddToSavingsDialog data={data} open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
