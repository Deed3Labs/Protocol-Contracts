import { Button } from '@/components/ui/button';
import Card from './Card';
import { money, compactMoney, signedMoney } from '@/lib/money';
import { poolBacking, poolUtilization, type EarnData } from '@/lib/clearModel';

/**
 * Yield pool — design spec §6.
 *
 * Deliberately a different visual language from the bond ladder: one large
 * variable rate and a continuous utilization bar, because the return moves and
 * the money comes out whenever you want it. Bonds get discrete rows for the
 * opposite reason.
 *
 * The backing row is the point of the whole page — the position is lent out, and
 * it still raises the credit limit while it is.
 */
export default function YieldPoolCard({
  data,
  onDeposit,
  onWithdraw,
}: {
  data: EarnData;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}) {
  const { pool } = data;
  const utilization = poolUtilization(pool);

  return (
    <Card className="flex flex-col">
      <div className="mb-0.5 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Yield pool</span>
        <span className="text-[11px] text-muted-foreground">Withdraw anytime</span>
      </div>

      <div className="mb-3 flex items-baseline gap-2">
        <span className="font-display text-[26px] font-medium leading-none">{pool.apy}%</span>
        <span className="text-xs text-foreground-secondary">APY · variable</span>
      </div>

      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
        <span>Utilization</span>
        <span className="tabular-nums">
          {Math.round(utilization * 100)}% · {compactMoney(pool.lent)} of{' '}
          {compactMoney(pool.capacity)} lent
        </span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-[3px] bg-border">
        <div className="h-full bg-tier-boost" style={{ width: `${utilization * 100}%` }} />
      </div>

      <div className="mb-3 border-t-[0.5px] border-border pt-2.5 text-xs leading-[1.95]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground-secondary">Your position</span>
          <span className="tabular-nums">{money(pool.position, { cents: true })}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground-secondary">Earned</span>
          <span className="tabular-nums text-tier-savings-fg">{signedMoney(pool.earned)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground-secondary">
            Backs limit at {Math.round(data.poolLtv * 100)}%
          </span>
          <span className="tabular-nums">{money(poolBacking(data))}</span>
        </div>
      </div>

      <div className="mt-auto flex gap-2">
        <Button variant="clear" size="xs" className="flex-1" onClick={onDeposit}>
          Deposit
        </Button>
        <Button
          variant="clear"
          size="xs"
          className="flex-1"
          disabled={pool.position <= 0}
          onClick={onWithdraw}
        >
          Withdraw
        </Button>
      </div>
    </Card>
  );
}
