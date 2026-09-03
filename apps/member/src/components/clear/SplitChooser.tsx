import { Button } from '@/components/ui/button';
import { money } from '@clear/domain';
import { splitQuote } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The split control and what each option costs — design spec §4c.
 *
 * Shared by the counter checkout and the plan modal on purpose. The split is chosen once at the
 * counter and changeable afterwards, and a member who set it in one place and revisited it in the
 * other should be reading the same five figures both times.
 *
 * Those figures are what make the choice honest: spreading further costs more and the carry lines
 * say so in dollars, so no warning has to.
 */
export default function SplitChooser({
  amount,
  options,
  ratePerCycle,
  /** Display rate, e.g. "2% / cycle" — heads the section rather than repeating per row. */
  rate,
  splitInto,
  onChange,
  doneBy,
}: {
  amount: number;
  options: number[];
  ratePerCycle: number;
  rate?: string;
  splitInto: number;
  onChange: (splitInto: number) => void;
  doneBy: (splitInto: number) => string;
}) {
  const quote = splitQuote(amount, splitInto, ratePerCycle);

  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-foreground-secondary">{label}</span>
      <span className={cn('tabular-nums', strong && 'font-medium')}>{value}</span>
    </div>
  );

  return (
    <>
      {/* The rate is stated once, with what it's charged on. Repeated per row it left open whether
          it applied to the original amount or to the balance. */}
      <p className="mb-2 text-[11px] uppercase tracking-[0.2px] text-muted-foreground">
        How to clear it{rate ? ` · ${rate.replace(' / cycle', '')} a cycle on what you still owe` : ''}
      </p>

      <div className="mb-3 flex gap-1.5">
        {options.map((option) => (
          <Button
            key={option}
            variant="clear"
            size="xs"
            aria-pressed={splitInto === option}
            onClick={() => onChange(option)}
            className={cn('flex-1', splitInto === option && 'border-tier-boost text-tier-boost-fg')}
          >
            {option === 1 ? 'In full' : `In ${option}`}
          </Button>
        ))}
      </div>

      <div className="border-t-[0.5px] border-border pt-2.5 text-xs leading-[2.1]">
        <Row label="Each cycle" value={money(quote.perCycle, { cents: true })} />
        {/* Two carry figures, because they answer different questions: what holding it costs now,
            and what the whole plan costs. Either alone misleads. */}
        <Row label="Carry this cycle" value={money(quote.carryThisCycle, { cents: true })} />
        <Row label="Carry over the whole plan" value={money(quote.carry, { cents: true })} />
        <Row label="Total" value={money(quote.total, { cents: true })} strong />
        <Row label="Done by" value={doneBy(splitInto)} />
      </div>
    </>
  );
}
