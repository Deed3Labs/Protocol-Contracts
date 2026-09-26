import { Btn } from './brand/anatomy';
import { money } from '@clear/domain';
import { splitQuote } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The split control — what you touch, so it is a modal's main: one chip per option, then one block
 * per payment and a caption saying the same thing in words.
 *
 * The blocks are a count made visible, not a ratio: twelve blocks means twelve payments, which is why
 * they pass where a progress bar on a split would not. The caption means the blocks are never the
 * only signal.
 */
export function SplitControl({
  amount,
  options,
  ratePerCycle,
  splitInto,
  onChange,
}: {
  amount: number;
  options: number[];
  ratePerCycle: number;
  splitInto: number;
  onChange: (splitInto: number) => void;
}) {
  const quote = splitQuote(amount, splitInto, ratePerCycle);

  return (
    <>
      <div className="c-qc c-split">
        {options.map((option) => (
          <Btn
            key={option}
            aria-pressed={splitInto === option}
            onClick={() => onChange(option)}
            className={cn('c-chip-q', splitInto === option && 'c-on')}
          >
            {/* Not "In full": beside Pay now that reads as the same thing, when it means clearing at
                the end of the cycle, with a cycle's carry. */}
            {option === 1 ? 'Next cycle' : `In ${option}`}
          </Btn>
        ))}
      </div>
      <div className="c-segs" aria-hidden>
        {Array.from({ length: quote.splitInto }, (_, i) => (
          <div key={i} />
        ))}
      </div>
      <p className="c-segcap">
        {quote.splitInto === 1
          ? `One payment of ${money(quote.perCycle, { cents: true })}`
          : `${quote.splitInto} payments of ${money(quote.perCycle, { cents: true })}`}
      </p>
    </>
  );
}

/**
 * What follows from the split — a modal's footer. Five lines, Total in cobalt, because on this
 * screen the total is the reason you are looking.
 *
 * Two carry figures, because they answer different questions: what holding it costs now, and what
 * the whole plan costs. Either alone misleads.
 */
export function SplitConsequences({
  amount,
  ratePerCycle,
  splitInto,
  doneBy,
}: {
  amount: number;
  ratePerCycle: number;
  splitInto: number;
  doneBy: (splitInto: number) => string;
}) {
  const quote = splitQuote(amount, splitInto, ratePerCycle);

  return (
    <div className="c-conseq">
      <div>
        <span>Each cycle</span>
        <span>{money(quote.perCycle, { cents: true })}</span>
      </div>
      <div>
        <span>Carry this cycle</span>
        <span>{money(quote.carryThisCycle, { cents: true })}</span>
      </div>
      <div>
        <span>Carry over the plan</span>
        <span>{money(quote.carry, { cents: true })}</span>
      </div>
      <div className="c-total">
        <span>Total</span>
        <span>{money(quote.total, { cents: true })}</span>
      </div>
      <div>
        <span>Done by</span>
        <span>{doneBy(splitInto)}</span>
      </div>
    </div>
  );
}

/**
 * Both halves together, for surfaces not yet on the modal shell (the counter onboarding). Shared on
 * purpose: a member who set the split at a counter and revisits it later reads the same five figures.
 */
export default function SplitChooser({
  amount,
  options,
  ratePerCycle,
  splitInto,
  onChange,
  doneBy,
}: {
  amount: number;
  options: number[];
  ratePerCycle: number;
  /** No longer shown here: the rate is stated in the footnote of the surface around the control. */
  rate?: string;
  splitInto: number;
  onChange: (splitInto: number) => void;
  doneBy: (splitInto: number) => string;
}) {
  return (
    <>
      <SplitControl amount={amount} options={options} ratePerCycle={ratePerCycle} splitInto={splitInto} onChange={onChange} />
      <div className="mt-s2 border-t border-ink-13 pt-s2">
        <SplitConsequences amount={amount} ratePerCycle={ratePerCycle} splitInto={splitInto} doneBy={doneBy} />
      </div>
    </>
  );
}
