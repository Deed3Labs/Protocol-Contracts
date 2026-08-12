import { ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { money } from '@/lib/money';
import {
  backingTotal,
  sectionTotal,
  TIER_FILL,
  type LimitBacking,
  type LimitBackingRow,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

function Row({ row, last }: { row: LimitBackingRow; last: boolean }) {
  return (
    <div
      className={cn('py-2', !last && 'border-b-[0.5px] border-border', row.dimmed && 'opacity-50')}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TIER_FILL[row.tier])} />
          <span className="truncate">{row.label}</span>
        </span>
        <span className="shrink-0 tabular-nums">{money(row.contribution)}</span>
      </div>
      <p className="pl-[14px] text-[11px] text-muted-foreground">{row.detail}</p>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: LimitBackingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <p className="mb-1.5 text-[11px] tracking-[0.3px] text-muted-foreground">
        {title} · {money(sectionTotal(rows))}
      </p>
      <div className="mb-3.5 text-xs">
        {rows.map((row, i) => (
          <Row key={row.label} row={row} last={i === rows.length - 1} />
        ))}
      </div>
    </>
  );
}

/**
 * "What backs your limit" — design spec §4, the sub-view behind the credit card.
 *
 * Section headers show each group's full capacity; the total at the foot is the
 * limit actually being extended, so an opt-in tier that hasn't been added is
 * listed but not counted.
 */
export default function LimitBreakdown({
  backing,
  open,
  onOpenChange,
}: {
  backing: LimitBacking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[380px] rounded-xl p-[15px]">
        <div className="mb-1 flex items-center gap-2.5">
          <DialogClose
            aria-label="Back"
            className="text-foreground-secondary transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </DialogClose>
          <DialogTitle className="text-[13px] font-medium">What backs your limit</DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          The positions and income that set your Clear credit limit.
        </DialogDescription>

        <div className="mt-1">
          <Section title="ASSET-BACKED" rows={backing.assetBacked} />
          <Section title="UNSECURED" rows={backing.unsecured} />

          <div className="flex items-baseline justify-between gap-3 border-t-[0.5px] border-border pt-2.5">
            <span className="text-xs text-foreground-secondary">Total limit</span>
            <span className="text-[15px] font-medium tabular-nums">{money(backingTotal(backing))}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Your bonds are worth more each month, so this limit grows on its own.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
