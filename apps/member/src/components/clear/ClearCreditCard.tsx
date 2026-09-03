import { Button } from '@/components/ui/button';
import Card, { CardRule } from './Card';
import SegmentedBar, { type Segment } from './SegmentedBar';
import { money } from '@clear/domain';
import {
  addableTier,
  creditLimit,
  creditUsed,
  orderedTiers,
  TIER_FILL,
  TIER_TINT,
  type Credit,
  type CreditTier,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

function TierDot({ tier }: { tier: CreditTier['key'] }) {
  return <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TIER_FILL[tier])} />;
}

function TierRow({ tier }: { tier: CreditTier }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 leading-[1.9]', !tier.added && 'opacity-50')}>
      <span className="flex min-w-0 items-center gap-1.5">
        <TierDot tier={tier.key} />
        <span className="truncate">
          {tier.shortLabel && <span className="lg:hidden">{tier.shortLabel}</span>}
          <span className={cn(tier.shortLabel && 'hidden lg:inline')}>{tier.label}</span>
          <span className="px-1">·</span>
          {tier.rate}
        </span>
      </span>
      <span className="shrink-0 tabular-nums">
        {tier.added ? `${money(tier.used)} of ${money(tier.limit)}` : 'not added'}
      </span>
    </div>
  );
}

/**
 * Clear credit — design spec §4.
 *
 * The bar is the load-bearing part: segments are sized from each tier's actual
 * usage against the limit and drawn cheapest-first (rules 4 and 7), with each
 * tier's remaining headroom tinted behind it, so the bar answers "how much is
 * left, and in which tier" rather than just "how full". It sits entirely in
 * tints while cash is being spent. The card takes an accent border once credit
 * is engaged (rule 6).
 */
export default function ClearCreditCard({
  credit,
  engaged,
  onViewBreakdown,
  onAddBoost,
}: {
  credit: Credit;
  engaged: boolean;
  onViewBreakdown?: () => void;
  onAddBoost?: () => void;
}) {
  const tiers = orderedTiers(credit.tiers);
  const used = creditUsed(credit);
  const limit = creditLimit(credit);
  const addable = addableTier(credit);

  // Each added tier draws twice: what's been used in its own colour, then what's
  // left of it in a tint of the same colour. The added tiers total the limit, so
  // the bar fills — the empty-looking part is headroom in a specific tier, not an
  // anonymous remainder. Tiers that haven't been added contribute neither.
  const segments: Segment[] = tiers
    .filter((t) => t.added)
    .flatMap((t) => [
      { value: t.used, className: TIER_FILL[t.key], label: `${t.label} used` },
      {
        value: Math.max(0, t.limit - t.used),
        className: TIER_TINT[t.key],
        label: `${t.label} left`,
      },
    ]);

  return (
    <Card accent={engaged} className="flex flex-col">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Clear credit used</span>
        <span className="shrink-0 text-[17px] font-medium tabular-nums">
          {money(used)}{' '}
          <span className="text-[13px] font-normal text-foreground-secondary">of {money(limit)}</span>
        </span>
      </div>

      <SegmentedBar
        segments={segments}
        total={limit}
        label={`${money(used)} of ${money(limit)} used`}
        className="mb-2.5"
      />

      <div className="text-xs text-muted-foreground">
        {tiers.map((t) => (
          <TierRow key={t.key} tier={t} />
        ))}
      </div>

      <CardRule className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-foreground-secondary">Carry cost so far</span>
        <span className="text-[13px] font-medium tabular-nums">{money(credit.carryCost, { cents: true })}</span>
      </CardRule>
      <p className="mt-[7px] text-[11px] leading-relaxed text-muted-foreground">
        Drops to {money(0)} when you get back under {money(credit.carryFreeUnder)}
      </p>

      {/* Adding the opt-in tier is offered next to the breakdown that explains it,
          and only while there's something left to add. */}
      <div className="mt-2.5 flex gap-2">
        {addable && (
          <Button variant="clear" size="xs" className="flex-1" onClick={onAddBoost}>
            {/* Not the tier's full name: it's a button, and the surface it opens says the rest.
                Deliberately not `shortLabel` either — that drives the mobile legend, which keeps the
                full mark. */}
            Add Boost
          </Button>
        )}
        <Button variant="clear" size="xs" className="flex-1" onClick={onViewBreakdown}>
          Limit breakdown
        </Button>
      </div>
    </Card>
  );
}
