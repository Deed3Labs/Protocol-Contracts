import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BalanceBlock from '@/components/clear/BalanceBlock';
import QuickActions from '@/components/clear/QuickActions';
import CycleCard from '@/components/clear/CycleCard';
import TaskStrip, { SetupPanel } from '@/components/clear/TaskStrip';
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
import TermLimitDialog from '@/components/clear/TermLimitDialog';
import AddBoostDialog from '@/components/clear/AddBoostDialog';
import ConnectedMoveMoney from '@/components/clear/ConnectedMoveMoney';
import LinkAccountDialog from '@/components/clear/LinkAccountDialog';
import AddMoneyDialog from '@/components/clear/AddMoneyDialog';
import TransactionDetailDialog from '@/components/clear/TransactionDetailDialog';
import { HOME_DAY_ONE, SAVINGS_DAY_ONE } from '@/data/clearPlaceholder';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { activePlans, addableTier, creditLimit, savingsTotal, type ActivityRow, type HomeData } from '@/lib/clearModel';

/**
 * Home.
 *
 * Hero on paper, then blocks: **the cycle, the temporary slot, and the standing accounts as one
 * slab.** The temporary slot is absent when it has nothing to say, never present and empty.
 *
 * Desktop puts the quick actions beside the hero and lays the slab in two columns — Credit over Term
 * plans, Spendable over Savings — with Recent activity full width beneath, because a growing list
 * never sits beside something short. The columns have equal cell counts, so they share the grid and
 * their rules line up across the seam. The phone stacks the slab in one column, Spendable first, and
 * leaves the quick actions to the nav's action button.
 *
 * Day one has no cycle and nothing on the slab: the hero, Getting set up, and Savings.
 */
