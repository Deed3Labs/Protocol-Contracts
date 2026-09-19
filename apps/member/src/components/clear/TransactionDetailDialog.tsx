import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  /*
   * "Something wrong" is a dispute. The disputes page says who decides it before anything is filed,
   * and when this payment is one the disputes API can name, it arrives with the payment chosen.
   */
  const somethingWrong = () => {
    onOpenChange(false);
    navigate('/settings/disputes', row.dispute ? { state: { dispute: row.dispute } } : undefined);
  };
  const details: { label: string; value: ReactNode; className?: string }[] = [];
  if (row.datetime) details.push({ label: 'Date', value: row.datetime });
  /*
   * A reversed charge is not paid from anywhere.
   *
   * Naming a tier beside money that came back is the one line here a member could act on wrongly —
   * they would go looking for a draw against a limit that no longer carries it. It says what became
   * of the charge instead.
   */
  if (row.reversed) {
    details.push({ label: 'Status', value: 'Reversed' });
  } else {
    details.push({
      label: 'Paid from',
      value: row.paidFromLabel ?? (row.paidFromTier ? `${TIER_SHORT_LABEL[row.paidFromTier]} credit` : capitalise(row.source)),
      className: row.paidFromTier ? TIER_TEXT_CLASS[row.paidFromTier] : undefined,
    });
  }
  if (row.rate) details.push({ label: 'Rate on this draw', value: row.rate });
  if (row.cardLast4) details.push({ label: 'Card', value: `•••• ${row.cardLast4}`, className: 'c-mono' });
  if (row.status) details.push({ label: 'Status', value: row.status });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={row.kind === 'repayment' ? 'Repayment' : 'Transaction'}
      description={`${row.name}, ${signedMoney(row.amount)}.`}
      footer={
        /*
         * Split is hidden for now. It belongs on Clear Partner charges, not on every card swipe, and
         * until partner charges are told apart here the button would offer something it cannot do.
         */
        // A repayment is the member's own payment against their balance; there is nothing to dispute.
        row.kind === 'repayment' ? undefined : (
          <Btn lg onClick={somethingWrong}>
            Something wrong
          </Btn>
        )
      }
    >
      <p className={cn('c-bigamt text-hero-m', row.reversed && 'text-ink-50 line-through')}>
        {signedMoney(row.amount)}
      </p>
      <p className="c-sub mt-[6px]">
        {row.name}
        {row.location && ` · ${row.location}`}
      </p>
      {row.reversed && (
        <p className="c-det mt-s1">This charge was reversed. The money is back on your limit.</p>
      )}
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
