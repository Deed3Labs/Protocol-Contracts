import { Link } from 'react-router-dom';
import { CHARGE_LABEL, countsAsVolume, dollars, formatCalendarDate, fromCents, isPending } from '@clear/domain';
import { Cap, Card, Lbl, Pill } from '@/shell/ui';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';

/**
 * Overview — reference section 10.
 *
 * Everything an owner asks at month end, and nothing a writer needs mid-shift. It took the fifth
 * nav slot from Settings, which is the right trade: this is a question a shop asks weekly and
 * Settings is one it asks twice a year.
 *
 * The layout is the reference's own, not the two-column shell the shift screens use: three figures
 * across the top, then recent charges beside a narrower column of terms and staff. A back-office
 * screen is read at a desk in one pass rather than glanced at across a counter, so it is denser
 * and wider than anything the counter uses.
 */

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/** "today", "yesterday", then the date — the reference's own phrasing for the recent list. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="!px-[17px] !py-[15px]">
      <Lbl>{label}</Lbl>
      <p className="m-0 text-[25px] font-medium tabular-nums">{value}</p>
      <p className="m-0 mt-[5px] text-[11.5px] text-[var(--clear-text-muted)]">{sub}</p>
    </Card>
  );
}

function TermRow({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-[12.5px] ${first ? '' : 'mt-[7px]'}`}>
      <span className="text-[var(--clear-text-secondary)]">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export default function OverviewPage() {
  const { data: charges, loading } = useApi(() => api.charges({ limit: 300 }), []);
  const { data: position } = useApi(() => api.payouts(), []);
  const { data: profile } = useApi(() => api.profile(), []);
  const { data: staff } = useApi(() => api.staff(), []);

  const month = (charges ?? []).filter(
    (c) => Date.parse(c.createdAt) >= startOfMonth() && countsAsVolume(c.state),
  );
  const total = month.reduce((sum, c) => sum + c.amount, 0);
  const average = month.length > 0 ? total / month.length : 0;
  // From what the shop was actually paid, not from today's rate: a charge carries the rate that
  // applied when it was raised, and that is the figure that reconciles.
  const fees = month.reduce((sum, c) => sum + (c.payout === undefined ? 0 : c.amount - c.payout), 0);
  const ratePercent =
    profile?.discountRate == null ? null : Math.round(profile.discountRate * 1000) / 10;
  const recent = (charges ?? []).slice(0, 5);

  return (
    <div className="@container">
      {/* Three figures across, stacking on anything narrow. */}
      <div className="mb-3 grid grid-cols-1 gap-3 @[560px]:grid-cols-3">
        <Figure
          label="This month"
          value={dollars(total)}
          sub={
            loading
              ? 'Loading…'
              : month.length === 0
                ? 'No charges yet this month'
                : `${month.length} charges · avg ${dollars(average)}`
          }
        />
        <Figure
          label="Owed to you"
          value={dollars(fromCents(position?.owedCents ?? 0))}
          sub={
            position?.nextPayoutOn
              ? `Next payout ${formatCalendarDate(position.nextPayoutOn)}`
              : 'Next payout not scheduled yet'
          }
        />
        <Figure
          label="Fees this month"
          value={month.length === 0 ? '—' : dollars(fees)}
          sub={ratePercent === null ? 'Your agreed rate' : `${ratePercent}% · your rate`}
        />
      </div>

      {/* Recent charges beside a narrower column, as the reference has it. */}
      <div className="grid grid-cols-1 gap-4 @[760px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card className="!px-[17px] !py-[15px]">
          <Cap>Recent charges</Cap>
          {recent.length === 0 ? (
            <p className="m-0 mt-1 text-[13px] text-[var(--clear-text-muted)]">
              {loading ? 'Loading…' : 'Nothing yet.'}
            </p>
          ) : (
            recent.map((c) => (
              <div
                key={c.code}
                className="flex items-center justify-between gap-3 border-b-[0.5px] border-[var(--clear-border)] py-3 text-[13px] last:border-b-0"
              >
                <Link to={`/charges/${c.code}`} className="min-w-0 truncate">
                  {c.memberName ?? 'Not opened yet'} · {whenLabel(c.createdAt)}
                </Link>
                {isPending(c.state) ? (
                  <Pill tone="pending">{CHARGE_LABEL[c.state]}</Pill>
                ) : (
                  <span className="shrink-0 tabular-nums">{dollars(c.amount)}</span>
                )}
              </div>
            ))
          )}
        </Card>

        <div>
          <Card className="mb-3 !px-[17px] !py-[15px]">
            <Cap>Your terms</Cap>
            <TermRow
              first
              label="Rate"
              value={ratePercent === null ? '—' : `${ratePercent}%`}
            />
            <TermRow label="Payout" value={profile?.payoutTerms ?? '—'} />
            <TermRow
              label="Approval cap"
              value={
                profile?.approvalCapCents == null
                  ? '—'
                  : dollars(fromCents(profile.approvalCapCents))
              }
            />
            {profile?.founding && (
              <p className="m-0 mt-2.5 text-[11px] leading-[1.55] text-[var(--clear-text-muted)]">
                Founding partner — first five shops.
              </p>
            )}
          </Card>

          <Card className="!px-[17px] !py-[15px]">
            <Cap>Staff</Cap>
            {(staff ?? []).filter((s) => s.active).length === 0 ? (
              <p className="m-0 mt-1 text-[12.5px] text-[var(--clear-text-muted)]">
                Nobody on the roster yet.
              </p>
            ) : (
              (staff ?? [])
                .filter((s) => s.active)
                .map((s, i) => (
                  <div
                    key={s.id}
                    className={`flex justify-between gap-3 text-[12.5px] ${i === 0 ? '' : 'mt-[7px]'}`}
                  >
                    <span className="min-w-0 truncate">
                      {s.name.split(' ')[0]} · {s.role}
                    </span>
                    <span className="shrink-0 text-[var(--clear-text-muted)]">
                      {s.role === 'owner'
                        ? 'Full access'
                        : s.role === 'manager'
                          ? 'Runs the shop'
                          : 'Can charge'}
                    </span>
                  </div>
                ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
