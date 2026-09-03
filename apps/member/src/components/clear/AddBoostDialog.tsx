import { Button } from '@/components/ui/button';
import Card from './Card';
import Modal from './Modal';
import { money } from '@clear/domain';
import { creditLimit, type Credit, type CreditTier } from '@/lib/clearModel';

/**
 * Add Clear Boost — the opt-in credit tier.
 *
 * The job here is to make the cost legible before anyone commits, so the figures
 * are computed rather than written: what the limit is today, what it becomes,
 * and what a full cycle on the whole amount would actually cost. Boost is the
 * most expensive tier, and it's the one tier a member has to choose.
 *
 * The reassurance below the numbers is the important part — Boost is drawn last
 * (rule 7, cheapest-first), so adding it doesn't make anything else cost more.
 */
export default function AddBoostDialog({
  credit,
  tier,
  open,
  onOpenChange,
  onAdd,
}: {
  credit: Credit;
  tier: CreditTier;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: () => void;
}) {
  const limitToday = creditLimit(credit);
  const fullCycleCost = tier.ratePerCycle ? tier.limit * tier.ratePerCycle : undefined;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${tier.label}`}
      description="Review what Clear Boost adds to your limit and what it costs before adding it."
    >
      <p className="mb-1 text-xs text-foreground-secondary">
        Extra credit when everything cheaper is used up
      </p>
      <p className="font-display mb-1 text-[32px] font-medium leading-none tracking-[-0.5px]">
        {money(tier.limit)}
      </p>
      <p className="mb-3.5 text-xs text-muted-foreground">
        {tier.rate.replace(' / cycle', ' per cycle')} · only charged on what you use
      </p>

      <Card className="mb-3">
        <div className="text-xs leading-[2]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">Your limit today</span>
            <span className="tabular-nums">{money(limitToday)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">With {tier.label}</span>
            <span className="tabular-nums">{money(limitToday + tier.limit)}</span>
          </div>
          {fullCycleCost !== undefined && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-foreground-secondary">
                Cost if you use {money(tier.limit)} for a full cycle
              </span>
              <span className="tabular-nums">{money(fullCycleCost, { cents: true })}</span>
            </div>
          )}
        </div>
      </Card>

      <div className="mb-3.5 rounded-lg bg-tier-boost/10 px-3.5 py-2.5">
        <p className="text-xs leading-relaxed text-tier-boost-fg">
          {tier.label} is drawn last. Your savings and asset-backed credit are used first, so you
          only reach it after everything cheaper is gone.
        </p>
      </div>

      <Button size="xs" className="mb-2 w-full" onClick={onAdd}>
        Add Boost
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        You can remove it any time you&rsquo;re not carrying a balance on it.
      </p>
    </Modal>
  );
}
