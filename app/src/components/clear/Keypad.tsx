import { Delete } from 'lucide-react';

/**
 * The digit pad for amount entry — design spec, "Move money".
 *
 * A pad rather than a text input because these surfaces are thumb-first and the amount is the only
 * thing being typed. It also removes a class of problem a numeric text field has on mobile: no
 * caret to fight, no keyboard covering the consequences the member is supposed to be reading while
 * they type, and no way to enter anything that is not a number.
 *
 * Entry is string-based, not numeric. "250." is a state somebody passes through on the way to
 * "250.5", and a pad that parsed on every press would erase the decimal point the moment it was
 * entered.
 */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

export default function Keypad({
  onKey,
  disabled = false,
}: {
  onKey: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onKey(key)}
          aria-label={key === 'del' ? 'Delete' : key}
          className="flex h-12 items-center justify-center rounded-[10px] bg-secondary/50 text-[17px] tabular-nums transition-colors hover:bg-secondary active:bg-secondary/80 disabled:opacity-40"
        >
          {key === 'del' ? <Delete className="h-[18px] w-[18px]" /> : key}
        </button>
      ))}
    </div>
  );
}
