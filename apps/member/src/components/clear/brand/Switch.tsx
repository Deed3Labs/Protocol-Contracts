import { cn } from '@/lib/utils';

/**
 * The guide's switch. It is neither a button nor a status chip — the only things with pill radius —
 * so the track and the knob are both square: settled green when on, ink 28 when off.
 */
export default function Switch({
  checked,
  onCheckedChange,
  id,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  /** For a switch with no visible label beside it to point at. */
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn('c-sw', checked && 'c-on', disabled && 'cursor-default opacity-60')}
    >
      <span className="c-knob" />
    </button>
  );
}
