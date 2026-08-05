import { useEffect } from 'react';
import { Home, FileText, SendHorizontal, ArrowDownLeft, Calendar, CircleCheck, TrendingUp, Flame, Repeat } from 'lucide-react';
import MetricRow from '@/components/app-ui/MetricRow';
import ActionTile from '@/components/app-ui/ActionTile';
import { Page, Row, Region } from '@/components/app-ui/Surface';
import RentEquityAnalyticsChart from '@/components/app-ui/charts/RentEquityAnalyticsChart';
import BillTimeline, { type TimelineBill } from '@/components/app-ui/BillTimeline';
import CardVisual from '@/components/app-ui/CardVisual';
import { usePay } from '@/context/PayContext';
import { useMoneyActions } from '@/context/MoneyActionsContext';

/**
 * Pay — Clear Pay's rent/bill core, send/request, card, and rent-to-equity viz.
 *
 * Same flat system as Accounts: one continuous canvas, regions divided by hairlines, no card
 * wrappers around content. Actions keep their borders because they're controls, not content.
 */
export default function PayPage() {
  const { bills, summary, openPay, openPortals, reconcile, loading } = usePay();
  const { openSend, openRequest, openAutoSave } = useMoneyActions();
  const timelineBills: TimelineBill[] = bills.map((b) => ({ id: b.id, name: b.name, dateLabel: b.dueLabel, amount: b.amount, icon: b.icon }));
  const streak = summary?.streak ?? 0;

  // Detect on-time recurring payments from Plaid when the Pay page opens (Plaid call kept off other pages).
  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  return (
    <Page>
      <MetricRow
        loading={loading}
        metrics={[
          { label: 'Due this month', value: summary?.dueThisMonth ?? 0, icon: Calendar },
          { label: 'Paid · 30 days', value: summary?.paid30 ?? 0, icon: CircleCheck },
          {
            label: 'Equity credits',
            value: summary?.totalEquity ?? 0,
            format: 'plain',
            change: summary?.pendingEquity ? `${summary.pendingEquity.toLocaleString()} vesting` : undefined,
            icon: TrendingUp,
          },
          {
            label: 'On-time streak',
            value: streak,
            format: 'plain',
            suffix: streak === 1 ? 'month' : 'months',
            icon: Flame,
          },
        ]}
      />

      <Row cols={3}>
        <Region label="Make a payment" first span={2}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <ActionTile icon={Home} label="Pay rent" hint="Schedule or pay now" primary onClick={() => openPay('rent')} />
            <ActionTile icon={FileText} label="Pay a bill" hint="Utilities, rent & more" onClick={openPortals} />
            <ActionTile icon={SendHorizontal} label="Send" hint="To anyone" onClick={openSend} />
            <ActionTile icon={ArrowDownLeft} label="Request" hint="Get paid" onClick={openRequest} />
            <ActionTile icon={Repeat} label="Auto-save" hint="Sign once, build equity" onClick={openAutoSave} />
          </div>
        </Region>
        <Region label="Your card">
          <CardVisual />
        </Region>
      </Row>

      <Row cols={3} divided={false}>
        <Region first span={2} className="lg:pr-8">
          <RentEquityAnalyticsChart series={summary?.series ?? []} />
        </Region>
        <Region label="Bills">
          <BillTimeline bills={timelineBills} onPay={openPay} />
        </Region>
      </Row>
    </Page>
  );
}
