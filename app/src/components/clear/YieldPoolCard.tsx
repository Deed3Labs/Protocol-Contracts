import { Button } from '@/components/ui/button';
import Card from './Card';
import { money, compactMoney, signedMoney } from '@/lib/money';
import { poolUtilization, type YieldPool } from '@/lib/clearModel';

/**
 * Yield pool — design spec §6.
 *
 * Deliberately a different visual language from BurnerBonds: one large variable
 * rate and a continuous utilization bar, because the return moves and the money
 * comes out whenever you want it. Bonds get a discrete ladder for the opposite
 * reason.
 */
export default function YieldPoolCard({
  pool,
  onDeposit,
}: {
  pool: YieldPool;
  onDeposit?: () => void;
}) {
  const utilization = poolUtilization(pool);

  return (
    <Card className="flex flex-col">
      <div className="mb-0.5 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Yield pool</span>
        <span className="text-[11px] text-muted-foreground">Withdraw anytime</span>
      </div>

      <p className="font-display mb-0.5 text-[28px] font-medium leading-none">
        {pool.apy}%
        <span className="ml-1.5 text-sm font-normal text-foreground-secondary">APY</span>
      </p>
      <p className="mb-3.5 text-[11px] text-muted-foreground">Variable · rises with lending demand</p>

      <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>Utilization</span>
        <span className="tabular-nums">{Math.round(utilization * 100)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-[3px] bg-border">
        <div className="h-full bg-tier-boost" style={{ width: `${utilization * 100}%` }} />
      </div>
      <p className="mb-3.5 mt-1.5 text-[11px] text-muted-foreground">
        {compactMoney(pool.lent)} of {compactMoney(pool.capacity)} lent to members
      </p>

      <div className="mb-3 border-t-[0.5px] border-border pt-[11px] text-xs leading-[2]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground-secondary">Your position</span>
          <span className="tabular-nums">{money(pool.position, { cents: true })}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground-secondary">Earned</span>
          <span className="tabular-nums text-tier-savings-fg">{signedMoney(pool.earned)}</span>
        </div>
      </div>

      <div className="mt-auto flex gap-2">
        <Button variant="clear" size="xs" className="flex-1" onClick={onDeposit}>
          Deposit
        </Button>
        <Button variant="clear" size="xs" className="flex-1" disabled={pool.position <= 0}>
          Withdraw
        </Button>
      </div>
    </Card>
  );
}
