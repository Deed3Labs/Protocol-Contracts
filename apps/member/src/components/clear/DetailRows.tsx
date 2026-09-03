import type { ReactNode } from 'react';
import Card, { CardRule } from './Card';

export interface DetailRow {
  label: string;
  value: ReactNode;
  /** Emphasise the figure — for the one line that's the point of the surface. */
  strong?: boolean;
}

/**
 * The label/value list every task surface uses to spell out what's about to
 * happen: what you pay from, what rate applies, when it lands.
 *
 * `footer` sits below a hairline for the consequence — usually what the action
 * does to the credit limit, which is the part people don't expect. It reads as a
 * gain by default; `footerTone="cost"` is for the ones that take something away,
 * which stay in the secondary text colour rather than turning red. Lowering your
 * own limit by withdrawing your own money is a trade-off, not an error.
 */
export default function DetailRows({
  rows,
  footer,
  footerTone = 'gain',
  className,
}: {
  rows: DetailRow[];
  footer?: DetailRow;
  footerTone?: 'gain' | 'cost';
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="text-xs leading-[2]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <span className="text-foreground-secondary">{row.label}</span>
            <span className={row.strong ? 'font-medium' : undefined}>{row.value}</span>
          </div>
        ))}
      </div>

      {footer && (
        <CardRule className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-foreground-secondary">{footer.label}</span>
          <span className={footerTone === 'cost' ? 'text-foreground-secondary' : 'text-tier-savings-fg'}>
            {footer.value}
          </span>
        </CardRule>
      )}
    </Card>
  );
}
