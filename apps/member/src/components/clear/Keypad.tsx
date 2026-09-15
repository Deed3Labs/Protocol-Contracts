import { BackspaceIcon } from './brand/icons';
import { cn } from '@/lib/utils';

/**
 * The digit pad for amount entry — the guide's `.keypad`: cells on a 1px seam, the slab idea at
 * small scale, with the point and delete keys in ink-50.
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
  className,
}: {
  onKey: (key: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('c-keypad', className)}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onKey(key)}
          aria-label={key === 'del' ? 'Delete' : key}
          className={cn((key === '.' || key === 'del') && 'c-fn')}
        >
          {key === 'del' ? <BackspaceIcon /> : key}
        </button>
      ))}
    </div>
  );
}
