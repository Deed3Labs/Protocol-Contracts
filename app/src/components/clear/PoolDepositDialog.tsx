import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import AmountPicker from './AmountPicker';
import DetailRows from './DetailRows';
import InfoBlock from './InfoBlock';
import { money } from '@/lib/money';
import type { EarnData } from '@/lib/clearModel';

/**
 * Deposit to the yield pool — the counterpart to buying a bond.
 *
 * The pool's whole pitch is that you can leave whenever, so the caveat has to be
 * stated plainly rather than buried: at high utilization a withdrawal queues
 * until members repay. Better to know that now than at the moment you need it.
 */
export default function PoolDepositDialog({
  data,
  open,
  onOpenChange,
  onDeposit,
}: {
  data: EarnData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeposit?: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(2500);

  const estimatedYear = amount * (data.pool.apy / 100);
  const addsToLimit = Math.round(amount * data.poolLtv);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Deposit to yield pool"
      description="Choose how much to deposit and review the rate and what it adds to your limit."
    >
      <AmountPicker
        amount={amount}
        presets={[500, 2500]}
        onChange={setAmount}
        maxLabel="Max"
        maxAmount={data.payFrom.balance}
      />

      <DetailRows
        className="mb-3"
        rows={[
          { label: 'Pay from', value: `${data.payFrom.label} · ${money(data.payFrom.balance)}` },
          { label: 'Current rate', value: `${data.pool.apy}% APY · variable` },
          { label: 'Est. earnings, 12 mo', value: `~${money(Math.round(estimatedYear))}` },
        ]}
        footer={{ label: 'Adds to your credit limit', value: `+${money(addsToLimit)}` }}
      />

      <InfoBlock className="mb-3.5">
        Withdraw any time. At high utilization withdrawals may queue until members repay.
      </InfoBlock>

      <Button size="xs" className="w-full" onClick={() => onDeposit?.(amount)}>
        Deposit {money(amount)}
      </Button>
    </Modal>
  );
}
