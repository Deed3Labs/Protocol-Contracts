import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * Six-digit verification code.
 *
 * One box per digit, advancing as you type and stepping back on delete. Pasting
 * a whole code into any box fills the lot — codes arrive by SMS and people paste
 * them, and a field that only accepts one character at a time turns that into
 * six failures.
 */
export default function CodeInput({
  value,
  onChange,
  length = 6,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setDigit = (index: number, digit: string) => {
    const next = value.padEnd(length, ' ').split('');
    next[index] = digit || ' ';
    onChange(next.join('').trimEnd());
    if (digit && index < length - 1) refs.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) refs.current[index - 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;
    e.preventDefault();
    onChange(digits);
    refs.current[Math.min(digits.length, length - 1)]?.focus();
  };

  return (
    <div className="mb-4 flex gap-[7px]">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i]?.trim() ?? ''}
          onChange={(e) => setDigit(i, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={onKeyDown(i)}
          onPaste={onPaste}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          className={cn(
            'h-[46px] min-w-0 flex-1 rounded-lg border-[0.5px] bg-transparent text-center font-mono text-lg outline-none',
            'focus:border-tier-boost',
            value[i]?.trim() ? 'border-tier-boost' : 'border-border',
          )}
        />
      ))}
    </div>
  );
}
