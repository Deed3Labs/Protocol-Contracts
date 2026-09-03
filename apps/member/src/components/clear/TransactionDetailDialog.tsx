import { Copy, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import DetailRows, { type DetailRow } from './DetailRows';
import { signedMoney } from '@clear/domain';
import { capitalise, TIER_FILL, type ActivityRow } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * One transaction, opened from any of the three lists that show them.
 *
 * The row that matters is "Paid from": a card charge silently picks a tier, and
 * this is where a member finds out which one it landed on and what that draw
 * costs. Rows the data doesn't carry are dropped rather than shown blank.
 */
export default function TransactionDetailDialog({
  row,
  open,
  onOpenChange,
}: {
  row: ActivityRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rows: DetailRow[] = [];
  if (row.datetime) rows.push({ label: 'Date', value: row.datetime });

  rows.push({
    label: 'Paid from',
    value: (
      <span className="flex items-center gap-1.5">
        {row.paidFromTier && (
          <span
            aria-hidden
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TIER_FILL[row.paidFromTier])}
          />
        )}
        {row.paidFromLabel ?? capitalise(row.source)}
      </span>
    ),
  });

  if (row.rate) rows.push({ label: 'Rate on this draw', value: row.rate });
  if (row.cardLast4)
    rows.push({ label: 'Card', value: <span className="font-mono">•••• {row.cardLast4}</span> });
  if (row.status) rows.push({ label: 'Status', value: row.status });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Transaction"
      description={`${row.name}, ${signedMoney(row.amount)}.`}
    >
      <p className="font-display mb-1 text-[32px] font-medium leading-none tracking-[-0.5px]">
        {signedMoney(row.amount)}
      </p>
      <p className="mb-4 text-xs text-foreground-secondary">
        {row.name}
        {row.location && ` · ${row.location}`}
      </p>

      <DetailRows className="mb-3" rows={rows} />

      <div className="flex gap-2">
        <Button variant="clear" size="xs" className="flex-1">
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          Receipt
        </Button>
        <Button variant="clear" size="xs" className="flex-1">
          <Flag className="h-3.5 w-3.5" strokeWidth={1.75} />
          Report an issue
        </Button>
      </div>
    </Modal>
  );
}
