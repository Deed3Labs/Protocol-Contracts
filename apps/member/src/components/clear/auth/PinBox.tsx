import { useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * A code is six boxes, not a text field — the same component as the four digits on Card.
 *
 * Filled boxes take the ink border, the live one takes the caret, and a code that failed turns the
 * whole row absent rather than growing an error icon beside it.
 *
 * One real input sits invisibly over the boxes rather than six of them: the code arrives by SMS and
 * people paste it, autofill hands it over whole, and six single-character fields turn one paste
 * into six failures.
 */
export default function PinBox({
  value,
  onChange,
  length = 6,
  err = false,
  autoFocus = false,
  label = 'Verification code',
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  err?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const digits = value.slice(0, length).split('');

  return (
    <div className="relative">
      <div className={cn('c-pinbox', length === 6 && 'c-six', err && 'c-err')} aria-hidden>
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={cn(digits[i] && 'c-done', !err && i === digits.length && 'c-live')}
          >
            {digits[i] ?? ''}
          </span>
        ))}
      </div>
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={label}
        // The only field on the screen, and the code is already in the member's hand.
        autoFocus={autoFocus}
        className="absolute inset-0 h-full w-full cursor-default bg-transparent text-transparent caret-transparent outline-none"
      />
    </div>
  );
}
