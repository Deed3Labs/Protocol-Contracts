import { Bar, Btn, CFoot, CHead, CMain, Cell, HeadFig, Line, SecHead } from './brand/anatomy';
import { money } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import {
  addableTier,
  creditLimit,
  creditUsed,
  orderedTiers,
  type Credit,
  type CreditTier,
  type TierKey,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** Tier text, on the guide's ramp. Asset takes land-ink: land itself is too light to read as text. */
export const TIER_TEXT_CLASS: Record<TierKey, string> = {
  savings: 'c-t-sav',
  asset: 'c-t-ast',
  income: 'c-t-inc',
  boost: 'c-t-bst',
};

/** Tier fill, as a colour for inline bar segments. */
export const TIER_COLOR: Record<TierKey, string> = {
  savings: 'var(--tier-savings)',
  asset: 'var(--tier-asset)',
  income: 'var(--tier-income)',
  boost: 'var(--tier-boost)',
};

/**
 * An "X of Y" figure on this cell: whole dollars, floored. The reference sets every X-of-Y here
 * without decimals, and a limit derived from haircut collateral ($8,300.25) otherwise prints its cents
 * and pushes the legend onto two lines at phone width. Floored rather than rounded so a limit is
 * never overstated.
 */
const whole = (v: number) => money(Math.floor(v));

/** Legend label. The phone drops "(CLRUSD)" from savings and "/ cycle" from every rate. */
function tierName(tier: CreditTier, desktop: boolean) {
  const label = !desktop && tier.key === 'savings' && tier.shortLabel ? tier.shortLabel : tier.label;
  const rate = desktop ? tier.rate : tier.rate.replace(' / cycle', '');
  return `${label} · ${rate}`;
}

/**
 * Credit used — a cell on Home's slab.
 *
 * Header: the label and "$5,400 of $12,300" (X of Y, no decimals). Main: the tier bar, the legend
 * and, while anything is drawn, the carry. Footer: Add Boost and Limit breakdown, the same place in
 * every state.
 *
 * The bar is the shape of the limit — each added tier's share of it, cheapest first — so it reads as
 * a cost ramp. Nothing drawn, it stays at 35% so it reads as available rather than spent, and every
 * legend line goes muted and states its capacity and that none of it is drawn.
 */
export default function ClearCreditCard({
  credit,
  onViewBreakdown,
  onAddBoost,
}: {
  credit: Credit;
  onViewBreakdown?: () => void;
  onAddBoost?: () => void;
}) {
  const desktop = useIsDesktop();
  const tiers = orderedTiers(credit.tiers);
  const used = creditUsed(credit);
  const limit = creditLimit(credit);
  const drawn = used > 0;
  const addable = addableTier(credit);

  return (
    <Cell>
      <CHead>
        <SecHead label="Credit used">
          <HeadFig value={whole(used)} of={whole(limit)} />
        </SecHead>
      </CHead>
      <CMain>
        <Bar
          label={`${whole(used)} of ${whole(limit)} credit used`}
          className="mb-s2"
          style={drawn ? undefined : { opacity: 0.35 }}
          segments={tiers
            .filter((t) => t.added)
            .map((t) => ({
              label: t.label,
              pct: limit > 0 ? (t.limit / limit) * 100 : 0,
              color: TIER_COLOR[t.key],
            }))}
        />
        <div className="c-legend">
          {tiers.map((t) => {
            const muted = !t.added || !drawn;
            return (
              <div key={t.key}>
                <span className={muted ? 'c-muted' : TIER_TEXT_CLASS[t.key]}>{tierName(t, desktop)}</span>
                <span className={cn(muted && 'c-muted')}>
                  {!t.added
                    ? 'not added'
                    : drawn
                      ? `${whole(t.used)} of ${whole(t.limit)}`
                      : `${whole(t.limit)} · not drawn`}
                </span>
              </div>
            );
          })}
        </div>
        {drawn && (
          <>
            <Line className="mt-s2 border-t border-ink-13 pt-s2">
              <span className="c-sub">{desktop ? 'Carry cost so far' : 'Carry cost'}</span>
              <span className="c-fig c-fig-row">{money(credit.carryCost, { cents: true })}</span>
            </Line>
            {desktop && (
              <p className="c-det mt-[6px]">
                Drops to {money(0, { cents: true })} when you get back under{' '}
                {money(credit.carryFreeUnder, { cents: true })}
              </p>
            )}
          </>
        )}
      </CMain>
      <CFoot>
        <div className="c-pair">
          {addable && <Btn onClick={onAddBoost}>Add Boost</Btn>}
          <Btn onClick={onViewBreakdown}>Limit breakdown</Btn>
        </div>
      </CFoot>
    </Cell>
  );
}
