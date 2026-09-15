import { Btn } from '../brand/anatomy';
import { cn } from '@/lib/utils';

/** A labelled row of choice chips — one of several on a filter or export sheet. */
export default function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  first,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  first?: boolean;
}) {
  return (
    <>
      <p className={cn('c-label', !first && 'mt-s3')}>{label}</p>
      <div className="c-qc c-split flex-wrap" role="group" aria-label={label}>
        {options.map((option) => (
          <Btn
            key={option.id}
            className={cn('c-chip-q', value === option.id && 'c-on')}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </Btn>
        ))}
      </div>
    </>
  );
}
