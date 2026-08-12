import { useState } from 'react';
import { Snowflake, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ClearCardFace from '@/components/clear/ClearCardFace';
import CardDetailsDialog from '@/components/clear/CardDetailsDialog';
import TransactionRows from '@/components/clear/TransactionRows';
import { CARD_IN_USE } from '@/data/clearPlaceholder';
import type { CardData } from '@/lib/clearModel';

/**
 * Card — design spec §9.
 *
 * The transactions here are card-only, which is what separates this page from
 * Activity: Activity shows everything that moved, this shows what the card did.
 *
 * Freeze holds UI state only. Nothing is issued yet, so there is no issuer call
 * to make — when card issuing goes live this is the seam that needs wiring, and
 * the control should go into a pending state until the issuer confirms.
 */
export default function CardPage({ data = CARD_IN_USE }: { data?: CardData }) {
  const [frozen, setFrozen] = useState(data.frozen);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const card = { ...data, frozen };

  const actions = card.activated ? (
    <div className="flex gap-2">
      <Button variant="clear" size="xs" className="flex-1" onClick={() => setFrozen((f) => !f)}>
        {frozen ? <Sun className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Snowflake className="h-3.5 w-3.5" strokeWidth={1.75} />}
        {frozen ? 'Unfreeze' : 'Freeze'}
      </Button>
      <Button variant="clear" size="xs" className="flex-1" onClick={() => setDetailsOpen(true)}>
        Details
      </Button>
    </div>
  ) : (
    <Button variant="clear" size="xs" className="w-full">
      Activate card
    </Button>
  );

  const caption = (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Spends your cash first, then your credit line. No transfers needed.
    </p>
  );

  const transactions = (
    <>
      <p className="mb-0.5 text-xs text-foreground-secondary">Card transactions</p>
      <TransactionRows
        rows={card.transactions}
        emptyMessage={
          card.activated
            ? 'No card spending yet.'
            : 'Activate your card and your spending will show up here.'
        }
      />
    </>
  );

  return (
    <>
      {/* Desktop: a fixed 250px card column beside the transactions */}
      <div className="lg:grid lg:grid-cols-[250px_1fr] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-3">
          <ClearCardFace card={card} />
          {actions}
          {caption}
        </div>
        <div className="mt-6 lg:mt-0">{transactions}</div>
      </div>

      <CardDetailsDialog card={card} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </>
  );
}
