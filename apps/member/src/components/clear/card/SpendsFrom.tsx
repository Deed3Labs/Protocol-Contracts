import { CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from '../brand/anatomy';
import { money } from '@clear/domain';
import type { CreditTier, TierKey } from '@/lib/clearModel';

/** What each tier is called here, and what it is made of. */
const TIER: Record<TierKey, { label: string; source: string; className: string }> = {
  savings: { label: 'Savings-backed', source: 'CLRUSD you hold', className: 'c-t-sav' },
  asset: { label: 'Asset-backed', source: 'Bonds and pool', className: 'c-t-ast' },
  income: { label: 'Income-backed', source: 'Observed income', className: 'c-t-inc' },
  boost: { label: 'Clear Boost™', source: 'Added', className: 'c-muted' },
};

const ORDER: TierKey[] = ['savings', 'asset', 'income', 'boost'];

/** "1.5% / cycle" reads as "1.5%" here — every tier is per cycle, so the suffix says nothing. */
const rateOf = (rate: string) => rate.replace(/\s*\/\s*cycle$/, '');

/**
 * Spends from — the waterfall in the order the card draws on it, each tier with what it costs.
 *
 * The single most important thing about this card and the thing most likely to be misunderstood, so
 * a component rather than a sentence. A numbered rail rather than a bar, because order is the fact,
 * not proportion. Across on desktop, stacked on a phone. You never choose, and the footer says so.
 */
export default function SpendsFrom({
  cash,
  tiers,
  desktop,
}: {
  /** Ready to allocate. Undefined when there is no readable card balance. */
  cash?: number;
  tiers: CreditTier[];
  desktop: boolean;
}) {
  const steps = [
    { key: 'cash', label: 'Cash', className: 'c-muted', value: cash === undefined ? '—' : money(cash, { cents: true }), source: 'Ready to allocate', rate: 'free' },
    ...ORDER.flatMap((key) => {
      const tier = tiers.find((t) => t.key === key);
      if (!tier) return [];
      return [
        {
          key,
          label: TIER[key].label,
          className: TIER[key].className,
          value: tier.added ? money(tier.limit, { cents: true }) : '—',
          source: tier.added ? TIER[key].source : 'Not added',
          rate: rateOf(tier.rate),
        },
      ];
    }),
  ];

  return (
    <Cell full>
      <CHead>
        <SecHead label="Spends from">
          <span className="c-det">Cheapest first</span>
        </SecHead>
      </CHead>
      <CMain>
        {desktop ? (
          <div className="c-wf" style={{ gridTemplateColumns: `repeat(${steps.length},minmax(0,1fr))` }}>
            {steps.map((step, i) => (
              <div key={step.key}>
                <span className="c-ord">{i + 1}</span>
                <p className={`text-sec ${step.className}`}>{step.label}</p>
                <p className="c-fig c-fig-row mt-[4px]">{step.value}</p>
                <p className="c-det mt-[4px]">{step.source}</p>
                <p className="c-det">{step.rate}</p>
              </div>
            ))}
          </div>
        ) : (
          <Rows>
            {steps.map((step, i) => (
              <div key={step.key}>
                <Line>
                  <span className="text-sec">
                    <span className="c-ord">{i + 1}</span>
                    <span className={step.className}>{step.label}</span>
                  </span>
                  <span className="c-fig c-fig-row">{step.value}</span>
                </Line>
                <p className="c-det mt-[3px] pl-[26px]">
                  {step.source} &middot; {step.rate}
                </p>
              </div>
            ))}
          </Rows>
        )}
      </CMain>
      <CFoot>
        <p className="c-det">
          You never choose. The card takes the cheapest money you have, and only reaches the next tier when the one above
          it runs out.
        </p>
      </CFoot>
    </Cell>
  );
}
