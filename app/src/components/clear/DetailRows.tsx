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
 * does to the credit limit, which is the part people don't expect.
 */
export default function DetailRows({
  rows,
  footer,
  className,
}: {
  rows: DetailRow[];
  footer?: DetailRow;
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
          <span className="text-tier-savings-fg">{footer.value}</span>
        </CardRule>
      )}
    </Card>
  );
}
