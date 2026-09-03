import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Card from './Card';
import Modal from './Modal';
import AmountPicker from './AmountPicker';
import InfoBlock from './InfoBlock';
import { money } from '@clear/domain';
import {
  TIER_FILL,
  creditUsed,
  cycleShortfall,
  repaidUnsecured,
  repayAllocation,
  securedUsed,
  unsecuredUsed,
  type CashAccount,
  type Credit,
  type Cycle,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** One quick-pick. A pick the source can't fund is offered but disabled, not hidden. */
function Pick({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="clear"
      size="xs"
      className={cn('flex-1', selected && 'border-tier-boost text-tier-boost-fg')}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      {label}
    </Button>
  );
}

function SummaryRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-foreground-secondary">{label}</span>
      <span className={cn('tabular-nums', className)}>{value}</span>
    </div>
  );
}

/**
 * Repay / Move to cash — design spec §4, one modal.
 *
 * They are the same action: money leaves Ready to allocate and lands on the account. The only
 * difference is whether a balance is in the way, and that difference is the title. Splitting them
 * into two surfaces would have meant a member learning two flows for one movement of money, and
 * having to know which one applied before they could pick.
 *
 * Carrying → the tier unwind appears, most expensive first, and the quick-picks are about the cycle.
 * Not carrying → that section drops out and a line says plainly that this is just moving money.
 *
 * The summary's `Cycle` row is the one that earns its place: it's the only thing on the surface that
 * answers whether the action the member is about to take actually resolves anything.
 */
export default function RepayDialog({
  credit,
  account,
  cycle,
  open,
  onOpenChange,
}: {
  credit: Credit;
  /** Source is Ready to allocate; destination is the account. Both live here. */
  account: CashAccount;
  cycle: Cycle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const source = account.readyToAllocate;
  const outstanding = creditUsed(credit);
  const carrying = outstanding > 0;
  const toClear = unsecuredUsed(credit);

  // A pick is only offered if the source can fund it, so the opening amount is the largest one that
  // can: clearing the cycle if that's affordable, otherwise everything on hand.
  const clearCycle = Math.min(toClear, source);
  const [amount, setAmount] = useState(carrying ? clearCycle : source);
  const [custom, setCustom] = useState(false);

  // Reopening after the numbers moved should not show the amount from last time.
  useEffect(() => {
    if (!open) return;
    setAmount(carrying ? clearCycle : source);
    setCustom(false);
  }, [open, carrying, clearCycle, source]);

  const capped = Math.min(Math.max(0, amount), source);
  const lines = repayAllocation(credit, capped);
  const towardCycle = repaidUnsecured(credit, capped);
  // The repayment behaves exactly like more deposit arriving, so the cycle reads it the same way and
  // this surface can't disagree with the strip on Home about whether the cycle clears.
  const shortAfter = cycleShortfall(credit, account.nextDepositEstimate + towardCycle);
  const stillCarrying = Math.max(0, outstanding - capped);
  // Money only spills to Spendable once EVERYTHING carried is cleared — not once the cycle
  // requirement is met. Paying past the cycle still buys down the cheap secured tiers, and handing
  // the surplus back while a balance stood would be lending the member their own money at 0.65%.
  const leftOver = Math.max(0, capped - outstanding);

  const select = (value: number) => {
    setCustom(false);
    setAmount(value);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={carrying ? 'Repay' : 'Move to cash'}
      description={
        carrying
          ? 'Put money against your Clear credit balance, most expensive tier first.'
          : 'Move money from Ready to allocate back to your spendable balance.'
      }
    >
      <AmountPicker amount={capped} onChange={setAmount} editable={custom} />

      <div className="mb-4 flex gap-1.5">
        {carrying ? (
          <>
            {toClear > 0 && (
              <Pick
                label="Clear cycle"
                selected={!custom && capped === clearCycle}
                disabled={toClear > source}
                onSelect={() => select(clearCycle)}
              />
            )}
            <Pick
              label="Clear all"
              selected={!custom && capped === outstanding}
              disabled={outstanding > source}
              onSelect={() => select(outstanding)}
            />
          </>
        ) : (
          <Pick label="All" selected={!custom && capped === source} onSelect={() => select(source)} />
        )}
        <Pick label="Custom" selected={custom} onSelect={() => setCustom(true)} />
      </div>

      {carrying && (
        <>
          <p className="mb-2 text-[11px] tracking-[0.2px] text-muted-foreground">THIS CLEARS</p>
          <div className="mb-3.5 text-xs">
            {lines.map((line, i) => (
              <div
                key={line.tier.key}
                className={cn(
                  'flex items-baseline justify-between gap-3 py-2',
                  i < lines.length - 1 && 'border-b-[0.5px] border-border',
                  // A tier the money never reaches is still worth showing, quietly.
                  line.applied === 0 && 'opacity-45',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TIER_FILL[line.tier.key])} />
                  <span className="truncate">
                    {line.tier.label} · {line.tier.rate}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {line.applied === 0
                    ? 'untouched'
                    : line.applied < line.drawn
                      ? `${money(line.applied, { cents: true })} of ${money(line.drawn, { cents: true })}`
                      : money(line.applied, { cents: true })}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {carrying && leftOver > 0 && (
        <InfoBlock tone="success" className="mb-3.5">
          <span className="flex items-baseline justify-between gap-3">
            <span>Left over → Spendable</span>
            <span className="text-[15px] font-medium tabular-nums">
              {money(leftOver, { cents: true })}
            </span>
          </span>
          <span className="mt-[5px] block text-[11px] opacity-85">
            Clears everything you're carrying, and the rest lands in your cash account.
          </span>
        </InfoBlock>
      )}

      <Card className="mb-3.5 px-3.5 py-[11px] text-xs leading-loose">
        <SummaryRow label="From" value="Ready to allocate" />
        {carrying ? (
          <>
            <SummaryRow
              label="Still carrying"
              value={
                stillCarrying > 0 && stillCarrying <= securedUsed(credit)
                  ? `${money(stillCarrying, { cents: true })} secured`
                  : money(stillCarrying, { cents: true })
              }
            />
            <SummaryRow
              label="Cycle"
              value={shortAfter === 0 ? 'Clear' : `${money(shortAfter, { cents: true })} short`}
              className={shortAfter === 0 ? 'text-tier-savings-fg' : 'text-tier-boost-fg'}
            />
          </>
        ) : (
          <>
            <SummaryRow label="To" value="Spendable" />
            <SummaryRow
              label="Available after"
              value={money(account.spendable + capped, { cents: true })}
            />
          </>
        )}
      </Card>

      {carrying && shortAfter > 0 && (
        <InfoBlock className="mb-3.5">
          {money(shortAfter, { cents: true })} short of clearing this cycle. Without it your limit
          contracts on {cycle.rebalanceBy}.
        </InfoBlock>
      )}

      {!carrying && (
        <InfoBlock tone="neutral" className="mb-3.5">
          You're not carrying credit, so this just moves money. It'll be spendable on your card
          straight away.
        </InfoBlock>
      )}

      <Button size="sm" className="w-full" disabled={capped <= 0}>
        {carrying ? 'Repay' : 'Move'} {money(capped, { cents: true })}
      </Button>

      {carrying && (
        <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
          Most expensive credit clears first.
        </p>
      )}
    </Modal>
  );
}
