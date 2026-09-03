import { Link } from 'react-router-dom';
import {
  CHARGE_LABEL,
  countsAsVolume,
  dollars,
  formatCalendarDate,
  fromCents,
  isPending,
} from '@clear/domain';
import { Columns } from '@/shell/AppShell';
import { Big, Cap, Card, Inset, Lbl, Pill, Row } from '@/shell/ui';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';

/**
 * Overview — reference section 10.
 *
 * Everything an owner asks at month end, and nothing a writer needs mid-shift. It took the fifth
 * nav slot from Settings, which is the right trade: this is a question a shop asks weekly and
 * Settings is one it asks twice a year.
 *
 * The figures are the month's, not the day's — Home already answers "how is today going", and
 * repeating it here would make the two screens compete rather than divide.
 */

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

export default function OverviewPage() {
  const { data: charges, loading } = useApi(() => api.charges({ limit: 300 }), []);
  const { data: position } = useApi(() => api.payouts(), []);
  const { data: profile } = useApi(() => api.profile(), []);

  const month = (charges ?? []).filter(
    (c) => Date.parse(c.createdAt) >= startOfMonth() && countsAsVolume(c.state),
  );
  const total = month.reduce((sum, c) => sum + c.amount, 0);
  const average = month.length > 0 ? total / month.length : 0;

  // Computed from what the shop was actually paid, not from the rate: a charge raised last week
  // carries the rate that applied when it was raised, which is the figure that reconciles.
  const fees = month.reduce((sum, c) => sum + (c.payout === undefined ? 0 : c.amount - c.payout), 0);
  const ratePercent =
    profile?.discountRate == null ? null : Math.round(profile.discountRate * 1000) / 10;

  const recent = (charges ?? []).slice(0, 6);

  return (
    <Columns
      action={
        <>
          <Lbl>This month</Lbl>
          <Big>{dollars(total)}</Big>
          <p className="m-0 mb-[18px] mt-[5px] text-[12.5px] text-[var(--clear-text-muted)]">
            {loading
              ? 'Loading…'
              : month.length === 0
                ? 'No charges yet this month'
                : `${month.length} charges · avg ${dollars(average)}`}
          </p>

          <div className="grid grid-cols-1 gap-3.5 @[520px]:grid-cols-2">
            <Inset className="!px-4 !py-[15px]">
              <Cap>Owed to you</Cap>
              <p className="m-0 mt-1 text-[19px] font-medium tabular-nums">
                {dollars(fromCents(position?.owedCents ?? 0))}
              </p>
              <p className="m-0 mt-[5px] text-[11.5px] text-[var(--clear-text-muted)]">
                {position?.nextPayoutOn
                  ? `Next payout ${formatCalendarDate(position.nextPayoutOn)}`
                  : 'Next payout not scheduled yet'}
              </p>
            </Inset>

            <Inset className="!px-4 !py-[15px]">
              <Cap>Fees this month</Cap>
              <p className="m-0 mt-1 text-[19px] font-medium tabular-nums">
                {/* Zero here means no settled charges yet, not a free month — said plainly rather
                    than rendered as a suspiciously good number. */}
                {fees > 0 ? dollars(fees) : month.length === 0 ? '—' : dollars(0)}
              </p>
              <p className="m-0 mt-[5px] text-[11.5px] text-[var(--clear-text-muted)]">
                {ratePercent === null ? 'Your agreed rate' : `${ratePercent}% · your rate`}
              </p>
            </Inset>
          </div>
        </>
      }
      context={
        <>
          <Cap>Recent charges</Cap>
          {recent.length === 0 ? (
            <Card>
              <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">
                {loading ? 'Loading…' : 'Nothing yet.'}
              </p>
            </Card>
          ) : (
            <Card rows>
              {recent.map((c) => (
                <Row
                  key={c.code}
                  title={
                    <Link to={`/charges/${c.code}`} className="block truncate">
                      {c.memberName ?? 'Not opened yet'}
                    </Link>
                  }
                  meta={`${formatCalendarDate(c.createdAt)} · ${c.raisedBy ?? '—'}`}
                  right={
                    isPending(c.state) ? (
                      <Pill tone="pending">{CHARGE_LABEL[c.state]}</Pill>
                    ) : (
                      <span className="tabular-nums">{dollars(c.amount)}</span>
                    )
                  }
                />
              ))}
            </Card>
          )}
          <p className="m-0 mt-[13px] text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
            The month's figures, not today's — Home answers how today is going.
          </p>
        </>
      }
    />
  );
}
