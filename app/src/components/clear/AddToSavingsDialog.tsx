import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import AmountPicker from './AmountPicker';
import DetailRows from './DetailRows';
import InfoBlock from './InfoBlock';
import { money, count } from '@/lib/money';
import type { SavingsData } from '@/lib/clearModel';

/**
 * Add to savings — the flow behind "Add money" on Savings and "Add" on Home's
 * savings card.
 *
 * The matched credits are the reason anyone does this, so they lead, above the
 * mechanics. The footnote is the counterweight: this money locks up, and that
 * shouldn't be discovered later.
 */
export default function AddToSavingsDialog({
  data,
  open,
  onOpenChange,
  onAdd,
}: {
  data: SavingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(500);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add to savings"
      description="Choose how much to add to savings and review the credits it earns."
    >
      <AmountPicker amount={amount} presets={[100, 500, 1000]} onChange={setAmount} />

      <InfoBlock tone="success" className="mb-3">
        <p className="mb-[3px] font-medium">
          You&rsquo;ll get {count(amount)} in equity credits
        </p>
        <p className="text-[11px] leading-snug">Matched 1:1. Vests after 30 days in the system.</p>
      </InfoBlock>

      <DetailRows
        className="mb-3"
        rows={[
          { label: 'From', value: `${data.payFrom.label} · ${money(data.payFrom.balance)}` },
          { label: 'Repeat', value: 'Every payday' },
          { label: 'New credit limit', value: money(data.creditLimitToday + amount) },
        ]}
      />

      <Button size="xs" className="w-full" onClick={() => onAdd?.(amount)}>
        Add {money(amount)}
      </Button>
      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
        Locked until you reserve a home or leave.
      </p>
    </Modal>
  );
}
