import { useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Btn } from './anatomy';
import { CaretIcon, TickIcon } from './icons';
import { cn } from '@/lib/utils';

/**
 * A control-bar menu — the list control that replaced filter chips. Chips do not scale past about
 * three options and wrap onto two lines at phone width; a menu button holds any number on one line.
 *
 * The trigger is the guide's button with a caret. The menu is a small sheet of rows, the current
 * choice ticked.
 */
export default function MenuButton<T extends string>({
  label,
  icon,
  options,
  value,
  onChange,
  align = 'start',
}: {
  /** What the button says — usually the current choice. */
  label: string;
  /** A leading glyph (sort). */
  icon?: ReactNode;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Btn aria-haspopup="menu" aria-expanded={open}>
          {icon}
          {label}
          <CaretIcon />
        </Btn>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="c-text w-[200px] rounded-none border-ink-28 bg-paper px-s2 py-s1 text-ink shadow-none outline-none"
      >
        <div role="menu">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === value}
              className={cn('c-menurow justify-between', option.id === value && 'font-medium')}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              {option.label}
              {option.id === value && <TickIcon className="text-ink" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
