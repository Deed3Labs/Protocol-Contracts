import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Filter chips — design spec §8. The selected chip takes the accent border and
 * text; the rest stay as plain hairline buttons.
 *
 * Scrolls horizontally on narrow phones rather than wrapping to a second row,
 * so the list below never shifts down as the filter set changes.
 */
export default function FilterChips<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { id: T; label: string; mobile?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Bleeds to the page edge on mobile so chips can scroll past it. The
        // vertical padding matters: `overflow-x: auto` forces `overflow-y: auto`
        // too, which clips the chip borders without it. The scrollbar itself is
        // hidden by the .overflow-x-auto rule in index.css.
        '-mx-5 flex gap-[7px] overflow-x-auto px-5 py-1 lg:mx-0 lg:px-0',
        className,
      )}
    >
      {options.map((opt) => (
        <Button
          key={opt.id}
          variant="clear"
          size="xs"
          aria-pressed={value === opt.id}
          onClick={() => onChange(opt.id)}
          className={cn(
            'shrink-0',
            // Filters not marked for mobile stay in the DOM but off a phone's
            // strip — a chip you have to scroll to find isn't doing its job.
            !opt.mobile && 'hidden lg:inline-flex',
            value === opt.id && 'border-tier-boost text-tier-boost-fg',
          )}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
