import { Button } from '@/components/ui/button';
import Modal from './Modal';
import { money } from '@clear/domain';
import {
  backingTotal,
  sectionTotal,
  TIER_FILL,
  type LimitBacking,
  type LimitBackingRow,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

function Row({ row, last, onAdd }: { row: LimitBackingRow; last: boolean; onAdd?: () => void }) {
  return (
    <div className={cn('py-2', !last && 'border-b-[0.5px] border-border')}>
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            'flex min-w-0 items-center gap-1.5',
            row.notAdded && 'text-muted-foreground',
          )}
        >
          <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TIER_FILL[row.tier])} />
          <span className="truncate">{row.label}</span>
        </span>

        {/* An opt-in tier isn't a number yet — it's an offer, so it gets the action
            rather than a greyed-out figure. */}
        {row.notAdded ? (
          <Button variant="clear" size="xs" className="shrink-0" onClick={onAdd}>
            Add {money(row.addAmount ?? row.contribution)}
          </Button>
        ) : (
          <span className="shrink-0 tabular-nums">{money(row.contribution)}</span>
        )}
      </div>
      <p className="pl-[14px] text-[11px] text-muted-foreground">{row.detail}</p>
    </div>
  );
}

function Section({
  title,
  rows,
  onAdd,
}: {
  title: string;
  rows: LimitBackingRow[];
  onAdd?: (row: LimitBackingRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <p className="mb-1.5 text-[11px] tracking-[0.3px] text-muted-foreground">
        {title} · {money(sectionTotal(rows))}
      </p>
      <div className="mb-3.5 text-xs">
        {rows.map((row, i) => (
          <Row key={row.label} row={row} last={i === rows.length - 1} onAdd={() => onAdd?.(row)} />
        ))}
      </div>
    </>
  );
}

/**
 * "What backs your limit" — design spec §4, the sub-view behind the credit card.
 *
 * Every figure here counts only what's actually backing the limit, so the section
 * subtotals and the footer total agree with the number on the credit card. An
 * opt-in tier that hasn't been added is still listed — as an offer with an Add
 * action — but contributes nothing until it's taken up.
 */
export default function LimitBreakdown({
  backing,
  open,
  onOpenChange,
  onAdd,
}: {
  backing: LimitBacking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: (row: LimitBackingRow) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="What backs your limit"
      description="The positions and income that set your Clear credit limit."
      onBack={() => onOpenChange(false)}
    >
      <div>
          <Section title="ASSET-BACKED" rows={backing.assetBacked} onAdd={onAdd} />
          <Section title="UNSECURED" rows={backing.unsecured} onAdd={onAdd} />

          <div className="flex items-baseline justify-between gap-3 border-t-[0.5px] border-border pt-2.5">
            <span className="text-xs text-foreground-secondary">Total limit</span>
            <span className="text-[15px] font-medium tabular-nums">{money(backingTotal(backing))}</span>
          </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Your bonds are worth more each month, so this limit grows on its own.
        </p>
      </div>
    </Modal>
  );
}
