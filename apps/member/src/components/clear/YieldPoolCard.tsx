import { Button } from '@/components/ui/button';
import Card from './Card';
import { money, compactMoney, signedMoney } from '@clear/domain';
import { poolBacking, poolUtilization, type EarnData } from '@/lib/clearModel';

/**
 * Utilization as a ring — design spec §6.
 *
 * A full-width track would be the page's second bar and would claim the same visual weight as the
 * composition bar in the hero, which is showing something else entirely (what the money is made of,
 * not how hard it's working). The ring costs no vertical space and sits beside the rate, which is
 * the number it belongs with: what you earn, and how much of the pool is out earning it.
 */
function UtilizationRing({ value, size = 58 }: { value: number; size?: number }) {
  const stroke = 5;
  const r = size / 2 - stroke / 2 - 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.round(value * 100);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, value)))}
          className="stroke-tier-boost"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[13px] font-medium tabular-nums">{pct}%</span>
      </div>
    </div>
  );
}

/**
 * Yield pool — design spec §6.
 *
 * Deliberately a different visual language from the bonds beside it: one large variable rate, and
 * money that leaves whenever you want it. Bonds get dated rows for the opposite reason.
 *
 * The backing row is the point of the whole page — the position is lent out, and it still raises the
 * credit limit while it is. The withdrawal-queue warning deliberately isn't here; it belongs in the
 * withdraw modal, at the moment it actually bears on a decision.
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

  return (
    <Card className="flex flex-col">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Yield pool</span>
        <span className="text-[11px] text-muted-foreground">Withdraw anytime</span>
      </div>

      <div className="mb-3.5 flex items-center gap-4">
        <UtilizationRing value={poolUtilization(pool)} />
        <div className="min-w-0">
          <p className="font-display text-[26px] font-medium leading-[1.1]">
            {pool.apy}%<span className="text-xs font-normal text-foreground-secondary"> APY</span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Variable · {compactMoney(pool.lent)} of {compactMoney(pool.capacity)} lent
          </p>
        </div>
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
          <span className="tabular-nums">{money(poolBacking(data), { cents: true })}</span>
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
