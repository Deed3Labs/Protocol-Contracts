import type { ReactNode } from 'react';
import Modal from './Modal';
import { Btn, Rows } from './brand/anatomy';
import { TIER_TEXT_CLASS } from './ClearCreditCard';
import { signedMoney } from '@clear/domain';
import { capitalise, TIER_SHORT_LABEL, type ActivityRow } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * One transaction, opened from any list that shows them.
 *
 * The row that matters is "Paid from": a card charge silently picks a tier, and this is where a
 * member finds out which one it landed on and what that draw costs — so it takes the tier's colour.
 * Rows the data doesn't carry are dropped rather than shown blank.
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
  const details: { label: string; value: ReactNode; className?: string }[] = [];
  if (row.datetime) details.push({ label: 'Date', value: row.datetime });
  details.push({
    label: 'Paid from',
    value: row.paidFromLabel ?? (row.paidFromTier ? `${TIER_SHORT_LABEL[row.paidFromTier]} credit` : capitalise(row.source)),
    className: row.paidFromTier ? TIER_TEXT_CLASS[row.paidFromTier] : undefined,
  });
  if (row.rate) details.push({ label: 'Rate on this draw', value: row.rate });
  if (row.cardLast4) details.push({ label: 'Card', value: `•••• ${row.cardLast4}`, className: 'c-mono' });
  if (row.status) details.push({ label: 'Status', value: row.status });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Transaction"
      description={`${row.name}, ${signedMoney(row.amount)}.`}
      footer={
        <div className="c-pair">
          <Btn>Split this</Btn>
          <Btn>Something wrong</Btn>
        </div>
      }
    >
      <p className="c-bigamt text-hero-m">{signedMoney(row.amount)}</p>
      <p className="c-sub mt-[6px]">
        {row.name}
        {row.location && ` · ${row.location}`}
      </p>
      <Rows className="mt-s3">
        {details.map((d) => (
          <div key={d.label}>
            <div className="c-kv">
              <span>{d.label}</span>
              <span className={cn('c-v', d.className)}>{d.value}</span>
            </div>
          </div>
        ))}
      </Rows>
    </Modal>
  );
}
