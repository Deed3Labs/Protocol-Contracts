import { useState } from 'react';
import BalanceBlock from '@/components/clear/BalanceBlock';
import CycleCard from '@/components/clear/CycleCard';
import TaskStrip from '@/components/clear/TaskStrip';
import SetupChecklist from '@/components/clear/SetupChecklist';
import ClearCreditCard from '@/components/clear/ClearCreditCard';
import CashAccountCard from '@/components/clear/CashAccountCard';
import SavingsSummaryCard from '@/components/clear/SavingsSummaryCard';
import RecentActivityCard from '@/components/clear/RecentActivityCard';
import LimitBreakdown from '@/components/clear/LimitBreakdown';
import AccountDetailsDialog from '@/components/clear/AccountDetailsDialog';
import AddBoostDialog from '@/components/clear/AddBoostDialog';
import AddToSavingsDialog from '@/components/clear/AddToSavingsDialog';
import TransactionDetailDialog from '@/components/clear/TransactionDetailDialog';
import { HOME_IN_USE, SAVINGS_IN_USE } from '@/data/clearPlaceholder';
import {
  addableTier,
  creditLimit,
  isCreditEngaged,
  savingsTotal,
  type ActivityRow,
  type HomeData,
} from '@/lib/clearModel';

/**
 * Home — design spec §4.
 *
 * Two states. Day one has no money in the account: a $0 headline and a setup
 * checklist, with no cycle and no credit card because neither exists yet. In use
 * gets the full layout, and any setup task still outstanding becomes a strip
 * under the balance.
 *
 * Desktop and mobile differ structurally, not just in width: desktop puts credit
 * beside a cash/savings column, mobile stacks in the spec's order (cycle, cash,
 * credit, savings). The same elements are placed into both layouts so the two
 * can't drift apart.
 */
export default function HomePage({ data = HOME_IN_USE }: { data?: HomeData }) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [boostOpen, setBoostOpen] = useState(false);
  const [addSavingsOpen, setAddSavingsOpen] = useState(false);
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  // Nothing has ever landed in the account: no cycle running, no savings, no cash.
  const dayOne = creditLimit(data.credit) === 0 && savingsTotal(data.savings) === 0 && data.cash === 0;
  const engaged = isCreditEngaged(data.cash, data.credit);
  const boost = addableTier(data.credit);

  const balance = <BalanceBlock cash={data.cash} credit={data.credit} emptyState={dayOne} />;
  const savings = (
    <SavingsSummaryCard
      savings={data.savings}
      emptyState={dayOne}
      onAdd={() => setAddSavingsOpen(true)}
    />
  );

  if (dayOne) {
    return (
      <div className="flex flex-col gap-3">
        {balance}
        {/* items-start so the savings card sizes to its content rather than
            stretching to match the checklist */}
        <div className="mt-1 grid items-start gap-3 lg:grid-cols-2">
          <SetupChecklist tasks={data.tasks} />
          {savings}
        </div>
      </div>
    );
  }

  const taskStrip = <TaskStrip tasks={data.tasks} />;
  const cycle = <CycleCard cycle={data.cycle} />;
  const cycleCard = <CycleCard cycle={data.cycle} variant="card" />;
  const credit = (
    <ClearCreditCard
      credit={data.credit}
      engaged={engaged}
      onViewBreakdown={() => setBreakdownOpen(true)}
      onAddBoost={() => setBoostOpen(true)}
    />
  );
  const cash = <CashAccountCard account={data.cashAccount} onDetails={() => setAccountOpen(true)} />;
  const activity = <RecentActivityCard rows={data.recent} onSelect={setSelected} />;

  return (
    <>
      {/* Mobile: single stack, spec §4 order */}
      <div className="flex flex-col gap-2.5 lg:hidden">
        {balance}
        {taskStrip}
        {cycleCard}
        {cash}
        {credit}
        {savings}
        {activity}
      </div>

      {/* Desktop: balance beside the cycle, then credit beside cash/savings */}
      <div className="hidden lg:block">
        <div className="mb-3.5 flex items-end justify-between gap-6">
          {balance}
          {cycle}
        </div>
        {taskStrip}
        <div className="mt-3.5 grid grid-cols-2 gap-3">
          {credit}
          <div className="flex flex-col gap-3">
            {cash}
            {savings}
          </div>
        </div>
        <div className="mt-3">{activity}</div>
      </div>

      {/* Add from the breakdown hands off to the same surface as the card's own
          button, so there's one place the decision gets made. */}
      <LimitBreakdown
        backing={data.backing}
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        onAdd={() => {
          setBreakdownOpen(false);
          setBoostOpen(true);
        }}
      />
      {boost && (
        <AddBoostDialog
          credit={data.credit}
          tier={boost}
          open={boostOpen}
          onOpenChange={setBoostOpen}
        />
      )}
      <AccountDetailsDialog account={data.cashAccount} open={accountOpen} onOpenChange={setAccountOpen} />
      {/* Savings deposit is the same surface Savings uses; the credit limit it
          quotes comes from this page's own tiers so the two can't disagree. */}
      <AddToSavingsDialog
        data={{ ...SAVINGS_IN_USE, savings: data.savings, creditLimitToday: creditLimit(data.credit) }}
        open={addSavingsOpen}
        onOpenChange={setAddSavingsOpen}
      />
      {selected && (
        <TransactionDetailDialog
          row={selected}
          open={selected !== null}
          onOpenChange={(o) => !o && setSelected(null)}
        />
      )}
    </>
  );
}
