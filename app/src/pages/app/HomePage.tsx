import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BalanceBlock from '@/components/clear/BalanceBlock';
import QuickActions from '@/components/clear/QuickActions';
import CycleCard from '@/components/clear/CycleCard';
import TaskStrip from '@/components/clear/TaskStrip';
import SetupChecklist from '@/components/clear/SetupChecklist';
import ClearCreditCard from '@/components/clear/ClearCreditCard';
import CashAccountCard from '@/components/clear/CashAccountCard';
import SavingsSummaryCard from '@/components/clear/SavingsSummaryCard';
import RecentActivityCard from '@/components/clear/RecentActivityCard';
import LimitBreakdown from '@/components/clear/LimitBreakdown';
import AccountDetailsDialog from '@/components/clear/AccountDetailsDialog';
import RepayDialog from '@/components/clear/RepayDialog';
import TermPlansCard from '@/components/clear/TermPlansCard';
import SplitPlanDialog from '@/components/clear/SplitPlanDialog';
import PaymentAccountDialog from '@/components/clear/PaymentAccountDialog';
import AddBoostDialog from '@/components/clear/AddBoostDialog';
import AddToSavingsDialog from '@/components/clear/AddToSavingsDialog';
import LinkAccountDialog from '@/components/clear/LinkAccountDialog';
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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [boostOpen, setBoostOpen] = useState(false);
  const [addSavingsOpen, setAddSavingsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [repayOpen, setRepayOpen] = useState(false);
  const [payAccountOpen, setPayAccountOpen] = useState(false);
  // Edits made in the term-plan modals, held here so Save has something to change. The placeholder
  // data is static; these are what a backend would persist.
  const [planId, setPlanId] = useState<string | null>(null);
  const [splits, setSplits] = useState<Record<string, number>>({});
  const [clearsFromId, setClearsFromId] = useState(data.termPlans.clearsFromId);
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  // Nothing has ever landed in the account: no cycle running, no savings, no cash.
  const dayOne = creditLimit(data.credit) === 0 && savingsTotal(data.savings) === 0 && data.cash === 0;
  const engaged = isCreditEngaged(data.cash, data.credit);
  const boost = addableTier(data.credit);

  // Deep link from the mobile nav's quick actions.
  useEffect(() => {
    if (params.get('do') !== 'add-money') return;
    setLinkOpen(true);
    params.delete('do');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const balance = <BalanceBlock cash={data.cash} credit={data.credit} emptyState={dayOne} />;
  const savings = <SavingsSummaryCard savings={data.savings} emptyState={dayOne} />;

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

  // A saved split reschedules the plan: same balance, new per-cycle figure, fresh count of cycles.
  const termPlansData = {
    ...data.termPlans,
    clearsFromId,
    plans: data.termPlans.plans.map((p) => {
      const split = splits[p.id];
      return split && p.balance !== undefined
        ? { ...p, splitInto: split, perCycle: p.balance / split, cyclesLeft: split }
        : p;
    }),
  };
  const plan = termPlansData.plans.find((p) => p.id === planId) ?? null;

  const taskStrip = <TaskStrip tasks={data.tasks} />;
  // The cycle needs the credit position and the deposit that's coming to say whether it clears —
  // and it's only the unsecured draw that has to.
  // One shape on both layouts now — the cycle reads the same everywhere, so there's nothing left
  // for a variant to differ about.
  const cycle = (
    <CycleCard
      cycle={data.cycle}
      credit={data.credit}
      expectedDeposit={data.cashAccount.nextDepositEstimate}
      depositOn={data.cashAccount.nextDepositOn}
      onRepay={() => setRepayOpen(true)}
    />
  );
  // Money comes in from a linked bank, so that's what Add money opens.
  const quickActions = (
    <QuickActions
      actions={[
        { label: 'Add money', onSelect: () => setLinkOpen(true) },
        { label: 'Send', onSelect: () => navigate('/send') },
        { label: 'Save', onSelect: () => setAddSavingsOpen(true) },
        { label: 'Pay', onSelect: () => navigate('/card') },
      ]}
    />
  );
  const credit = (
    <ClearCreditCard
      credit={data.credit}
      engaged={engaged}
      onViewBreakdown={() => setBreakdownOpen(true)}
      onAddBoost={() => setBoostOpen(true)}
    />
  );
  // Savings opens the same sheet as Save, since that sheet is what places money in the ESA. Earn
  // routes to the Earn page to choose a product. Back to cash opens the same surface the cycle's
  // Repay does — spec §4: one modal, and which title it wears depends on the balance, not on which
  // button was pressed.
  const cash = (
    <CashAccountCard
      account={data.cashAccount}
      onDetails={() => setAccountOpen(true)}
      onAllocateSavings={() => setAddSavingsOpen(true)}
      onAllocateEarn={() => navigate('/earn')}
      onBackToCash={() => setRepayOpen(true)}
    />
  );
  // Sits under Clear credit in both layouts — spec §4c, one shelf for everything with a schedule.
  // Home doesn't repeat the Limit subrow; the credit limit is already stated directly above it.
  const termPlans = (
    <TermPlansCard
      data={termPlansData}
      showLimit={false}
      onPlan={(p) => setPlanId(p.id)}
      onClearsFrom={() => setPayAccountOpen(true)}
    />
  );
  const activity = <RecentActivityCard rows={data.recent} onSelect={setSelected} />;

  return (
    <>
      {/* Mobile: single stack, spec §4 order. No quick actions here — the nav's
          action button fans out the same four, and two sets of the same buttons
          on one screen is one set too many. */}
      <div className="flex flex-col gap-2.5 lg:hidden">
        {balance}
        {taskStrip}
        {cycle}
        {cash}
        {credit}
        {termPlans}
        {savings}
        {activity}
      </div>

      {/* Desktop: balance beside the four things you can start, then the cycle as
          a status strip, then credit beside cash/savings. Credit takes the wider
          column — it carries four legend rows the others don't. */}
      <div className="hidden lg:block">
        <div className="mb-4 grid grid-cols-[minmax(0,1fr)_300px] items-end gap-6">
          {balance}
          {quickActions}
        </div>
        <div className="mb-3">{cycle}</div>
        {taskStrip}
        <div className="mt-3.5 grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-3">
          <div className="flex flex-col gap-3">
            {credit}
            {termPlans}
          </div>
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
      <RepayDialog
        credit={data.credit}
        account={data.cashAccount}
        cycle={data.cycle}
        open={repayOpen}
        onOpenChange={setRepayOpen}
      />
      <LinkAccountDialog open={linkOpen} onOpenChange={setLinkOpen} />
      <PaymentAccountDialog
        accounts={termPlansData.accounts}
        selectedId={clearsFromId}
        open={payAccountOpen}
        onOpenChange={setPayAccountOpen}
        onSave={(id) => {
          setClearsFromId(id);
          setPayAccountOpen(false);
        }}
        onLink={() => {
          setPayAccountOpen(false);
          setLinkOpen(true);
        }}
      />
      {plan && (
        <SplitPlanDialog
          plan={plan}
          options={termPlansData.splitOptions}
          ratePerCycle={plan.ratePerCycle ?? 0.02}
          doneBy={(splitInto) => `${splitInto} cycle${splitInto === 1 ? '' : 's'} from now`}
          onSave={(splitInto) => {
            setSplits((s) => ({ ...s, [plan.id]: splitInto }));
            setPlanId(null);
          }}
          open={plan !== null}
          onOpenChange={(o) => !o && setPlanId(null)}
        />
      )}
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