export default function HomePage({
  data = HOME_DAY_ONE,
  onRepay,
}: {
  data?: HomeData;
  /** Repays card debt on chain. Absent in the preview harness. */
  onRepay?: (amount: number) => Promise<{ repaid?: number; pendingLeft?: number; error?: string }>;
}) {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [boostOpen, setBoostOpen] = useState(false);
  const [addSavingsOpen, setAddSavingsOpen] = useState(false);
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [repayOpen, setRepayOpen] = useState(false);
  const [payAccountOpen, setPayAccountOpen] = useState(false);
  const [termLimitOpen, setTermLimitOpen] = useState(false);
  // Edits made in the term-plan modals, held here so Save has something to change. The placeholder
  // data is static; these are what a backend would persist.
  const [planId, setPlanId] = useState<string | null>(null);
  const [splits, setSplits] = useState<Record<string, number>>({});
  const [clearsFromId, setClearsFromId] = useState(data.termPlans.clearsFromId);
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  // Nothing has ever landed in the account: no cycle running, no savings, no cash.
  const dayOne = creditLimit(data.credit) === 0 && savingsTotal(data.savings) === 0 && data.cash === 0;
  const boost = addableTier(data.credit);

  // Deep links: add money from the nav's quick actions, the limit breakdown from a bond on Earn, and
  // repaying from a pool withdrawal that would leave the limit short.
  useEffect(() => {
    const action = params.get('do');
    if (action === 'add-money') setAddMoneyOpen(true);
    else if (action === 'limit-breakdown') setBreakdownOpen(true);
    else if (action === 'repay') setRepayOpen(true);
    else return;
    params.delete('do');
    setParams(params, { replace: true });
  }, [params, setParams]);

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

  // A setup step opens the surface that completes it.
  const onTask = (id: string) => {
    if (id === 'deposit') setAddMoneyOpen(true);
    else if (id === 'direct-deposit') setAccountOpen(true);
    else if (id === 'card') navigate('/card');
  };

  const termPlans = (panel?: boolean) => (
    <TermPlansCard
      data={termPlansData}
      panel={panel}
      onPlan={(p) => setPlanId(p.id)}
      onLimit={() => setTermLimitOpen(true)}
      onClearsFrom={() => setPayAccountOpen(true)}
    />
  );

  // Money comes in from a linked bank, so that's what Add money opens.
  const quickActions = (
    <QuickActions
      actions={[
        { label: 'Add money', onSelect: () => setAddMoneyOpen(true) },
        { label: 'Send', onSelect: () => navigate('/send') },
        { label: 'Save', onSelect: () => setAddSavingsOpen(true) },
        { label: 'Pay', onSelect: () => navigate('/card') },
      ]}
    />
  );

  const hero = desktop ? (
    <div className="mb-s3 grid grid-cols-[minmax(0,1fr)_300px] items-end gap-s4">
      <BalanceBlock cash={data.cash} credit={data.credit} emptyState={dayOne} />
      {quickActions}
    </div>
  ) : (
    <div className="mb-s3">
      <BalanceBlock cash={data.cash} credit={data.credit} emptyState={dayOne} />
    </div>
  );

  const modals = (
    <>
      <TermLimitDialog data={termPlansData} open={termLimitOpen} onOpenChange={setTermLimitOpen} />
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
      <LinkAccountDialog open={linkOpen} onOpenChange={setLinkOpen} />
      {/* Its From leg is the Clears from picker, so the account it pulls from is the one plans use. */}
      <AddMoneyDialog
        open={addMoneyOpen}
        onOpenChange={setAddMoneyOpen}
        account={termPlansData.accounts.find((a) => a.id === clearsFromId) ?? termPlansData.accounts[0]}
        readyToAllocate={data.cashAccount.readyToAllocate}
        firstDeposit={!data.tasks.find((t) => t.id === 'deposit')?.done}
        onPickAccount={() => setPayAccountOpen(true)}
      />
      <AccountDetailsDialog account={data.cashAccount} open={accountOpen} onOpenChange={setAccountOpen} />
      {/* Savings deposit is the same surface Savings uses; the credit limit it quotes comes from this
          page's own tiers so the two can't disagree. */}
      <ConnectedMoveMoney
        data={{ ...SAVINGS_DAY_ONE, savings: data.savings, creditLimitToday: creditLimit(data.credit) }}
        open={addSavingsOpen}
        onOpenChange={setAddSavingsOpen}
      />
    </>
  );

  if (dayOne) {
    // A member who joined at a counter already has a plan, and it is why they are here, so the shelf
    // sits between setup and savings. A member who signed up directly has an empty shelf, and it
    // stays off Home until there is something on it.
    const fromCounter = activePlans(data.termPlans).length > 0;

    return (
      <>
        {hero}
        <div className="c-home">
          <SetupPanel tasks={data.tasks} onAction={onTask} onAddMoney={() => setAddMoneyOpen(true)} />
          {fromCounter && termPlans(true)}
          <SavingsSummaryCard savings={data.savings} emptyState />
        </div>
        {modals}
      </>
    );
  }

  const cycle = (
    <CycleCard
      cycle={data.cycle}
      credit={data.credit}
      expectedDeposit={data.cashAccount.nextDepositEstimate}
      depositOn={data.cashAccount.nextDepositOn}
      onRepay={() => setRepayOpen(true)}
      onTopOff={() => setAddSavingsOpen(true)}
    />
  );
  const credit = (
    <ClearCreditCard
      credit={data.credit}
      onViewBreakdown={() => setBreakdownOpen(true)}
      onAddBoost={() => setBoostOpen(true)}
    />
  );
  // Back to cash opens the same surface the cycle's Repay does: one modal, and which title it wears
  // depends on the balance, not on which button was pressed.
  const cash = (
    <CashAccountCard
      account={data.cashAccount}
      onDetails={() => setAccountOpen(true)}
      onAllocateSavings={() => setAddSavingsOpen(true)}
      onAllocateEarn={() => navigate('/earn')}
      onBackToCash={() => setRepayOpen(true)}
    />
  );
  const savings = <SavingsSummaryCard savings={data.savings} />;
  const activity = <RecentActivityCard rows={data.recent} onSelect={setSelected} />;

  return (
    <>
      {hero}
      <div className="c-home">
        {cycle}
        <TaskStrip tasks={data.tasks} onAction={onTask} limit={desktop ? undefined : 1} />
        {desktop ? (
          /* Both columns hold two cells, so they go straight into the shared grid: one grid row per
             pair means every divider meets its neighbour. Nest only when the cell counts differ. */
          <div className="c-slab">
            {credit}
            {cash}
            {termPlans()}
            {savings}
            {activity}
          </div>
        ) : (
          <div className="c-slab c-one">
            {cash}
            {credit}
            {termPlans()}
            {savings}
            {activity}
          </div>
        )}
      </div>

      {modals}
      {/* Add from the breakdown hands off to the same surface as the cell's own button, so there's one
          place the decision gets made. */}
      <LimitBreakdown
        backing={data.backing}
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        onAdd={() => {
          setBreakdownOpen(false);
          setBoostOpen(true);
        }}
      />
      {boost && <AddBoostDialog credit={data.credit} tier={boost} open={boostOpen} onOpenChange={setBoostOpen} />}
      <RepayDialog
        credit={data.credit}
        account={data.cashAccount}
        cycle={data.cycle}
        open={repayOpen}
        onOpenChange={setRepayOpen}
        onRepay={onRepay}
      />
      {selected && (
        <TransactionDetailDialog row={selected} open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} />
      )}
    </>
  );
}
