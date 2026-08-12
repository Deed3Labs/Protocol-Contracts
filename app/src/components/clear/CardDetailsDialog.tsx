import { ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import type { CardData } from '@/lib/clearModel';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b-[0.5px] border-border py-2 last:border-b-0">
      <span className="text-foreground-secondary">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Card details — the sub-view behind the Details action (spec §9).
 *
 * The number stays masked. Revealing a full PAN needs a call to the issuer and a
 * re-authentication step; until card issuing is live there is nothing real to
 * reveal, and rendering a plausible-looking full number would invite someone to
 * try paying with it.
 */
export default function CardDetailsDialog({
  card,
  open,
  onOpenChange,
}: {
  card: CardData;
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
          <DialogTitle className="text-[13px] font-medium">Card details</DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          Details for your Clear card. The full number stays hidden.
        </DialogDescription>

        <div className="text-xs">
          <Row label="Card number" value={`•••• •••• •••• ${card.last4}`} />
          <Row label="Cardholder" value={card.cardholder} />
          <Row label="Expires" value={card.expiry} />
          <Row label="Network" value={card.network} />
          <Row label="Status" value={card.frozen ? 'Frozen' : 'Active'} />
        </div>

        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Spends your cash first, then your credit line. No transfers needed.
        </p>
      </DialogContent>
    </Dialog>
  );
}
