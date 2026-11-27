import { useState } from 'react';
import { money } from '@clear/domain';
import { cn } from '@/lib/utils';

/**
 * The amount a modal is about to act on — the guide's `.bigamt`: dollars in ink, the cents in ink-50.
 *
 * `editable` makes it a field, for Custom. While focused it holds what was typed rather than what
 * that parses to: reformatting on every keystroke fights the caret, and a typed decimal point would
 * vanish the moment it was entered.
 */
export default function BigAmount({
  amount,
  onChange,
  editable,
  className,
  label = 'Amount',
}: {
  amount: number;
  onChange?: (amount: number) => void;
  editable?: boolean;
  className?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);

  const formatted = money(amount, { cents: true });
  const dot = formatted.lastIndexOf('.');
  const whole = dot === -1 ? formatted : formatted.slice(0, dot);
  const dec = dot === -1 ? '' : formatted.slice(dot);

  if (editable) {
    return (
      <input
        value={focused ? draft : formatted}
        onFocus={() => {
          setDraft(String(amount));
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const typed = e.target.value.replace(/[^0-9.]/g, '');
          setDraft(typed);
          onChange?.(Number(typed) || 0);
        }}
        inputMode="decimal"
        aria-label={label}
        className={cn('c-bigamt w-full bg-transparent outline-none', className)}
      />
    );
  }

  return (
    <p className={cn('c-bigamt', className)}>
      {whole}
      <span className="c-dec">{dec}</span>
    </p>
  );
}
