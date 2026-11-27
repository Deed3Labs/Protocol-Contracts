import { Btn, CFoot, CHead, CMain, Cell, Line, SecHead } from './brand/anatomy';
import { money, compactMoney, signedMoney } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { poolBacking, poolUtilization, type EarnData } from '@/lib/clearModel';

/**
 * Utilization as a ring.
 *
 * A data mark, not a container, so the square/pill rule does not reach it — but its caps are squared.
 * Utilization is a single ratio, and a number beats a bar for that; the ring pairs it with the APY it
 * qualifies and costs no vertical space. Track ink-13, arc in the pool's colour (underway: variable).
 */
function UtilizationRing({ value, size }: { value: number; size: number }) {
  const stroke = 5;
  const r = size / 2 - stroke;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <div className="c-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink-13)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--tier-income)"
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
        />
      </svg>
      <div className="c-pct">{Math.round(clamped * 100)}%</div>
    </div>
  );
}

/**
 * Yield pool — a variable rate, and money that leaves whenever you want it.
 *
 * Header: the name and the one fact that sets it apart from bonds. Main: the ring beside the rate,
 * then the member's position, what it has earned and what it backs. Footer: Deposit and Withdraw.
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
  const desktop = useIsDesktop();
  const { pool } = data;

  return (
    <Cell full={!desktop}>
      <CHead>
        <SecHead label="Yield pool">
          <span className="c-det">Withdraw anytime</span>
        </SecHead>
      </CHead>
      <CMain>
        <div className="c-rate">
          <UtilizationRing value={poolUtilization(pool)} size={desktop ? 58 : 52} />
          <div>
            <p className="c-apy">
              {pool.apy}%<small> APY</small>
            </p>
            <p className="c-det mt-1">
              Variable &middot; {compactMoney(pool.lent)} of {compactMoney(pool.capacity)} lent
            </p>
          </div>
        </div>
        <div className="mt-s2 border-t border-ink-13 pt-s2">
          <Line>
            <span className="c-sub">Your position</span>
            <span className="c-fig c-fig-row">{money(pool.position, { cents: true })}</span>
          </Line>
          <Line>
            <span className="c-sub">Earned</span>
            <span className="c-fig c-fig-row c-pos">{signedMoney(pool.earned)}</span>
          </Line>
          <Line>
            <span className="c-sub">Backs limit at {Math.round(data.poolLtv * 100)}%</span>
            <span className="c-fig c-fig-row">{money(poolBacking(data), { cents: true })}</span>
          </Line>
        </div>
      </CMain>
      <CFoot>
        <div className="c-pair">
          <Btn onClick={onDeposit}>Deposit</Btn>
          <Btn disabled={pool.position <= 0} onClick={onWithdraw}>
            Withdraw
          </Btn>
        </div>
      </CFoot>
    </Cell>
  );
}
