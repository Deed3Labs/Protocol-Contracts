import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Modal from './Modal';
import AmountPicker from './AmountPicker';
import DetailRows from './DetailRows';
import { money } from '@clear/domain';
import {
  CONTACT_ROLE_LABEL,
  nextDrawTier,
  TIER_FILL,
  type Contact,
  type Credit,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Send money to a member or Clear Partner.
 *
 * "Paying from" is derived, not chosen: draws land on the cheapest tier with
 * headroom (rule 7). Showing it here means nobody discovers after the fact that
 * a send went onto credit rather than cash.
 *
 * The footnote covers the case the Activity page has a banner for — sending to
 * someone who isn't a member yet, where the money leaves but nobody has it.
 */
export default function SendMoneyDialog({
  contact,
  credit,
  cash,
  open,
  onOpenChange,
  onSend,
}: {
  contact: Contact;
  credit: Credit;
  /** Cash spends first, so it's what a send draws from while there's any left. */
  cash: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend?: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(40);
  const [note, setNote] = useState('');

  const drawTier = cash > 0 ? undefined : nextDrawTier(credit);
  const payingFrom = drawTier ? `${drawTier.label} credit` : 'Cash account';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Send money"
      description={`Send money to ${contact.name}.`}
    >
      <div className="mb-3.5 flex items-center gap-2.5 border-b-[0.5px] border-border pb-3.5">
        <span
          aria-hidden
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-tier-boost/10 text-xs text-tier-boost-fg"
        >
          {contact.initials}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px]">{contact.name}</span>
          <span className="block text-[11px] text-muted-foreground">
            {CONTACT_ROLE_LABEL[contact.role]}
            {contact.handle && ` · ${contact.handle}`}
          </span>
        </span>
      </div>

      <AmountPicker amount={amount} presets={[20, 40, 100]} onChange={setAmount} />

      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What's it for? (optional)"
        aria-label="What's it for?"
        className="mb-3.5"
      />

      <DetailRows
        className="mb-3"
        rows={[
          {
            label: 'Paying from',
            value: (
              <span className="flex items-center gap-1.5">
                {drawTier && (
                  <span
                    aria-hidden
                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TIER_FILL[drawTier.key])}
                  />
                )}
                {payingFrom}
              </span>
            ),
          },
          { label: 'Fee', value: 'None' },
          { label: 'Arrives', value: 'Instantly' },
        ]}
      />

      <Button size="xs" className="w-full" onClick={() => onSend?.(amount)}>
        Send {money(amount)}
      </Button>
      <p className="mt-2.5 text-center text-[11px] leading-relaxed text-muted-foreground">
        Sending to someone who isn&rsquo;t a member yet? They&rsquo;ll get a link and have 14 days
        to claim it.
      </p>
    </Modal>
  );
}
