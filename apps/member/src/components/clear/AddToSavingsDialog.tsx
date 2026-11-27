import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import AmountPicker from './AmountPicker';
import DetailRows from './DetailRows';
import InfoBlock from './InfoBlock';
import { Check, Loader2 } from 'lucide-react';
import { money, count } from '@clear/domain';
import type { SavingsData } from '@/lib/clearModel';

/**
 * Add to savings — the flow behind "Add money" on Savings and "Add" on Home's
 * savings card.
 *
 * The matched credits are the reason anyone does this, so they lead, above the
 * mechanics. The footnote is the counterweight: this money locks up, and that
 * shouldn't be discovered later.
 *
 * Presentational. `ConnectedAddToSavings` supplies the deposit; the preview harness supplies
 * nothing and gets the same screen, which is what keeps the two honest about each other.
 */
export default function AddToSavingsDialog({
  data,
  open,
  onOpenChange,
  onAdd,
  busy = false,
  error = null,
  txHash = null,
}: {
  data: SavingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: (amount: number) => void;
  busy?: boolean;
  error?: string | null;
  /** Set once the deposit has landed — the dialog becomes a receipt rather than vanishing. */
  txHash?: string | null;
}) {
  const [amount, setAmount] = useState(500);
  // Capped against the balance this dialog actually displays, not a second number passed in beside
  // it. Those disagreed the first time round, and the disagreement was on screen: a From row
  // reading $6,200.00 above a warning that the account holds $0.00.
  const available = data.payFrom.balance;
  const overBalance = amount > available;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add to savings"
      description="Choose how much to add to savings and review the credits it earns."
    >
      {txHash ? (
        <div className="py-2 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-positive/15">
            <Check className="h-[22px] w-[22px] text-positive" strokeWidth={2.4} />
          </div>
          <p className="text-2xl font-medium">{money(amount, { cents: true })}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Added to savings · {count(amount)} in equity credits
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Credits vest after 30 days in the system.
          </p>
          <Button
            size="xs"
            variant="clear"
            className="mt-4 w-full"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      ) : (
        <>
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

      {overBalance && (
        <p className="mb-2 text-[11px] leading-relaxed text-negative">
          That&rsquo;s more than your cash account holds ({money(available, { cents: true })}).
        </p>
      )}
      {error && <p className="mb-2 text-[11px] leading-relaxed text-negative">{error}</p>}

      <Button
        size="xs"
        className="w-full"
        onClick={() => onAdd?.(amount)}
        disabled={busy || overBalance}
      >
        {busy ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Adding…
          </>
        ) : (
          `Add ${money(amount)}`
        )}
      </Button>
      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
        Locked until you reserve a home or leave.
      </p>
        </>
      )}
    </Modal>
  );
}
