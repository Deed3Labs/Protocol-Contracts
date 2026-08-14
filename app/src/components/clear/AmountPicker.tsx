import { Button } from '@/components/ui/button';
import { money } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * The amount a task surface is about to act on, with quick presets under it.
 *
 * Centered and large because it's the one thing being decided — everything else
 * on these surfaces is consequence. The presets are shortcuts, not the only
 * options; the figure is the source of truth.
 */
export default function AmountPicker({
  amount,
  presets = [],
  onChange,
  label = 'Amount',
  /** Label for a preset that means "everything available" rather than a figure. */
  maxLabel,
  maxAmount,
  /** Let the figure itself be typed into, for surfaces with no natural presets. */
  editable,
}: {
  amount: number;
  presets?: number[];
  onChange: (amount: number) => void;
  label?: string;
  maxLabel?: string;
  maxAmount?: number;
  editable?: boolean;
}) {
  return (
    <>
      <p className="mb-1 text-center text-xs text-foreground-secondary">{label}</p>
      {editable ? (
        <input
          value={money(amount)}
          onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
          inputMode="decimal"
          aria-label={label}
          className="font-display mb-3.5 w-full bg-transparent text-center text-[40px] font-medium leading-none tracking-[-1px] outline-none"
        />
      ) : (
        <p className="font-display mb-3.5 text-center text-[40px] font-medium leading-none tracking-[-1px]">
          {money(amount)}
        </p>
      )}

      <div className={cn('mb-4 flex gap-1.5', presets.length === 0 && !maxLabel && 'hidden')}>
        {presets.map((preset) => (
          <Button
            key={preset}
            variant="clear"
            size="xs"
            aria-pressed={amount === preset}
            onClick={() => onChange(preset)}
            className={cn('flex-1', amount === preset && 'border-tier-boost text-tier-boost-fg')}
          >
            {money(preset)}
          </Button>
        ))}
        {maxLabel && maxAmount !== undefined && (
          <Button
            variant="clear"
            size="xs"
            aria-pressed={amount === maxAmount}
            onClick={() => onChange(maxAmount)}
            className={cn('flex-1', amount === maxAmount && 'border-tier-boost text-tier-boost-fg')}
          >
            {maxLabel}
          </Button>
        )}
      </div>
    </>
  );
}
