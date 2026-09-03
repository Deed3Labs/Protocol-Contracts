import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import AmountPicker from './AmountPicker';
import DetailRows from './DetailRows';
import InfoBlock from './InfoBlock';
import { money } from '@clear/domain';
import {
  creditLimit,
  creditUsed,
  poolUtilization,
  type Credit,
  type EarnData,
} from '@/lib/clearModel';

/**
 * Withdraw from the yield pool.
 *
 * The position backs part of the credit line, so taking it out lowers the limit
 * — the one consequence nobody expects, which is why it gets the footer row and
 * a plain sentence rather than a footnote. The sentence changes when the
 * withdrawal would push the balance over the new limit, because at that point
 * it's not a trade-off any more, it's a repayment.
 */
export default function PoolWithdrawDialog({
  data,
  credit,
  open,
  onOpenChange,
  onWithdraw,
}: {
  data: EarnData;
  /** For working out whether the smaller limit still covers what's owed. */
  credit?: Credit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWithdraw?: (amount: number) => void;
}) {
  const available = data.pool.position + data.pool.earned;
  const [amount, setAmount] = useState(Math.min(1000, Math.round(available)));

  const limitDrop = Math.round(Math.min(amount, available) * data.poolLtv);
  const used = credit ? creditUsed(credit) : 0;
  const newLimit = credit ? creditLimit(credit) - limitDrop : 0;
  const overBy = Math.max(0, used - newLimit);
  // The sentence names what this position actually backs — the asset-backed
  // tier — not the whole balance, most of which is backed by something else.
  const backedHere = credit?.tiers.find((t) => t.key === 'asset')?.used ?? 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Withdraw from pool"
      description="Choose how much to take out and review what it does to your credit limit."
    >
      <AmountPicker
        amount={amount}
        presets={[500, 1000]}
        onChange={setAmount}
        maxLabel={`All (${money(Math.round(available))})`}
        maxAmount={Math.round(available)}
      />

      <DetailRows
        className="mb-3"
        rows={[
          { label: 'Goes to', value: 'Cash account' },
          { label: 'Arrives', value: 'Within 24 hours' },
          { label: 'Pool utilization', value: `${Math.round(poolUtilization(data.pool) * 100)}%` },
        ]}
        footer={{ label: 'Credit limit drops by', value: `−${money(limitDrop)}` }}
        footerTone="cost"
      />

      {credit && backedHere > 0 && (
        <InfoBlock className="mb-3.5">
          You&rsquo;re carrying {money(backedHere)} of credit backed partly by this position. Withdrawing
          lowers your limit —{' '}
          {overBy > 0
            ? `that would put you ${money(overBy)} over it, so you'd need to repay that first.`
            : "you'll still be under it."}
        </InfoBlock>
      )}

      <Button
        size="xs"
        className="w-full"
        disabled={amount <= 0 || amount > available}
        onClick={() => onWithdraw?.(amount)}
      >
        Withdraw {money(amount)}
      </Button>
    </Modal>
  );
}
