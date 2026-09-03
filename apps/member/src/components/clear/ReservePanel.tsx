import Card from './Card';
import SettingRows from './SettingRows';
import { money, count } from '@clear/domain';
import type { AssuranceReserve } from '@/lib/clearModel';

/**
 * The assurance reserve — design spec §5.
 *
 * Published numbers are the whole point: a protection nobody can audit is a
 * promise, and the balance, the members covered and what's actually been paid out
 * are what turn it into a fund. "Where it comes from" answers the question every
 * member asks next — whether their savings are quietly insuring someone else.
 * They aren't, and that has to be said in the plainest words available.
 */
export default function ReservePanel({
  reserve,
  onClaim,
}: {
  reserve: AssuranceReserve;
  onClaim?: () => void;
}) {
  return (
    <>
      <p className="mb-3.5 text-xs leading-relaxed text-foreground-secondary">
        The assurance reserve is the co-op&rsquo;s shared safety fund. It&rsquo;s what makes these
        protections real rather than a promise.
      </p>

      <Card className="mb-4">
        <div className="text-xs leading-[2]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Reserve balance</span>
            <span className="tabular-nums">{money(reserve.balance)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Members covered</span>
            <span className="tabular-nums">{count(reserve.membersCovered)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Claims paid this year</span>
            <span className="tabular-nums">{money(reserve.claimsPaidThisYear)}</span>
          </div>
        </div>
      </Card>

      <p className="mb-1.5 text-[11px] text-foreground-secondary">Where it comes from</p>
      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
        Retained surplus from lending and card activity — not from member deposits. Your savings are
        never used to cover someone else&rsquo;s claim.
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        When a member defaults, their own collateral covers it first.
      </p>

      <SettingRows
        className="mt-3.5 border-t-[0.5px] border-border pt-1"
        rows={[
          { label: 'Reserve reports', value: reserve.reportCadence },
          { label: 'How to make a claim', onSelect: onClaim },
        ]}
      />
    </>
  );
}
